import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  signal
} from '@angular/core';

import { CommonModule } from '@angular/common';

import { NormalizedLandmark } from '@mediapipe/tasks-vision';

import { Pose } from '../../services/pose';

import {
  Measurement,
  PoseMeasurements
} from '../../services/measurement';

import {
  SizeRecommendation,
  SizeResult
} from '../../services/size-recommendation';


type CaptureState =
  | 'idle'
  | 'positioning'
  | 'countdown'
  | 'ready'
  | 'analysing'
  | 'complete';


interface PositionCheck {
  valid: boolean;
  message: string;
}


@Component({
  selector: 'app-fit-assistant',
  imports: [CommonModule],
  templateUrl: './fit-assistant.html',
  styleUrl: './fit-assistant.css'
})
export class FitAssistant
  implements AfterViewInit, OnDestroy {

  @ViewChild('videoElement')
  videoElement!: ElementRef<HTMLVideoElement>;

  @ViewChild('canvasElement')
  canvasElement!: ElementRef<HTMLCanvasElement>;


  // -------------------------------------------------
  // Reactive UI state
  // -------------------------------------------------

  isCameraActive = signal(false);

  isModelReady = signal(false);

  isTorsoVisible = signal(false);

  isPositionValid = signal(false);

  isAnalysing = signal(false);

  captureState =
    signal<CaptureState>('idle');

  countdown =
    signal<number | null>(null);

  guidanceMessage = signal(
    'Start the camera and position your upper body in the frame.'
  );


  // -------------------------------------------------
  // Analysis results
  // -------------------------------------------------

  measurements:
    PoseMeasurements | null = null;

  sizeResult:
    SizeResult | null = null;


  // -------------------------------------------------
  // Multi-frame sampling
  // -------------------------------------------------

  private measurementSamples:
    PoseMeasurements[] = [];

  private readonly maxSamples = 30;

  private readonly minimumSamplesForAnalysis = 10;


  // -------------------------------------------------
  // Positioning guide
  // -------------------------------------------------

  /*
   * These normalized coordinates approximately correspond
   * to the visual positioning guide in the CSS.
   */
  private readonly shoulderTargetY = 0.29;

  private readonly shoulderToleranceY = 0.09;

  private readonly hipTargetY = 0.68;

  private readonly hipToleranceY = 0.10;

  private readonly centreTargetX = 0.50;

  private readonly centreToleranceX = 0.12;


  /*
   * Secondary scale constraint.
   *
   * This prevents very small or very large torso detections
   * from being accepted even if the landmarks happen to
   * align with the guide.
   */
  private readonly minimumTorsoLength = 0.28;

  private readonly maximumTorsoLength = 0.52;


  // -------------------------------------------------
  // Analysis workflow state
  // -------------------------------------------------

  /*
   * True after at least one successful recommendation.
   */
  private hasCompletedAnalysis = false;


  /*
   * After an analysis, the system deliberately waits for
   * the participant to leave the valid positioning state.
   *
   * This prevents continuous automatic recommendations
   * while the person remains standing still.
   */
  private waitingForReposition = false;


  /*
   * Becomes true once the participant has moved outside
   * the valid positioning state after an analysis.
   *
   * Returning to the guide then begins a fresh automatic
   * measurement cycle.
   */
  private repositionDetected = false;


  /*
   * Manual Analyse Fit remains available as a fallback.
   *
   * When true, fresh measurements are collected during
   * the manual three-second countdown.
   */
  private manualReanalysisInProgress = false;


  private countdownInProgress = false;

  private countdownTimer:
    ReturnType<typeof setTimeout> | null = null;

  private animationFrameId:
    number | null = null;

  private stream:
    MediaStream | null = null;


  constructor(
    private poseService: Pose,
    private measurementService: Measurement,
    private sizeRecommendationService: SizeRecommendation
  ) {}


  // -------------------------------------------------
  // MediaPipe initialisation
  // -------------------------------------------------

  async ngAfterViewInit():
    Promise<void> {

    try {

      await this.poseService.initialise();

      this.isModelReady.set(true);

      console.log(
        'Pose model loaded successfully.'
      );

    } catch (error) {

      console.error(
        'Pose model could not be loaded:',
        error
      );

      this.isModelReady.set(false);

      this.guidanceMessage.set(
        'The pose detection model could not be loaded.'
      );
    }
  }


  // -------------------------------------------------
  // Camera
  // -------------------------------------------------

  async startCamera():
    Promise<void> {

    try {

      if (!this.isModelReady()) {

        this.guidanceMessage.set(
          'Please wait for the pose detection model to finish loading.'
        );

        return;
      }


      /*
       * Clean up any previous camera session.
       */
      this.stopCamera();


      // Reset fitting-session data.
      this.measurementSamples = [];

      this.measurements = null;

      this.sizeResult = null;


      // Reset workflow.
      this.hasCompletedAnalysis = false;

      this.waitingForReposition = false;

      this.repositionDetected = false;

      this.manualReanalysisInProgress = false;


      const video =
        this.videoElement.nativeElement;


      this.stream =
        await navigator.mediaDevices
          .getUserMedia({

            video: {

              width: {
                ideal: 640
              },

              height: {
                ideal: 480
              },

              facingMode: 'user'
            },

            audio: false
          });


      video.srcObject =
        this.stream;


      /*
       * Wait for the browser to expose the video dimensions.
       */
      await new Promise<void>(
        (resolve) => {

          video.onloadedmetadata =
            () => resolve();
        }
      );


      await video.play();


      this.isCameraActive.set(true);

      this.isTorsoVisible.set(false);

      this.isPositionValid.set(false);

      this.isAnalysing.set(false);

      this.captureState.set(
        'positioning'
      );


      this.guidanceMessage.set(
        'Move into the guide and align your shoulders and hips with the guide lines.'
      );


      this.detectPose();

    } catch (error) {

      console.error(
        'Camera could not be started:',
        error
      );

      this.isCameraActive.set(false);

      this.guidanceMessage.set(
        'Camera access failed. Please check your browser camera permissions.'
      );
    }
  }


  stopCamera(): void {

    this.isCameraActive.set(false);

    this.isTorsoVisible.set(false);

    this.isPositionValid.set(false);

    this.isAnalysing.set(false);

    this.captureState.set('idle');


    this.cancelCountdown();


    this.manualReanalysisInProgress = false;

    this.waitingForReposition = false;

    this.repositionDetected = false;


    if (
      this.animationFrameId !== null
    ) {

      cancelAnimationFrame(
        this.animationFrameId
      );

      this.animationFrameId = null;
    }


    if (this.stream) {

      this.stream
        .getTracks()
        .forEach(
          (track) => track.stop()
        );

      this.stream = null;
    }


    const video =
      this.videoElement?.nativeElement;


    if (video) {

      video.pause();

      video.srcObject = null;
    }


    const canvas =
      this.canvasElement?.nativeElement;


    if (canvas) {

      /*
       * Resetting the width clears all canvas drawings.
       */
      canvas.width =
        canvas.width;
    }


    this.guidanceMessage.set(
      'Camera stopped. Start the camera to begin a new fitting session.'
    );
  }


  // -------------------------------------------------
  // Manual fallback analysis
  // -------------------------------------------------

  analyseFit(): void {

    if (!this.isCameraActive()) {
      return;
    }


    if (
      !this.isTorsoVisible() ||
      !this.isPositionValid()
    ) {

      this.guidanceMessage.set(
        'Align your shoulders and hips with the positioning guide before analysing.'
      );

      return;
    }


    if (
      this.countdownInProgress ||
      this.isAnalysing()
    ) {
      return;
    }


    /*
     * Manual analysis always starts with a fresh
     * measurement buffer.
     *
     * The participant therefore receives a genuinely
     * new measurement rather than one influenced by
     * previous frames.
     */
    this.measurementSamples = [];

    this.manualReanalysisInProgress = true;


    this.startManualCountdown();
  }


  // -------------------------------------------------
  // Pose detection loop
  // -------------------------------------------------

  private detectPose(): void {

    const video =
      this.videoElement.nativeElement;

    const canvas =
      this.canvasElement.nativeElement;

    const context =
      canvas.getContext('2d');


    if (
      !context ||
      !this.isCameraActive()
    ) {
      return;
    }


    if (
      video.videoWidth === 0 ||
      video.videoHeight === 0
    ) {

      this.animationFrameId =
        requestAnimationFrame(
          () => this.detectPose()
        );

      return;
    }


    canvas.width =
      video.videoWidth;

    canvas.height =
      video.videoHeight;


    const result =
      this.poseService.detect(
        video,
        performance.now()
      );


    context.clearRect(
      0,
      0,
      canvas.width,
      canvas.height
    );


    if (
      result?.landmarks?.length
    ) {

      const landmarks =
        result.landmarks[0];


      this.drawLandmarks(
        context,
        landmarks,
        canvas.width,
        canvas.height
      );


      const torsoVisible =
        this.checkTorsoVisibility(
          landmarks
        );


      this.isTorsoVisible.set(
        torsoVisible
      );


      if (!torsoVisible) {

        this.handleMissingTorso();

      } else {

        const calculatedMeasurements =
          this.measurementService
            .calculate(landmarks);


        if (!calculatedMeasurements) {

          this.handleMissingTorso();

        } else {

          const positionCheck =
            this.checkGuideAlignment(
              landmarks,
              calculatedMeasurements
            );


          this.isPositionValid.set(
            positionCheck.valid
          );


          if (
            positionCheck.valid &&
            !this.isAnalysing()
          ) {

            this.handleValidPosition(
              calculatedMeasurements
            );

          } else if (
            !positionCheck.valid &&
            !this.isAnalysing()
          ) {

            this.handleInvalidPosition(
              positionCheck.message
            );
          }
        }
      }

    } else {

      this.handleMissingTorso();
    }


    this.animationFrameId =
      requestAnimationFrame(
        () => this.detectPose()
      );
  }


  // -------------------------------------------------
  // Positioning guide validation
  // -------------------------------------------------

  private checkGuideAlignment(
    landmarks: NormalizedLandmark[],
    measurements: PoseMeasurements
  ): PositionCheck {

    const leftShoulder =
      landmarks[11];

    const rightShoulder =
      landmarks[12];

    const leftHip =
      landmarks[23];

    const rightHip =
      landmarks[24];


    const shoulderMidX =
      (
        leftShoulder.x +
        rightShoulder.x
      ) / 2;


    const shoulderMidY =
      (
        leftShoulder.y +
        rightShoulder.y
      ) / 2;


    const hipMidX =
      (
        leftHip.x +
        rightHip.x
      ) / 2;


    const hipMidY =
      (
        leftHip.y +
        rightHip.y
      ) / 2;


    const torsoCentreX =
      (
        shoulderMidX +
        hipMidX
      ) / 2;


    // -----------------------------
    // Camera distance / scale
    // -----------------------------

    if (
      measurements.torsoLength <
      this.minimumTorsoLength
    ) {

      return {
        valid: false,
        message:
          'Move slightly closer to the camera.'
      };
    }


    if (
      measurements.torsoLength >
      this.maximumTorsoLength
    ) {

      return {
        valid: false,
        message:
          'Move slightly farther from the camera.'
      };
    }


    // -----------------------------
    // Shoulder alignment
    // -----------------------------

    if (
      shoulderMidY <
      this.shoulderTargetY -
        this.shoulderToleranceY
    ) {

      return {
        valid: false,
        message:
          'Move slightly lower so your shoulders align with the upper guide line.'
      };
    }


    if (
      shoulderMidY >
      this.shoulderTargetY +
        this.shoulderToleranceY
    ) {

      return {
        valid: false,
        message:
          'Move slightly higher so your shoulders align with the upper guide line.'
      };
    }


    // -----------------------------
    // Hip alignment
    // -----------------------------

    if (
      hipMidY <
      this.hipTargetY -
        this.hipToleranceY
    ) {

      return {
        valid: false,
        message:
          'Move slightly lower so your hips align with the lower guide line.'
      };
    }


    if (
      hipMidY >
      this.hipTargetY +
        this.hipToleranceY
    ) {

      return {
        valid: false,
        message:
          'Move slightly higher so your hips align with the lower guide line.'
      };
    }


    // -----------------------------
    // Horizontal centring
    // -----------------------------

    if (
      Math.abs(
        torsoCentreX -
        this.centreTargetX
      ) >
      this.centreToleranceX
    ) {

      return {
        valid: false,
        message:
          'Move your torso slightly toward the centre of the guide.'
      };
    }


    return {
      valid: true,
      message:
        'Position looks good.'
    };
  }


  // -------------------------------------------------
  // Valid positioning
  // -------------------------------------------------

  private handleValidPosition(
    measurements: PoseMeasurements
  ): void {

    /*
     * MANUAL FALLBACK
     *
     * If the user explicitly selected Analyse Fit,
     * collect fresh measurements throughout the
     * three-second countdown.
     */
    if (
      this.manualReanalysisInProgress
    ) {

      this.addMeasurementSample(
        measurements
      );

      return;
    }


    /*
     * AFTER AN ANALYSIS
     *
     * Do not immediately analyse the person again while
     * they remain standing in exactly the same valid pose.
     *
     * We first require them to leave the valid position.
     */
    if (
      this.hasCompletedAnalysis &&
      this.waitingForReposition &&
      !this.repositionDetected
    ) {

      this.captureState.set(
        'complete'
      );


      this.guidanceMessage.set(
        'Recommendation complete. Move out of position and return to the guide to analyse again.'
      );

      return;
    }


    /*
     * FIRST ANALYSIS
     */
    if (!this.hasCompletedAnalysis) {

      this.addMeasurementSample(
        measurements
      );


      if (
        !this.countdownInProgress &&
        this.measurementSamples.length >=
          this.minimumSamplesForAnalysis
      ) {

        this.startAutomaticCountdown(
          false
        );

        return;
      }


      if (!this.countdownInProgress) {

        this.captureState.set(
          'positioning'
        );


        this.guidanceMessage.set(
          'Position looks good. Hold still while measurements are collected.'
        );
      }


      return;
    }


    /*
     * HANDS-FREE RE-ANALYSIS
     *
     * The user has already moved out of the guide and has
     * now returned to a valid position.
     *
     * Measurements were cleared when repositioning was
     * detected, so this is a completely fresh capture.
     */
    if (
      this.waitingForReposition &&
      this.repositionDetected
    ) {

      this.addMeasurementSample(
        measurements
      );


      if (
        !this.countdownInProgress &&
        this.measurementSamples.length >=
          this.minimumSamplesForAnalysis
      ) {

        this.startAutomaticCountdown(
          true
        );

        return;
      }


      if (!this.countdownInProgress) {

        this.captureState.set(
          'ready'
        );


        this.guidanceMessage.set(
          'Position looks good. Hold still for another analysis.'
        );
      }
    }
  }


  // -------------------------------------------------
  // Invalid positioning
  // -------------------------------------------------

  private handleInvalidPosition(
    message: string
  ): void {

    this.isPositionValid.set(false);


    /*
     * Leaving a valid position during an analysis
     * countdown cancels that capture.
     */
    if (
      this.countdownInProgress
    ) {

      this.cancelCountdown();
    }


    /*
     * If a manual capture was interrupted, stop the
     * manual workflow and allow the normal hands-free
     * repositioning workflow to take over.
     */
    if (
      this.manualReanalysisInProgress
    ) {

      this.manualReanalysisInProgress = false;

      this.measurementSamples = [];


      if (this.hasCompletedAnalysis) {

        this.waitingForReposition = true;

        this.repositionDetected = true;
      }
    }


    /*
     * Detect deliberate repositioning after an analysis.
     *
     * The first time the user leaves the valid guide,
     * clear all previous samples.
     */
    if (
      this.hasCompletedAnalysis &&
      this.waitingForReposition &&
      !this.repositionDetected
    ) {

      this.repositionDetected = true;

      this.measurementSamples = [];


      this.captureState.set(
        'positioning'
      );


      this.guidanceMessage.set(
        'Reposition yourself inside the guide. The next analysis will begin automatically.'
      );

      return;
    }


    this.captureState.set(
      'positioning'
    );


    /*
     * Once repositioning has already been detected,
     * continue showing useful positioning guidance.
     */
    if (
      this.hasCompletedAnalysis &&
      this.repositionDetected
    ) {

      this.guidanceMessage.set(
        message
      );

      return;
    }


    this.guidanceMessage.set(
      message
    );
  }


  // -------------------------------------------------
  // Missing torso
  // -------------------------------------------------

  private handleMissingTorso():
    void {

    this.isTorsoVisible.set(false);

    this.isPositionValid.set(false);


    if (
      this.countdownInProgress
    ) {

      this.cancelCountdown();
    }


    if (
      this.manualReanalysisInProgress
    ) {

      this.manualReanalysisInProgress = false;

      this.measurementSamples = [];
    }


    /*
     * Leaving the camera frame also counts as deliberate
     * repositioning after a completed recommendation.
     */
    if (
      this.hasCompletedAnalysis &&
      this.waitingForReposition &&
      !this.repositionDetected
    ) {

      this.repositionDetected = true;

      this.measurementSamples = [];


      this.captureState.set(
        'positioning'
      );


      this.guidanceMessage.set(
        'Reposition yourself inside the guide. The next analysis will begin automatically.'
      );

      return;
    }


    if (!this.isAnalysing()) {

      this.captureState.set(
        'positioning'
      );


      this.guidanceMessage.set(
        'Keep both shoulders and both hips visible in the frame.'
      );
    }
  }


  // -------------------------------------------------
  // Automatic countdown
  // -------------------------------------------------

  private startAutomaticCountdown(
    isRepeat: boolean
  ): void {

    if (
      this.countdownInProgress
    ) {
      return;
    }


    this.countdownInProgress = true;

    this.captureState.set(
      'countdown'
    );


    this.runAutomaticCountdown(
      3,
      isRepeat
    );
  }


  private runAutomaticCountdown(
    value: number,
    isRepeat: boolean
  ): void {

    if (
      !this.isCameraActive() ||
      !this.isTorsoVisible() ||
      !this.isPositionValid()
    ) {

      this.cancelCountdown();

      this.captureState.set(
        'positioning'
      );


      this.guidanceMessage.set(
        'Return to the positioning guide.'
      );

      return;
    }


    this.countdown.set(value);


    this.guidanceMessage.set(

      value > 0

        ? (
          isRepeat

            ? `Hold still. Re-analysing in ${value}...`

            : `Hold still. First analysis in ${value}...`
        )

        : (
          isRepeat

            ? 'Re-analysing your T-shirt fit...'

            : 'Analysing your T-shirt fit...'
        )
    );


    if (value === 0) {

      this.countdownInProgress = false;

      this.countdown.set(null);


      /*
       * There should normally be more than enough frames,
       * but do not produce a recommendation if the device
       * has failed to collect the minimum number.
       */
      if (
        this.measurementSamples.length <
        this.minimumSamplesForAnalysis
      ) {

        this.captureState.set(
          'positioning'
        );


        this.guidanceMessage.set(
          'Not enough stable measurements were collected. Hold still and try again.'
        );

        return;
      }


      this.performAnalysis();

      return;
    }


    this.countdownTimer =
      setTimeout(
        () =>
          this.runAutomaticCountdown(
            value - 1,
            isRepeat
          ),
        1000
      );
  }


  // -------------------------------------------------
  // Manual countdown
  // -------------------------------------------------

  private startManualCountdown():
    void {

    if (
      this.countdownInProgress
    ) {
      return;
    }


    this.countdownInProgress = true;

    this.captureState.set(
      'countdown'
    );


    this.runManualCountdown(3);
  }


  private runManualCountdown(
    value: number
  ): void {

    if (
      !this.isCameraActive() ||
      !this.isTorsoVisible() ||
      !this.isPositionValid()
    ) {

      this.cancelCountdown();

      this.manualReanalysisInProgress = false;

      this.measurementSamples = [];


      this.captureState.set(
        'positioning'
      );


      this.guidanceMessage.set(
        'Return to the positioning guide.'
      );

      return;
    }


    this.countdown.set(value);


    this.guidanceMessage.set(

      value > 0

        ? `Hold still. Manual analysis in ${value}...`

        : 'Analysing your T-shirt fit...'
    );


    if (value === 0) {

      this.countdownInProgress = false;

      this.countdown.set(null);


      if (
        this.measurementSamples.length <
        this.minimumSamplesForAnalysis
      ) {

        this.manualReanalysisInProgress = false;


        this.captureState.set(
          'positioning'
        );


        this.guidanceMessage.set(
          'Not enough stable measurements were collected. Hold still and try again.'
        );

        return;
      }


      this.performAnalysis();

      return;
    }


    this.countdownTimer =
      setTimeout(
        () =>
          this.runManualCountdown(
            value - 1
          ),
        1000
      );
  }


  private cancelCountdown():
    void {

    if (
      this.countdownTimer !== null
    ) {

      clearTimeout(
        this.countdownTimer
      );

      this.countdownTimer = null;
    }


    this.countdownInProgress = false;

    this.countdown.set(null);
  }


  // -------------------------------------------------
  // Fit analysis
  // -------------------------------------------------

  private performAnalysis():
    void {

    if (
      this.measurementSamples.length <
      this.minimumSamplesForAnalysis
    ) {
      return;
    }


    this.isAnalysing.set(true);

    this.captureState.set(
      'analysing'
    );


    const averagedMeasurements =
      this.averageMeasurements(
        this.measurementSamples
      );


    this.measurements =
      averagedMeasurements;


    this.sizeResult =
      this.sizeRecommendationService
        .recommend(
          averagedMeasurements
        );


    /*
     * At least one successful recommendation now exists.
     */
    this.hasCompletedAnalysis = true;


    /*
     * From this point onward, automatic analysis must
     * wait until the participant deliberately moves out
     * of the valid positioning state.
     */
    this.waitingForReposition = true;

    this.repositionDetected = false;

    this.manualReanalysisInProgress = false;


    this.isAnalysing.set(false);

    this.captureState.set(
      'complete'
    );


    this.guidanceMessage.set(
      'Recommendation complete. Move out of position and return to the guide to analyse again.'
    );
  }


  // -------------------------------------------------
  // Multi-frame averaging
  // -------------------------------------------------

  private addMeasurementSample(
    measurement: PoseMeasurements
  ): void {

    this.measurementSamples.push(
      measurement
    );


    /*
     * Rolling buffer keeps only recent valid frames.
     */
    if (
      this.measurementSamples.length >
      this.maxSamples
    ) {

      this.measurementSamples.shift();
    }
  }


  private averageMeasurements(
    samples: PoseMeasurements[]
  ): PoseMeasurements {

    const count =
      samples.length;


    const totals =
      samples.reduce(

        (sum, sample) => ({

          shoulderWidth:
            sum.shoulderWidth +
            sample.shoulderWidth,

          hipWidth:
            sum.hipWidth +
            sample.hipWidth,

          torsoLength:
            sum.torsoLength +
            sample.torsoLength,

          shoulderToTorsoRatio:
            sum.shoulderToTorsoRatio +
            sample.shoulderToTorsoRatio,

          hipToTorsoRatio:
            sum.hipToTorsoRatio +
            sample.hipToTorsoRatio,

          shoulderToHipRatio:
            sum.shoulderToHipRatio +
            sample.shoulderToHipRatio

        }),

        {
          shoulderWidth: 0,
          hipWidth: 0,
          torsoLength: 0,
          shoulderToTorsoRatio: 0,
          hipToTorsoRatio: 0,
          shoulderToHipRatio: 0
        }
      );


    return {

      shoulderWidth:
        totals.shoulderWidth /
        count,

      hipWidth:
        totals.hipWidth /
        count,

      torsoLength:
        totals.torsoLength /
        count,

      shoulderToTorsoRatio:
        totals.shoulderToTorsoRatio /
        count,

      hipToTorsoRatio:
        totals.hipToTorsoRatio /
        count,

      shoulderToHipRatio:
        totals.shoulderToHipRatio /
        count
    };
  }


  // -------------------------------------------------
  // Landmark visibility
  // -------------------------------------------------

  private checkTorsoVisibility(
    landmarks: NormalizedLandmark[]
  ): boolean {

    const requiredIndices =
      [11, 12, 23, 24];


    const minimumVisibility =
      0.6;


    return requiredIndices.every(
      (index) => {

        const landmark =
          landmarks[index];


        return (
          landmark &&
          (landmark.visibility ?? 0) >=
            minimumVisibility
        );
      }
    );
  }


  // -------------------------------------------------
  // Canvas rendering
  // -------------------------------------------------

  private drawLandmarks(
    context:
      CanvasRenderingContext2D,

    landmarks:
      NormalizedLandmark[],

    width: number,

    height: number
  ): void {

    context.fillStyle =
      '#00ff88';


    landmarks.forEach(
      (point) => {

        const x =
          point.x * width;

        const y =
          point.y * height;


        context.beginPath();


        context.arc(
          x,
          y,
          4,
          0,
          2 * Math.PI
        );


        context.fill();
      }
    );


    /*
     * Highlight the torso region used by
     * the proportion calculations.
     */
    this.drawLine(
      context,
      landmarks[11],
      landmarks[12],
      width,
      height
    );


    this.drawLine(
      context,
      landmarks[23],
      landmarks[24],
      width,
      height
    );


    this.drawLine(
      context,
      landmarks[11],
      landmarks[23],
      width,
      height
    );


    this.drawLine(
      context,
      landmarks[12],
      landmarks[24],
      width,
      height
    );
  }


  private drawLine(
    context:
      CanvasRenderingContext2D,

    a:
      NormalizedLandmark,

    b:
      NormalizedLandmark,

    width: number,

    height: number
  ): void {

    if (!a || !b) {
      return;
    }


    context.strokeStyle =
      '#00ff88';

    context.lineWidth = 2;


    context.beginPath();


    context.moveTo(
      a.x * width,
      a.y * height
    );


    context.lineTo(
      b.x * width,
      b.y * height
    );


    context.stroke();
  }


  // -------------------------------------------------
  // Cleanup
  // -------------------------------------------------

  ngOnDestroy(): void {

    this.stopCamera();
  }
}