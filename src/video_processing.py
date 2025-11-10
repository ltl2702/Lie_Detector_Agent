import cv2
import pygame
from ffpyplayer.player import MediaPlayer
import deception_detection as dd
from deception_detection import process_frame, find_face_and_hands, MAX_FRAMES, add_text
import mediapipe as mp
import numpy as np

# Global variables for screen dimensions
video_width = 640
video_height = 480
side_panel_width = 160

# Colors
COLOR_BACKGROUND = (20, 20, 20)
COLOR_BUTTON = (50, 50, 50)
COLOR_BUTTON_HOVER = (70, 70, 70)
COLOR_TEXT = (255, 255, 255)

# Load meter image
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
except: 
    pass

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


def draw_fps(screen, fps, x, y):
    font = pygame.font.Font(None, 36)
    fps_text = font.render(f'FPS: {int(fps)}', True, (0, 255, 0))
    screen.blit(fps_text, (x, y))

def draw_tells_on_frame(screen, tells, x, y):
    font = pygame.font.Font(None, 36)
    for idx, (key, tell) in enumerate(tells.items()):
        tell_text = font.render(f'{tell["text"]} (TTL: {tell["ttl"]})', True, (255, 0, 0))
        screen.blit(tell_text, (x, y + idx * 30))

def draw_calibration_indicator(screen, x, y, remaining_frames):
    font = pygame.font.Font(None, 36)
    calib_text = font.render(f'Calibrating... {remaining_frames} frames remaining', True, (255, 255, 0))
    screen.blit(calib_text, (x, y))

def draw_landmarks_and_hands(image, face_landmarks, hands_landmarks):
    mp_drawing = mp.solutions.drawing_utils
    mp_drawing_styles = mp.solutions.drawing_styles
    if face_landmarks:
        mp_drawing.draw_landmarks(
            image,
            face_landmarks,
            mp.solutions.face_mesh.FACEMESH_TESSELATION,
            landmark_drawing_spec=None,
            connection_drawing_spec=mp_drawing_styles.get_default_face_mesh_tesselation_style())
        mp_drawing.draw_landmarks(
            image,
            face_landmarks,
            mp.solutions.face_mesh.FACEMESH_CONTOURS,
            landmark_drawing_spec=None,
            connection_drawing_spec=mp_drawing_styles.get_default_face_mesh_contours_style())
        mp_drawing.draw_landmarks(
            image,
            face_landmarks,
            mp.solutions.face_mesh.FACEMESH_IRISES,
            landmark_drawing_spec=None,
            connection_drawing_spec=mp_drawing_styles.get_default_face_mesh_iris_connections_style())
    if hands_landmarks:
        for hand_landmarks in hands_landmarks:
            mp_drawing.draw_landmarks(
                image,
                hand_landmarks,
                mp.solutions.hands.HAND_CONNECTIONS,
                mp_drawing_styles.get_default_hand_landmarks_style(),
                mp_drawing_styles.get_default_hand_connections_style())

def draw_button(screen, rect, text, font, is_hovered=False):
    color = COLOR_BUTTON_HOVER if is_hovered else COLOR_BUTTON
    pygame.draw.rect(screen, color, rect)
    text_surf = font.render(text, True, COLOR_TEXT)
    screen.blit(text_surf, (rect.x + (rect.width - text_surf.get_width()) // 2, rect.y + (rect.height - text_surf.get_height()) // 2))

def play_video(file_path, screen, draw_landmarks=False):
    pygame.display.set_caption('Video Playback')
    clock = pygame.time.Clock()
    font = pygame.font.Font(None, 36)

    # Reset data khi bắt đầu phiên mới
    dd.hr_times = []
    dd.hr_values = []
    dd.avg_bpms = [0] * dd.MAX_FRAMES
    dd.mood = ''
    dd.mood_history = []
    dd.mood_frames_count = 0
    dd.calculating_mood = False
    dd.tells = dict()
    dd.EPOCH = __import__('time').time()

    cap = cv2.VideoCapture(file_path)
    player = MediaPlayer(file_path)
    face_mesh = mp.solutions.face_mesh.FaceMesh(
        max_num_faces=1,
        refine_landmarks=True,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5)
    hands = mp.solutions.hands.Hands(
        max_num_hands=2,
        min_detection_confidence=0.7)

    exit_button = pygame.Rect(10, 10, 80, 30)
    play_button = pygame.Rect(10, 50, 80, 30)
    pause_button = pygame.Rect(10, 90, 80, 30)
    stop_button = pygame.Rect(10, 130, 80, 30)
    recalibrate_button = pygame.Rect(10, 170, 140, 30)
    running = True
    is_paused = False
    calibrated = False
    calibration_frames = 0

    while running:
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False
            if event.type == pygame.MOUSEBUTTONDOWN:
                if exit_button.collidepoint(event.pos):
                    running = False
                if play_button.collidepoint(event.pos):
                    is_paused = False
                if pause_button.collidepoint(event.pos):
                    is_paused = True
                if stop_button.collidepoint(event.pos):
                    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    player.seek(0, relative=False)
                    is_paused = True
                if recalibrate_button.collidepoint(event.pos):
                    calibrated = False
                    calibration_frames = 0
                    # Reset dữ liệu khi recalibrate - video
                    dd.hr_times = []
                    dd.hr_values = []
                    dd.avg_bpms = [0] * dd.MAX_FRAMES
                    dd.mood_history = []
                    dd.mood_frames_count = 0
                    dd.EPOCH = __import__('time').time()

        if not is_paused:
            ret, frame = cap.read()
            if not ret:
                break
            audio_frame, val = player.get_frame(show=False)
            face_landmarks, hands_landmarks = find_face_and_hands(frame, face_mesh, hands)
            tells = process_frame(frame, face_landmarks, hands_landmarks, calibrated, fps=cap.get(cv2.CAP_PROP_FPS))
            
            calibration_frames += 1
            if calibration_frames >= MAX_FRAMES:
                calibrated = True

            frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            frame = cv2.resize(frame, (video_width, video_height))

            if draw_landmarks:
                draw_landmarks_and_hands(frame, face_landmarks, hands_landmarks)
            
            # Add overlays to frame AFTER resize
            add_text(frame, tells, calibrated)
            add_truth_meter(frame, len(tells))

            # pygame.surfarray.make_surface swaps axes, so we need to transpose first
            frame = np.transpose(frame, (1, 0, 2))  # Swap height and width
            frame = pygame.surfarray.make_surface(frame).convert()

            screen.fill((0, 0, 0))
            screen.blit(frame, (side_panel_width, 0))

            pygame.draw.rect(screen, (200, 0, 0), exit_button)
            exit_text = font.render('Exit', True, (255, 255, 255))
            screen.blit(exit_text, (20, 10))

            if not calibrated:
                draw_calibration_indicator(screen, side_panel_width + 10, 10, MAX_FRAMES - calibration_frames)
            else:
                draw_fps(screen, clock.get_fps(), side_panel_width + 10, 10)
                # draw_tells_on_frame(screen, tells, side_panel_width + 10, 50)  # Disabled - using add_text() on frame instead

            draw_button(screen, play_button, 'Play', font, play_button.collidepoint(pygame.mouse.get_pos()))
            draw_button(screen, pause_button, 'Pause', font, pause_button.collidepoint(pygame.mouse.get_pos()))
            draw_button(screen, stop_button, 'Stop', font, stop_button.collidepoint(pygame.mouse.get_pos()))
            draw_button(screen, recalibrate_button, 'Recalibrate', font, recalibrate_button.collidepoint(pygame.mouse.get_pos()))

            pygame.display.flip()
            clock.tick(30)

    cap.release()
    player.close_player()

def play_webcam(screen, draw_landmarks=False):
    pygame.display.set_caption('Webcam Feed')
    clock = pygame.time.Clock()
    font = pygame.font.Font(None, 36)
    
    side_panel_width = 200  # Space for menu buttons on the left

    # Reset data khi bắt đầu phiên mới
    dd.hr_times = []
    dd.hr_values = []
    dd.avg_bpms = [0] * dd.MAX_FRAMES
    dd.mood = ''
    dd.mood_history = []
    dd.mood_frames_count = 0
    dd.calculating_mood = False
    dd.tells = dict()
    dd.EPOCH = __import__('time').time()

    cap = cv2.VideoCapture(0)
    face_mesh = mp.solutions.face_mesh.FaceMesh(
        max_num_faces=1,
        refine_landmarks=True,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5)
    hands = mp.solutions.hands.Hands(
        max_num_hands=2,
        min_detection_confidence=0.7)

    exit_button = pygame.Rect(10, 10, 80, 30)
    recalibrate_button = pygame.Rect(10, 50, 140, 30)
    running = True
    calibrated = False
    calibration_frames = 0

    while running:
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False
            if event.type == pygame.MOUSEBUTTONDOWN:
                if exit_button.collidepoint(event.pos):
                    running = False
                if recalibrate_button.collidepoint(event.pos):
                    calibrated = False
                    calibration_frames = 0
                    # Reset dữ liệu khi recalibrate - webcam
                    dd.hr_times = []
                    dd.hr_values = []
                    dd.avg_bpms = [0] * dd.MAX_FRAMES
                    dd.mood_history = []
                    dd.mood_frames_count = 0
                    dd.EPOCH = __import__('time').time()

        ret, frame = cap.read()
        if not ret:
            break

        face_landmarks, hands_landmarks = find_face_and_hands(frame, face_mesh, hands)
        tells = process_frame(frame, face_landmarks, hands_landmarks, calibrated, fps=cap.get(cv2.CAP_PROP_FPS))
        
        calibration_frames += 1
        if calibration_frames >= MAX_FRAMES:
            calibrated = True

        frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        frame = cv2.resize(frame, (video_width, video_height))

        if draw_landmarks:
            draw_landmarks_and_hands(frame, face_landmarks, hands_landmarks)
        
        # Add overlays to frame AFTER resize
        add_text(frame, tells, calibrated)
        add_truth_meter(frame, len(tells))

        # pygame.surfarray.make_surface swaps axes, so we need to transpose first
        frame = np.transpose(frame, (1, 0, 2))  # Swap height and width
        frame = pygame.surfarray.make_surface(frame).convert()

        screen.fill((0, 0, 0))
        screen.blit(frame, (side_panel_width, 0))

        pygame.draw.rect(screen, (200, 0, 0), exit_button)
        exit_text = font.render('Exit', True, (255, 255, 255))
        screen.blit(exit_text, (20, 10))

        if not calibrated:
            draw_calibration_indicator(screen, side_panel_width + 10, 10, MAX_FRAMES - calibration_frames)
        else:
            draw_fps(screen, clock.get_fps(), side_panel_width + 10, 10)
            # draw_tells_on_frame(screen, tells, side_panel_width + 10, 50)  # Disabled - using add_text() on frame instead

        draw_button(screen, recalibrate_button, 'Recalibrate', font, recalibrate_button.collidepoint(pygame.mouse.get_pos()))

        pygame.display.flip()
        clock.tick(30)

    cap.release()