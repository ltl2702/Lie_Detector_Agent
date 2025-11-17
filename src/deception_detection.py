import cv2
import numpy as np
from scipy.signal import find_peaks
from scipy.spatial import distance as dist
from fer import FER
import threading
import time
import mediapipe as mp

# Constants and global variables
MAX_FRAMES = 120
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

# Baseline storage for calibration
baseline = {
    'bpm': 0,
    'blink_rate': 0,
    'gaze_stability': 0,
    'lip_ratio': 0,
    'emotion': 'neutral',
    'hand_face_frequency': 0,
    'calibrated': False,
    'samples_count': 0
}

def decrement_tells(tells):
    for key, tell in tells.copy().items():
        if 'ttl' in tell:
            tell['ttl'] -= 1
            if tell['ttl'] <= 0:
                del tells[key]
    return tells

def reset_baseline():
    """Reset baseline to default values for new session"""
    global baseline
    baseline = {
        'bpm': 0,
        'blink_rate': 0,
        'gaze_stability': 0,
        'lip_ratio': 0,
        'emotion': 'neutral',
        'hand_face_frequency': 0,
        'calibrated': False,
        'samples_count': 0
    }

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
                    calculated_bpm = calculate_bpm(recent_hr, 30)  # Assume 30 FPS
                    if calculated_bpm and 50 <= calculated_bpm <= 150:
                        baseline['bpm'] = calculated_bpm
                        print(f"    Using calculated BPM from hr_values: {calculated_bpm:.1f}")
                except Exception as e:
                    print(f"    BPM calculation failed: {e}")
        
        # Calculate blink rate baseline (blinks per minute)
        total_blinks = sum(blinks)
        baseline['blink_rate'] = (total_blinks / MAX_FRAMES) * 60 * 30  # Estimate for 1 minute
        
        # Calculate gaze stability baseline
        valid_gazes = [g for g in gaze_values if g != 0]
        if valid_gazes:
            baseline['gaze_stability'] = np.std(valid_gazes)  # Lower std = more stable
        
        # Set dominant emotion as baseline
        if mood_history:
            from collections import Counter
            emotion_counts = Counter(mood_history)
            baseline['emotion'] = emotion_counts.most_common(1)[0][0]
        
        # Calculate hand-on-face frequency
        baseline['hand_face_frequency'] = sum(hand_on_face) / MAX_FRAMES
        
        baseline['calibrated'] = True
        baseline['samples_count'] = MAX_FRAMES
        
        print(f"\n🎯 BASELINE ESTABLISHED:")
        print(f"   💓 Average BPM: {baseline['bpm']:.1f}")
        print(f"   👁️  Blink Rate: {baseline['blink_rate']:.1f}/min")
        print(f"   👀 Gaze Stability: {baseline['gaze_stability']:.3f}")
        print(f"   😊 Dominant Emotion: {baseline['emotion']}")
        print(f"   🤚 Hand-Face Contact: {baseline['hand_face_frequency']:.2%}")
        print(f"   📊 Total Samples: {baseline['samples_count']}")
        
        return True
    except Exception as e:
        print(f"Error calculating baseline: {e}")
        return False

def get_calibration_progress():
    """Get calibration progress as percentage"""
    # Check multiple data sources
    bpm_samples = len([bpm for bpm in avg_bpms if bpm > 0 and 50 <= bpm <= 150])
    blink_samples = len([b for b in blinks if b is not None])
    mood_samples = len(mood_history)
    
    # Debug info
    if len(avg_bpms) > 0:
        valid_bpms = [bpm for bpm in avg_bpms if bpm > 0]
        if len(valid_bpms) > 0:
            print(f"BPM Progress: {bpm_samples} valid/{len(valid_bpms)} total, range: {min(valid_bpms):.1f}-{max(valid_bpms):.1f}")
    
    # Minimum requirements for each metric
    min_bpm_samples = 30  # At least 30 BPM readings
    min_blink_samples = MAX_FRAMES // 2  # At least half the frames
    min_mood_samples = 5  # At least 5 mood detections
    
    progress_bpm = min(100, (bpm_samples / min_bpm_samples) * 100) if min_bpm_samples > 0 else 0
    progress_blinks = min(100, (blink_samples / min_blink_samples) * 100)
    progress_mood = min(100, (mood_samples / min_mood_samples) * 100)
    
    # Overall progress is average of all metrics
    overall_progress = (progress_bpm + progress_blinks + progress_mood) / 3
    
    return {
        'overall': overall_progress,
        'bpm': progress_bpm,
        'blinks': progress_blinks,
        'mood': progress_mood,
        'ready': overall_progress >= 70 and bpm_samples >= 15  # Lower threshold but require min BPM samples
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
    mood_x = int(.75 * image.shape[1])  # Dịch sang phải từ 70% lên 75%
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

def get_blink_tell(blinks):
    if sum(blinks[:RECENT_FRAMES]) < 3:
        return None
    recent_closed = 1.0 * sum(blinks[-RECENT_FRAMES:]) / RECENT_FRAMES
    avg_closed = 1.0 * sum(blinks) / MAX_FRAMES
    if recent_closed > (20 * avg_closed):
        return "Increased blinking"
    elif avg_closed > (20 * recent_closed):
        return "Decreased blinking"
    else:
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
            emothread = threading.Thread(target=get_mood, args=(image,))
            emothread.start()
            calculating_mood = True
            
        cheekL = get_area(image, False, topL=face[449], topR=face[350], bottomR=face[429], bottomL=face[280])
        cheekR = get_area(image, False, topL=face[121], topR=face[229], bottomR=face[50], bottomL=face[209])
        bpm = get_bpm_change_value(image, False, face_landmarks, hands_landmarks, fps)
        
        # Hiển thị số mẫu đã thu thập khi chưa đủ dữ liệu
        if is_calibrating:
            # During calibration - show collection progress
            samples_collected = len(hr_values)
            bpm_samples = len([bpm for bpm in avg_bpms if bpm > 0])
            if bpm and bpm_samples >= 5:
                bpm_display = f"BPM: {bpm:.1f} (Calibrating: {bpm_samples}/30)"
            else:
                bpm_display = f"BPM: Collecting... ({samples_collected}/60)"
        else:
            # After calibration - show current vs baseline with percentage change
            if bpm and baseline['bpm'] > 0:
                baseline_bpm = baseline['bpm']
                deviation = abs(bpm - baseline_bpm)
                percentage_change = ((bpm - baseline_bpm) / baseline_bpm) * 100
                if deviation > SIGNIFICANT_BPM_CHANGE:
                    bpm_display = f"BPM: {bpm:.1f} ({percentage_change:+.0f}% from baseline)"
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
            # Very strict conditions for BPM change detection - only major changes
            if bpm_delta > SIGNIFICANT_BPM_CHANGE and bpm_delta > baseline_bpm * 0.25:  # 25% change minimum
                # Add cooldown - only report BPM changes every 60 frames (2 seconds)
                if 'bpm_change' not in tells:  # Only create if no existing BPM change tell
                    change_desc = f"Major heart rate {'increase' if bpm > baseline_bpm else 'decrease'} (+{bpm_delta:.1f} BPM)"
                    tells['bpm_change'] = new_tell(change_desc, ttl_for_tells)
        # Always collect blink data
        blinks = blinks[1:] + [is_blinking(face)]
        
        # Only generate blink tells after calibration with baseline comparison + throttling
        if not is_calibrating and baseline['calibrated'] and process_frame.frame_counter % 60 == 0:  # Every 60th frame (2 seconds)
            recent_blink_tell = get_blink_tell(blinks)
            if recent_blink_tell:
                # Only report if significantly different from baseline + cooldown
                current_blink_rate = sum(blinks[-30:]) / 30 * 60 * 30  # Last 30 frames to blinks/min
                baseline_blink_rate = baseline['blink_rate']
                if (abs(current_blink_rate - baseline_blink_rate) > baseline_blink_rate * 0.4 and  # 40% change
                    'blinking' not in tells):  # Only if no existing blink tell
                    tells['blinking'] = new_tell(f"{recent_blink_tell} (vs baseline: {baseline_blink_rate:.1f}/min)", ttl_for_tells)
        # Always collect hand data
        recent_hand_on_face = check_hand_on_face(hands_landmarks, face)
        hand_on_face = hand_on_face[1:] + [recent_hand_on_face]
        
        # Only generate hand tells after calibration and if frequency exceeds baseline + throttling
        if not is_calibrating and recent_hand_on_face and baseline['calibrated'] and process_frame.frame_counter % 90 == 0:  # Every 90th frame (3 seconds)
            current_frequency = sum(hand_on_face[-10:]) / 10  # Last 10 frames
            if (current_frequency > baseline['hand_face_frequency'] * 3 and  # 3x baseline (stricter)
                'hand' not in tells):  # Only if no existing hand tell
                tells['hand'] = new_tell("Frequent hand-face contact", ttl_for_tells)
        # Always collect gaze data
        avg_gaze = get_avg_gaze(face)
        gaze_change = detect_gaze_change(avg_gaze)
        
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
                cheekLwithoutBlue = np.average(cheekL[:, :, 1:3])
                cheekRwithoutBlue = np.average(cheekR[:, :, 1:3])
                
                # Thêm giá trị vào hr_values
                hr_value = cheekLwithoutBlue + cheekRwithoutBlue
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