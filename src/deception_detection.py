import cv2
import numpy as np
from scipy.signal import find_peaks
from scipy.spatial import distance as dist
from fer import FER
import threading
import time
import mediapipe as mp

# Import memory system for adaptive learning
try:
    from memory_system import memory_system
    MEMORY_SYSTEM_AVAILABLE = True
except ImportError:
    MEMORY_SYSTEM_AVAILABLE = False
    print("Memory system not available - using static thresholds")

# Constants and global variables
MAX_FRAMES = 120  # Still used for rolling window arrays
CALIBRATION_TIME_SECONDS = 60  # 1 minute for baseline collection
RECENT_FRAMES = int(MAX_FRAMES / 10)
EYE_BLINK_HEIGHT = .15
SIGNIFICANT_BPM_CHANGE = 10  # Increased threshold to reduce false positives
LIP_COMPRESSION_RATIO = .35
TEXT_HEIGHT = 30
FACEMESH_FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109, 10]
EPOCH = time.time()

# Global variables for detection.
blinks = [False] * MAX_FRAMES
hand_on_face = [False] * MAX_FRAMES
face_area_size = 0
MAX_HISTORY = MAX_FRAMES * 10
hr_times = []  
hr_values = []
avg_bpms = [0] * MAX_FRAMES
gaze_values = [0] * MAX_FRAMES
emotion_detector = FER(mtcnn=True)
calculating_mood = False
mood = ''
mood_history = []  # Lưu lịch sử mood để làm mượt
mood_frames_count = 0  # Đếm số frame để giảm tần suất phát hiện
tells = dict()

# Calibration time tracking and FPS measurement
calibration_start_time = None
fps_tracker = {'last_time': 0, 'frame_count': 0, 'current_fps': 30}
calibration_data = {
    'bpm_values': [],
    'blink_states': [],      # Raw blink states (True/False per frame)
    'blink_events': [],      # Actual blink events (transition detection)
    'gaze_values': [],
    'lip_values': [],        # Lip compression ratios
    'emotion_history': [],
    'hand_states': [],       # Raw hand contact states
    'hand_contact_events': [], # Actual hand contact events
    'start_time': None
}

# Baseline storage for calibration
baseline = {
    'bpm': 0,
    'blink_rate': 0,
    'gaze_stability': 0,
    'lip_ratio': 0,
    'emotion': 'neutral',
    'hand_face_frequency': 0,
    'calibrated': False,
    'samples_count': 0,
    'calibration_duration': 0
}

def decrement_tells(tells):
    for key, tell in tells.copy().items():
        if 'ttl' in tell:
            tell['ttl'] -= 1
            if tell['ttl'] <= 0:
                del tells[key]
    return tells

def start_calibration():
    """Start 2-minute calibration data collection"""
    global calibration_start_time, calibration_data
    calibration_start_time = time.time()
    calibration_data = {
        'bpm_values': [],
        'blink_states': [],      # Raw blink states
        'blink_events': [],      # Actual blink events
        'gaze_values': [],
        'lip_values': [],        # Lip compression ratios
        'emotion_history': [],   # Emotion detections
        'hand_states': [],       # Raw hand contact states
        'hand_contact_events': [], # Actual hand contact events
        'start_time': calibration_start_time
    }
    print(f"🕒 Starting 2-minute calibration data collection at {time.strftime('%H:%M:%S')}")

def is_calibration_complete():
    """Check if 2-minute calibration period is complete"""
    global calibration_start_time
    if not calibration_start_time:
        return False
    return (time.time() - calibration_start_time) >= CALIBRATION_TIME_SECONDS

def get_calibration_elapsed_time():
    """Get elapsed calibration time in seconds"""
    global calibration_start_time
    if not calibration_start_time:
        return 0
    return time.time() - calibration_start_time

def update_fps():
    """Track actual FPS for accurate calculations"""
    global fps_tracker
    current_time = time.time()
    fps_tracker['frame_count'] += 1
    
    if current_time - fps_tracker['last_time'] >= 1.0:  # Update every second
        fps_tracker['current_fps'] = fps_tracker['frame_count'] / (current_time - fps_tracker['last_time'])
        fps_tracker['last_time'] = current_time
        fps_tracker['frame_count'] = 0
    
    return fps_tracker['current_fps']

def reset_baseline():
    """Reset baseline to default values for new session"""
    global baseline, calibration_data, calibration_start_time
    baseline = {
        'bpm': 0,
        'blink_rate': 0,
        'gaze_stability': 0,
        'lip_ratio': 0,
        'emotion': 'neutral',
        'hand_face_frequency': 0,
        'calibrated': False,
        'samples_count': 0,
        'calibration_duration': 0
    }
    calibration_data = {
        'bpm_values': [],
        'blink_states': [],      # Raw blink states
        'blink_events': [],      # Actual blink events
        'gaze_values': [],
        'emotion_history': [],
        'hand_contact_events': [],
        'start_time': None
    }
    calibration_start_time = None

def calculate_baseline():
    """Calculate baseline values from collected calibration data"""
    global baseline, avg_bpms, blinks, gaze_values, mood_history, hand_on_face
    
    try:
        # Calculate BPM baseline - use avg_bpms which contains processed BPM values
        valid_bpms = [bpm for bpm in avg_bpms if bpm > 0 and 50 <= bpm <= 150]
        if len(valid_bpms) >= 10:  # Need at least 10 valid BPM readings
            baseline['bpm'] = sum(valid_bpms) / len(valid_bpms)
            print(f"   🔍 BPM Calculation: {len(valid_bpms)} valid samples, range: {min(valid_bpms):.1f}-{max(valid_bpms):.1f}")
        else:
            print(f"   ⚠️  Insufficient BPM data: only {len(valid_bpms)} valid samples from {len(avg_bpms)} total")
            # Try alternative calculation from hr_values if available
            if len(hr_values) >= 60:
                try:
                    # Calculate BPM from recent hr_values
                    recent_hr = hr_values[-60:]  # Last 60 samples
                    # Use actual FPS from calibration data if available
                    actual_fps = calibration_data.get('fps', 30)
                    calculated_bpm = calculate_bpm(recent_hr, actual_fps)
                    if calculated_bpm and 50 <= calculated_bpm <= 150:
                        baseline['bpm'] = calculated_bpm
                        print(f"    Using calculated BPM from hr_values: {calculated_bpm:.1f}")
                except Exception as e:
                    print(f"    BPM calculation failed: {e}")
        
        # Calculate blink rate baseline from full calibration period
        total_blinks = sum(calibration_data['blink_events'])
        calibration_duration = len(calibration_data['blink_events']) / 30.0  # Assume 30 FPS
        if calibration_duration > 0:
            baseline['blink_rate'] = total_blinks / calibration_duration  # blinks per second
        else:
            baseline['blink_rate'] = 0
        total_blink_frames = sum(calibration_data['blink_states']) if 'blink_states' in calibration_data else 0
        print(f"   👁️  Blink Rate: {total_blinks} blinks in {calibration_duration:.1f}s = {baseline['blink_rate']:.2f}/sec")
        print(f"      Blink frames: {total_blink_frames} | Actual blinks: {total_blinks}")
        
        # Calculate gaze stability baseline from full calibration
        valid_gazes = [g for g in calibration_data['gaze_values'] if g != 0]
        if len(valid_gazes) >= 50:  # Need sufficient gaze data
            baseline['gaze_stability'] = np.std(valid_gazes)  # Lower std = more stable
        else:
            baseline['gaze_stability'] = 0.1  # Default moderate stability
        
        # Set dominant emotion as baseline from calibration period
        if calibration_data['emotion_history']:
            from collections import Counter
            emotion_counts = Counter(calibration_data['emotion_history'])
            baseline['emotion'] = emotion_counts.most_common(1)[0][0]
            print(f"   😊 Emotion Distribution: {dict(emotion_counts)}")
        else:
            baseline['emotion'] = 'neutral'
        
        # Calculate hand-on-face frequency from actual contact events
        total_hand_events = sum(calibration_data['hand_contact_events']) if 'hand_contact_events' in calibration_data else 0
        total_hand_frames = sum(calibration_data['hand_states']) if 'hand_states' in calibration_data else 0
        
        if calibration_duration > 0:
            # Hand contact rate per second
            baseline['hand_face_frequency'] = total_hand_events / calibration_duration
            print(f"   🤚 Hand-Face Contact: {total_hand_events} events in {calibration_duration:.1f}s = {baseline['hand_face_frequency']:.3f}/sec")
            print(f"      Contact frames: {total_hand_frames} | Actual events: {total_hand_events}")
        else:
            baseline['hand_face_frequency'] = 0
            print(f"   🤚 Hand-Face Contact: No data collected")
        
        baseline['calibrated'] = True
        baseline['samples_count'] = len(calibration_data.get('blink_states', []))
        
        # Validate baseline quality
        quality_score = 0
        if len(valid_bpms) >= 30: quality_score += 25
        if baseline['blink_rate'] > 0: quality_score += 25  
        if len(valid_gazes) >= 50: quality_score += 25
        if calibration_data['emotion_history']: quality_score += 25
        
        print(f"   📊 Baseline Quality Score: {quality_score}/100")
        
        print(f"\n🎯 BASELINE ESTABLISHED:")
        print(f"   💓 Average BPM: {baseline['bpm']:.1f}")
        print(f"   👁️  Blink Rate: {baseline['blink_rate']:.2f}/sec")
        print(f"   👀 Gaze Stability: {baseline['gaze_stability']:.3f}")
        print(f"   😊 Dominant Emotion: {baseline['emotion']}")
        print(f"   🤚 Hand-Face Contact: {baseline['hand_face_frequency']:.3f}/sec")
        print(f"   📊 Total Samples: {baseline['samples_count']}")
        
        # Debug: Show collection summary
        print(f"\n📊 COLLECTION SUMMARY:")
        print(f"   BPM samples: {len(calibration_data['bpm_values'])}")
        print(f"   Blink events: {len(calibration_data['blink_events'])}")
        print(f"   Gaze samples: {len(calibration_data['gaze_values'])}")
        print(f"   Hand events: {len(calibration_data['hand_contact_events'])}")
        print(f"   Emotion samples: {len(calibration_data['emotion_history'])}")
        
        # Update memory system with baseline metrics (session already started)
        if MEMORY_SYSTEM_AVAILABLE and memory_system.current_session:
            memory_system.current_session.baseline_metrics = baseline.copy()
            print(f"🧠 MEMORY SYSTEM: Baseline metrics recorded for current session")
        
        return True
    except Exception as e:
        print(f"Error calculating baseline: {e}")
        return False

def get_calibration_progress():
    """Get calibration progress as percentage"""
    if not calibration_start_time:
        return {
            'elapsed_time': 0,
            'time_progress': 0,
            'bpm': 0,
            'blinks': 0,
            'mood': 0,
            'gaze': 0,
            'samples_collected': {'bpm': 0, 'blinks': 0, 'moods': 0, 'gazes': 0, 'hand_contacts': 0},
            'ready': False
        }
    
    # Calculate time progress
    elapsed_time = time.time() - calibration_start_time
    time_progress = min(100, (elapsed_time / CALIBRATION_TIME_SECONDS) * 100)
    
    # Check data collection progress
    bpm_count = len([bpm for bpm in calibration_data.get('bpm_values', []) if bpm and 50 <= bpm <= 150])
    blink_count = sum(calibration_data.get('blink_events', []))  # Actual blinks
    mood_count = len(calibration_data.get('emotion_history', []))
    gaze_count = len(calibration_data.get('gaze_values', []))
    hand_count = sum(calibration_data.get('hand_contact_events', []))  # Actual contacts
    
    # Calculate progress percentages
    # Target: 60 samples per minute for 2 minutes = 120 samples each
    target_samples = 120
    bpm_progress = min(100, (bpm_count / target_samples) * 100)
    blink_progress = min(100, (blink_count / 60) * 100)  # Expect ~60 blinks in 2 mins
    mood_progress = min(100, (mood_count / 20) * 100)  # Need fewer mood samples
    gaze_progress = min(100, (gaze_count / target_samples) * 100)
    hand_progress = min(100, (hand_count / 10) * 100)  # Expect ~10 hand contacts
    
    # Overall data progress
    data_progress = (bpm_progress + blink_progress + mood_progress + gaze_progress + hand_progress) / 5
    
    # Ready when we have minimum time AND minimum data
    # Realistic requirements: BPM=30, Blinks=20 (10/min), Moods=5, Gaze=50
    min_data_ready = (bpm_count >= 30 and blink_count >= 10 and
                     mood_count >= 3 and gaze_count >= 30)
    time_ready = elapsed_time >= CALIBRATION_TIME_SECONDS
    
    return {
        'elapsed_time': elapsed_time,
        'time_progress': time_progress,
        'bpm': bpm_progress,
        'blinks': blink_progress,
        'mood': mood_progress,
        'gaze': gaze_progress,
        'hand': hand_progress,
        'samples_collected': {
            'bpm': bpm_count,
            'blinks': blink_count,
            'moods': mood_count,
            'gazes': gaze_count,
            'hand_contacts': hand_count
        },
        'ready': time_ready and min_data_ready
    }

def new_tell(result, ttl_for_tells):
    return {'text': result, 'ttl': ttl_for_tells}

def smooth(signal, window_size):
    window = np.ones(window_size) / window_size
    return np.convolve(signal, window, mode='same')

def calculate_bpm(signal, fps, min_bpm=50, max_bpm=150):
    if len(signal) < 30:  # Cần ít nhất 30 mẫu
        return None
    
    try:
        # Chuẩn hóa tín hiệu
        signal_array = np.array(signal)
        signal_normalized = (signal_array - np.mean(signal_array)) / (np.std(signal_array) + 1e-6)
        
        # Làm mượt tín hiệu
        signal_smooth = smooth(signal_normalized, window_size=min(5, len(signal_normalized) // 2))
        
        # Tìm peaks với các tham số linh hoạt hơn
        min_distance = max(int(fps * 60 / max_bpm), 10)  # Khoảng cách tối thiểu giữa các peaks
        
        peaks, properties = find_peaks(signal_smooth, 
                                        distance=min_distance,
                                        prominence=0.3)  # Giảm prominence để dễ phát hiện hơn
        
        if len(peaks) < 2:
            return None
        
        # Tính BPM từ khoảng cách giữa các peaks
        peak_intervals = np.diff(peaks) / fps  # Thời gian giữa các peaks (giây)
        bpms = 60.0 / peak_intervals  # Chuyển sang BPM
        
        # Lọc các giá trị BPM hợp lệ
        valid_bpms = bpms[(bpms >= min_bpm) & (bpms <= max_bpm)]
        
        if len(valid_bpms) == 0:
            return None
        
        # Trả về BPM trung bình
        avg_bpm = np.mean(valid_bpms)
        return float(avg_bpm)
    except Exception as e:
        print(f"Error in calculate_bpm: {e}")
        return None

def draw_on_frame(image, face_landmarks, hands_landmarks):
    import mediapipe as mp
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

def add_text(image, tells, calibrated, banner_height=0):
    """
    Add text overlays to image
    banner_height: height of top banner to offset text below it
    """
    global mood
    # Offset cho text bắt đầu sau banner - tăng thêm khoảng cách
    start_y = banner_height + 40 if banner_height > 0 else TEXT_HEIGHT
    text_y = start_y
    
    # Hiển thị mood ở góc phải hơn, sau banner và xuống dưới hơn
    mood_x = int(.80*image.shape[1])  # Dịch sang phải từ 70% lên 75%
    mood_y = start_y + 10  # Thêm 10px xuống dưới
    
    if mood:
        mood_text = "Mood: {}".format(mood)
        write(mood_text, image, mood_x, mood_y)
    else:
        # Hiển thị "Detecting..." nếu chưa có mood
        write("Mood: Detecting...", image, mood_x, mood_y)
    
    if calibrated:
        for tell in tells.values():
            write(tell['text'], image, 10, text_y)
            text_y += TEXT_HEIGHT

def write(text, image, x, y):
    cv2.putText(img=image, text=text, org=(x, y),
                fontFace=cv2.FONT_HERSHEY_SIMPLEX, fontScale=1, color=[0, 0, 0],
                lineType=cv2.LINE_AA, thickness=4)
    cv2.putText(img=image, text=text, org=(x, y),
                fontFace=cv2.FONT_HERSHEY_SIMPLEX, fontScale=1, color=[255, 255, 255],
                lineType=cv2.LINE_AA, thickness=2)

def get_aspect_ratio(top, bottom, right, left):
    height = dist.euclidean([top.x, top.y], [bottom.x, bottom.y])
    width = dist.euclidean([right.x, right.y], [left.x, left.y])
    return height / width

def get_area(image, draw, topL, topR, bottomR, bottomL):
    topY = int((topR.y + topL.y) / 2 * image.shape[0])
    botY = int((bottomR.y + bottomL.y) / 2 * image.shape[0])
    leftX = int((topL.x + bottomL.x) / 2 * image.shape[1])
    rightX = int((topR.x + bottomR.x) / 2 * image.shape[1])
    return image[topY:botY, rightX:leftX]

def is_blinking(face):
    eyeR = [face[p] for p in [159, 145, 133, 33]]
    eyeR_ar = get_aspect_ratio(*eyeR)
    eyeL = [face[p] for p in [386, 374, 362, 263]]
    eyeL_ar = get_aspect_ratio(*eyeL)
    eyeA_ar = (eyeR_ar + eyeL_ar) / 2
    return eyeA_ar < EYE_BLINK_HEIGHT

def get_blink_tell(blinks, baseline_blink_rate):
    """Detect abnormal blinking compared to calibrated baseline"""
    if baseline_blink_rate <= 0:
        return None
        
    # Calculate current blink rate (last 30 frames = ~1 second at 30fps)
    recent_frames = min(30, len(blinks))
    recent_blinks = sum(blinks[-recent_frames:])
    current_blink_rate = recent_blinks / (recent_frames / 30.0)  # Convert to blinks/second
    
    # Compare with baseline (need significant change)
    change_ratio = abs(current_blink_rate - baseline_blink_rate) / baseline_blink_rate
    
    if change_ratio > 0.5:  # 50% change from baseline
        if current_blink_rate > baseline_blink_rate:
            return f"Increased blinking ({current_blink_rate:.2f} vs {baseline_blink_rate:.2f}/sec)"
        else:
            return f"Decreased blinking ({current_blink_rate:.2f} vs {baseline_blink_rate:.2f}/sec)"
    
    return None

def check_hand_on_face(hands_landmarks, face):
    if hands_landmarks:
        face_landmarks = [face[p] for p in FACEMESH_FACE_OVAL]
        face_points = [[[p.x, p.y] for p in face_landmarks]]
        face_contours = np.array(face_points).astype(np.single)
        for hand_landmarks in hands_landmarks:
            hand = []
            for point in hand_landmarks.landmark:
                hand.append((point.x, point.y))
            for finger in [4, 8, 20]:
                overlap = cv2.pointPolygonTest(face_contours, hand[finger], False)
                if overlap != -1:
                    return True
    return False

def count_hand_transitions(hand_states):
    """Count actual hand contact events (transitions from False to True)"""
    if len(hand_states) < 2:
        return 0
    
    contact_count = 0
    for i in range(1, len(hand_states)):
        if not hand_states[i-1] and hand_states[i]:  # False → True transition
            contact_count += 1
    return contact_count

def get_avg_gaze(face):
    gaze_left = get_gaze(face, 476, 474, 263, 362)
    gaze_right = get_gaze(face, 471, 469, 33, 133)
    return round((gaze_left + gaze_right) / 2, 1)

def get_gaze(face, iris_L_side, iris_R_side, eye_L_corner, eye_R_corner):
    iris = (face[iris_L_side].x + face[iris_R_side].x, face[iris_L_side].y + face[iris_R_side].y)
    eye_center = (face[eye_L_corner].x + face[eye_R_corner].x, face[eye_L_corner].y + face[eye_R_corner].y)
    gaze_dist = dist.euclidean(iris, eye_center)
    eye_width = abs(face[eye_R_corner].x - face[eye_L_corner].x)
    gaze_relative = gaze_dist / eye_width
    if (eye_center[0] - iris[0]) < 0:
        gaze_relative *= -1
    return gaze_relative

def detect_gaze_change(avg_gaze):
    global gaze_values
    gaze_values = gaze_values[1:] + [avg_gaze]
    gaze_relative_matches = 1.0 * gaze_values.count(avg_gaze) / MAX_FRAMES
    if gaze_relative_matches < .01:
        return gaze_relative_matches
    return 0


def get_lip_ratio(face):
    return get_aspect_ratio(face[0], face[17], face[61], face[291])

def get_mood(image):
    global emotion_detector, calculating_mood, mood, mood_history
    try:
        detected_mood, score = emotion_detector.top_emotion(image)
        calculating_mood = False
        
        if detected_mood and score:
            # Giảm ngưỡng confidence xuống 0.5 để phát hiện nhanh hơn
            if score > 0.50:
                # Thêm vào lịch sử
                mood_history.append(detected_mood)
                
                # Giữ tối đa 6 kết quả gần nhất (giảm từ 10)
                if len(mood_history) > 6:
                    mood_history = mood_history[-6:]
                
                # Chỉ cần 3 kết quả để bắt đầu phát hiện (giảm từ 5)
                if len(mood_history) >= 3:
                    # Đếm mood nào xuất hiện nhiều nhất
                    from collections import Counter
                    mood_counter = Counter(mood_history)
                    most_common_mood, count = mood_counter.most_common(1)[0]
                    
                    # Chỉ cần 50% consistency (giảm từ 60%)
                    if count >= len(mood_history) * 0.5:
                        if mood != most_common_mood:
                            print(f"Mood changed: {most_common_mood} (confidence: {score:.2f}, consistency: {count}/{len(mood_history)})")
                            mood = most_common_mood
                        return mood
            elif detected_mood == 'neutral' and score > 0.35:
                # Neutral dễ phát hiện hơn, giảm ngưỡng xuống 0.35
                mood_history.append(detected_mood)
                if len(mood_history) > 6:
                    mood_history = mood_history[-6:]
                if len(mood_history) >= 2:  # Chỉ cần 2 kết quả cho neutral
                    from collections import Counter
                    mood_counter = Counter(mood_history)
                    most_common_mood, count = mood_counter.most_common(1)[0]
                    if count >= len(mood_history) * 0.5 and most_common_mood == 'neutral':
                        if mood != 'neutral':
                            print(f"Mood changed: neutral (confidence: {score:.2f})")
                            mood = 'neutral'
                        return mood
        calculating_mood = False
    except Exception as e:
        print(f"Error detecting mood: {e}")
        calculating_mood = False
    return mood
    
def get_emotions(image):
    global emotion_detector
    emotion_data = {
        "angry": 0,
        "disgust": 0,
        "fear": 0,
        "happy": 0,
        "sad": 0,
        "surprise": 0,
        "neutral": 0
    }
    emotions = emotion_detector.detect_emotions(image)
    if emotions:
        for emotion in emotions:
            for key in emotion["emotions"]:
                emotion_data[key] += emotion["emotions"][key]
    return emotion_data

def get_face_relative_area(face):
    face_width = abs(max(face[454].x, 0) - max(face[234].x, 0))
    face_height = abs(max(face[152].y, 0) - max(face[10].y, 0))
    return face_width * face_height

def find_face_and_hands(image_original, face_mesh, hands):
    image = image_original.copy()
    image.flags.writeable = False
    image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    faces = face_mesh.process(image)
    hands_landmarks = hands.process(image).multi_hand_landmarks
    face_landmarks = None
    if faces.multi_face_landmarks and len(faces.multi_face_landmarks) > 0:
        face_landmarks = faces.multi_face_landmarks[0]
    return face_landmarks, hands_landmarks

def process_frame(image, face_landmarks, hands_landmarks, calibrated=False, fps=None, ttl_for_tells=20):
    global tells, calculating_mood, mood_frames_count, baseline
    global blinks, hand_on_face, face_area_size
    
    # Add frame counter for detection throttling
    if not hasattr(process_frame, "frame_counter"):
        process_frame.frame_counter = 0
    process_frame.frame_counter += 1
    
    # Track actual FPS for accurate calculations
    actual_fps = update_fps()
    if fps is None:
        fps = actual_fps
    
    # Initialize calibration if not started
    global calibration_start_time, calibration_data
    if calibration_start_time is None and not baseline['calibrated']:
        start_calibration()
    
    # During calibration, only collect data - don't generate detection tells
    is_calibrating = not calibrated or not baseline['calibrated']
    
    # Only decrement existing tells, don't create new ones during calibration
    if not is_calibrating:
        tells = decrement_tells(tells)
    else:
        # During calibration, clear all tells except BPM display
        tells = {'avg_bpms': tells.get('avg_bpms', {'text': 'BPM: Initializing...', 'ttl': ttl_for_tells})}
    if face_landmarks:
        face = face_landmarks.landmark
        face_area_size = get_face_relative_area(face)
        
        # Chỉ phát hiện mood mỗi 5 frames (nhanh hơn) để giảm nhiễu
        mood_frames_count += 1
        if not calculating_mood and mood_frames_count >= 5:
            mood_frames_count = 0
            # Pass image copy to avoid race conditions
            image_copy = image.copy() 
            emothread = threading.Thread(target=get_mood, args=(image_copy,))
            emothread.daemon = True  # Ensure thread closes with main program
            emothread.start()
            calculating_mood = True
        cheekL = get_area(image, False, topL=face[449], topR=face[350], bottomR=face[429], bottomL=face[280])
        cheekR = get_area(image, False, topL=face[121], topR=face[229], bottomR=face[50], bottomL=face[209])
        bpm = get_bpm_change_value(image, False, face_landmarks, hands_landmarks, fps)
        
        # Collect calibration data during 2-minute period
        if is_calibrating and calibration_start_time:
            # Collect BPM data
            if bpm and 50 <= bpm <= 150:
                calibration_data['bpm_values'].append(bpm)
            
            # Collect blink data - detect blink transitions (not just blink state)
            current_blink_state = is_blinking(face)
            calibration_data['blink_states'].append(current_blink_state)
            
            # Count actual blinks by detecting transitions from non-blink to blink
            if len(calibration_data['blink_states']) == 1:
                # First frame - no transition possible
                calibration_data['blink_events'].append(False)
            elif len(calibration_data['blink_states']) >= 2:
                prev_blink = calibration_data['blink_states'][-2]
                curr_blink = calibration_data['blink_states'][-1]
                if not prev_blink and curr_blink:  # Transition: False → True = new blink
                    calibration_data['blink_events'].append(True)
                    print(f"👁️ New blink detected at frame {len(calibration_data['blink_states'])}")
                else:
                    calibration_data['blink_events'].append(False)
            
            # Collect gaze data
            avg_gaze = get_avg_gaze(face)
            if avg_gaze != 0:
                calibration_data['gaze_values'].append(avg_gaze)
            
            # Collect lip data
            lip_ratio = get_lip_ratio(face)
            if lip_ratio > 0:
                calibration_data['lip_values'].append(lip_ratio)
            
            # Collect emotion data (from global mood variable)
            if mood and mood not in calibration_data['emotion_history'][-1:]:  # Avoid duplicates
                calibration_data['emotion_history'].append(mood)
            
            # Collect hand-face contact data - detect contact transitions
            current_hand_contact = check_hand_on_face(hands_landmarks, face)
            calibration_data['hand_states'].append(current_hand_contact)
            
            # Count actual hand contacts by detecting transitions
            if len(calibration_data['hand_states']) == 1:
                # First frame - no transition possible
                calibration_data['hand_contact_events'].append(False)
            elif len(calibration_data['hand_states']) >= 2:
                prev_contact = calibration_data['hand_states'][-2]
                curr_contact = calibration_data['hand_states'][-1]
                if not prev_contact and curr_contact:  # Transition: False → True = new contact
                    calibration_data['hand_contact_events'].append(True)
                    print(f"🤚 New hand contact at frame {len(calibration_data['hand_states'])}")
                else:
                    calibration_data['hand_contact_events'].append(False)
            
            # Debug hand detection
            total_contacts = sum(calibration_data['hand_contact_events'])
            total_frames_with_contact = sum(calibration_data['hand_states'])
            if hands_landmarks:
                print(f"🤚 Hand detected | Contacts: {total_contacts} | Contact frames: {total_frames_with_contact}")
            
            # Debug hand detection
            # Debug removed - already included above
            
            # Display calibration progress
            elapsed_time = get_calibration_elapsed_time()
            bpm_count = len(calibration_data['bpm_values'])
            remaining_time = CALIBRATION_TIME_SECONDS - elapsed_time
            
            if bpm and bpm_count >= 5:
                bpm_display = f"BPM: {bpm:.1f} (Calibrating: {elapsed_time:.0f}s/{CALIBRATION_TIME_SECONDS}s)"
            else:
                bpm_display = f"BPM: Collecting... ({elapsed_time:.0f}s/{CALIBRATION_TIME_SECONDS}s, {bpm_count} samples)"
        else:
            # After calibration - show current vs baseline with percentage change
            if bpm and baseline['bpm'] > 0:
                baseline_bpm = baseline['bpm']
                deviation = abs(bpm - baseline_bpm)
                percentage_change = ((bpm - baseline_bpm) / baseline_bpm) * 100
                if deviation > SIGNIFICANT_BPM_CHANGE:
                    bpm_display = f"BPM: {bpm:.1f} ({percentage_change:+.0f}%)"
                else:
                    bpm_display = f"BPM: {bpm:.1f} (Normal)"
            else:
                bpm_display = f"BPM: {bpm:.1f}" if bpm else "BPM: Calculating..."
        
        # Always show BPM info
        tells['avg_bpms'] = new_tell(bpm_display, ttl_for_tells)
        
        # Only generate detection tells after calibration is complete + frame throttling
        if not is_calibrating and bpm and baseline['bpm'] > 0 and process_frame.frame_counter % 30 == 0:  # Every 30th frame (1 second)
            baseline_bpm = baseline['bpm']
            bpm_delta = abs(bpm - baseline_bpm)
            
            # Get adaptive threshold from memory system
            adaptive_threshold = SIGNIFICANT_BPM_CHANGE
            if MEMORY_SYSTEM_AVAILABLE:
                adaptive_threshold_pct = memory_system.get_adaptive_threshold('bpm_change') 
                adaptive_threshold = baseline_bpm * (adaptive_threshold_pct / 100.0)
            
            # Use adaptive threshold instead of fixed threshold
            if bpm_delta > adaptive_threshold:
                # Add cooldown - only report BPM changes every 60 frames (2 seconds)
                if 'bpm_change' not in tells:  # Only create if no existing BPM change tell
                    change_desc = f"Heart rate {'increase' if bpm > baseline_bpm else 'decrease'} (+{bpm_delta:.1f} BPM)"
                    tells['bpm_change'] = new_tell(change_desc, ttl_for_tells)
        # Always collect blink data (for rolling window during detection phase)
        if not is_calibrating:  # Only update rolling window after calibration
            blinks = blinks[1:] + [is_blinking(face)]
        
        # Only generate blink tells after calibration with baseline comparison + throttling
        if not is_calibrating and baseline['calibrated'] and process_frame.frame_counter % 60 == 0:  # Every 60th frame (2 seconds)
            recent_blink_tell = get_blink_tell(blinks, baseline.get('blink_rate', 0))
            if recent_blink_tell:
                # Get adaptive threshold from memory system
                adaptive_threshold_pct = 0.4  # Default 40%
                if MEMORY_SYSTEM_AVAILABLE:
                    adaptive_threshold_pct = memory_system.get_adaptive_threshold('blink_rate') / 100.0
                
                # Only report if significantly different from baseline + cooldown
                current_blink_rate = (sum(blinks[-30:]) / (30 / 30.0)) * 60  # Last 30 frames (1 sec) to blinks/min
                baseline_blink_rate = baseline['blink_rate']
                if (abs(current_blink_rate - baseline_blink_rate) > baseline_blink_rate * adaptive_threshold_pct and
                    'blinking' not in tells):  # Only if no existing blink tell
                    tells['blinking'] = new_tell(f"{recent_blink_tell} (vs baseline: {baseline_blink_rate:.1f}/min)", ttl_for_tells)
        # Always collect hand data (for rolling window during detection phase)
        if not is_calibrating:  # Only update rolling window after calibration
            recent_hand_on_face = check_hand_on_face(hands_landmarks, face)
            hand_on_face = hand_on_face[1:] + [recent_hand_on_face]
        
        # Only generate hand tells after calibration and if frequency exceeds baseline + throttling
        if not is_calibrating and recent_hand_on_face and baseline['calibrated'] and process_frame.frame_counter % 90 == 0:  # Every 90th frame (3 seconds)
            # Get adaptive threshold from memory system
            adaptive_multiplier = 3.0  # Default 3x baseline
            if MEMORY_SYSTEM_AVAILABLE:
                adaptive_threshold_pct = memory_system.get_adaptive_threshold('hand_face_frequency')
                adaptive_multiplier = adaptive_threshold_pct / 100.0
            
            # Count actual hand contacts in recent window (last 10 seconds = 300 frames at 30fps)
            recent_window_size = min(300, len(hand_on_face))
            recent_contacts = count_hand_transitions(hand_on_face[-recent_window_size:])
            recent_duration = recent_window_size / 30.0  # seconds
            current_rate = recent_contacts / recent_duration if recent_duration > 0 else 0  # contacts/sec
            
            baseline_rate = baseline['hand_face_frequency']  # contacts/sec
            if (current_rate > baseline_rate * adaptive_multiplier and
                'hand' not in tells):  # Only if no existing hand tell
                tells['hand'] = new_tell(f"Frequent hand-face contact ({current_rate:.3f}/sec vs {baseline_rate:.3f}/sec baseline)", ttl_for_tells)
        # Always collect gaze data (for rolling window during detection phase)
        if not is_calibrating:  # Only update rolling window after calibration
            avg_gaze = get_avg_gaze(face)
            gaze_change = detect_gaze_change(avg_gaze)
        else:
            gaze_change = 0  # No gaze change detection during calibration
        
        # Always collect lip data
        lip_ratio = get_lip_ratio(face)
        
        # Only generate tells after calibration with stricter conditions + throttling
        if not is_calibrating and process_frame.frame_counter % 15 == 0:  # Every 15th frame (0.5 seconds) for gaze/lips
            # Report gaze changes
            if gaze_change and gaze_change > 0.08:  # Restored original threshold
                tells['gaze'] = new_tell(f"Gaze shift ({gaze_change:.2f})", ttl_for_tells)
            # Lip compression detection
            if lip_ratio < LIP_COMPRESSION_RATIO:  # Restored original threshold
                tells['lips'] = new_tell(f"Lip compression (ratio: {lip_ratio:.3f})", ttl_for_tells)
    
    # During calibration, return only BPM info
    if is_calibrating:
        return {'avg_bpms': tells.get('avg_bpms', new_tell('BPM: Initializing...', ttl_for_tells))}
    else:
        # Aggressive tell filtering - keep only essential tells
        filtered_tells = {}
        
        # Always keep BPM display
        if 'avg_bpms' in tells:
            filtered_tells['avg_bpms'] = tells['avg_bpms']
            
        # Include all detection tells (restored original behavior)
        detection_tells = ['bpm_change', 'blinking', 'hand', 'gaze', 'lips']
        
        for tell_type in detection_tells:
            if tell_type in tells:
                filtered_tells[tell_type] = tells[tell_type]
                
        return filtered_tells

def get_bpm_change_value(image, draw, face_landmarks, hands_landmarks, fps):
    global hr_values, hr_times, EPOCH, avg_bpms
    
    if face_landmarks:
        face = face_landmarks.landmark
        try:
            cheekL = get_area(image, draw, topL=face[449], topR=face[350], bottomR=face[429], bottomL=face[280])
            cheekR = get_area(image, draw, topL=face[121], topR=face[229], bottomR=face[50], bottomL=face[209])
            
            # Kiểm tra kích thước vùng má có hợp lệ không
            if cheekL.size > 0 and cheekR.size > 0:
                # Use only Green channel (index 1) for better rPPG signal
                cheekL_green = np.average(cheekL[:, :, 1])  # Green channel only
                cheekR_green = np.average(cheekR[:, :, 1])  # Green channel only
                
                # Combine Green channel values from both cheeks
                hr_value = (cheekL_green + cheekR_green) / 2  # Average for stability
                hr_values.append(hr_value)
                hr_times.append(time.time() - EPOCH)
                
                # Giới hạn độ dài để tránh tràn bộ nhớ
                if len(hr_values) > MAX_HISTORY:
                    hr_values = hr_values[-MAX_HISTORY:]
                    hr_times = hr_times[-MAX_HISTORY:]
                
                # Cần ít nhất 60 frame (khoảng 2 giây) để tính BPM chính xác
                if len(hr_values) >= 60:
                    bpm = calculate_bpm(hr_values[-120:], fps)
                    if bpm:
                        # Cập nhật avg_bpms
                        avg_bpms = avg_bpms[1:] + [bpm]
                        return bpm
        except Exception as e:
            print(f"Error calculating BPM: {e}")
    
    return None