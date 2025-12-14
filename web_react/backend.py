"""
Flask API Backend for Lie Detector Web Interface
Connects React frontend with Python deception detection engine
"""

from flask import Flask, jsonify, request, send_file
from flask_cors import CORS
from flask_socketio import SocketIO, emit, join_room, leave_room
from werkzeug.utils import secure_filename
import sys
import os
import threading
import uuid
import json
import re
import time
from datetime import datetime
from pathlib import Path

# Add src directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

import cv2
import mediapipe as mp
import deception_detection as dd
import memory_system as ms

# Load environment variables from .env file
from dotenv import load_dotenv
load_dotenv()

# Import Gemini AI for session analysis
try:
    import google.generativeai as genai
    # Configure with API key (set GEMINI_API_KEY in environment or .env file)
    GEMINI_API_KEY = os.getenv('GEMINI_API_KEY', '')
    if GEMINI_API_KEY:
        genai.configure(api_key=GEMINI_API_KEY)
        GEMINI_AVAILABLE = True
        print("✅ Gemini AI configured for session analysis")
    else:
        GEMINI_AVAILABLE = False
        print("⚠️ GEMINI_API_KEY not found. AI analysis will be disabled.")
        print("   Please create .env file with: GEMINI_API_KEY=your_key_here")
except ImportError:
    GEMINI_AVAILABLE = False
    print("⚠️ google-generativeai not installed. Run: pip install google-generativeai")

app = Flask(__name__)
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*")

# Global state management
sessions = {}
active_cameras = {}
current_frame = None  # Store latest frame from camera
current_frame_lock = threading.Lock()  # Thread-safe frame access

class DetectionSession:
    """Manages a single detection session"""
    def __init__(self, session_id):
        self.session_id = session_id
        self.created_at = datetime.now()
        self.baseline = None
        self.calibrated = False
        self.metrics = {}
        self.tells = []
        self.camera_thread = None
        self.camera_running = False
        self.frame_count = 0
        self.emotion_detector = None
        self.cap = None  # Camera capture object
        self.video_writer = None  # Video writer for recording
        self.video_filename = None  # Output video filename
        self.recording = False  # Recording status
        
        # Store MediaPipe references (lazy initialization)
        self.mp_face_mesh = None
        self.mp_hands = None
        self.mp_drawing = None
        self.mp_drawing_styles = None
        self.face_mesh = None
        self.hands = None
    
    def _init_mediapipe(self):
        """Initialize MediaPipe components (lazy initialization)"""
        if self.mp_face_mesh is None:
            self.mp_face_mesh = mp.solutions.face_mesh
            self.mp_hands = mp.solutions.hands
            self.mp_drawing = mp.solutions.drawing_utils
            self.mp_drawing_styles = mp.solutions.drawing_styles
            
            self.face_mesh = self.mp_face_mesh.FaceMesh(
                max_num_faces=1,
                refine_landmarks=True,
                min_detection_confidence=0.5,
                min_tracking_confidence=0.5
            )
            self.hands = self.mp_hands.Hands(
                max_num_hands=2,
                min_detection_confidence=0.5,
                min_tracking_confidence=0.5
            )
        
    def start_camera_capture(self):
        """Start camera capture thread"""
        global current_frame, current_frame_lock
        
        if self.camera_thread and self.camera_thread.is_alive():
            return  # Already running
        
        # Initialize MediaPipe before starting camera
        self._init_mediapipe()
        
        def capture_frames():
            global current_frame, current_frame_lock
            
            # Try multiple methods to open camera
            self.cap = cv2.VideoCapture(0, cv2.CAP_DSHOW)
            if not self.cap.isOpened():
                self.cap = cv2.VideoCapture(0)
            
            if not self.cap.isOpened():
                print(f"❌ Cannot open camera for session {self.session_id}")
                print("Available cameras might be in use or not available")
                return
            
            self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
            self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
            self.cap.set(cv2.CAP_PROP_FPS, 30)
            
            print(f"✅ Camera opened successfully for session {self.session_id}")
            
            frame_count = 0
            while self.camera_running:
                ret, frame = self.cap.read()
                if not ret:
                    print(f"⚠️ Failed to read frame from camera")
                    break
                
                frame = cv2.flip(frame, 1)
                frame_count += 1
                self.frame_count = frame_count
                
                # Process frame with landmarks if recording
                frame_to_save = frame.copy()
                if self.recording and self.video_writer:
                    # Convert BGR to RGB for MediaPipe
                    frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                    
                    # Process face mesh
                    face_results = self.face_mesh.process(frame_rgb)
                    if face_results.multi_face_landmarks:
                        for face_landmarks in face_results.multi_face_landmarks:
                            # Draw face mesh
                            self.mp_drawing.draw_landmarks(
                                image=frame_to_save,
                                landmark_list=face_landmarks,
                                connections=self.mp_face_mesh.FACEMESH_TESSELATION,
                                landmark_drawing_spec=None,
                                connection_drawing_spec=self.mp_drawing_styles.get_default_face_mesh_tesselation_style()
                            )
                            # Draw face contours
                            self.mp_drawing.draw_landmarks(
                                image=frame_to_save,
                                landmark_list=face_landmarks,
                                connections=self.mp_face_mesh.FACEMESH_CONTOURS,
                                landmark_drawing_spec=None,
                                connection_drawing_spec=self.mp_drawing_styles.get_default_face_mesh_contours_style()
                            )
                    
                    # Process hands
                    hand_results = self.hands.process(frame_rgb)
                    if hand_results.multi_hand_landmarks:
                        for hand_landmarks in hand_results.multi_hand_landmarks:
                            # Draw hand landmarks
                            self.mp_drawing.draw_landmarks(
                                image=frame_to_save,
                                landmark_list=hand_landmarks,
                                connections=self.mp_hands.HAND_CONNECTIONS,
                                landmark_drawing_spec=self.mp_drawing_styles.get_default_hand_landmarks_style(),
                                connection_drawing_spec=self.mp_drawing_styles.get_default_hand_connections_style()
                            )
                    
                    # Add timestamp and session info
                    timestamp_text = f"Session: {self.session_id} | Time: {datetime.now().strftime('%H:%M:%S')}"
                    cv2.putText(frame_to_save, timestamp_text, (10, 30), 
                               cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
                    
                    # Add phase indicator (CALIBRATION or ANALYSIS)
                    phase_text = "CALIBRATION" if not self.calibrated else "ANALYSIS"
                    phase_color = (0, 165, 255) if not self.calibrated else (0, 255, 0)  # Orange for calibration, green for analysis
                    text_size = cv2.getTextSize(phase_text, cv2.FONT_HERSHEY_BOLD, 1.2, 3)[0]
                    text_x = frame_to_save.shape[1] - text_size[0] - 20  # Right side
                    text_y = 40
                    
                    # Draw background rectangle for better readability
                    cv2.rectangle(frame_to_save, 
                                (text_x - 10, text_y - text_size[1] - 10),
                                (text_x + text_size[0] + 10, text_y + 10),
                                (0, 0, 0), -1)
                    
                    # Draw phase text
                    cv2.putText(frame_to_save, phase_text, (text_x, text_y), 
                               cv2.FONT_HERSHEY_BOLD, 1.2, phase_color, 3)
                    
                    # Write frame to video
                    self.video_writer.write(frame_to_save)
                
                # Store current frame thread-safely
                with current_frame_lock:
                    current_frame = frame
                
                # Log every 30 frames
                if frame_count % 30 == 0:
                    print(f"📹 Captured {frame_count} frames" + (" (Recording)" if self.recording else ""))
            
            # Clean up
            if self.video_writer:
                self.video_writer.release()
                print(f"💾 Video saved: {self.video_filename}")
            
            if self.cap:
                self.cap.release()
            print(f"🎬 Camera stopped for session {self.session_id} ({frame_count} total frames)")
        
        
        self.camera_running = True
        self.camera_thread = threading.Thread(target=capture_frames, daemon=True)
        self.camera_thread.start()
    
    def stop_camera_capture(self):
        """Stop camera capture thread"""
        self.camera_running = False
        self.recording = False
        if self.camera_thread:
            self.camera_thread.join(timeout=2)
        if self.video_writer:
            self.video_writer.release()
            self.video_writer = None
        if self.cap:
            self.cap.release()
    
    def start_recording(self):
        """Start video recording with landmarks"""
        if self.recording:
            return  # Already recording
        
        # Create recordings directory
        recordings_dir = Path(__file__).parent.parent / 'recordings'
        recordings_dir.mkdir(exist_ok=True)
        
        # Generate filename
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        self.video_filename = recordings_dir / f"session_{self.session_id}_{timestamp}.mp4"
        
        # Get frame dimensions from camera
        if self.cap:
            frame_width = int(self.cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            frame_height = int(self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            fps = int(self.cap.get(cv2.CAP_PROP_FPS)) or 30
            
            # Create VideoWriter
            fourcc = cv2.VideoWriter_fourcc(*'mp4v')
            self.video_writer = cv2.VideoWriter(
                str(self.video_filename),
                fourcc,
                fps,
                (frame_width, frame_height)
            )
            
            if self.video_writer.isOpened():
                self.recording = True
                print(f"🎥 Started recording: {self.video_filename}")
                return True
            else:
                print(f"❌ Failed to start recording")
                return False
        return False
        
    def to_dict(self):
        return {
            'session_id': self.session_id,
            'created_at': self.created_at.isoformat(),
            'baseline': self.baseline,
            'calibrated': self.calibrated,
            'metrics': self.metrics,
            'tells': self.tells,
            'frame_count': self.frame_count
        }

# Routes
@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.now().isoformat()
    })

@app.route('/api/upload_video', methods=['POST'])
def upload_video():
    """Upload video from frontend and save to recordings folder"""
    try:
        if 'video' not in request.files:
            return jsonify({'status': 'error', 'message': 'No video file provided'}), 400
        
        video_file = request.files['video']
        session_id = request.form.get('session_id', 'unknown')
        
        # Generate secure filename
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = secure_filename(f"session_{session_id}_{timestamp}.webm")
        
        # Create recordings directory
        recordings_dir = Path(__file__).parent.parent / 'recordings'
        recordings_dir.mkdir(exist_ok=True)
        
        # Save video file
        save_path = recordings_dir / filename
        video_file.save(str(save_path))
        
        print(f"🎥 [UPLOAD] Video saved: {save_path} ({save_path.stat().st_size} bytes)")
        
        return jsonify({
            'status': 'success',
            'video_file': filename,
            'size': save_path.stat().st_size
        }), 200
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500

@app.route('/recordings/<path:filename>', methods=['GET'])
def serve_recording(filename):
    """Serve recorded video files with proper headers for video streaming"""
    try:
        recordings_dir = Path(__file__).parent.parent / 'recordings'
        file_path = recordings_dir / filename
        
        if not file_path.exists():
            return jsonify({'status': 'error', 'message': 'Video file not found'}), 404
        
        # Get file size for Content-Length header
        file_size = file_path.stat().st_size
        
        response = send_file(
            str(file_path), 
            mimetype='video/webm',
            as_attachment=False,
            conditional=True  # Enable conditional requests (Range support)
        )
        
        # Add CORS headers
        response.headers['Access-Control-Allow-Origin'] = '*'
        response.headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS'
        response.headers['Access-Control-Allow-Headers'] = 'Range'
        response.headers['Accept-Ranges'] = 'bytes'
        response.headers['Content-Length'] = str(file_size)
        
        return response
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/api/session/start', methods=['POST'])
def start_session():
    """Start a new detection session"""
    try:
        session_id = str(uuid.uuid4())[:8]
        session = DetectionSession(session_id)
        sessions[session_id] = session
        
        print(f"🎬 Started new session: {session_id}")
        
        return jsonify({
            'status': 'success',
            'session_id': session_id,
            'message': 'Session started'
        }), 200
    except Exception as e:
        print(f"Error starting session: {e}")
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 400

@app.route('/api/session/<session_id>/end', methods=['POST'])
def end_session(session_id):
    """End a detection session and save to file with video"""
    try:
        if session_id in sessions:
            session = sessions[session_id]
            
            if session.camera_running:
                session.stop_camera_capture()
            
            # Get session data from request if provided
            request_data = request.get_json() if request.is_json else {}
            
            # Prioritize video_file from frontend (uploaded video) over server-side recording
            video_filename = request_data.get('video_file')
            if not video_filename and session.video_filename:
                video_filename = str(session.video_filename.name)
            
            print(f"📹 Video file for session {session_id}: {video_filename}")
            
            # Create session review data - USE session.tells directly (not from request)
            session_data = {
                'session_id': session_id,
                'session_name': request_data.get('session_name', f'Session_{datetime.now().strftime("%Y%m%d_%H%M%S")}'),
                'start_time': session.created_at.timestamp(),
                'end_time': datetime.now().timestamp(),
                'calibration_end_time': datetime.now().timestamp(),
                'baseline': session.baseline if session.baseline else {},
                'tells': session.tells,  # Use session.tells directly - contains ALL tells collected during session
                'metrics': session.metrics if session.metrics else {},
                'frame_count': session.frame_count,
                'fps': 30,
                'events': [
                    {
                        'timestamp': tell.get('timestamp', 0),
                        'tell_type': tell.get('type', 'detection'),
                        'tell_text': tell.get('message', ''),
                        'stress_level': 2 if tell.get('type') in ['lips', 'blink', 'bpm'] else 1,
                        'confidence': 0.8
                    } for tell in session.tells
                ] if session.tells else [],
                'video_file': video_filename
            }
            
            print(f"📊 Session tells count: {len(session.tells)}")
            
            # Generate AI analysis
            print(f"🤖 Generating AI analysis for session {session_id}...")
            ai_analysis = analyze_session_with_ai(session_data)
            session_data['ai_analysis'] = ai_analysis
            
            # Save to sessions directory
            sessions_dir = Path(__file__).parent.parent / 'sessions'
            sessions_dir.mkdir(exist_ok=True)
            
            session_filename = f"session_{datetime.now().strftime('%Y%m%d_%H%M%S')}_review.json"
            session_filepath = sessions_dir / session_filename
            
            with open(session_filepath, 'w') as f:
                json.dump(session_data, f, indent=2)
            
            print(f"📝 Session {session_id} saved to {session_filepath}")
            if video_filename:
                print(f"🎥 Video recording saved: {video_filename}")
            
            # Clean up session
            del sessions[session_id]
            print(f"🏁 Ended session: {session_id}")
            
            return jsonify({
                'status': 'success',
                'message': 'Session ended and saved',
                'session_file': str(session_filename),
                'video_file': video_filename,
                'ai_analysis': session_data.get('ai_analysis', {})
            }), 200
        else:
            return jsonify({
                'status': 'error',
                'message': 'Session not found'
            }), 404
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 400

@app.route('/api/session/<session_id>/baseline', methods=['GET'])
def get_baseline(session_id):
    """Get baseline for a session"""
    try:
        if session_id not in sessions:
            return jsonify({
                'status': 'error',
                'message': 'Session not found'
            }), 404
        
        session = sessions[session_id]
        baseline = dd.baseline.copy()
        
        return jsonify({
            'status': 'success',
            'baseline': baseline,
            'calibrated': baseline.get('calibrated', False)
        }), 200
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 400

@app.route('/api/session/<session_id>/calibrate', methods=['POST'])
def calibrate_session(session_id):
    """Mark session as calibrated and start camera with recording"""
    try:
        if session_id not in sessions:
            return jsonify({
                'status': 'error',
                'message': 'Session not found'
            }), 404
        
        session = sessions[session_id]
        session.calibrated = True
        
        # Start camera capture with recording when analysis begins
        session.start_camera_capture()
        
        # Start recording after camera initializes
        import time
        time.sleep(0.5)
        if session.cap and session.cap.isOpened():
            session.start_recording()
            print(f"🎥 Recording started for analysis phase")
        
        print(f"✅ Session {session_id} marked as calibrated, camera and recording started")
        
        return jsonify({
            'status': 'success',
            'message': 'Calibration complete and recording started',
            'baseline': dd.baseline
        }), 200
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 400

@app.route('/api/session/<session_id>/metrics', methods=['GET'])
def get_metrics(session_id):
    """Get current metrics for a session"""
    try:
        if session_id not in sessions:
            return jsonify({
                'status': 'error',
                'message': 'Session not found'
            }), 404
        
        session = sessions[session_id]
        
        # Get current metrics from deception_detection
        metrics = {
            'bpm': dd.avg_bpms[-1] if dd.avg_bpms and dd.avg_bpms[-1] > 0 else 0,
            'emotion_data': get_emotion_data(),
            'dominant_emotion': dd.mood,
            'emotion_confidence': 0.65,
            'gesture_score': 85,
            'tells': session.tells,
            'stress_level': calculate_stress_level(dd.tells)
        }
        
        return jsonify({
            'status': 'success',
            'metrics': metrics
        }), 200
    except Exception as e:
        print(f"Error getting metrics: {e}")
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 400

@app.route('/api/session/<session_id>/data', methods=['GET'])
def get_session_data(session_id):
    """Get all data for a session"""
    try:
        if session_id not in sessions:
            return jsonify({
                'status': 'error',
                'message': 'Session not found'
            }), 404
        
        session = sessions[session_id]
        return jsonify({
            'status': 'success',
            'session': session.to_dict()
        }), 200
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 400

@app.route('/api/sessions/active', methods=['GET'])
def list_sessions():
    """List all active sessions"""
    try:
        session_list = [session.to_dict() for session in sessions.values()]
        return jsonify({
            'status': 'success',
            'sessions': session_list,
            'count': len(session_list)
        }), 200
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 400

@app.route('/api/camera/start', methods=['POST'])
def start_camera():
    """Start camera for a session"""
    try:
        data = request.json
        session_id = data.get('session_id')
        
        if session_id not in sessions:
            return jsonify({
                'status': 'error',
                'message': 'Session not found'
            }), 404
        
        session = sessions[session_id]
        
        if not session.camera_running:
            session.camera_running = True
            # Start camera thread
            camera_thread = threading.Thread(
                target=run_camera_thread,
                args=(session_id,),
                daemon=True
            )
            camera_thread.start()
            session.camera_thread = camera_thread
            
            print(f"📷 Camera started for session {session_id}")
        
        return jsonify({
            'status': 'success',
            'message': 'Camera started'
        }), 200
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 400

@app.route('/api/camera/stop', methods=['POST'])
def stop_camera():
    """Stop camera for a session"""
    try:
        data = request.json
        session_id = data.get('session_id')
        
        if session_id not in sessions:
            return jsonify({
                'status': 'error',
                'message': 'Session not found'
            }), 404
        
        session = sessions[session_id]
        session.camera_running = False
        
        print(f"📷 Camera stopped for session {session_id}")
        
        return jsonify({
            'status': 'success',
            'message': 'Camera stopped'
        }), 200
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 400

# WebSocket events
@socketio.on('connect')
def handle_connect():
    """Handle WebSocket connection"""
    print(f"Client connected: {request.sid}")
    emit('response', {'data': 'Connected to server'})

@socketio.on('disconnect')
def handle_disconnect():
    """Handle WebSocket disconnection"""
    print(f"Client disconnected: {request.sid}")

@socketio.on('join_session')
def handle_join_session(data):
    """Join a session room"""
    session_id = data.get('session_id')
    join_room(session_id)
    emit('response', {'data': f'Joined session {session_id}'})

@socketio.on('leave_session')
def handle_leave_session(data):
    """Leave a session room"""
    session_id = data.get('session_id')
    leave_room(session_id)
    emit('response', {'data': f'Left session {session_id}'})

@socketio.on('frontend_tell')
def handle_frontend_tell(data):
    """Receive tells detected from frontend"""
    session_id = data.get('session_id')
    tell_type = data.get('type')
    message = data.get('message')
    timestamp = data.get('timestamp', time.time())
    
    if not session_id or session_id not in sessions:
        print(f"⚠️  Invalid session_id for frontend tell: {session_id}")
        return
    
    session = sessions[session_id]
    
    # Save EVERY tell occurrence - no duplicate filtering
    session.tells.append({
        'type': tell_type,
        'message': message,
        'timestamp': timestamp,
        'source': 'frontend'
    })
    print(f"📱 Frontend tell received: {tell_type} - {message} (Total: {len(session.tells)})")

# Helper functions
def get_emotion_data():
    """Get current emotion data from detector"""
    try:
        # Simulate emotion data for now
        return {
            'angry': 5,
            'disgust': 2,
            'fear': 10,
            'happy': 8,
            'sad': 5,
            'surprise': 3,
            'neutral': 67
        }
    except:
        return {}

def analyze_session_with_ai(session_data):
    """Analyze session using Gemini AI and provide recommendations"""
    if not GEMINI_AVAILABLE:
        return {
            'summary': 'AI analysis not available',
            'recommendation': 'Manual review required',
            'suspicion_level': 'UNKNOWN',
            'reasoning': 'Gemini API not configured'
        }
    
    try:
        # Prepare session context for AI
        tells_summary = []
        for tell in session_data.get('tells', []):
            tells_summary.append(f"- {tell.get('type', 'unknown')}: {tell.get('message', 'N/A')}")
        
        tells_text = "\n".join(tells_summary) if tells_summary else "No deception indicators detected"
        
        duration_seconds = session_data.get('end_time', 0) - session_data.get('start_time', 0)
        duration_mins = int(duration_seconds // 60)
        duration_secs = int(duration_seconds % 60)
        
        metrics = session_data.get('metrics', {})
        
        # Create detailed prompt for Gemini
        prompt = f"""Bạn là chuyên gia phân tích hành vi và tâm lý trong thẩm vấn. Hãy phân tích phiên phỏng vấn sau:

**THÔNG TIN PHIÊN:**
- Tên phiên: {session_data.get('session_name', 'Unknown')}
- Thời lượng: {duration_mins} phút {duration_secs} giây
- Tổng số tells (dấu hiệu lừa dối): {len(session_data.get('tells', []))}

**CÁC DẤU HIỆU PHÁT HIỆN:**
{tells_text}

**CHỈ SỐ SINH LÝ:**
- Nhịp tim trung bình: {metrics.get('bpm', 'N/A')} BPM
- Cảm xúc phát hiện: {metrics.get('emotion', 'N/A')}
- Mức độ stress: {metrics.get('stress_level', 'N/A')}
- Điểm cử chỉ: {metrics.get('gesture_score', 'N/A')}

YÊU CẦU PHÂN TÍCH:
1. **TÓM TẮT**: Tóm tắt ngắn gọn phiên phỏng vấn (2-3 câu)
2. **MỨC ĐỘ KHẢ NGHI**: Đánh giá LOW/MEDIUM/HIGH với giải thích chi tiết
3. **KHUYẾN NGHỊ**: Có nên tiếp tục thẩm vấn không? Tại sao?
4. **LÝ DO CỤ THỂ**: Phân tích từng dấu hiệu và ý nghĩa của chúng
5. **GỢI Ý HÀNH ĐỘNG**: Nếu tiếp tục, nên tập trung vào điểm nào?

Trả lời bằng JSON format:
{{
  "summary": "Tóm tắt ngắn gọn",
  "suspicion_level": "LOW/MEDIUM/HIGH",
  "suspicion_score": 0-100,
  "recommendation": "Có nên tiếp tục thẩm vấn",
  "reasoning": "Giải thích chi tiết tại sao",
  "key_indicators": ["Dấu hiệu quan trọng 1", "Dấu hiệu 2"],
  "suggested_questions": ["Câu hỏi nên hỏi thêm 1", "Câu hỏi 2"]
}}
"""
        
        # Call Gemini API
        model = genai.GenerativeModel('gemini-2.5-flash')
        response = model.generate_content(prompt)
        
        # Parse JSON response
        response_text = response.text.strip()
        print(f"Gemini raw response: {response_text[:200]}...")
        
        # Remove markdown code blocks if present
        if response_text.startswith('```json'):
            response_text = response_text[7:]
        if response_text.startswith('```'):
            response_text = response_text[3:]
        if response_text.endswith('```'):
            response_text = response_text[:-3]
        response_text = response_text.strip()
        
        # Try to parse JSON
        try:
            analysis = json.loads(response_text)
            print(f"AI Analysis completed: {analysis.get('suspicion_level', 'UNKNOWN')}")
            return analysis
        except json.JSONDecodeError as json_err:
            print(f" Failed to parse Gemini response as JSON: {json_err}")
            print(f"   Response text: {response_text[:500]}")
            # Return structured error
            return {
                'summary': 'AI response was not in valid JSON format',
                'recommendation': 'Manual review required',
                'suspicion_level': 'UNKNOWN',
                'reasoning': f'Gemini returned non-JSON response. First 200 chars: {response_text[:200]}',
                'error': str(json_err),
                'raw_response': response_text[:1000]  # Include part of raw response for debugging
            }
        
    except Exception as e:
        print(f"❌ Error in AI analysis: {e}")
        import traceback
        traceback.print_exc()
        return {
            'summary': 'AI analysis encountered an error',
            'recommendation': 'Manual review recommended',
            'suspicion_level': 'UNKNOWN',
            'reasoning': f'Error: {str(e)}',
            'error': str(e)
        }

def calculate_stress_level(tells):
    """Calculate stress level based on tells"""
    if not tells:
        return "LOW STRESS"
    
    tell_count = len(tells)
    
    # Check for HIGH STRESS and trigger alert
    if tell_count >= 4:
        stress = "HIGH STRESS - ALERT"
        # Emit alert to frontend
        try:
            socketio.emit('high_stress_alert', {
                'message': 'HIGH STRESS DETECTED',
                'confidence': 0.8,
                'indicators': list(tells.keys()),
                'tell_count': tell_count
            }, broadcast=True)
        except Exception as e:
            print(f"Error emitting alert: {e}")
        return stress
    elif tell_count >= 2:
        return "MEDIUM STRESS"
    else:
        return "LOW STRESS"

def run_camera_thread(session_id):
    """Run camera capture in separate thread"""
    try:
        session = sessions.get(session_id)
        if not session:
            return
        
        mp_face_mesh = mp.solutions.face_mesh
        mp_hands = mp.solutions.hands
        cap = cv2.VideoCapture(0)
        
        if not cap.isOpened():
            cap = cv2.VideoCapture(0)
        
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
        cap.set(cv2.CAP_PROP_FPS, 30)
        
        with mp_face_mesh.FaceMesh() as face_mesh, mp_hands.Hands() as hands:
            while session.camera_running:
                success, frame = cap.read()
                if not success:
                    continue
                
                frame = cv2.flip(frame, 1)
                face_landmarks, hands_landmarks = dd.find_face_and_hands(
                    frame, face_mesh, hands
                )
                
                if face_landmarks:
                    session.frame_count += 1
                    
                    # Draw landmarks on frame for visualization
                    dd.draw_on_frame(frame, face_landmarks, hands_landmarks)
                    
                    # Process frame through detection pipeline
                    tells = dd.process_frame(
                        frame, face_landmarks, hands_landmarks, 
                        dd.baseline['calibrated'], 30
                    )
                    
                    # Save ALL tells to session (count every occurrence, including duplicates)
                    if dd.baseline['calibrated']:
                        for tell_type, tell_data in tells.items():
                            # Skip BPM display tell (avg_bpms is just for display)
                            if tell_type == 'avg_bpms':
                                continue
                            
                            # Save EVERY tell occurrence - no duplicate filtering
                            session.tells.append({
                                'type': tell_type,
                                'message': tell_data.get('text', ''),
                                'timestamp': time.time(),
                                'source': 'backend'
                            })
                            print(f"🚨 Tell detected: {tell_type} - {tell_data.get('text', '')} (Total: {len(session.tells)})")
                    
                    # Store current frame for streaming
                    with current_frame_lock:
                        current_frame = frame.copy()
                    
                    socketio.emit('metrics_update', {
                        'bpm': dd.avg_bpms[-1] if dd.avg_bpms else 0,
                        'tells': list(tells.keys()),
                        'frame_count': session.frame_count
                    }, room=session_id)
        
        cap.release()
    except Exception as e:
        print(f"Error in camera thread: {e}")
    finally:
        session.camera_running = False

# Error handlers
@app.errorhandler(404)
def not_found(error):
    return jsonify({
        'status': 'error',
        'message': 'Endpoint not found'
    }), 404

@app.route('/api/session/<session_id>/camera/frame', methods=['GET'])
def get_camera_frame(session_id):
    """Get current camera frame as base64 for a session"""
    global current_frame, current_frame_lock
    
    try:
        if session_id not in sessions:
            return jsonify({
                'status': 'error',
                'message': 'Session not found'
            }), 404
        
        session = sessions[session_id]
        
        # Start camera if not running
        if not session.camera_running and session.calibrated:
            session.start_camera_capture()
        
        # Get current frame from global variable (with retry for first frame)
        frame_to_send = None
        retry_count = 0
        max_retries = 3
        
        while frame_to_send is None and retry_count < max_retries:
            with current_frame_lock:
                if current_frame is not None:
                    frame_to_send = current_frame.copy()
            
            if frame_to_send is None:
                retry_count += 1
                if retry_count < max_retries:
                    import time
                    time.sleep(0.05)  # Wait 50ms before retry
        
        if frame_to_send is None:
            # Return placeholder if no frame yet
            import base64
            import numpy as np
            placeholder = np.zeros((720, 1280, 3), dtype=np.uint8)
            cv2.putText(placeholder, 'Waiting for camera frame...', (350, 360), 
                       cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 255), 2)
            cv2.putText(placeholder, f'Running frames: {session.frame_count}', (400, 420),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 200, 200), 1)
            _, buffer = cv2.imencode('.jpg', placeholder)
            frame_base64 = base64.b64encode(buffer).decode('utf-8')
        else:
            # Encode actual frame
            import base64
            _, buffer = cv2.imencode('.jpg', frame_to_send)
            frame_base64 = base64.b64encode(buffer).decode('utf-8')
        
        return jsonify({
            'status': 'success',
            'frame': frame_base64,
            'frame_count': session.frame_count,
            'camera_active': session.camera_running
        }), 200
    except Exception as e:
        print(f"Error in get_camera_frame: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 400

def internal_error(error):
    return jsonify({
        'status': 'error',
        'message': 'Internal server error'
    }), 500

@app.route('/api/sessions', methods=['GET'])
def get_sessions():
    """Get list of all review sessions"""
    try:
        sessions_dir = Path(__file__).parent.parent / 'sessions'
        sessions_dir.mkdir(exist_ok=True)
        
        session_files = list(sessions_dir.glob('*_review.json'))
        sessions_list = []
        
        for session_file in sorted(session_files, reverse=True):
            try:
                with open(session_file, 'r') as f:
                    session_data = json.load(f)
                    sessions_list.append(session_data)
            except Exception as e:
                print(f"Error loading session {session_file}: {e}")
                continue
        
        return jsonify({
            'status': 'success',
            'sessions': sessions_list,
            'count': len(sessions_list)
        }), 200
    except Exception as e:
        print(f"Error fetching sessions: {e}")
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500

@app.route('/api/video/<path:video_path>', methods=['GET'])
def serve_video(video_path):
    """Serve video files with range request support for streaming"""
    try:
        from urllib.parse import unquote
        import os
        from flask import Response, stream_with_context
        
        # Decode the path
        video_path = unquote(video_path)
        
        # Security check - ensure path is within recordings directory
        recordings_dir = Path(__file__).parent.parent / 'recordings'
        recordings_dir.mkdir(exist_ok=True)
        
        # If path is absolute, use it directly, otherwise construct from recordings dir
        if os.path.isabs(video_path):
            video_file = Path(video_path)
        else:
            video_file = recordings_dir / video_path
        
        # Check if file exists
        if not video_file.exists():
            return jsonify({
                'status': 'error',
                'message': f'Video file not found: {video_file}'
            }), 404
        
        # Get file size
        file_size = os.path.getsize(video_file)
        
        # Check for range header (for video seeking)
        range_header = request.headers.get('Range', None)
        
        if range_header:
            # Parse range header
            byte_start, byte_end = 0, file_size - 1
            match = re.search(r'bytes=(\d+)-(\d*)', range_header)
            if match:
                byte_start = int(match.group(1))
                if match.group(2):
                    byte_end = int(match.group(2))
            
            length = byte_end - byte_start + 1
            
            # Stream the requested range
            def generate():
                with open(video_file, 'rb') as f:
                    f.seek(byte_start)
                    remaining = length
                    while remaining > 0:
                        chunk_size = min(8192, remaining)
                        data = f.read(chunk_size)
                        if not data:
                            break
                        remaining -= len(data)
                        yield data
            
            response = Response(
                stream_with_context(generate()),
                status=206,
                mimetype='video/x-msvideo',
                direct_passthrough=True
            )
            response.headers.add('Content-Range', f'bytes {byte_start}-{byte_end}/{file_size}')
            response.headers.add('Accept-Ranges', 'bytes')
            response.headers.add('Content-Length', str(length))
            return response
        else:
            # Serve entire file
            return send_file(
                str(video_file),
                mimetype='video/x-msvideo',
                as_attachment=False,
                conditional=True
            )
    except Exception as e:
        print(f"Error serving video: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500

if __name__ == '__main__':
    print("🚀 Starting Lie Detector Backend API")
    print("📡 Server running on http://localhost:5000")
    print("🌐 CORS enabled for frontend communication")
    
    # Run with socketio
    socketio.run(
        app,
        host='0.0.0.0',
        port=5000,
        debug=False,
        use_reloader=False
    )