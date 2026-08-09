import { Injectable } from '@angular/core';
import { NormalizedLandmark } from '@mediapipe/tasks-vision';

/**
 * Relative body proportions derived from 2D MediaPipe pose landmarks.
 *
 * The prototype intentionally uses ratios rather than exact body
 * measurements. This keeps the approach:
 *
 * - client-side;
 * - lightweight;
 * - aligned with the MSc project proposal;
 * - less sensitive to camera distance than raw image distances.
 */
export interface PoseMeasurements {
  shoulderToTorsoRatio: number;
  hipToTorsoRatio: number;
  shoulderToHipRatio: number;
}

@Injectable({
  providedIn: 'root'
})
export class Measurement {

  /**
   * Converts MediaPipe pose landmarks into relative torso proportions.
   */
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
      this.distance(leftShoulder, rightShoulder);

    const hipWidth =
      this.distance(leftHip, rightHip);

    const shoulderMidpoint =
      this.midpoint(leftShoulder, rightShoulder);

    const hipMidpoint =
      this.midpoint(leftHip, rightHip);

    const torsoLength =
      this.distance(
        shoulderMidpoint,
        hipMidpoint
      );

    /*
     * Prevent invalid or degenerate ratios.
     */
    if (
      shoulderWidth <= 0 ||
      hipWidth <= 0 ||
      torsoLength <= 0
    ) {
      return null;
    }

    /*
     * Ratio-based measurements reduce the influence of image scale.
     *
     * If a user moves somewhat closer to or farther from the camera,
     * shoulder width, hip width and torso length should change by
     * approximately the same scale factor.
     *
     * Dividing these values therefore produces a more stable signal
     * than using the raw normalized distances directly.
     */
    return {
      shoulderToTorsoRatio:
        shoulderWidth / torsoLength,

      hipToTorsoRatio:
        hipWidth / torsoLength,

      shoulderToHipRatio:
        shoulderWidth / hipWidth
    };
  }

  /**
   * Calculates 2D Euclidean distance between two landmarks.
   *
   * Z is deliberately excluded because this project focuses on
   * relative 2D proportions rather than 3D reconstruction.
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

  /**
   * Calculates the midpoint between two landmarks.
   *
   * This is used to approximate the centre of the shoulder line
   * and the centre of the hip line.
   */
  private midpoint(
    a: NormalizedLandmark,
    b: NormalizedLandmark
  ): NormalizedLandmark {

    return {
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,

      // Retained because NormalizedLandmark includes z,
      // although it is not used in our distance calculation.
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