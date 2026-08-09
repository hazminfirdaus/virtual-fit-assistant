import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';

import { Pose } from '../../services/pose';
import { Measurement, PoseMeasurements } from '../../services/measurement';
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

@Component({
  selector: 'app-fit-assistant',
  imports: [CommonModule],
  templateUrl: './fit-assistant.html',
  styleUrl: './fit-assistant.css'
})
export class FitAssistant implements AfterViewInit, OnDestroy {
  @ViewChild('videoElement') videoElement!: ElementRef<HTMLVideoElement>;
  @ViewChild('canvasElement') canvasElement!: ElementRef<HTMLCanvasElement>;

  isCameraActive = signal(false);
  isModelReady = signal(false);
  isTorsoVisible = signal(false);
  isAnalysing = signal(false);

  captureState = signal<CaptureState>('idle');
  countdown = signal<number | null>(null);

  guidanceMessage = signal(
    'Start the camera and position your upper body in the frame.'
  );

  measurements: PoseMeasurements | null = null;
  sizeResult: SizeResult | null = null;

  // Recent valid measurements are kept in a rolling buffer.
  // This lets us average multiple frames instead of relying on one frame.
  private measurementSamples: PoseMeasurements[] = [];

  private readonly maxSamples = 30;
  private readonly minimumSamplesForAnalysis = 10;

  // The first analysis is automatic.
  // Re-analysis is initiated manually by the user.
  private automaticAnalysisCompleted = false;

  private countdownInProgress = false;
  private countdownTimer: ReturnType<typeof setTimeout> | null = null;

  private animationFrameId: number | null = null;
  private stream: MediaStream | null = null;

  constructor(
    private poseService: Pose,
    private measurementService: Measurement,
    private sizeRecommendationService: SizeRecommendation
  ) {}

  async ngAfterViewInit(): Promise<void> {
    try {
      await this.poseService.initialise();

      this.isModelReady.set(true);

      console.log('Pose model loaded successfully.');
    } catch (error) {
      console.error('Pose model could not be loaded:', error);

      this.isModelReady.set(false);

      this.guidanceMessage.set(
        'The pose detection model could not be loaded.'
      );
    }
  }

  async startCamera(): Promise<void> {
    try {
      if (!this.isModelReady()) {
        this.guidanceMessage.set(
          'Please wait for the pose detection model to finish loading.'
        );
        return;
      }

      this.stopCamera();

      // Reset session data.
      this.measurementSamples = [];
      this.measurements = null;
      this.sizeResult = null;
      this.automaticAnalysisCompleted = false;

      const video = this.videoElement.nativeElement;

      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user'
        },
        audio: false
      });

      video.srcObject = this.stream;

      await new Promise<void>((resolve) => {
        video.onloadedmetadata = () => resolve();
      });

      await video.play();

      this.isCameraActive.set(true);
      this.isTorsoVisible.set(false);
      this.isAnalysing.set(false);

      this.captureState.set('positioning');

      this.guidanceMessage.set(
        'Move into position and keep both shoulders and both hips visible.'
      );

      this.detectPose();
    } catch (error) {
      console.error('Camera could not be started:', error);

      this.isCameraActive.set(false);

      this.guidanceMessage.set(
        'Camera access failed. Please check your browser camera permissions.'
      );
    }
  }

  stopCamera(): void {
    // Change state first so the pose loop cannot draw another frame.
    this.isCameraActive.set(false);
    this.isTorsoVisible.set(false);
    this.isAnalysing.set(false);

    this.captureState.set('idle');

    this.cancelCountdown();

    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }

    const video = this.videoElement?.nativeElement;

    if (video) {
      video.pause();
      video.srcObject = null;
    }

    const canvas = this.canvasElement?.nativeElement;

    if (canvas) {
      // Resetting the dimensions clears all landmark drawings.
      canvas.width = canvas.width;
    }

    this.guidanceMessage.set(
      'Camera stopped. Start the camera to begin a new fitting session.'
    );
  }

  /**
   * Manual re-analysis.
   * The user gets another 3-second countdown so they can return
   * to a stable pose after clicking the button.
   */
  analyseFit(): void {
    if (!this.isCameraActive()) {
      return;
    }

    if (!this.isTorsoVisible()) {
      this.guidanceMessage.set(
        'Please make sure both shoulders and both hips are visible before analysing.'
      );
      return;
    }

    if (
      this.measurementSamples.length <
      this.minimumSamplesForAnalysis
    ) {
      this.guidanceMessage.set(
        'Hold still briefly while enough stable measurements are collected.'
      );
      return;
    }

    if (
      this.countdownInProgress ||
      this.isAnalysing()
    ) {
      return;
    }

    this.startManualCountdown();
  }

  private detectPose(): void {
    const video = this.videoElement.nativeElement;
    const canvas = this.canvasElement.nativeElement;
    const context = canvas.getContext('2d');

    if (!context || !this.isCameraActive()) {
      return;
    }

    if (
      video.videoWidth === 0 ||
      video.videoHeight === 0
    ) {
      this.animationFrameId =
        requestAnimationFrame(() => this.detectPose());

      return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

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

    if (result?.landmarks?.length) {
      const landmarks = result.landmarks[0];

      this.drawLandmarks(
        context,
        landmarks,
        canvas.width,
        canvas.height
      );

      const torsoVisible =
        this.checkTorsoVisibility(landmarks);

      this.isTorsoVisible.set(torsoVisible);

      const calculatedMeasurements =
        this.measurementService.calculate(landmarks);

      if (
        torsoVisible &&
        calculatedMeasurements &&
        !this.isAnalysing()
      ) {
        this.addMeasurementSample(
          calculatedMeasurements
        );

        /*
         * Trigger the initial automatic countdown once enough
         * stable samples have been collected.
         */
        if (
          !this.automaticAnalysisCompleted &&
          !this.countdownInProgress &&
          this.measurementSamples.length >=
            this.minimumSamplesForAnalysis
        ) {
          this.startAutomaticCountdown();
        } else if (
          !this.countdownInProgress &&
          this.automaticAnalysisCompleted
        ) {
          this.captureState.set('ready');

          this.guidanceMessage.set(
            'Position looks good. You can analyse your fit again.'
          );
        } else if (!this.countdownInProgress) {
          this.captureState.set('positioning');

          this.guidanceMessage.set(
            'Position looks good. Hold still while measurements are collected.'
          );
        }
      } else if (
        !torsoVisible &&
        !this.isAnalysing()
      ) {
        if (this.countdownInProgress) {
          this.cancelCountdown();
        }

        this.captureState.set('positioning');

        this.guidanceMessage.set(
          'Keep both shoulders and both hips visible in the frame.'
        );
      }
    } else {
      this.isTorsoVisible.set(false);

      if (this.countdownInProgress) {
        this.cancelCountdown();
      }

      if (!this.isAnalysing()) {
        this.captureState.set('positioning');

        this.guidanceMessage.set(
          'No pose detected. Move into the camera frame.'
        );
      }
    }

    this.animationFrameId =
      requestAnimationFrame(() => this.detectPose());
  }

  private startAutomaticCountdown(): void {
    if (
      this.countdownInProgress ||
      this.automaticAnalysisCompleted
    ) {
      return;
    }

    this.countdownInProgress = true;
    this.captureState.set('countdown');

    this.runAutomaticCountdown(3);
  }

  private runAutomaticCountdown(
    value: number
  ): void {
    if (
      !this.isCameraActive() ||
      !this.isTorsoVisible()
    ) {
      this.cancelCountdown();

      this.captureState.set('positioning');

      this.guidanceMessage.set(
        'Keep both shoulders and both hips visible in the frame.'
      );

      return;
    }

    this.countdown.set(value);

    this.guidanceMessage.set(
      value > 0
        ? `Hold still. First analysis in ${value}...`
        : 'Analysing your T-shirt fit...'
    );

    if (value === 0) {
      this.countdownInProgress = false;
      this.countdown.set(null);

      // Prevent automatic analysis from triggering again.
      this.automaticAnalysisCompleted = true;

      this.performAnalysis();

      return;
    }

    this.countdownTimer = setTimeout(() => {
      this.runAutomaticCountdown(value - 1);
    }, 1000);
  }

  private startManualCountdown(): void {
    if (this.countdownInProgress) {
      return;
    }

    this.countdownInProgress = true;
    this.captureState.set('countdown');

    this.runManualCountdown(3);
  }

  private runManualCountdown(
    value: number
  ): void {
    if (
      !this.isCameraActive() ||
      !this.isTorsoVisible()
    ) {
      this.cancelCountdown();

      this.captureState.set('positioning');

      this.guidanceMessage.set(
        'Keep both shoulders and both hips visible in the frame.'
      );

      return;
    }

    this.countdown.set(value);

    this.guidanceMessage.set(
      value > 0
        ? `Hold still. Re-analysing in ${value}...`
        : 'Re-analysing your T-shirt fit...'
    );

    if (value === 0) {
      this.countdownInProgress = false;
      this.countdown.set(null);

      this.performAnalysis();

      return;
    }

    this.countdownTimer = setTimeout(() => {
      this.runManualCountdown(value - 1);
    }, 1000);
  }

  private cancelCountdown(): void {
    if (this.countdownTimer !== null) {
      clearTimeout(this.countdownTimer);
      this.countdownTimer = null;
    }

    this.countdownInProgress = false;
    this.countdown.set(null);
  }

  private performAnalysis(): void {
    if (
      this.measurementSamples.length <
      this.minimumSamplesForAnalysis
    ) {
      return;
    }

    this.isAnalysing.set(true);
    this.captureState.set('analysing');

    this.guidanceMessage.set(
      'Analysing your T-shirt fit...'
    );

    const averagedMeasurements =
      this.averageMeasurements(
        this.measurementSamples
      );

    this.measurements =
      averagedMeasurements;

    this.sizeResult =
      this.sizeRecommendationService.recommend(
        averagedMeasurements
      );

    this.isAnalysing.set(false);
    this.captureState.set('complete');

    this.guidanceMessage.set(
      'Analysis complete. Reposition yourself and select Analyse Fit if you want to try again.'
    );
  }

  private addMeasurementSample(
    measurement: PoseMeasurements
  ): void {
    this.measurementSamples.push(
      measurement
    );

    // Keep only the latest valid frames.
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
    const count = samples.length;

    const totals = samples.reduce(
      (sum, sample) => ({
        shoulderWidthRatio:
          sum.shoulderWidthRatio +
          sample.shoulderWidthRatio,

        hipWidthRatio:
          sum.hipWidthRatio +
          sample.hipWidthRatio,

        torsoLengthRatio:
          sum.torsoLengthRatio +
          sample.torsoLengthRatio,

        shoulderToHipRatio:
          sum.shoulderToHipRatio +
          sample.shoulderToHipRatio
      }),
      {
        shoulderWidthRatio: 0,
        hipWidthRatio: 0,
        torsoLengthRatio: 0,
        shoulderToHipRatio: 0
      }
    );

    return {
      shoulderWidthRatio:
        totals.shoulderWidthRatio / count,

      hipWidthRatio:
        totals.hipWidthRatio / count,

      torsoLengthRatio:
        totals.torsoLengthRatio / count,

      shoulderToHipRatio:
        totals.shoulderToHipRatio / count
    };
  }

  private checkTorsoVisibility(
    landmarks: any[]
  ): boolean {
    // MediaPipe Pose landmark indices:
    // 11 = left shoulder
    // 12 = right shoulder
    // 23 = left hip
    // 24 = right hip
    const requiredIndices = [
      11,
      12,
      23,
      24
    ];

    const minimumVisibility = 0.6;

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

  private drawLandmarks(
    context: CanvasRenderingContext2D,
    landmarks: any[],
    width: number,
    height: number
  ): void {
    context.fillStyle = '#00ff88';

    landmarks.forEach((point) => {
      const x = point.x * width;
      const y = point.y * height;

      context.beginPath();

      context.arc(
        x,
        y,
        4,
        0,
        2 * Math.PI
      );

      context.fill();
    });

    // Highlight the torso used by the prototype.
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
    context: CanvasRenderingContext2D,
    a: any,
    b: any,
    width: number,
    height: number
  ): void {
    if (!a || !b) {
      return;
    }

    context.strokeStyle = '#00ff88';
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

  ngOnDestroy(): void {
    this.stopCamera();
  }
}