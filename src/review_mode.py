"""
Review Mode - Phase 4
Timeline playback with synchronized tells, key moment markers, and statistical summary
"""

import json
import os
import time
import cv2
import numpy as np
from datetime import datetime, timedelta
from collections import defaultdict, Counter
from dataclasses import dataclass, field, asdict
from typing import List, Dict, Any, Optional


@dataclass
class TellEvent:
    """Single tell/indicator event with timestamp"""
    timestamp: float  # seconds from session start
    frame_number: int
    tell_type: str  # 'bpm_change', 'hand', 'blinking', etc.
    tell_text: str
    stress_level: int  # 1-3
    confidence: float = 0.0
    
    def to_dict(self):
        return asdict(self)


@dataclass
class KeyMoment:
    """Significant moment in the interrogation"""
    timestamp: float
    frame_number: int
    reason: str  # 'high_stress', 'alert_cluster', 'manual', etc.
    tells: List[str]
    confidence: float
    notes: str = ""
    
    def to_dict(self):
        return asdict(self)


@dataclass
class SessionStats:
    """Statistical summary of interrogation session"""
    duration: float  # seconds
    total_frames: int
    calibration_duration: float
    
    # Tell statistics
    total_tells: int
    tells_by_type: Dict[str, int]
    tells_per_minute: float
    
    # Stress analysis
    stress_distribution: Dict[str, float]  # LOW/MEDIUM/HIGH percentages
    avg_stress_level: float
    max_stress_timestamp: float
    
    # BPM analysis
    baseline_bpm: float
    avg_bpm: float
    max_bpm: float
    min_bpm: float
    bpm_variance: float
    
    # Alert analysis
    total_alerts: int
    high_confidence_alerts: int
    avg_alert_confidence: float
    
    # Key moments
    key_moments_count: int
    
    def to_dict(self):
        return asdict(self)


class ReviewSession:
    """Track and analyze interrogation session for review"""
    
    def __init__(self, session_name: str = None):
        self.session_name = session_name or f"session_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        self.start_time = time.time()
        self.calibration_end_time = None
        
        # Timeline data
        self.events: List[TellEvent] = []
        self.key_moments: List[KeyMoment] = []
        self.frame_count = 0
        
        # Real-time tracking
        self.stress_levels: List[int] = []
        self.bpm_values: List[float] = []
        self.timestamps: List[float] = []
        self.baseline_bpm: float = 0.0
        
        # Metadata
        self.video_file = None
        self.fps = 30.0
        
    def set_calibration_complete(self, baseline_bpm: float = 0.0):
        """Mark when calibration phase ended"""
        self.calibration_end_time = time.time()
        self.baseline_bpm = baseline_bpm
        
    def add_event(self, tells: Dict[str, Dict], stress_level: int, 
                  confidence: float = 0.0, frame_number: int = None):
        """Add tells from current frame to timeline"""
        timestamp = time.time() - self.start_time
        frame = frame_number or self.frame_count
        
        for tell_type, tell_data in tells.items():
            if tell_type == 'avg_bpms':
                # Extract BPM value with improved parsing
                try:
                    bpm_text = tell_data['text']
                    if 'BPM:' in bpm_text and 'Collecting' not in bpm_text and 'Calculating' not in bpm_text:
                        # Extract number between "BPM:" and next space or "("
                        import re
                        bpm_match = re.search(r'BPM:\s*(\d+\.?\d*)', bpm_text)
                        if bpm_match:
                            bpm = float(bpm_match.group(1))
                            if 50 <= bpm <= 200:  # Valid BPM range
                                self.bpm_values.append(bpm)
                except Exception as e:
                    pass  # Skip invalid BPM values
            
            event = TellEvent(
                timestamp=timestamp,
                frame_number=frame,
                tell_type=tell_type,
                tell_text=tell_data['text'],
                stress_level=stress_level,
                confidence=confidence
            )
            self.events.append(event)
        
        self.stress_levels.append(stress_level)
        self.timestamps.append(timestamp)
        self.frame_count += 1
        
    def add_key_moment(self, tells: List[str], confidence: float, 
                       reason: str = "alert_cluster", notes: str = ""):
        """Mark a key moment for quick review"""
        timestamp = time.time() - self.start_time
        
        moment = KeyMoment(
            timestamp=timestamp,
            frame_number=self.frame_count,
            reason=reason,
            tells=tells,
            confidence=confidence,
            notes=notes
        )
        self.key_moments.append(moment)
        
    def add_manual_marker(self, notes: str):
        """Allow investigator to manually mark important moments"""
        self.add_key_moment([], 0.0, reason="manual", notes=notes)
        
    def get_statistics(self) -> SessionStats:
        """Compute comprehensive statistics"""
        duration = time.time() - self.start_time
        calib_duration = (self.calibration_end_time - self.start_time) if self.calibration_end_time else 0
        
        # Tell statistics
        tells_by_type = Counter(e.tell_type for e in self.events)
        total_tells = sum(tells_by_type.values())
        tells_per_min = (total_tells / duration * 60) if duration > 0 else 0
        
        # Stress distribution
        stress_counter = Counter(self.stress_levels)
        total_stress_frames = len(self.stress_levels) or 1
        stress_dist = {
            'LOW': stress_counter.get(1, 0) / total_stress_frames * 100,
            'MEDIUM': stress_counter.get(2, 0) / total_stress_frames * 100,
            'HIGH': stress_counter.get(3, 0) / total_stress_frames * 100
        }
        avg_stress = sum(self.stress_levels) / total_stress_frames if self.stress_levels else 0
        
        # Find max stress timestamp
        max_stress_ts = 0
        if self.stress_levels:
            max_idx = max(range(len(self.stress_levels)), key=lambda i: self.stress_levels[i])
            max_stress_ts = self.timestamps[max_idx] if max_idx < len(self.timestamps) else 0
        
        # BPM statistics  
        baseline_bpm = self.baseline_bpm  # Use stored baseline from calibration
        avg_bpm = np.mean(self.bpm_values) if self.bpm_values else 0
        max_bpm = max(self.bpm_values) if self.bpm_values else 0
        min_bpm = min(self.bpm_values) if self.bpm_values else 0
        bpm_var = np.var(self.bpm_values) if self.bpm_values else 0
        
        # Alert statistics
        high_conf_events = [e for e in self.events if e.confidence >= 0.6]
        total_alerts = len(high_conf_events)
        avg_conf = np.mean([e.confidence for e in high_conf_events]) if high_conf_events else 0
        
        return SessionStats(
            duration=duration,
            total_frames=self.frame_count,
            calibration_duration=calib_duration,
            total_tells=total_tells,
            tells_by_type=dict(tells_by_type),
            tells_per_minute=tells_per_min,
            stress_distribution=stress_dist,
            avg_stress_level=avg_stress,
            max_stress_timestamp=max_stress_ts,
            baseline_bpm=baseline_bpm,
            avg_bpm=avg_bpm,
            max_bpm=max_bpm,
            min_bpm=min_bpm,
            bpm_variance=bpm_var,
            total_alerts=total_alerts,
            high_confidence_alerts=total_alerts,
            avg_alert_confidence=avg_conf,
            key_moments_count=len(self.key_moments)
        )
    
    def save(self, sessions_dir: str = None):
        """Save session to JSON file"""
        if sessions_dir is None:
            filepath = f"{self.session_name}_review.json"
        else:
            filepath = os.path.join(sessions_dir, f"{self.session_name}_review.json")
        
        data = {
            'session_name': self.session_name,
            'start_time': self.start_time,
            'calibration_end_time': self.calibration_end_time,
            'video_file': self.video_file,
            'fps': self.fps,
            'events': [e.to_dict() for e in self.events],
            'key_moments': [m.to_dict() for m in self.key_moments],
            'statistics': self.get_statistics().to_dict()
        }
        
        with open(filepath, 'w') as f:
            json.dump(data, f, indent=2)
        
        print(f"✓ Session saved to: {filepath}")
        return filepath
    
    @classmethod
    def load(cls, filepath: str):
        """Load session from JSON file"""
        with open(filepath, 'r') as f:
            data = json.load(f)
        
        session = cls(data['session_name'])
        session.start_time = data['start_time']
        session.calibration_end_time = data.get('calibration_end_time')
        session.video_file = data.get('video_file')
        session.fps = data.get('fps', 30.0)
        
        # Restore events
        for e_dict in data.get('events', []):
            event = TellEvent(**e_dict)
            session.events.append(event)
            if event.tell_type != 'avg_bpms':
                session.stress_levels.append(event.stress_level)
                session.timestamps.append(event.timestamp)
        
        # Restore key moments
        for m_dict in data.get('key_moments', []):
            moment = KeyMoment(**m_dict)
            session.key_moments.append(moment)
        
        session.frame_count = max([e.frame_number for e in session.events]) if session.events else 0
        
        print(f"✓ Session loaded from: {filepath}")
        return session
    
    def print_summary(self):
        """Print human-readable summary to console"""
        stats = self.get_statistics()
        
        print("\n" + "="*70)
        print(f"📊 INTERROGATION SESSION SUMMARY - {self.session_name}")
        print("="*70)
        
        # Duration
        duration_str = str(timedelta(seconds=int(stats.duration)))
        calib_str = str(timedelta(seconds=int(stats.calibration_duration)))
        print(f"\n⏱️  Duration: {duration_str} (Calibration: {calib_str})")
        print(f"   Total Frames: {stats.total_frames}")
        
        # Tells
        print(f"\n📌 Tell Analysis:")
        print(f"   Total Tells: {stats.total_tells}")
        print(f"   Tells/Minute: {stats.tells_per_minute:.1f}")
        print(f"   By Type:")
        for tell_type, count in sorted(stats.tells_by_type.items(), key=lambda x: -x[1]):
            print(f"      • {tell_type}: {count}")
        
        # Stress
        print(f"\n🔥 Stress Analysis:")
        print(f"   Average Stress: {stats.avg_stress_level:.2f}")
        print(f"   Distribution:")
        for level, pct in stats.stress_distribution.items():
            bar = "█" * int(pct / 5)
            print(f"      {level:7s}: {pct:5.1f}% {bar}")
        max_stress_time = str(timedelta(seconds=int(stats.max_stress_timestamp)))
        print(f"   Peak Stress at: {max_stress_time}")
        
        # BPM
        print(f"\n💓 Heart Rate:")
        print(f"   Baseline: {stats.baseline_bpm:.1f} BPM")
        print(f"   Average:  {stats.avg_bpm:.1f} BPM")
        print(f"   Range:    {stats.min_bpm:.1f} - {stats.max_bpm:.1f} BPM")
        print(f"   Variance: {stats.bpm_variance:.1f}")
        
        # Alerts
        print(f"\n🚨 Alerts:")
        print(f"   Total Alerts: {stats.total_alerts}")
        print(f"   Avg Confidence: {stats.avg_alert_confidence:.1%}")
        
        # Key moments
        print(f"\n⭐ Key Moments: {stats.key_moments_count}")
        for i, moment in enumerate(self.key_moments[:5], 1):
            ts = str(timedelta(seconds=int(moment.timestamp)))
            print(f"   {i}. [{ts}] {moment.reason}: {', '.join(moment.tells[:3])}")
            if moment.notes:
                print(f"      Note: {moment.notes}")
        
        if len(self.key_moments) > 5:
            print(f"   ... and {len(self.key_moments) - 5} more")
        
        print("\n" + "="*70)


def play_review(video_file: str, session_file: str = None):
    """Play recorded video with synchronized tells and timeline controls"""
    
    # Load session data
    if session_file:
        session = ReviewSession.load(session_file)
    else:
        print("No session file provided - playing video only")
        session = None
    
    cap = cv2.VideoCapture(video_file)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    
    # Start from Phase 2 (after calibration) if session data available
    if session and session.calibration_end_time:
        calibration_end = session.calibration_end_time - session.start_time
        phase2_start_frame = int(calibration_end * fps)
        current_frame = min(phase2_start_frame, total_frames - 1)
        cap.set(cv2.CAP_PROP_POS_FRAMES, current_frame)
        
        # Verify the position was set correctly
        actual_frame = int(cap.get(cv2.CAP_PROP_POS_FRAMES))
        print(f"📍 Starting from Phase 2 (Interrogation)")
        print(f"   Calibration end: {calibration_end:.1f}s")
        print(f"   Target frame: {phase2_start_frame}, Actual frame: {actual_frame}")
        print(f"   FPS: {fps}")
        current_frame = actual_frame  # Use actual frame position
    else:
        current_frame = 0
    
    paused = True  # Start paused so user can see first frame
    playback_speed = 1.0
    need_frame_read = True
    
    print("\n" + "="*60)
    print("🎬 REVIEW MODE - Controls:")
    print("="*60)
    print("  SPACE    - Pause/Resume")
    print("  ←/→ A/D  - Skip backward/forward 5 seconds (auto-pause)")
    print("  ↑/↓ W/X  - Speed up/down (0.5x, 1x, 2x)")
    print("  M        - Jump to next key moment (auto-pause)")
    print("  R        - Reset to beginning")
    print("  S        - Print statistics")
    print("  ESC      - Exit")
    print("="*60 + "\n")
    print("⏸️  Starting PAUSED - Press SPACE to play\n")
    
    # Debug: Show key moment info
    if session:
        if session.calibration_end_time:
            calibration_end = session.calibration_end_time - session.start_time
            phase2_start_frame = int(calibration_end * fps)
            
            # Debug info
            print(f"🔍 Debug Info:")
            print(f"   Calibration end: {calibration_end:.1f}s")
            print(f"   Phase 2 start frame: {phase2_start_frame}")
            print(f"   FPS: {fps}")
            
            if session.key_moments:
                first_moment = min(session.key_moments, key=lambda m: m.frame_number)
                last_moment = max(session.key_moments, key=lambda m: m.frame_number)
                print(f"   Key moment frame range: {first_moment.frame_number} - {last_moment.frame_number}")
                print(f"   Key moment time range: {first_moment.timestamp:.1f}s - {last_moment.timestamp:.1f}s")
            
            # Filter by timestamp instead of frame number (more reliable)
            phase2_moments = [m for m in session.key_moments if m.timestamp >= calibration_end]
            print(f"🔍 Found {len(phase2_moments)} key moments in Phase 2 (out of {len(session.key_moments)} total)")
            if phase2_moments:
                print(f"   First moment at {str(timedelta(seconds=int(phase2_moments[0].timestamp)))} (frame {phase2_moments[0].frame_number})")
                print(f"   Last moment at {str(timedelta(seconds=int(phase2_moments[-1].timestamp)))} (frame {phase2_moments[-1].frame_number})")
        else:
            print(f"🔍 Found {len(session.key_moments)} key moments total")
        print(f"   Press 'M' to jump to key moments\n")
    
    key_moment_idx = 0
    frame = None
    
    while cap.isOpened():
        # Read frame only when needed
        if need_frame_read:
            success, frame = cap.read()
            if not success:
                print("\n🏁 End of video reached")
                break
            need_frame_read = False
        
        # Advance frame only when playing
        if not paused:
            current_frame += 1
            need_frame_read = True
        
        # Ensure current_frame stays in sync with video position
        if need_frame_read:
            actual_frame = int(cap.get(cv2.CAP_PROP_POS_FRAMES))
            if abs(actual_frame - current_frame) > 1:  # Resync if out of sync
                current_frame = actual_frame
            
            # Get tells for this frame - only from Phase 2 (after calibration)
            if session:
                timestamp = current_frame / fps
                # Only include events from Phase 2 (after calibration ended)
                calibration_end = session.calibration_end_time - session.start_time if session.calibration_end_time else 0
                frame_events = [e for e in session.events 
                               if abs(e.timestamp - timestamp) < 0.1 and e.timestamp >= calibration_end]
                
                # Draw review mode banner at top
                overlay = frame.copy()
                cv2.rectangle(overlay, (0, 0), (frame.shape[1], 60), (20, 20, 20), -1)
                cv2.addWeighted(overlay, 0.7, frame, 0.3, 0, frame)
                
                # Title and info
                cv2.putText(frame, "REVIEW MODE", (10, 25),
                           cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)
                
                # Session info
                session_info = f"Session: {session.session_name}"
                cv2.putText(frame, session_info, (10, 50),
                           cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
                
                # Tell count on right
                if frame_events:
                    tell_count = len([e for e in frame_events if e.tell_type != 'avg_bpms'])
                    if tell_count > 0:
                        cv2.putText(frame, f"Tells: {tell_count}", 
                                   (frame.shape[1] - 150, 35),
                                   cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
                
                # Draw tells overlay
                y_offset = 30
                for event in frame_events:
                    if event.tell_type != 'avg_bpms':
                        text = f"• {event.tell_text}"
                        color = get_stress_color(event.stress_level)
                        cv2.putText(frame, text, (10, y_offset),
                                   cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)
                        y_offset += 30
                
                # Check if this is a key moment
                for moment in session.key_moments:
                    if abs(moment.frame_number - current_frame) < 3:  # Increased tolerance
                        # Highlight key moment with border at top
                        cv2.rectangle(frame, (0, 0), (frame.shape[1], 80), (0, 0, 255), 5)
                        # Show key moment text ABOVE timeline (not at bottom)
                        key_text = f"KEY MOMENT: {moment.reason}"
                        cv2.putText(frame, key_text,
                                   (frame.shape[1]//2 - 200, 50),
                                   cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 255, 255), 3)
                        # Also show tells involved
                        if moment.tells:
                            tells_text = f"Tells: {', '.join(moment.tells[:3])}"
                            cv2.putText(frame, tells_text,
                                       (frame.shape[1]//2 - 200, 75),
                                       cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 0), 2)
        
        # Always draw timeline bar at bottom (even when paused) - Phase 2 only  
        if session and session.calibration_end_time:
            calibration_end = session.calibration_end_time - session.start_time
            phase2_start_frame = int(calibration_end * fps)
            draw_timeline_phase2(frame, current_frame, total_frames, session.key_moments, fps, phase2_start_frame)
            
            # Show Phase 2 time only - convert frame back to session timestamp
            video_current_time = current_frame / fps if fps > 0 else 0
            # Session timestamp = video time
            session_current_time = video_current_time
            phase2_current_time = max(0, session_current_time - calibration_end)
            
            # Calculate total phase 2 duration from session data
            video_total_time = total_frames / fps if fps > 0 else 0
            phase2_total_time = max(0, video_total_time - calibration_end)
            
            time_str = str(timedelta(seconds=int(phase2_current_time)))
            total_str = str(timedelta(seconds=int(phase2_total_time)))
            
            # Debug info 
            if current_frame % 30 == 0:  # Print every 30 frames to avoid spam
                print(f"Debug: frame={current_frame}, video_time={video_current_time:.1f}s, session_time={session_current_time:.1f}s, calib_end={calibration_end:.1f}s, phase2_time={phase2_current_time:.1f}s")
            
            info = f"Interrogation: {time_str}/{total_str} | Frame: {current_frame}/{total_frames} | Session: {str(timedelta(seconds=int(session_current_time)))} | Speed: {playback_speed}x"
        elif session:
            draw_timeline(frame, current_frame, total_frames, session.key_moments, fps)
            time_str = str(timedelta(seconds=int(current_frame / fps)))
            total_str = str(timedelta(seconds=int(total_frames / fps)))
            info = f"Frame: {current_frame}/{total_frames} | Time: {time_str}/{total_str} | Speed: {playback_speed}x"
        else:
            time_str = str(timedelta(seconds=int(current_frame / fps)))
            total_str = str(timedelta(seconds=int(total_frames / fps)))
            info = f"Frame: {current_frame}/{total_frames} | Time: {time_str}/{total_str} | Speed: {playback_speed}x"
        
        # Cover old UI elements from recorded video but preserve timeline area (bottom 40px only)  
        # Timeline is at h-33 to h-11, so cover h-80 to h-45
        cv2.rectangle(frame, (0, frame.shape[0] - 80), (frame.shape[1], frame.shape[0] - 45), 
                     (0, 0, 0), -1)
        
        # Position: bar is at h - 33, text at h - 52 (now on black background)
        cv2.putText(frame, info, (15, frame.shape[0] - 52),
                   cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
        
        if paused:
            cv2.putText(frame, " PAUSED (SPACE to play)", (frame.shape[1]//2 - 150, 50),
                       cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 255, 255), 3)
        
        cv2.imshow('Review Mode', frame)
        
        # Controls - always wait for key, adjust timing based on playback state
        if paused:
            key = cv2.waitKey(0)  # Wait indefinitely when paused (don't mask)
        else:
            wait_time = max(1, int(1000 / (fps * playback_speed)))
            key = cv2.waitKey(wait_time)
        
        # Handle different key codes
        key_char = key & 0xFF
        
        if key_char == 27:  # ESC
            print("\n👋 Exiting review mode")
            break
        elif key_char == ord(' '):  # SPACE
            paused = not paused
            print(f"{'⏸️  Paused' if paused else '▶️  Playing'} at {str(timedelta(seconds=int(current_frame / fps)))}")
        elif key == 2555904 or key == 65363 or key_char == ord('d') or key_char == ord('D'):  # Right arrow or D
            # Skip forward 5 seconds
            skip_frames = int(5 * fps)
            current_frame = min(total_frames - 1, current_frame + skip_frames)
            cap.set(cv2.CAP_PROP_POS_FRAMES, current_frame)
            need_frame_read = True
            paused = True  # Auto-pause after seeking
            print(f"⏩ Skipped forward to {str(timedelta(seconds=int(current_frame / fps)))}")
        elif key == 2424832 or key == 65361 or key_char == ord('a') or key_char == ord('A'):  # Left arrow or A
            skip_frames = int(5 * fps)
            if session and session.calibration_end_time:
                calibration_end = session.calibration_end_time - session.start_time
                phase2_start_frame = int(calibration_end * fps)
                current_frame = max(phase2_start_frame, current_frame - skip_frames)  # Don't go before Phase 2
            else:
                current_frame = max(0, current_frame - skip_frames)
            cap.set(cv2.CAP_PROP_POS_FRAMES, current_frame)
            need_frame_read = True
            paused = True  # Auto-pause after seeking
            print(f"⏪ Skipped backward to {str(timedelta(seconds=int(current_frame / fps)))}")
        elif key == 2490368 or key == 65362 or key_char == ord('w') or key_char == ord('W'):  # Up arrow or W
            playback_speed = min(2.0, playback_speed * 2)
            print(f"⚡ Speed: {playback_speed}x")
        elif key == 2621440 or key == 65364 or key_char == ord('x') or key_char == ord('X'):  # Down arrow or X
            playback_speed = max(0.25, playback_speed / 2)
            print(f"🐢 Speed: {playback_speed}x")
        elif key_char == ord('m') or key_char == ord('M'):
            # Jump to next key moment (only Phase 2 moments if applicable)
            if session:
                # Filter key moments to Phase 2 only if we have calibration data
                if session.calibration_end_time:
                    calibration_end = session.calibration_end_time - session.start_time
                    # Use timestamp filtering instead of frame number (more reliable)
                    phase2_moments = [m for m in session.key_moments if m.timestamp >= calibration_end]
                else:
                    phase2_moments = session.key_moments
                
                if key_moment_idx < len(phase2_moments):
                    moment = phase2_moments[key_moment_idx]
                    
                    # Use timestamp to calculate frame position (more reliable)
                    target_frame = int(moment.timestamp * fps)
                    target_frame = max(0, min(target_frame, total_frames - 1))
                    
                    print(f"🔍 Jumping to Key Moment #{key_moment_idx + 1}/{len(phase2_moments)}")
                    print(f"   Timestamp: {moment.timestamp:.1f}s -> Frame: {target_frame}")
                    print(f"   Original frame_number: {moment.frame_number}")
                    
                    current_frame = target_frame
                    cap.set(cv2.CAP_PROP_POS_FRAMES, current_frame)
                    need_frame_read = True
                    paused = True  # Auto-pause at key moment
                    time_str = str(timedelta(seconds=int(moment.timestamp)))
                    print(f"⭐ Key Moment: [{time_str}] {moment.reason}")
                    if moment.tells:
                        print(f"   Tells: {', '.join(moment.tells)}")
                    if moment.notes:
                        print(f"   Note: {moment.notes}")
                    key_moment_idx += 1
                else:
                    print(f"ℹ️  No more key moments (found {len(phase2_moments)} total)")
                    key_moment_idx = 0  # Reset to beginning
            else:
                print("ℹ️  No session data available")
        elif key_char == ord('s') or key_char == ord('S'):
            if session:
                session.print_summary()
        elif key_char == ord('r') or key_char == ord('R'):
            # Reset to Phase 2 beginning (not video beginning)
            if session and session.calibration_end_time:
                calibration_end = session.calibration_end_time - session.start_time
                phase2_start_frame = int(calibration_end * fps)
                current_frame = phase2_start_frame
                cap.set(cv2.CAP_PROP_POS_FRAMES, current_frame)
                print("⏮️  Reset to interrogation start")
            else:
                current_frame = 0
                cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                print("⏮️  Reset to beginning")
            need_frame_read = True
            paused = True
            key_moment_idx = 0
        elif key != -1 and key_char != 255:
            # Debug: print unknown key codes
            print(f"Debug: key={key}, key_char={key_char}")
    
    cap.release()
    cv2.destroyAllWindows()


def draw_timeline(frame, current_frame, total_frames, key_moments, fps):
    """Draw progress bar with key moment markers at bottom of screen"""
    h, w = frame.shape[:2]
    bar_height = 22
    bar_y = h - bar_height - 10  # 10px from bottom
    bar_x = 15
    bar_width = w - 30
    
    # Background (dark gray)
    cv2.rectangle(frame, (bar_x, bar_y), (bar_x + bar_width, bar_y + bar_height), 
                 (40, 40, 40), -1)
    
    # Progress (cyan/light blue for visibility)
    progress = current_frame / total_frames if total_frames > 0 else 0
    cv2.rectangle(frame, (bar_x, bar_y), 
                 (bar_x + int(bar_width * progress), bar_y + bar_height),
                 (255, 150, 0), -1)  # Orange/blue
    
    # Key moment markers (bright yellow vertical lines)
    for moment in key_moments:
        marker_x = bar_x + int((moment.frame_number / total_frames) * bar_width)
        # Draw thicker yellow line
        cv2.line(frame, (marker_x, bar_y - 2), (marker_x, bar_y + bar_height + 2),
                (0, 255, 255), 5)
    
    # Current position marker (bright white vertical line with outline)
    current_x = bar_x + int(progress * bar_width)
    # Black outline
    cv2.line(frame, (current_x, bar_y - 6), (current_x, bar_y + bar_height + 6),
            (0, 0, 0), 5)
    # White line
    cv2.line(frame, (current_x, bar_y - 5), (current_x, bar_y + bar_height + 5),
            (255, 255, 255), 3)
    
    # Border (bright white)
    cv2.rectangle(frame, (bar_x, bar_y), (bar_x + bar_width, bar_y + bar_height),
                 (255, 255, 255), 2)


def draw_timeline_phase2(frame, current_frame, total_frames, key_moments, fps, phase2_start_frame):
    """Draw progress bar for Phase 2 only (interrogation phase)"""
    h, w = frame.shape[:2]
    bar_height = 22
    bar_y = h - bar_height - 10  # 10px from bottom (should be h-32)
    bar_x = 15
    bar_width = w - 30
    
    # Debug: Ensure timeline is visible by making it brighter
    print(f"Drawing timeline at y={bar_y}, height={bar_height}, frame size={h}x{w}")
    
    # Calculate Phase 2 frames
    phase2_total_frames = max(1, total_frames - phase2_start_frame)
    phase2_current_frame = max(0, current_frame - phase2_start_frame)
    
    # Background (darker gray for better contrast)
    cv2.rectangle(frame, (bar_x, bar_y), (bar_x + bar_width, bar_y + bar_height), 
                 (60, 60, 60), -1)
    
    # Progress within Phase 2 only (bright cyan for visibility)
    progress = phase2_current_frame / phase2_total_frames if phase2_total_frames > 0 else 0
    cv2.rectangle(frame, (bar_x, bar_y), 
                 (bar_x + int(bar_width * progress), bar_y + bar_height),
                 (255, 255, 0), -1)  # Bright yellow
    
    # Key moment markers (only from Phase 2, bright yellow vertical lines)
    calibration_end = (phase2_start_frame / fps) if fps > 0 else 0
    for moment in key_moments:
        if moment.timestamp >= calibration_end:
            # Map moment to Phase 2 timeline using timestamp
            moment_phase2_time = moment.timestamp - calibration_end
            phase2_total_time = (phase2_total_frames / fps) if fps > 0 else 1
            marker_progress = moment_phase2_time / phase2_total_time if phase2_total_time > 0 else 0
            marker_x = bar_x + int(marker_progress * bar_width)
            # Draw thicker yellow line
            cv2.line(frame, (marker_x, bar_y - 2), (marker_x, bar_y + bar_height + 2),
                    (0, 255, 255), 5)
    
    # Current position marker (bright white vertical line with outline)
    current_x = bar_x + int(progress * bar_width)
    # Black outline
    cv2.line(frame, (current_x, bar_y - 6), (current_x, bar_y + bar_height + 6),
            (0, 0, 0), 5)
    # White line
    cv2.line(frame, (current_x, bar_y - 5), (current_x, bar_y + bar_height + 5),
            (255, 255, 255), 3)
    
    # Border (bright white, thicker)
    cv2.rectangle(frame, (bar_x, bar_y), (bar_x + bar_width, bar_y + bar_height),
                 (255, 255, 255), 3)
    
    # # Label to indicate this is Phase 2 timeline (brighter text)
    # cv2.putText(frame, "Phase 2: Interrogation", (bar_x, bar_y - 8),
    #            cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 255), 2)


def get_stress_color(stress_level):
    """Get color for stress level visualization"""
    colors = {
        1: (0, 255, 0),      # Green
        2: (0, 165, 255),    # Orange
        3: (0, 0, 255)       # Red
    }
    return colors.get(stress_level, (255, 255, 255))
