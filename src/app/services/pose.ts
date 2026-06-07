import { Injectable } from '@angular/core';
import {
  FilesetResolver,
  PoseLandmarker,
  PoseLandmarkerResult
} from '@mediapipe/tasks-vision';

@Injectable({
  providedIn: 'root'
})
export class Pose {
  private poseLandmarker: PoseLandmarker | null = null;

  async initialise(): Promise<void> {
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
    );

    this.poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
        delegate: 'GPU'
      },
      runningMode: 'VIDEO',
      numPoses: 1
    });
  }

  detect(
    video: HTMLVideoElement,
    timestamp: number
  ): PoseLandmarkerResult | null {
    if (!this.poseLandmarker) {
      return null;
    }

    return this.poseLandmarker.detectForVideo(video, timestamp);
  }
}