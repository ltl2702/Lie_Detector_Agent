import pygame
import cv2
import mediapipe as mp
import numpy as np
from datetime import datetime
from matplotlib import pyplot as plt
from matplotlib.backends.backend_agg import FigureCanvasAgg
import threading
import time

# QUAN TRỌNG: Import cả module để đồng bộ dữ liệu global
import deception_detection as dd
from utils import get_video_file

# Global variables
screen_width = 1200  # Increased for BPM chart
screen_height = 600
recording = None
bpm_chart_enabled = False
fig = None
ax = None
line = None
peakpts = None

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


meter = cv2.imread('D:\\Lie_Detector_Agent\\src\\meter.png')

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
    # ax.legend(loc='upper right', fontsize=7, facecolor='#2a2a2a', edgecolor='white')
    ax.grid(True, alpha=0.3, color='gray')

    plt.tight_layout()


def update_bpm_chart():
    """Update BPM chart with current data"""
    global fig, ax, line, peakpts

    if fig is None:
        return None

    try:
        from scipy.signal import find_peaks

        # Sử dụng dữ liệu từ module dd
        min_len = min(len(dd.hr_times), len(dd.hr_values))
        # Lấy tối đa 300 điểm dữ liệu gần nhất để vẽ cho nhanh
        draw_len = min(min_len, 300)
        
        current_times = dd.hr_times[-draw_len:]
        current_values = dd.hr_values[-draw_len:]

        line.set_data(current_times, current_values)

        # Cập nhật trục X để hiển thị dữ liệu mới nhất (khoảng 10s cuối)
        if len(current_times) > 0:
            last_time = current_times[-1]
            ax.set_xlim(max(0, last_time - 10), last_time + 0.5)
        
        ax.relim()
        ax.autoscale_view(scalex=False, scaley=True)

        # Tìm và vẽ đỉnh (chỉ trên phần dữ liệu đang hiển thị)
        if len(current_values) > 10:
             # Cần điều chỉnh tham số find_peaks cho phù hợp với tín hiệu thực tế
             peaks, _ = find_peaks(current_values, distance=5, prominence=0.1)
             if len(peaks) > 0:
                 peak_times = [current_times[i] for i in peaks]
                 peak_vals = [current_values[i] for i in peaks]
                 peakpts.set_data(peak_times, peak_vals)
             else:
                 peakpts.set_data([], [])

        canvas = FigureCanvasAgg(fig)
        canvas.draw()
        buf = canvas.buffer_rgba()
        chart_img = np.frombuffer(buf, dtype=np.uint8)
        chart_img = chart_img.reshape(canvas.get_width_height()[::-1] + (4,))
        chart_img = cv2.cvtColor(chart_img, cv2.COLOR_RGBA2BGR)

        return chart_img
    except Exception as e:
        print(f"Chart error: {e}")
        return None

def add_truth_meter(image, tell_count):
    """Add truth meter overlay to image"""
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

        # Position at top
        y_pos = sm
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


def main_menu():
    """Main menu interface"""
    global screen, bpm_chart_enabled

    pygame.init()
    screen = pygame.display.set_mode((screen_width, screen_height))
    pygame.display.set_caption('Lie Detector Pro v5.1')

    font = pygame.font.Font(None, 36)
    title_font = pygame.font.Font(None, 56)
    subtitle_font = pygame.font.Font(None, 24)

    # Button definitions
    button_width = 220
    button_height = 50
    button_spacing = 20
    start_y = 180
    title_y = 50
    checkbox_size = 30

    center_x = (screen_width - button_width) // 2

    webcam_button = pygame.Rect(center_x, start_y, button_width, button_height)
    video_button = pygame.Rect(center_x, start_y + button_height + button_spacing, button_width, button_height)

    # Checkboxes
    checkbox_y = start_y + 2 * (button_height + button_spacing)
    landmarks_checkbox = pygame.Rect(center_x - 150, checkbox_y, checkbox_size, checkbox_size)
    record_checkbox = pygame.Rect(center_x - 150, checkbox_y + 40, checkbox_size, checkbox_size)
    chart_checkbox = pygame.Rect(center_x - 150, checkbox_y + 80, checkbox_size, checkbox_size)

    exit_button = pygame.Rect(center_x, checkbox_y + 140, button_width, button_height)

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
                    pygame.quit() # Close pygame window entirely before opening opencv
                    try:
                        play_webcam(draw_landmarks, enable_recording, enable_chart)
                    except Exception as e:
                        print(f"Webcam error: {e}")
                    pygame.init() # Re-init pygame after opencv closes
                    screen = pygame.display.set_mode((screen_width, screen_height))
                    pygame.display.set_caption('Lie Detector Pro v5.1')

                elif video_button.collidepoint(event.pos):
                    video_file = get_video_file()
                    if video_file:
                        pygame.quit() # Close pygame window
                        try:
                            play_video(video_file, draw_landmarks, enable_recording, enable_chart)
                        except Exception as e:
                            print(f"Video error: {e}")
                        pygame.init() # Re-init pygame
                        screen = pygame.display.set_mode((screen_width, screen_height))
                        pygame.display.set_caption('Lie Detector Pro v5.1')

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


def play_webcam(draw_landmarks=False, enable_recording=False, enable_chart=False):
    global recording, bpm_chart_enabled, fig
    bpm_chart_enabled = enable_chart
    if enable_chart:
        chart_setup()

    # Reset data khi bắt đầu phiên mới
    dd.hr_times = [0.0] * dd.MAX_FRAMES
    dd.hr_values = [0.0] * dd.MAX_FRAMES
    dd.avg_bpms = [0] * dd.MAX_FRAMES
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
        while cap.isOpened():
            success, image = cap.read()
            if not success: continue
            image = cv2.flip(image, 1)

            face_landmarks, hands_landmarks = dd.find_face_and_hands(image, face_mesh, hands)
            current_tells = dd.process_frame(image, face_landmarks, hands_landmarks, calibrated, fps)

            if draw_landmarks:
                dd.draw_on_frame(image, face_landmarks, hands_landmarks)
            dd.add_text(image, current_tells, calibrated)
            add_truth_meter(image, len(current_tells))

            if not calibrated:
                progress = min(100, int(frame_count / dd.MAX_FRAMES * 100))
                cv2.putText(image, f"Calibrating... {progress}%", (10, image.shape[0]-20), cv2.FONT_HERSHEY_SIMPLEX, 1, (0,255,255), 2)
            else:
                cv2.putText(image, "CALIBRATED", (10, image.shape[0]-20), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0,255,0), 2)

            if enable_chart and calibrated:
                chart_img = update_bpm_chart()
                if chart_img is not None:
                    h, w = chart_img.shape[:2]
                    x_off = image.shape[1] - w - 10
                    y_off = 10
                    if x_off > 0 and y_off + h < image.shape[0]:
                        image[y_off:y_off+h, x_off:x_off+w] = chart_img

            if frame_count >= dd.MAX_FRAMES: calibrated = True
            cv2.imshow('Lie Detector - Webcam', image)
            if enable_recording and recording: recording.write(image)
            frame_count += 1

            key = cv2.waitKey(5) & 0xFF
            if key == 27: break
            elif key == ord('c'): calibrated = not calibrated
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
    dd.hr_times = [0.0] * dd.MAX_FRAMES
    dd.hr_values = [0.0] * dd.MAX_FRAMES
    dd.avg_bpms = [0] * dd.MAX_FRAMES
    dd.EPOCH = time.time()

    mp_face_mesh = mp.solutions.face_mesh
    mp_hands = mp.solutions.hands
    cap = cv2.VideoCapture(video_file)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    if enable_recording:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"analyzed_{timestamp}.avi"
        fourcc = cv2.VideoWriter_fourcc(*'MJPG')
        recording = cv2.VideoWriter(filename, fourcc, 10, (w, h))

    with mp_face_mesh.FaceMesh(max_num_faces=1, refine_landmarks=True, min_detection_confidence=0.5, min_tracking_confidence=0.5) as face_mesh, \
         mp_hands.Hands(max_num_hands=2, min_detection_confidence=0.5, min_tracking_confidence=0.5) as hands:

        calibrated = False
        frame_count = 0
        paused = False
        while cap.isOpened():
            if not paused:
                success, image = cap.read()
                if not success: break
                
                face_landmarks, hands_landmarks = dd.find_face_and_hands(image, face_mesh, hands)
                current_tells = dd.process_frame(image, face_landmarks, hands_landmarks, calibrated, fps)

                if draw_landmarks:
                    dd.draw_on_frame(image, face_landmarks, hands_landmarks)
                dd.add_text(image, current_tells, calibrated)
                add_truth_meter(image, len(current_tells))

                if not calibrated:
                    progress = min(100, int(frame_count / dd.MAX_FRAMES * 100))
                    cv2.putText(image, f"Calibrating... {progress}%", (10, image.shape[0]-20), cv2.FONT_HERSHEY_SIMPLEX, 1, (0,255,255), 2)
                else:
                    cv2.putText(image, "CALIBRATED", (10, image.shape[0]-20), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0,255,0), 2)

                if enable_chart and calibrated:
                    chart_img = update_bpm_chart()
                    if chart_img is not None:
                        ch, cw = chart_img.shape[:2]
                        x_off = image.shape[1] - cw - 10
                        y_off = 10
                        if x_off > 0 and y_off + ch < image.shape[0]:
                            image[y_off:y_off+ch, x_off:x_off+cw] = chart_img

                if frame_count >= dd.MAX_FRAMES: calibrated = True
                frame_count += 1

            cv2.imshow('Lie Detector - Video Analysis', image)
            if enable_recording and recording and not paused: recording.write(image)

            key = cv2.waitKey(int(1000/fps)) & 0xFF
            if key == 27: break
            elif key == ord(' '): paused = not paused
            if cv2.getWindowProperty('Lie Detector - Video Analysis', cv2.WND_PROP_VISIBLE) < 1: break

    cap.release()
    if recording: recording.release()
    cv2.destroyAllWindows()
    if fig: plt.close(fig); fig = None


if __name__ == "__main__":
    main_menu()