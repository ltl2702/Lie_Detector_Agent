"""
Flask API Backend for Lie Detector Web Interface
Connects React frontend with Python deception detection engine
"""

from flask import Flask, jsonify, request, send_file
from flask_cors import CORS
from flask_socketio import SocketIO, emit, join_room, leave_room
import sys
import os
import threading
import uuid
import json
import re
from datetime import datetime
from pathlib import Path

# Add src directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

import cv2
import mediapipe as mp
import deception_detection as dd
import memory_system as ms

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
        
        # Initialize MediaPipe for landmarks
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
            
            # Store video filename before stopping camera
            video_filename = str(session.video_filename.name) if session.video_filename else None
            
            if session.camera_running:
                session.stop_camera_capture()
            
            # Get session data from request if provided
            request_data = request.get_json() if request.is_json else {}
            
            # Create session review data
            session_data = {
                'session_id': session_id,
                'session_name': request_data.get('session_name', f'Session_{datetime.now().strftime("%Y%m%d_%H%M%S")}'),
                'start_time': session.created_at.timestamp(),
                'end_time': datetime.now().timestamp(),
                'calibration_end_time': datetime.now().timestamp(),
                'baseline': request_data.get('baseline', session.baseline) if session.baseline else {},
                'tells': request_data.get('tells', session.tells),
                'metrics': request_data.get('metrics', session.metrics),
                'frame_count': session.frame_count,
                'fps': 30,
                'events': [
                    {
                        'timestamp': tell.get('timestamp', 0),
                        'type': tell.get('type', 'detection'),
                        'message': tell.get('message', '')
                    } for tell in session.tells
                ] if session.tells else [],
                'video_file': video_filename
            }
            
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
                'video_file': video_filename
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
        
        # Start camera capture
        session.start_camera_capture()
        
        # Start recording when calibration begins
        import time
        time.sleep(0.5)  # Wait for camera to initialize
        if session.cap and session.cap.isOpened():
            session.start_recording()
        
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
