import { Injectable } from '@angular/core';
import { NormalizedLandmark } from '@mediapipe/tasks-vision';

/**
 * Relative 2D measurements derived from MediaPipe pose landmarks.
 *
 * The prototype intentionally avoids exact body measurements.
 * Instead, it combines:
 *
 * 1. normalized image-space dimensions, and
 * 2. relative body-shape ratios.
 *
 * The positioning guide helps reduce variation caused by camera distance.
 */
export interface PoseMeasurements {
  shoulderWidth: number;
  hipWidth: number;
  torsoLength: number;

  shoulderToTorsoRatio: number;
  hipToTorsoRatio: number;
  shoulderToHipRatio: number;
}

@Injectable({
  providedIn: 'root'
})
export class Measurement {

  calculate(
    landmarks: NormalizedLandmark[]
  ): PoseMeasurements | null {

    if (!landmarks || landmarks.length < 33) {
      return null;
    }

    // MediaPipe Pose landmark indices:
    // 11 = left shoulder
    // 12 = right shoulder
    // 23 = left hip
    // 24 = right hip
    const leftShoulder = landmarks[11];
    const rightShoulder = landmarks[12];
    const leftHip = landmarks[23];
    const rightHip = landmarks[24];

    const shoulderWidth =
      this.distance(
        leftShoulder,
        rightShoulder
      );

    const hipWidth =
      this.distance(
        leftHip,
        rightHip
      );

    const shoulderMidpoint =
      this.midpoint(
        leftShoulder,
        rightShoulder
      );

    const hipMidpoint =
      this.midpoint(
        leftHip,
        rightHip
      );

    const torsoLength =
      this.distance(
        shoulderMidpoint,
        hipMidpoint
      );

    if (
      shoulderWidth <= 0 ||
      hipWidth <= 0 ||
      torsoLength <= 0
    ) {
      return null;
    }

    return {
      shoulderWidth,
      hipWidth,
      torsoLength,

      shoulderToTorsoRatio:
        shoulderWidth / torsoLength,

      hipToTorsoRatio:
        hipWidth / torsoLength,

      shoulderToHipRatio:
        shoulderWidth / hipWidth
    };
  }

  /**
   * Calculates a 2D Euclidean distance.
   *
   * Z is intentionally excluded because this project
   * uses 2D pose estimation rather than 3D reconstruction.
   */
  private distance(
    a: NormalizedLandmark,
    b: NormalizedLandmark
  ): number {

    const dx = a.x - b.x;
    const dy = a.y - b.y;

    return Math.sqrt(
      dx * dx +
      dy * dy
    );
  }

  private midpoint(
    a: NormalizedLandmark,
    b: NormalizedLandmark
  ): NormalizedLandmark {

    return {
      x:
        (a.x + b.x) / 2,

      y:
        (a.y + b.y) / 2,

      z:
        ((a.z ?? 0) + (b.z ?? 0)) / 2,

      visibility:
        Math.min(
          a.visibility ?? 1,
          b.visibility ?? 1
        )
    };
  }
}