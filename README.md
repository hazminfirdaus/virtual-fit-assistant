# Virtual Fit Assistant

A browser-based Virtual Fit Assistant that uses client-side pose estimation to provide T-shirt size guidance while preserving user privacy.

The application was developed as part of an MSc Computing project investigating whether browser-based, client-side pose estimation can support clothing size selection while maintaining acceptable usability and reducing the need to upload or store webcam imagery.

## Live Application

Try the deployed application here:

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
```

## Running the Project Locally

### Prerequisites

Make sure Node.js and npm are installed.

Check the installed versions:

```bash
node --version
npm --version
```

If Angular CLI is not installed globally, install it with:

```bash
npm install -g @angular/cli
```

### Clone the Repository

```bash
git clone https://github.com/hazminfirdaus/virtual-fit-assistant.git
cd virtual-fit-assistant
```

### Install Dependencies

```bash
npm install
```

### Start the Development Server

```bash
ng serve
```

Then open:

```text
http://localhost:4200/
```

The browser will request webcam permission when the fitting assistant is started.

## Building the Project

To create a production build:

```bash
ng build
```

For GitHub Pages deployment using the repository path:

```bash
npx ng build --base-href /virtual-fit-assistant/
```

The compiled application will be written to the Angular `dist/` output directory.

## Using the Application

1. Open the Virtual Fit Assistant.
2. Start the camera and allow webcam access.
3. Position yourself so that your shoulders and hips align with the on-screen guide.
4. Remain in position until the automatic countdown begins.
5. The application analyses multiple valid frames and produces a T-shirt size recommendation.
6. To perform another analysis, move out of the valid positioning area and return to the guide.
7. On mobile devices, rotate the device to landscape orientation before starting the fitting process.

## Privacy

Privacy is a central design consideration of the project.

Webcam frames are processed locally within the browser. The fitting workflow does not upload or store webcam images or video.

Pose landmarks and derived measurements are used temporarily to generate the recommendation and are not stored as a persistent body profile.

The application may retrieve required software and model resources over the network, but fitting-related webcam imagery is not sent to an application backend for analysis.

## Limitations

This project is an exploratory research prototype and should not be treated as a commercially validated clothing-sizing system.

Current limitations include:

- two-dimensional image-space measurements;
- sensitivity to camera geometry and positioning;
- experimental rule-based recommendation thresholds;
- support for regular-fit T-shirt sizing only;
- size categories limited to XS–XL;
- landscape-only mobile fitting;
- no independently verified anthropometric or garment-fit ground truth.

The recommendation should therefore be interpreted as sizing guidance rather than guaranteed garment fit.

## Research Project

This application was developed for the MSc Computing project:

**A Client-Side Virtual Fit Assistant Using Browser-Based Pose Estimation for Privacy-Preserving Clothing Size Recommendation**

The research evaluates the prototype in terms of:

- recommendation plausibility;
- usability;
- confidence;
- usefulness;
- privacy;
- trust; and
- comparison with a traditional T-shirt size chart.

## Related Material

The systematic literature review that informed the project is available here:

[Systematic Literature Review](https://github.com/hazminfirdaus/virtual-fit-assistant/blob/main/P1143604_Chik_ICA_Literature_Review.pdf)

## Author

**Muhammad Hazmin Firdaus Bin Chik**

MSc Computing  
Teesside University
