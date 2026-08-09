import { Injectable } from '@angular/core';
import {
  FilesetResolver,
  PoseLandmarker,
  PoseLandmarkerResult
} from '@mediapipe/tasks-vision';


// while the Pose service is responsible for detecting pose landmarks from video input. 
// This separation allows each service to focus on a specific task, making the code easier to maintain and test. 
// The Pose service can be used to get the raw pose landmarks, which can then be passed to the Measurement service to calculate specific measurements based on those landmarks. 
// This design adheres to the Single Responsibility Principle, as each service has a clear and distinct responsibility.
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