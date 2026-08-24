# Virtual Fit Assistant

A browser-based Virtual Fit Assistant that uses client-side pose estimation to provide T-shirt size guidance while preserving user privacy.

The application was developed as part of an MSc Computing project investigating whether browser-based, client-side pose estimation can support clothing size selection while maintaining acceptable usability and reducing the need to upload or store webcam imagery.

## Live Application

You can try the deployed application here:

[Virtual Fit Assistant](https://hazminfirdaus.github.io/virtual-fit-assistant/)

## Project Overview

The Virtual Fit Assistant uses a webcam and MediaPipe Pose to detect selected shoulder and hip landmarks in real time.

The application:

- processes webcam frames locally in the browser;
- detects shoulder and hip landmarks using MediaPipe Pose;
- derives two-dimensional pose-based body features;
- uses guided positioning to improve capture consistency;
- averages measurements across multiple valid frames;
- generates a rule-based T-shirt size recommendation from XS to XL;
- supports automatic capture and hands-free re-analysis;
- requires landscape orientation on mobile devices.

The application does not upload or store webcam images or video as part of the fitting workflow.

## Technologies

- Angular
- TypeScript
- MediaPipe Tasks Vision
- HTML
- CSS
- GitHub Pages

## Architecture

The application is organised around a central `FitAssistant` component and three supporting services:

- `Pose` — MediaPipe initialisation and pose detection
- `Measurement` — pose-derived feature calculation
- `SizeRecommendation` — rule-based T-shirt size recommendation

The overall processing flow is:

```text
Webcam Input
    ↓
MediaPipe Pose
    ↓
Shoulder and Hip Landmarks
    ↓
Position Validation
    ↓
Feature Extraction
    ↓
Multi-Frame Averaging
    ↓
Rule-Based Recommendation
    ↓
T-Shirt Size Guidance