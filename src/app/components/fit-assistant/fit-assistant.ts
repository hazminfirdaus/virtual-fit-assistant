import {
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
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

  isMobileDevice = signal(false);

  isPortraitMode = signal(false);

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

  private readonly shoulderTargetY = 0.29;

  private readonly shoulderToleranceY = 0.09;

  private readonly hipTargetY = 0.68;

  private readonly hipToleranceY = 0.10;

  private readonly centreTargetX = 0.50;

  private readonly centreToleranceX = 0.12;

  private readonly minimumTorsoLength = 0.28;

  private readonly maximumTorsoLength = 0.52;


  // -------------------------------------------------
  // Analysis workflow state
  // -------------------------------------------------

  private hasCompletedAnalysis = false;

  private waitingForReposition = false;

  private repositionDetected = false;

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
  // Initialisation
  // -------------------------------------------------

  async ngAfterViewInit():
    Promise<void> {

    this.updateDeviceState();

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
  // Device orientation handling
  // -------------------------------------------------

  @HostListener('window:resize')
  onWindowResize(): void {

    this.updateDeviceState();
  }


  @HostListener('window:orientationchange')
  onOrientationChange(): void {

    setTimeout(
      () => this.updateDeviceState(),
      100
    );
  }


  private updateDeviceState(): void {

    /*
     * We use viewport width as a practical proxy for
     * identifying phone/tablet-sized devices.
     */
    const mobile =
      window.innerWidth <= 900;


    const portrait =
      window.innerHeight >
      window.innerWidth;


    this.isMobileDevice.set(
      mobile
    );


    this.isPortraitMode.set(
      mobile &&
      portrait
    );


    /*
     * If a mobile user rotates into portrait while
     * the camera is running, cancel any active capture.
     */
    if (
      this.isCameraActive() &&
      this.isPortraitMode()
    ) {

      this.cancelCountdown();

      this.isPositionValid.set(false);

      this.captureState.set(
        'positioning'
      );


      this.guidanceMessage.set(
        'Please rotate your device to landscape orientation before continuing.'
      );
    }


    /*
     * When the user returns to landscape, restore
     * positioning guidance.
     */
    if (
      this.isCameraActive() &&
      !this.isPortraitMode()
    ) {

      this.guidanceMessage.set(
        'Align your shoulders with the upper horizontal line and your hips with the lower horizontal line.'
      );
    }
  }


  private canAnalyseInCurrentOrientation():
    boolean {

    return !(
      this.isMobileDevice() &&
      this.isPortraitMode()
    );
  }


  // -------------------------------------------------
  // Camera
  // -------------------------------------------------

  async startCamera():
    Promise<void> {

    try {

      this.updateDeviceState();


      if (
        !this.canAnalyseInCurrentOrientation()
      ) {

        this.guidanceMessage.set(
          'Please rotate your device to landscape orientation before starting the camera.'
        );

        return;
      }


      if (!this.isModelReady()) {

        this.guidanceMessage.set(
          'Please wait for the pose detection model to finish loading.'
        );

        return;
      }


      this.stopCamera();


      this.measurementSamples = [];

      this.measurements = null;

      this.sizeResult = null;


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
        'Align your shoulders with the upper horizontal line and your hips with the lower horizontal line.'
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

      canvas.width =
        canvas.width;
    }


    this.guidanceMessage.set(
      'Camera stopped. Start the camera to begin a new fitting session.'
    );
  }


  // -------------------------------------------------
  // Manual fallback
  // -------------------------------------------------

  analyseFit(): void {

    if (
      !this.canAnalyseInCurrentOrientation()
    ) {

      this.guidanceMessage.set(
        'Please rotate your device to landscape orientation before analysing.'
      );

      return;
    }


    if (!this.isCameraActive()) {
      return;
    }


    if (
      !this.isTorsoVisible() ||
      !this.isPositionValid()
    ) {

      this.guidanceMessage.set(
        'Align your shoulders with the upper line and your hips with the lower line before analysing.'
      );

      return;
    }


    if (
      this.countdownInProgress ||
      this.isAnalysing()
    ) {
      return;
    }


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
      !this.canAnalyseInCurrentOrientation()
    ) {

      context.clearRect(
        0,
        0,
        canvas.width,
        canvas.height
      );


      this.isPositionValid.set(false);

      this.captureState.set(
        'positioning'
      );


      this.guidanceMessage.set(
        'Please rotate your device to landscape orientation before continuing.'
      );


      this.animationFrameId =
        requestAnimationFrame(
          () => this.detectPose()
        );

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
  // Guide validation
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


    if (
      shoulderMidY <
      this.shoulderTargetY -
        this.shoulderToleranceY
    ) {

      return {
        valid: false,
        message:
          'Move slightly lower so your shoulders align with the upper horizontal line.'
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
          'Move slightly higher so your shoulders align with the upper horizontal line.'
      };
    }


    if (
      hipMidY <
      this.hipTargetY -
        this.hipToleranceY
    ) {

      return {
        valid: false,
        message:
          'Move slightly lower so your hips align with the lower horizontal line.'
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
          'Move slightly higher so your hips align with the lower horizontal line.'
      };
    }


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
  // Valid position handling
  // -------------------------------------------------

  private handleValidPosition(
    measurements: PoseMeasurements
  ): void {

    if (
      this.manualReanalysisInProgress
    ) {

      this.addMeasurementSample(
        measurements
      );

      return;
    }


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


      if (this.hasCompletedAnalysis) {

        this.waitingForReposition = true;

        this.repositionDetected = true;
      }
    }


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
      !this.canAnalyseInCurrentOrientation() ||
      !this.isCameraActive() ||
      !this.isTorsoVisible() ||
      !this.isPositionValid()
    ) {

      this.cancelCountdown();

      this.captureState.set(
        'positioning'
      );


      this.guidanceMessage.set(
        this.isPortraitMode()
          ? 'Please rotate your device to landscape orientation before continuing.'
          : 'Return to the positioning guide.'
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
      !this.canAnalyseInCurrentOrientation() ||
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
        this.isPortraitMode()
          ? 'Please rotate your device to landscape orientation before continuing.'
          : 'Return to the positioning guide.'
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
  // Analysis
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


    this.hasCompletedAnalysis = true;

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