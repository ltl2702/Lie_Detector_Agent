"""
Web-based Lie Detector Application
Flask server with video streaming and real-time analysis
"""

from flask import Flask, render_template, Response, jsonify
from flask_socketio import SocketIO, emit
import cv2
import numpy as np
import mediapipe as mp
import numpy as np
import time
import json
from datetime import datetime
import threading
import deception_detection as dd
import alert_system as alerts
from memory_system import memory_system

app = Flask(__name__)
app.config['SECRET_KEY'] = 'lie_detector_secret_2025'
socketio = SocketIO(app, cors_allowed_origins="*")

# Initialize alert manager
alert_manager = alerts.AlertManager()

# Global variables
camera = None
camera_active = False
calibrated = False
session_start_time = None
calibration_start_time = None
CALIBRATION_TIME = 60

class VideoCamera:
    def __init__(self):
        self.cap = cv2.VideoCapture(0, cv2.CAP_DSHOW)
        if not self.cap.isOpened():
            self.cap = cv2.VideoCapture(0)
        
        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
        self.cap.set(cv2.CAP_PROP_FPS, 30)
        self.fps = self.cap.get(cv2.CAP_PROP_FPS) or 30
        
        self.mp_face_mesh = mp.solutions.face_mesh
        self.mp_hands = mp.solutions.hands
        self.mp_drawing = mp.solutions.drawing_utils
        
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
        
    def __del__(self):
        if self.cap:
            self.cap.release()
        if hasattr(self, 'face_mesh'):
            self.face_mesh.close()
        if hasattr(self, 'hands'):
            self.hands.close()
    
    def get_frame(self):
        success, image = self.cap.read()
        if not success:
            return None
        
        image = cv2.flip(image, 1)
        
        try:
            # Process frame for deception detection
            face_landmarks, hands_landmarks = dd.find_face_and_hands(
                image, self.face_mesh, self.hands
            )
            current_tells = dd.process_frame(
                image, face_landmarks, hands_landmarks, calibrated, self.fps
            )
        except ValueError as e:
            # Handle MediaPipe timestamp mismatch error
            if "timestamp mismatch" in str(e) or "CalculatorGraph" in str(e):
                # Skip this frame and return previous tells or empty
                print(f"⚠️ MediaPipe error (skipping frame): {str(e)[:50]}...")
                current_tells = {'avg_bpms': 0}
                face_landmarks = None
                hands_landmarks = None
            else:
                raise
        except Exception as e:
            print(f"⚠️ Frame processing error: {e}")
            return None
        
        # Draw landmarks on frame
        if face_landmarks or hands_landmarks:
            dd.draw_on_frame(image, face_landmarks, hands_landmarks)
        
        # Add overlay information
        self._add_overlay(image, current_tells)
        
        # Encode frame to JPEG
        ret, jpeg = cv2.imencode('.jpg', image)
        return jpeg.tobytes(), current_tells
    
    def _add_overlay(self, image, current_tells):
        """Add text overlay to video frame"""
        h, w = image.shape[:2]
        
        # Add calibration/interrogation status
        if not calibrated:
            cv2.putText(image, "CALIBRATION MODE", 
                       (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 
                       0.7, (0, 255, 255), 2)
        else:
            cv2.putText(image, "INTERROGATION MODE", 
                       (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 
                       0.7, (0, 255, 0), 2)
            
            # Draw detection indicators
            y_pos = 60
            for tell, value in current_tells.items():
                if tell != 'avg_bpms':
                    cv2.putText(image, f"{tell}: {value:.2f}", 
                               (10, y_pos), cv2.FONT_HERSHEY_SIMPLEX, 
                               0.5, (0, 0, 255), 1)
                    y_pos += 25

def generate_frames():
    """Generate video frames for streaming with overlays"""
    global camera, calibrated
    frame_count = 0
    calibration_start_time = time.time()
    
    while camera_active:
        if camera is None:
            break
        
        try:
            result = camera.get_frame()
            if result is None:
                break
                
            frame, current_tells = result
            
            # Decode frame for overlay
            frame_array = cv2.imdecode(np.frombuffer(frame, np.uint8), cv2.IMREAD_COLOR)
            
            # Add overlays similar to main.py
            if not calibrated:
                # Calibration banner
                elapsed_time = time.time() - calibration_start_time
                remaining_time = max(0, CALIBRATION_TIME - elapsed_time)
                minutes = int(remaining_time // 60)
                seconds = int(remaining_time % 60)
                
                # Draw semi-transparent banner
                overlay = frame_array.copy()
                banner_height = 100
                cv2.rectangle(overlay, (0, 0), (frame_array.shape[1], banner_height), (0, 0, 0), -1)
                cv2.addWeighted(overlay, 0.7, frame_array, 0.3, 0, frame_array)
                
                # Text
                cv2.putText(frame_array, "PHASE 1: CALIBRATION", 
                           (10, 35), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 255, 255), 2)
                cv2.putText(frame_array, f"TIME: {minutes:02d}:{seconds:02d}", 
                           (frame_array.shape[1] - 200, 35), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 255, 0), 2)
                cv2.putText(frame_array, "Establishing baseline...", 
                           (10, 75), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)
            else:
                # Interrogation mode banner
                overlay = frame_array.copy()
                banner_height = 100
                cv2.rectangle(overlay, (0, 0), (frame_array.shape[1], banner_height), (0, 0, 0), -1)
                cv2.addWeighted(overlay, 0.6, frame_array, 0.4, 0, frame_array)
                
                cv2.putText(frame_array, "PHASE 2: INTERROGATION MODE - ACTIVE", 
                           (10, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)
                
                baseline_info = f"BPM: {dd.baseline.get('bpm', 0):.0f} | Blinks: {dd.baseline.get('blink_rate', 0):.0f}/min"
                cv2.putText(frame_array, baseline_info, 
                           (10, 50), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 1)
                
                cv2.putText(frame_array, f"Active Tells: {len(current_tells) - 1}", 
                           (frame_array.shape[1] - 300, 50), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 165, 255), 2)
            
            # Add detection text overlay
            y_offset = 120
            for tell, value in current_tells.items():
                if tell != 'avg_bpms' and value > 0:
                    text = f"{tell}: {value:.2f}"
                    cv2.putText(frame_array, text, (10, y_offset), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 165, 255), 1)
                    y_offset += 25
            
            # Re-encode to JPEG
            ret, jpeg = cv2.imencode('.jpg', frame_array)
            frame = jpeg.tobytes()
            
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + frame + b'\r\n')
        except Exception as e:
            print(f"⚠️ Error in generate_frames: {e}")
        
        time.sleep(0.033)  # ~30 FPS

def send_analysis_data():
    """Send real-time analysis data via WebSocket with memory & alerts"""
    global camera, calibrated
    
    while camera_active:
        if camera is None:
            break
        
        try:
            result = camera.get_frame()
            if result is None:
                break
                
            _, current_tells = result
            
            # Calculate stress level
            bpm = dd.avg_bpms[-1] if len(dd.avg_bpms) > 0 else 0
            bpm_change = 0
            if len(dd.avg_bpms) > 1 and dd.avg_bpms[-1] > 0:
                bpm_change = dd.avg_bpms[-1] - dd.avg_bpms[0]
            
            # PHASE 1 (CALIBRATION): Only collect data, no analysis
            if not calibrated:
                data = {
                    'calibrated': False,
                    'bpm': float(bpm),
                    'bpm_change': float(bpm_change),
                    'tells_count': 0,
                    'tells': {},
                    'baseline': None,
                    'emotion': dd.mood,
                    'blink_history': [],
                    'alert': None,
                    'timestamp': time.time()
                }
                socketio.emit('analysis_data', data)
                time.sleep(0.5)
                continue
            
            # PHASE 2 (INTERROGATION): Start detecting and analyzing
            alert = alert_manager.process(current_tells, stress_level=0, timestamp=time.time())
            alert_data = None
            
            if alert:
                try:
                    # Record detection in memory system
                    if memory_system and hasattr(memory_system, 'threshold_manager'):
                        memory_system.threshold_manager.record_detection(
                            indicators=alert.indicators,
                            confidence=alert.confidence,
                            timestamp=alert.timestamp
                        )
                except Exception as mem_err:
                    print(f"⚠️ Memory system error: {mem_err}")
                
                alert_data = {
                    'indicators': alert.indicators,
                    'confidence': alert.confidence,
                    'priority': alert.priority,
                    'details': alert.details
                }
            
            # Prepare data for frontend
            data = {
                'calibrated': calibrated,
                'bpm': float(bpm),
                'bpm_change': float(bpm_change),
                'tells_count': len(current_tells) - 1,  # Exclude BPM from tells
                'tells': {k: float(v) for k, v in current_tells.items() if k != 'avg_bpms'},
                'baseline': {
                    'bpm': float(dd.baseline.get('bpm', 0)),
                    'blink_rate': float(dd.baseline.get('blink_rate', 0)),
                    'gaze_stability': float(dd.baseline.get('gaze_stability', 0)),
                    'emotion': dd.baseline.get('emotion', 'neutral'),
                    'hand_face_frequency': float(dd.baseline.get('hand_face_frequency', 0))
                } if calibrated else None,
                'emotion': dd.mood,
                'blink_history': dd.blink_times[-20:] if hasattr(dd, 'blink_times') else [],
                'alert': alert_data,
                'timestamp': time.time()
            }
            
            socketio.emit('analysis_data', data)
        except Exception as e:
            print(f"⚠️ Error in send_analysis_data: {e}")
        
        time.sleep(0.5)  # Update every 500ms

@app.route('/')
def index():
    """Main page"""
    return render_template('index.html')

@app.route('/video_feed')
def video_feed():
    """Video streaming route"""
    return Response(generate_frames(),
                   mimetype='multipart/x-mixed-replace; boundary=frame')

@socketio.on('connect')
def handle_connect():
    """Handle client connection"""
    print('Client connected')
    emit('connection_response', {'status': 'connected'})

@socketio.on('disconnect')
def handle_disconnect():
    """Handle client disconnection"""
    print('Client disconnected')

@socketio.on('start_camera')
def handle_start_camera():
    """Start camera and analysis"""
    global camera, camera_active, calibrated, session_start_time, calibration_start_time
    
    if not camera_active:
        # Reset deception detection
        dd.reset_baseline()
        dd.hr_times = []
        dd.hr_values = []
        dd.avg_bpms = [0] * dd.MAX_FRAMES
        dd.mood = ''
        dd.mood_history = []
        dd.mood_frames_count = 0
        dd.calculating_mood = False
        dd.EPOCH = time.time()
        
        camera = VideoCamera()
        camera_active = True
        calibrated = False
        session_start_time = time.time()
        calibration_start_time = time.time()
        
        # Start analysis data thread
        threading.Thread(target=send_analysis_data, daemon=True).start()
        
        emit('camera_started', {'status': 'success'})
        
        # Start calibration timer
        threading.Thread(target=calibration_timer, daemon=True).start()

@socketio.on('stop_camera')
def handle_stop_camera():
    """Stop camera and analysis"""
    global camera, camera_active
    
    camera_active = False
    if camera:
        del camera
        camera = None
    
    emit('camera_stopped', {'status': 'success'})

def calibration_timer():
    """Handle automatic calibration completion with memory save"""
    global calibrated, calibration_start_time
    
    while camera_active and not calibrated:
        elapsed = time.time() - calibration_start_time
        remaining = max(0, CALIBRATION_TIME - elapsed)
        progress = min(100, (elapsed / CALIBRATION_TIME) * 100)
        
        # Send calibration progress to all clients
        socketio.emit('calibration_progress', {
            'elapsed': elapsed,
            'remaining': remaining,
            'progress': progress
        })
        
        print(f"📊 Calibration progress: {progress:.1f}% ({int(elapsed)}s/{CALIBRATION_TIME}s)")
        
        # Check if calibration time is up
        if remaining <= 0:
            if dd.calculate_baseline():
                calibrated = True
                
                # Save session to memory system (with error handling)
                try:
                    if memory_system and hasattr(memory_system, 'save_session'):
                        memory_system.save_session({
                            'baseline_metrics': dd.baseline,
                            'detection_events': [],
                            'adaptive_thresholds': memory_system.threshold_manager.current_thresholds if hasattr(memory_system, 'threshold_manager') else {}
                        })
                except Exception as save_err:
                    print(f"⚠️ Memory save error: {save_err}")
                
                baseline_data = {
                    'bpm': float(dd.baseline.get('bpm', 0)),
                    'blink_rate': float(dd.baseline.get('blink_rate', 0)),
                    'gaze_stability': float(dd.baseline.get('gaze_stability', 0)),
                    'emotion': dd.baseline.get('emotion', 'neutral'),
                    'hand_face_frequency': float(dd.baseline.get('hand_face_frequency', 0))
                }
                
                socketio.emit('calibration_complete', {'baseline': baseline_data})
                print("✅ Calibration complete! Baseline established.")
                break
            else:
                # Reset calibration if failed
                calibration_start_time = time.time()
                print("⚠️ Calibration failed, restarting...")
        
        time.sleep(0.5)  # Send progress every 500ms instead of 1s for smoother updates

if __name__ == '__main__':
    socketio.run(app, debug=True, host='0.0.0.0', port=5000)
