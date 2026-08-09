import { Injectable } from '@angular/core';
import { NormalizedLandmark } from '@mediapipe/tasks-vision';

export interface PoseMeasurements {
  shoulderWidthRatio: number;
  hipWidthRatio: number;
  torsoLengthRatio: number;
  shoulderToHipRatio: number;
}

// Design pattern / principle note: this is mainly Single Responsibility Principle.
// The Measurement service is responsible for calculating measurements from pose landmarks.
@Injectable({
  providedIn: 'root'
})
export class Measurement {
  calculate(landmarks: NormalizedLandmark[]): PoseMeasurements | null {
    if (!landmarks || landmarks.length < 33) {
      return null;
    }

    const leftShoulder = landmarks[11];
    const rightShoulder = landmarks[12];
    const leftHip = landmarks[23];
    const rightHip = landmarks[24];

    const shoulderWidth = this.distance(leftShoulder, rightShoulder);
    const hipWidth = this.distance(leftHip, rightHip);

    const shoulderMidpoint = this.midpoint(leftShoulder, rightShoulder);
    const hipMidpoint = this.midpoint(leftHip, rightHip);

    const torsoLength = this.distance(shoulderMidpoint, hipMidpoint);

    if (hipWidth === 0 || torsoLength === 0) {
      return null;
    }

    return {
      shoulderWidthRatio: shoulderWidth,
      hipWidthRatio: hipWidth,
      torsoLengthRatio: torsoLength,
      shoulderToHipRatio: shoulderWidth / hipWidth
    };
  }

  private distance(a: NormalizedLandmark, b: NormalizedLandmark): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;

    return Math.sqrt(dx * dx + dy * dy);
  }

  private midpoint(
    a: NormalizedLandmark,
    b: NormalizedLandmark
  ): NormalizedLandmark {
    return {
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
      z: ((a.z ?? 0) + (b.z ?? 0)) / 2,
      visibility: Math.min(a.visibility ?? 1, b.visibility ?? 1)
    };
  }
}