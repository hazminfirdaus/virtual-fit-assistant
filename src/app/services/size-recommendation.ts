import { Injectable } from '@angular/core';
import { PoseMeasurements } from './measurement';

export interface SizeResult {
  recommendedSize: 'XS' | 'S' | 'M' | 'L' | 'XL';
  confidence: 'Low' | 'Medium' | 'High';
  explanation: string;
}


// Design pattern / principle note: this is mainly Single Responsibility Principle.
// The SizeRecommendation service is responsible for recommending a clothing size based on pose measurements.
@Injectable({
  providedIn: 'root'
})
export class SizeRecommendation {
  recommend(measurements: PoseMeasurements): SizeResult {
    const shoulder = measurements.shoulderWidthRatio;
    const hip = measurements.hipWidthRatio;
    const torso = measurements.torsoLengthRatio;

    const bodyScale = shoulder + hip + torso;

    let recommendedSize: SizeResult['recommendedSize'];

    if (bodyScale < 0.75) {
      recommendedSize = 'XS';
    } else if (bodyScale < 0.9) {
      recommendedSize = 'S';
    } else if (bodyScale < 1.05) {
      recommendedSize = 'M';
    } else if (bodyScale < 1.2) {
      recommendedSize = 'L';
    } else {
      recommendedSize = 'XL';
    }

    return {
      recommendedSize,
      confidence: 'Medium',
      explanation:
        'This prototype uses relative shoulder width, hip width, and torso length detected from pose landmarks. It does not calculate exact body measurements.'
    };
  }
}