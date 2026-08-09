import { Injectable } from '@angular/core';
import { PoseMeasurements } from './measurement';

export interface SizeResult {
  recommendedSize:
    | 'XS'
    | 'S'
    | 'M'
    | 'L'
    | 'XL';

  confidence:
    | 'Low'
    | 'Medium'
    | 'High';

  explanation: string;

  // Development/calibration value.
  // This is useful for testing how the rule-based size mapping behaves.
  proportionScore: number;
}

@Injectable({
  providedIn: 'root'
})
export class SizeRecommendation {

  /**
   * Produces a prototype T-shirt size recommendation from
   * relative 2D torso proportions.
   *
   * The thresholds are currently provisional and are intended
   * for prototype calibration rather than as universal sizing rules.
   */
  recommend(
    measurements: PoseMeasurements
  ): SizeResult {

    const {
      shoulderToTorsoRatio,
      hipToTorsoRatio,
      shoulderToHipRatio
    } = measurements;

    /**
     * Weighted relative-proportion score.
     *
     * Shoulder and hip proportions are given the largest
     * influence, while shoulder-to-hip balance contributes
     * a smaller adjustment.
     */
    const proportionScore =
      shoulderToTorsoRatio * 0.4 +
      hipToTorsoRatio * 0.4 +
      shoulderToHipRatio * 0.2;

    console.log(
      'Proportion score:',
      proportionScore
    );

    let recommendedSize:
      SizeResult['recommendedSize'];

    /**
     * PROVISIONAL SIZE BANDS
     *
     * These bands have been adjusted to better match the
     * numerical scale produced by the current 2D ratio model.
     *
     * They still require further calibration using pilot testing
     * and should not be presented as universal clothing standards.
     */
    if (proportionScore < 0.58) {
      recommendedSize = 'XS';

    } else if (proportionScore < 0.68) {
      recommendedSize = 'S';

    } else if (proportionScore < 0.78) {
      recommendedSize = 'M';

    } else if (proportionScore < 0.88) {
      recommendedSize = 'L';

    } else {
      recommendedSize = 'XL';
    }

    return {
      recommendedSize,

      /*
       * Medium is appropriate while the mapping remains
       * an experimental rule-based prototype.
       */
      confidence: 'Medium',

      explanation:
        'This guidance is based on averaged relative torso proportions detected across multiple camera frames. It is intended as size-selection support rather than a guaranteed exact fit.',

      proportionScore
    };
  }
}