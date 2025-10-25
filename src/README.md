# Lie Detector - Technical Documentation

## Overview
This application uses computer vision and machine learning to detect potential deception indicators through facial analysis, heart rate monitoring, and behavioral pattern recognition.

- Real-time facial landmark detection
- Heart rate monitoring through facial color changes
- Blink pattern analysis
- Gaze tracking
- Emotion detection
- Hand-to-face gesture detection
- Lip compression analysis

## Technical Requirements
- Python 3.8+
- Webcam
- Windows/Mac/Linux

## Installation Instructions
1. Navigate to the `src` folder
2. Create virtual environment: `python -m venv venv`
3. Activate virtual environment:
   - Windows: `venv\Scripts\activate`
   - Mac/Linux: `source venv/bin/activate`
4. Install dependencies: `pip install -r requirements.txt`

## Usage
```bash
cd src
python main.py
```

## Algorithm Details
The application analyzes multiple biometric indicators:
- **Heart Rate**: Extracted from facial color variations
- **Blink Patterns**: Unusual blinking frequency changes
- **Gaze Direction**: Sudden changes in eye movement
- **Facial Expressions**: Emotion classification
- **Micro-expressions**: Lip compression detection
- **Body Language**: Hand-to-face touching behaviors

## Calibration
The system requires 120 frames (~4 seconds) for calibration to establish baseline measurements.

## Controls
- ESC key: Exit application
- The system automatically detects faces and hands in real-time

## Limitations
- Requires good lighting conditions
- Single face detection only
- Results are indicative, not diagnostic
