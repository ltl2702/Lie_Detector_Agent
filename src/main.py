import pygame
import cv2
import mediapipe as mp
import numpy as np
from datetime import datetime
from matplotlib import pyplot as plt
from matplotlib.backends.backend_agg import FigureCanvasAgg
import threading
import time
import deception_detection as dd
from utils import get_video_file
import alert_system as alerts

# Global variables
screen_width = 1200
screen_height = 600
recording = None
bpm_chart_enabled = False
fig = None
ax = None
line = None
peakpts = None
last_chart_update = 0

# Colors
COLOR_BACKGROUND = (20, 20, 20)
COLOR_BUTTON = (50, 50, 50)
COLOR_BUTTON_HOVER = (70, 70, 70)
COLOR_TEXT = (255, 255, 255)
COLOR_TITLE = (200, 200, 200)
COLOR_EXIT_BUTTON = (200, 0, 0)
COLOR_EXIT_BUTTON_HOVER = (255, 0, 0)
COLOR_CHECKBOX = (100, 100, 100)
COLOR_CHECKBOX_CHECKED = (0, 200, 0)


meter = None
try:
    meter = cv2.imread(r'D:\Lie_Detector_Agent\src\meter.png')
    if meter is None:
        meter = np.zeros((50, 400, 3), dtype=np.uint8)
        # Vẽ meter giả nếu không tìm thấy file
        cv2.rectangle(meter, (0,0), (100,50), (0,255,0), -1)
        cv2.rectangle(meter, (100,0), (200,50), (0,255,255), -1)
        cv2.rectangle(meter, (200,0), (300,50), (0,165,255), -1)
        cv2.rectangle(meter, (300,0), (400,50), (0,0,255), -1)
except: pass

def chart_setup():
    """Initialize BPM chart"""
    global fig, ax, line, peakpts

    if fig is not None:
        plt.close(fig)

    fig = plt.figure(figsize=(4, 3), dpi=80)
    ax = fig.add_subplot(1, 1, 1)
    ax.set_title('Heart Rate Monitor', color='white', fontsize=10)
    ax.set_xlabel('Time (s)', color='white', fontsize=8)
    ax.set_ylabel('Signal', color='white', fontsize=8)
    ax.set_facecolor('#1a1a1a')
    fig.patch.set_facecolor('#1a1a1a')
    ax.tick_params(colors='white', labelsize=7)

    line, = ax.plot([], [], 'cyan', linewidth=1.5, label='Signal')
    peakpts, = ax.plot([], [], 'r+', markersize=8, label='Peaks')
    ax.grid(True, alpha=0.3, color='gray')

    plt.tight_layout()


def update_bpm_chart():
    """Update BPM chart with current data"""
    global fig, ax, line, peakpts, last_chart_update

    if fig is None:
        return None

    try:
        from scipy.signal import find_peaks

        # Sử dụng dữ liệu từ module dd
        min_len = min(len(dd.hr_times), len(dd.hr_values))
        
        if min_len < 2: return None
        
        draw_len = min(min_len, 300)
        current_times = dd.hr_times[-draw_len:]
        current_values = dd.hr_values[-draw_len:]

        line.set_data(current_times, current_values)

        if current_times:
            ax.set_xlim(max(0, current_times[-1]-10), current_times[-1]+0.5)
            ymin, ymax = min(current_values), max(current_values)
            margin = (ymax-ymin)*0.1 if ymax!=ymin else 1.0
            ax.set_ylim(ymin-margin, ymax+margin)
        
        if len(current_values) > 10:
             peaks, _ = find_peaks(current_values, distance=5, prominence=np.ptp(current_values)*0.05 or 0.01)
             peakpts.set_data(np.array(current_times)[peaks], np.array(current_values)[peaks]) if len(peaks) else peakpts.set_data([],[])
        canvas = FigureCanvasAgg(fig)
        canvas.draw()
        
        return cv2.cvtColor(np.frombuffer(canvas.buffer_rgba(), dtype=np.uint8).reshape(canvas.get_width_height()[::-1] + (4,)), cv2.COLOR_RGBA2BGR)
    except: return None

def add_truth_meter(image, tell_count, banner_height=0):
    """
    Add truth meter overlay to image
    banner_height: height of top banner to position meter below it
    """
    global meter

    if meter is None:
        return

    width = image.shape[1]
    height = image.shape[0]
    sm = int(width / 64)  # scale multiplier
    bg = int(width / 3.2)  # background width

    # Resize meter to fit
    meter_height = min(sm, 30)
    meter_width = min(bg, 300)
    # Ensure meter_height and meter_width are at least 1
    meter_height = max(1, meter_height)
    meter_width = max(1, meter_width)

    try:
        resized_meter = cv2.resize(meter, (meter_width, meter_height), interpolation=cv2.INTER_AREA)

        # Position below banner with more offset
        y_pos = banner_height + 40 if banner_height > 0 else sm
        x_pos = bg

        # Ensure we don't exceed image bounds
        if y_pos + meter_height <= height and x_pos + meter_width <= width:
            image[y_pos:y_pos+meter_height, x_pos:x_pos+meter_width] = resized_meter

            # Draw indicator based on number of tells
            if tell_count > 0:
                # Position indicator (excludes BPM which is always shown)
                actual_tells = max(0, tell_count - 1)
                indicator_x = x_pos + min(int(meter_width * actual_tells / 6), meter_width - 10)
                cv2.rectangle(image,
                             (indicator_x, y_pos - 5),
                             (indicator_x + 10, y_pos + meter_height + 5),
                             (255, 255, 255), 2)
    except Exception as e:
        print(f"Error adding truth meter: {e}")
    
def get_stress_level(tells_count, bpm_change=0):
    """
    Calculate stress level based on number of tells and BPM change
    Returns: (level_text, color, severity_int)
    """
    # Exclude BPM from tells count for severity calculation
    actual_tells = max(0, tells_count - 1)
    
    # Calculate severity score (0-100)
    severity_score = 0
    
    # Tells contribute 15 points each
    severity_score += actual_tells * 15
    
    # BPM change contributes up to 30 points
    if abs(bpm_change) > 20:
        severity_score += 30
    elif abs(bpm_change) > 15:
        severity_score += 20
    elif abs(bpm_change) > 10:
        severity_score += 10
    
    # Cap at 100
    severity_score = min(100, severity_score)
    
    # Determine level
    if severity_score < 30:
        return ("LOW STRESS", (0, 255, 0), 1)  # Green
    elif severity_score < 60:
        return ("MEDIUM STRESS", (0, 165, 255), 2)  # Orange
    else:
        return ("HIGH STRESS - ALERT", (0, 0, 255), 3)  # Red


def draw_button(screen, rect, text, font, is_hovered=False):
    """Draw a button on Pygame surface"""
    color = COLOR_BUTTON_HOVER if is_hovered else COLOR_BUTTON
    pygame.draw.rect(screen, color, rect, border_radius=5)
    pygame.draw.rect(screen, COLOR_TEXT, rect, 2, border_radius=5)
    text_surf = font.render(text, True, COLOR_TEXT)
    screen.blit(text_surf, (rect.x + (rect.width - text_surf.get_width()) // 2,
                            rect.y + (rect.height - text_surf.get_height()) // 2))


def draw_checkbox(screen, rect, is_checked, font, label):
    """Draw a checkbox with label"""
    pygame.draw.rect(screen, COLOR_CHECKBOX, rect, border_radius=3)
    pygame.draw.rect(screen, COLOR_TEXT, rect, 2, border_radius=3)

    if is_checked:
        # Draw X
        padding = 5
        pygame.draw.line(screen, COLOR_CHECKBOX_CHECKED,
                         (rect.x + padding, rect.y + padding),
                         (rect.x + rect.width - padding, rect.y + rect.height - padding), 3)
        pygame.draw.line(screen, COLOR_CHECKBOX_CHECKED,
                         (rect.x + rect.width - padding, rect.y + padding),
                         (rect.x + padding, rect.y + rect.height - padding), 3)

    text_surf = font.render(label, True, COLOR_TEXT)
    screen.blit(text_surf, (rect.x + rect.width + 10, rect.y + (rect.height - text_surf.get_height()) // 2))


def play_webcam(draw_landmarks=False, enable_recording=False, enable_chart=False):
    global recording, bpm_chart_enabled, fig
    bpm_chart_enabled = enable_chart
    if enable_chart:
        chart_setup()

    # Reset data khi bắt đầu phiên mới
    dd.hr_times = []
    dd.hr_values = []
    dd.avg_bpms = [0] * dd.MAX_FRAMES
    dd.mood = ''
    dd.mood_history = []
    dd.mood_frames_count = 0
    dd.calculating_mood = False
    dd.EPOCH = time.time()

    mp_face_mesh = mp.solutions.face_mesh
    mp_hands = mp.solutions.hands
    cap = cv2.VideoCapture(0, cv2.CAP_DSHOW)
    if not cap.isOpened():
        cap = cv2.VideoCapture(0)
    
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
    cap.set(cv2.CAP_PROP_FPS, 30)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30

    if enable_recording:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"interrogation_{timestamp}.avi"
        fourcc = cv2.VideoWriter_fourcc(*'MJPG')
        recording = cv2.VideoWriter(filename, fourcc, 10, (1280, 720))

    with mp_face_mesh.FaceMesh(max_num_faces=1, refine_landmarks=True, min_detection_confidence=0.5, min_tracking_confidence=0.5) as face_mesh, \
         mp_hands.Hands(max_num_hands=2, min_detection_confidence=0.5, min_tracking_confidence=0.5) as hands:
        
        calibrated = False
        frame_count = 0
        calibration_start_time = time.time()
        # CALIBRATION_TIME = 120  # 2 minutes in seconds
        CALIBRATION_TIME = 20  # 20s in seconds
        while cap.isOpened():
            success, image = cap.read()
            if not success: continue
            image = cv2.flip(image, 1)

            face_landmarks, hands_landmarks = dd.find_face_and_hands(image, face_mesh, hands)
            current_tells = dd.process_frame(image, face_landmarks, hands_landmarks, calibrated, fps)

            if draw_landmarks:
                dd.draw_on_frame(image, face_landmarks, hands_landmarks)
            
            # Determine banner height to pass to add_text and add_truth_meter
            banner_height = 0

            if not calibrated:
                # Calculate elapsed and remaining time
                elapsed_time = time.time() - calibration_start_time
                remaining_time = max(0, CALIBRATION_TIME - elapsed_time)
                minutes = int(remaining_time // 60)
                seconds = int(remaining_time % 60)
                
                # Draw banner AT TOP
                overlay = image.copy()
                banner_height = 100
                banner_y_start = 0  # Start at very top
                cv2.rectangle(overlay, (0, banner_y_start), (image.shape[1], banner_y_start + banner_height), (0, 0, 0), -1)
                cv2.addWeighted(overlay, 0.7, image, 0.3, 0, image)
                
                # Phase 1 title and timer on same line
                phase_text = "PHASE 1: CALIBRATION"
                cv2.putText(image, phase_text, 
                           (10, banner_y_start + 35), 
                           cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 255, 255), 3)
                
                # Timer display next to title
                timer_text = f"TIME: {minutes:02d}:{seconds:02d}"
                cv2.putText(image, timer_text, 
                           (image.shape[1] - 280, banner_y_start + 35), 
                           cv2.FONT_HERSHEY_SIMPLEX, 1.2, (255, 255, 0), 3)
                
                # Instruction text on second line
                cv2.putText(image, "Ask neutral questions only - Establishing baseline", 
                           (10, banner_y_start + 75), 
                           cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)
                
                # Progress bar at bottom
                progress = min(1.0, elapsed_time / CALIBRATION_TIME)
                bar_width = int(image.shape[1] * 0.8)
                bar_x = int(image.shape[1] * 0.1)
                bar_y = image.shape[0] - 60
                cv2.rectangle(image, (bar_x, bar_y), (bar_x + bar_width, bar_y + 30), (50, 50, 50), -1)
                cv2.rectangle(image, (bar_x, bar_y), (bar_x + int(bar_width * progress), bar_y + 30), (0, 255, 255), -1)
                cv2.rectangle(image, (bar_x, bar_y), (bar_x + bar_width, bar_y + 30), (255, 255, 255), 2)
                
                # Automatic transition when time is up
                if remaining_time <= 0:
                    calibrated = True
                    print("\n" + "="*60)
                    print("CALIBRATION COMPLETE - TRANSITIONING TO INTERROGATION MODE")
                    print("="*60 + "\n")
            else:
                # Phase 2: INTERROGATION MODE
                # Calculate stress level
                bpm_change = 0
                if len(dd.avg_bpms) > 1 and dd.avg_bpms[-1] > 0:
                    bpm_change = dd.avg_bpms[-1] - dd.avg_bpms[0]
                
                stress_text, stress_color, stress_level = get_stress_level(len(current_tells), bpm_change)
                
                # Phase 2 banner AT TOP with dynamic color based on stress
                overlay = image.copy()
                banner_height = 100
                banner_y_start = 0
                cv2.rectangle(overlay, (0, banner_y_start), (image.shape[1], banner_y_start + banner_height), (0, 0, 0), -1)
                cv2.addWeighted(overlay, 0.6, image, 0.4, 0, image)
                
                # Title
                cv2.putText(image, "PHASE 2: INTERROGATION MODE - ACTIVE", 
                           (10, banner_y_start + 25), 
                           cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)
                
                # Ready indicator
                cv2.putText(image, "CALIBRATED - Ready for interrogation", 
                           (10, banner_y_start + 50), 
                           cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)
                
                # Stress level indicator with color coding
                cv2.putText(image, f"STRESS LEVEL: {stress_text}", 
                           (10, banner_y_start + 80), 
                           cv2.FONT_HERSHEY_SIMPLEX, 0.7, stress_color, 2)
                
                # Process tells through alert system (clustering + priority)
                alert = alerts.process_indicators(current_tells, stress_level)
                alert_x = image.shape[1] - 350
                if alert:
                    # High confidence alert: visual + audio cue
                    text = alerts.overlay_text_for_alert(alert)
                    cv2.putText(image, text,
                               (alert_x, banner_y_start + 30),
                               cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)
                    cv2.putText(image, f"Active Tells: {len(current_tells) - 1}",
                               (alert_x, banner_y_start + 60),
                               cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 165, 255), 2)
                    try:
                        alerts.play_alert_sound()
                    except Exception:
                        pass
                else:
                    # Lower-confidence visual hint (keep previous behavior)
                    if len(current_tells) > 1:
                        cv2.putText(image, "DEVIATION DETECTED!",
                                   (alert_x, banner_y_start + 30),
                                   cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
                        cv2.putText(image, f"Active Tells: {len(current_tells) - 1}",
                                   (alert_x, banner_y_start + 60),
                                   cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 165, 255), 2)
            
            # Add truth meter and text BELOW banner
            dd.add_text(image, current_tells, calibrated, banner_height)
            add_truth_meter(image, len(current_tells), banner_height)

            if enable_chart and calibrated:
                chart_img = update_bpm_chart()
                if chart_img is not None:
                    h, w = chart_img.shape[:2]
                    x_off = image.shape[1] - w - 10 
                    y_off = image.shape[0] - h - 50  
                    if x_off > 0 and y_off > 0 and y_off + h < image.shape[0]:
                        image[y_off:y_off+h, x_off:x_off+w] = chart_img

            cv2.imshow('Lie Detector - Webcam', image)
            if enable_recording and recording: recording.write(image)
            frame_count += 1

            key = cv2.waitKey(5) & 0xFF
            if key == 27: break
            elif key == ord('c'): 
                # Manual calibration toggle
                calibrated = not calibrated
                if not calibrated:
                    calibration_start_time = time.time()  # Reset timer
            if cv2.getWindowProperty('Lie Detector - Webcam', cv2.WND_PROP_VISIBLE) < 1: break

    cap.release()
    if recording: recording.release()
    cv2.destroyAllWindows()
    if fig: plt.close(fig); fig = None

def play_video(video_file, draw_landmarks=False, enable_recording=False, enable_chart=False):
    global recording, bpm_chart_enabled, fig
    bpm_chart_enabled = enable_chart
    if enable_chart:
        chart_setup()

    # Reset data
    dd.hr_times = []
    dd.hr_values = []
    dd.avg_bpms = [0] * dd.MAX_FRAMES
    dd.mood = ''
    dd.mood_history = []
    dd.mood_frames_count = 0
    dd.calculating_mood = False
    dd.EPOCH = time.time()

    mp_face_mesh = mp.solutions.face_mesh
    mp_hands = mp.solutions.hands
    cap = cv2.VideoCapture(video_file)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = total_frames / fps
    
    # Auto-adjust calibration time based on video duration
    CALIBRATION_TIME = min(10, duration * 0.5)  # 50% of video duration, max 10s
    
    # Frame skipping for better performance
    target_fps = 15  # Process at 15 FPS instead of original FPS
    frame_skip = max(1, int(fps / target_fps))
    effective_fps = fps / frame_skip
    
    print(f"Video Info: {fps} FPS, {w}x{h}, {total_frames} frames, Duration: {duration:.1f}s")
    print(f"Calibration: {CALIBRATION_TIME:.1f}s, Processing: {effective_fps:.1f} FPS (skip every {frame_skip} frames)")

    if enable_recording:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"analyzed_{timestamp}.avi"
        fourcc = cv2.VideoWriter_fourcc(*'MJPG')
        recording = cv2.VideoWriter(filename, fourcc, effective_fps, (w, h))

    with mp_face_mesh.FaceMesh(max_num_faces=1, refine_landmarks=True, min_detection_confidence=0.5, min_tracking_confidence=0.5) as face_mesh, \
         mp_hands.Hands(max_num_hands=2, min_detection_confidence=0.5, min_tracking_confidence=0.5) as hands:

        calibrated = False
        frame_count = 0
        processed_count = 0
        paused = False
        calibration_start_frame = 0
        
        while cap.isOpened():
            if not paused:
                success, image = cap.read()
                if not success:
                    print(f"\n{'='*60}")
                    print(f"Video ended at frame {frame_count}/{total_frames}")
                    print(f"Processed {processed_count} frames")
                    print(f"Calibrated: {calibrated}")
                    print(f"{'='*60}\n")
                    break
                
                frame_count += 1
                
                # Skip frames for better performance
                if frame_count % frame_skip != 0:
                    continue
                
                processed_count += 1
                
                face_landmarks, hands_landmarks = dd.find_face_and_hands(image, face_mesh, hands)
                current_tells = dd.process_frame(image, face_landmarks, hands_landmarks, calibrated, effective_fps)

                if draw_landmarks:
                    dd.draw_on_frame(image, face_landmarks, hands_landmarks)
                
                banner_height = 0

                if not calibrated:
                    # Calculate elapsed and remaining time based on processed frames
                    elapsed_time = (processed_count - calibration_start_frame) / effective_fps
                    remaining_time = max(0, CALIBRATION_TIME - elapsed_time)
                    minutes = int(remaining_time // 60)
                    seconds = int(remaining_time % 60)
                    
                    # Draw banner AT TOP
                    overlay = image.copy()
                    banner_height = 100
                    banner_y_start = 0  # Start at very top
                    cv2.rectangle(overlay, (0, banner_y_start), (image.shape[1], banner_y_start + banner_height), (0, 0, 0), -1)
                    cv2.addWeighted(overlay, 0.7, image, 0.3, 0, image)
                    
                    # Phase 1 title and timer on same line
                    phase_text = "PHASE 1: CALIBRATION"
                    cv2.putText(image, phase_text, 
                               (10, banner_y_start + 35), 
                               cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 255, 255), 3)
                    
                    # Timer display next to title
                    timer_text = f"TIME: {minutes:02d}:{seconds:02d}"
                    cv2.putText(image, timer_text, 
                               (image.shape[1] - 280, banner_y_start + 35), 
                               cv2.FONT_HERSHEY_SIMPLEX, 1.2, (255, 255, 0), 3)
                    
                    # Instruction text on second line
                    cv2.putText(image, "Ask neutral questions only - Establishing baseline", 
                               (10, banner_y_start + 75), 
                               cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)
                    
                    # Progress bar at bottom
                    progress = min(1.0, elapsed_time / CALIBRATION_TIME)
                    bar_width = int(image.shape[1] * 0.8)
                    bar_x = int(image.shape[1] * 0.1)
                    bar_y = image.shape[0] - 60
                    cv2.rectangle(image, (bar_x, bar_y), (bar_x + bar_width, bar_y + 30), (50, 50, 50), -1)
                    cv2.rectangle(image, (bar_x, bar_y), (bar_x + int(bar_width * progress), bar_y + 30), (0, 255, 255), -1)
                    cv2.rectangle(image, (bar_x, bar_y), (bar_x + bar_width, bar_y + 30), (255, 255, 255), 2)
                    
                    # Automatic transition when time is up
                    if remaining_time <= 0:
                        calibrated = True
                        print("\n" + "="*60)
                        print("CALIBRATION COMPLETE - TRANSITIONING TO INTERROGATION MODE")
                        print("="*60 + "\n")
                else:
                    # Phase 2: INTERROGATION MODE
                    # Calculate stress level
                    bpm_change = 0
                    if len(dd.avg_bpms) > 1 and dd.avg_bpms[-1] > 0:
                        bpm_change = dd.avg_bpms[-1] - dd.avg_bpms[0]
                    
                    stress_text, stress_color, stress_level = get_stress_level(len(current_tells), bpm_change)
                    
                    # Phase 2 banner AT TOP with dynamic color based on stress
                    overlay = image.copy()
                    banner_height = 100
                    banner_y_start = 0
                    cv2.rectangle(overlay, (0, banner_y_start), (image.shape[1], banner_y_start + banner_height), (0, 0, 0), -1)
                    cv2.addWeighted(overlay, 0.6, image, 0.4, 0, image)
                    
                    # Title
                    cv2.putText(image, "PHASE 2: INTERROGATION MODE - ACTIVE", 
                               (10, banner_y_start + 25), 
                               cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)
                    
                    # Ready indicator
                    cv2.putText(image, "CALIBRATED - Ready for interrogation", 
                               (10, banner_y_start + 50), 
                               cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)
                    
                    # Stress level indicator with color coding
                    cv2.putText(image, f"STRESS LEVEL: {stress_text}", 
                               (10, banner_y_start + 80), 
                               cv2.FONT_HERSHEY_SIMPLEX, 0.7, stress_color, 2)
                    
                    # Process tells through alert system (clustering + priority)
                    alert = alerts.process_indicators(current_tells, stress_level)
                    alert_x = image.shape[1] - 350
                    if alert:
                        text = alerts.overlay_text_for_alert(alert)
                        cv2.putText(image, text,
                                   (alert_x, banner_y_start + 30),
                                   cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)
                        cv2.putText(image, f"Active Tells: {len(current_tells) - 1}",
                                   (alert_x, banner_y_start + 60),
                                   cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 165, 255), 2)
                        try:
                            alerts.play_alert_sound()
                        except Exception:
                            pass
                    else:
                        if len(current_tells) > 1:
                            cv2.putText(image, "DEVIATION DETECTED!",
                                       (alert_x, banner_y_start + 30),
                                       cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
                            cv2.putText(image, f"Active Tells: {len(current_tells) - 1}",
                                       (alert_x, banner_y_start + 60),
                                       cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 165, 255), 2)
                
                # Add truth meter and text BELOW banner
                dd.add_text(image, current_tells, calibrated, banner_height)
                add_truth_meter(image, len(current_tells), banner_height)

                if enable_chart and calibrated:
                    chart_img = update_bpm_chart()
                    if chart_img is not None:
                        ch, cw = chart_img.shape[:2]
                        x_off = image.shape[1] - cw - 10
                        y_off = image.shape[0] - ch - 50
                        if x_off > 0 and y_off > 0 and y_off + ch < image.shape[0]:
                            image[y_off:y_off+ch, x_off:x_off+cw] = chart_img

                # Progress indicator
                progress_text = f"Frame: {frame_count}/{total_frames} | Processing: {processed_count} | Phase: {'CALIBRATION' if not calibrated else 'INTERROGATION'}"
                cv2.putText(image, progress_text, 
                           (10, image.shape[0] - 10), 
                           cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)

            cv2.imshow('Lie Detector - Video Analysis', image)
            if enable_recording and recording and not paused: 
                recording.write(image)

            # Simplified timing
            key = cv2.waitKey(1) & 0xFF
                
            if key == 27: break
            elif key == ord(' '): 
                paused = not paused
            elif key == ord('c'):
                calibrated = not calibrated
                if not calibrated:
                    calibration_start_frame = processed_count
            if cv2.getWindowProperty('Lie Detector - Video Analysis', cv2.WND_PROP_VISIBLE) < 1: break

    cap.release()
    if recording: recording.release()
    cv2.destroyAllWindows()
    if fig: plt.close(fig); fig = None


def main_menu():
    """Main menu interface"""
    global screen, bpm_chart_enabled

    pygame.init()
    screen = pygame.display.set_mode((screen_width, screen_height))
    pygame.display.set_caption('Lie Detector Pro v5.1')

    def init_fonts():
        return (pygame.font.Font(None, 36),
                pygame.font.Font(None, 56),
                pygame.font.Font(None, 24))

    font, title_font, subtitle_font = init_fonts()

    # Button definitions
    button_width = 220
    button_height = 50
    button_spacing = 20
    start_y = 180
    title_y = 50
    checkbox_size = 30

    center_x = screen_width // 2
    button_start_x = center_x - button_width // 2 # Căn giữa nút bấm

    # Cập nhật lại vị trí các nút
    webcam_button = pygame.Rect(button_start_x, start_y, button_width, button_height)
    video_button = pygame.Rect(button_start_x, start_y + button_height + button_spacing, button_width, button_height)
    
    # Căn giữa nhóm checkbox (ước lượng chiều rộng khoảng 300px để cân đối)
    checkbox_group_width = 300
    checkbox_start_x = center_x - checkbox_group_width // 2
    
    checkbox_y = start_y + 2 * (button_height + button_spacing)
    landmarks_checkbox = pygame.Rect(checkbox_start_x, checkbox_y, checkbox_size, checkbox_size)
    record_checkbox = pygame.Rect(checkbox_start_x, checkbox_y + 40, checkbox_size, checkbox_size)
    chart_checkbox = pygame.Rect(checkbox_start_x, checkbox_y + 80, checkbox_size, checkbox_size)

    exit_button = pygame.Rect(button_start_x, checkbox_y + 140, button_width, button_height)

    # Settings
    draw_landmarks = False
    enable_recording = False
    enable_chart = False

    clock = pygame.time.Clock()
    running = True

    while running:
        mouse_pos = pygame.mouse.get_pos()

        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False

            if event.type == pygame.MOUSEBUTTONDOWN:
                if webcam_button.collidepoint(event.pos):
                    pygame.quit()
                    try:
                        play_webcam(draw_landmarks, enable_recording, enable_chart)
                    except Exception as e:
                        import traceback
                        print(f"Webcam error: {e}")
                        traceback.print_exc()
                    return
                    
                elif video_button.collidepoint(event.pos):
                    # Minimize pygame window to avoid blocking file dialog
                    pygame.display.iconify()
                    pygame.event.pump()  # Process events
                    
                    video_file = get_video_file()
                    
                    if video_file:
                        pygame.quit()
                        try:
                            play_video(video_file, draw_landmarks, enable_recording, enable_chart)
                        except Exception as e:
                            import traceback
                            print(f"Video error: {e}")
                            traceback.print_exc()
                        return
                    else:
                        # If no file selected, restore window
                        pygame.display.flip()
                        
                elif landmarks_checkbox.collidepoint(event.pos):
                    draw_landmarks = not draw_landmarks

                elif record_checkbox.collidepoint(event.pos):
                    enable_recording = not enable_recording

                elif chart_checkbox.collidepoint(event.pos):
                    enable_chart = not enable_chart

                elif exit_button.collidepoint(event.pos):
                    running = False

        # Draw
        if pygame.display.get_surface() is not None: # Check if surface exists
            screen.fill(COLOR_BACKGROUND)

            # Title
            title_text = title_font.render("Lie Detector Pro", True, COLOR_TITLE)
            screen.blit(title_text, (screen_width // 2 - title_text.get_width() // 2, title_y))

            subtitle_text = subtitle_font.render("Advanced Deception Detection System", True, (150, 150, 150))
            screen.blit(subtitle_text, (screen_width // 2 - subtitle_text.get_width() // 2, title_y + 50))

            # Buttons
            draw_button(screen, webcam_button, 'Webcam', font, webcam_button.collidepoint(mouse_pos))
            draw_button(screen, video_button, 'Video File', font, video_button.collidepoint(mouse_pos))

            # Checkboxes
            draw_checkbox(screen, landmarks_checkbox, draw_landmarks, font, 'Draw Landmarks')
            draw_checkbox(screen, record_checkbox, enable_recording, font, 'Record Session')
            draw_checkbox(screen, chart_checkbox, enable_chart, font, 'Show BPM Chart')

            # Exit button
            exit_color = COLOR_EXIT_BUTTON_HOVER if exit_button.collidepoint(mouse_pos) else COLOR_EXIT_BUTTON
            pygame.draw.rect(screen, exit_color, exit_button, border_radius=5)
            pygame.draw.rect(screen, COLOR_TEXT, exit_button, 2, border_radius=5)
            exit_text = font.render('Exit', True, COLOR_TEXT)
            screen.blit(exit_text, (exit_button.x + (exit_button.width - exit_text.get_width()) // 2,
                                    exit_button.y + (exit_button.height - exit_text.get_height()) // 2))

            pygame.display.flip()
            clock.tick(60)

    pygame.quit()


if __name__ == "__main__":
    main_menu()