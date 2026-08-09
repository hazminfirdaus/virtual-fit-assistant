import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';

import { Pose } from '../../services/pose';
import { Measurement, PoseMeasurements } from '../../services/measurement';
import {
  SizeRecommendation,
  SizeResult
} from '../../services/size-recommendation';

@Component({
  selector: 'app-fit-assistant',
  imports: [CommonModule],
  templateUrl: './fit-assistant.html',
  styleUrl: './fit-assistant.css'
})
export class FitAssistant implements AfterViewInit, OnDestroy {
  // References to the video and canvas elements in the HTML template.
  // Angular fills these after the view has been created.
  @ViewChild('videoElement') videoElement!: ElementRef<HTMLVideoElement>;
  @ViewChild('canvasElement') canvasElement!: ElementRef<HTMLCanvasElement>;

  isCameraActive = false;
  isModelReady = false;

  measurements: PoseMeasurements | null = null;
  sizeResult: SizeResult | null = null;

  private animationFrameId: number | null = null;
  private stream: MediaStream | null = null;

  constructor(
    private poseService: Pose,
    private measurementService: Measurement,
    private sizeRecommendationService: SizeRecommendation
  ) {}

async ngAfterViewInit(): Promise<void> {
  try {
    // Load the MediaPipe pose model after the component view is ready.
    // This keeps model setup separate from the constructor.
    await this.poseService.initialise();

    this.isModelReady = true;
    console.log('Pose model loaded successfully.');
  } catch (error) {
    console.error('Pose model could not be loaded:', error);

    this.isModelReady = false;
  }
}

async startCamera(): Promise<void> {

  try {

    if (!this.isModelReady) {
      console.warn('Camera started before pose model was ready.');
    }
    const video = this.videoElement.nativeElement;

    // Stop any previous camera session before starting a new one.

    this.stopCamera();

    this.stream = await navigator.mediaDevices.getUserMedia({

      video: {

        width: { ideal: 640 },

        height: { ideal: 480 },

        facingMode: 'user'

      },

      audio: false

    });

    video.srcObject = this.stream;

    // Wait until the browser has loaded enough video metadata

    // to know the real video width and height.

    await new Promise<void>((resolve) => {

      video.onloadedmetadata = () => {

        resolve();

      };

    });

    await video.play();

    this.isCameraActive = true;

    // Start pose detection only after video is ready.

    this.detectPose();

  } catch (error) {

    console.error('Camera could not be started:', error);

    this.isCameraActive = false;

  }

}

stopCamera(): void {
  console.log('Stop Camera button clicked.');

  if (this.animationFrameId !== null) {
    cancelAnimationFrame(this.animationFrameId);
    this.animationFrameId = null;
  }

  if (this.stream) {
    this.stream.getTracks().forEach(track => {
      console.log('Stopping track:', track.kind, track.readyState);
      track.stop();
    });

    this.stream = null;
  }

  const video = this.videoElement?.nativeElement;

  if (video) {
    video.pause();
    video.srcObject = null;
    video.load();
  }

  this.isCameraActive = false;
}

  private detectPose(): void {
    const video = this.videoElement.nativeElement;
    const canvas = this.canvasElement.nativeElement;
    const context = canvas.getContext('2d');

    if (!context) {
      return;
    }

  if (!this.isModelReady) {
    this.animationFrameId = requestAnimationFrame(() => this.detectPose());
    return;
  }

    if (!this.isCameraActive || video.videoWidth === 0 || video.videoHeight === 0) {
      this.animationFrameId = requestAnimationFrame(() => this.detectPose());
      return;
    }

    // Match the canvas size to the actual video frame size.
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const result = this.poseService.detect(video, performance.now());

    context.clearRect(0, 0, canvas.width, canvas.height);

    if (result?.landmarks?.length) {
      const landmarks = result.landmarks[0];

      this.drawLandmarks(context, landmarks, canvas.width, canvas.height);

      const calculatedMeasurements = this.measurementService.calculate(landmarks);

      if (calculatedMeasurements) {
        this.measurements = calculatedMeasurements;

        this.sizeResult =
          this.sizeRecommendationService.recommend(calculatedMeasurements);
      }
    }

    // Continue detection on the next browser animation frame.
    this.animationFrameId = requestAnimationFrame(() => this.detectPose());
  }

  private drawLandmarks(
    context: CanvasRenderingContext2D,
    landmarks: any[],
    width: number,
    height: number
  ): void {
    context.fillStyle = '#00ff88';

    // Draw each detected landmark as a small dot.
    landmarks.forEach(point => {
      const x = point.x * width;
      const y = point.y * height;

      context.beginPath();
      context.arc(x, y, 4, 0, 2 * Math.PI);
      context.fill();
    });

    // Draw the key body areas used in the prototype measurement logic.
    // 11/12 = shoulders, 23/24 = hips in MediaPipe Pose.
    this.drawLine(context, landmarks[11], landmarks[12], width, height);
    this.drawLine(context, landmarks[23], landmarks[24], width, height);
    this.drawLine(context, landmarks[11], landmarks[23], width, height);
    this.drawLine(context, landmarks[12], landmarks[24], width, height);
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
    context.moveTo(a.x * width, a.y * height);
    context.lineTo(b.x * width, b.y * height);
    context.stroke();
  }

  ngOnDestroy(): void {
    // Clean up the webcam if the component is destroyed.
    this.stopCamera();
  }
}