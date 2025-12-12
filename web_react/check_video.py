import cv2
import numpy as np

video_file = r'D:\Lie_Detector_Agent\recordings\interrogation_2025-12-11_23-13_web.mp4'

cap = cv2.VideoCapture(video_file)
frames_checked = 0
bright_frames = 0

print("Checking video frames...")
while frames_checked < 20:
    ret, frame = cap.read()
    if not ret:
        break
    
    mean_brightness = np.mean(frame)
    print(f'Frame {frames_checked}: brightness = {mean_brightness:.1f}')
    if mean_brightness > 10:
        bright_frames += 1
    frames_checked += 1

cap.release()
print(f'\nResult: {bright_frames}/{frames_checked} frames have content')
print(f'Video appears: {"OK" if bright_frames > frames_checked/2 else "DARK/BLACK"}')
