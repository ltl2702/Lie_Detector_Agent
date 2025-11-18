import json
import os
import time
from datetime import datetime
from typing import Dict, List, Any, Optional
from dataclasses import dataclass, asdict
import numpy as np


@dataclass
class SessionMemory:
    """Lưu trữ thông tin session để học hỏi"""
    session_id: str
    timestamp: str
    baseline_metrics: Dict[str, float]
    detection_events: List[Dict[str, Any]]
    deception_count: int
    confidence_scores: List[float]
    behavioral_patterns: Dict[str, Any]
    adaptive_thresholds: Dict[str, float]
    
       
class AdaptiveThresholdManager:
    """
    Quản lý adaptive thresholds dựa trên Agent personality/behavior definition
    Nguyên lý tâm lý học: Người đã nói dối một lần có xu hướng cao hơn để nói dối tiếp
    """
    
    def __init__(self):
        # Ngưỡng mặc định ban đầu (% so với baseline)
        self.default_thresholds = {
            'bpm_change': 30.0,        # +30% so với baseline
            'blink_rate': 40.0,        # +40% so với baseline  
            'gaze_stability': 50.0,    # +50% so với baseline
            'hand_face_frequency': 20.0,  # +20% so với baseline
            'lip_compression': 30.0,   # +30% độ nhạy
            'emotion_change': 0.6      # confidence threshold
        }
        
        # Ngưỡng hiện tại (sẽ được điều chỉnh)
        self.current_thresholds = self.default_thresholds.copy()
        
        # Lịch sử phát hiện để học hỏi
        self.detection_history = []
        self.successful_detections = 0
        
        # Tham số điều chỉnh - Learning nhẹ nhàng hơn
        self.sensitivity_increase_rate = 0.99  # Hạ ngưỡng xuống 99% sau mỗi lần phát hiện (1% improvement)
        self.min_threshold_ratio = 0.8        # Không hạ quá 80% ngưỡng gốc (tối đa 20% improvement)
        self.confidence_memory_window = 10     # Nhớ 10 detection gần nhất
        
    def record_detection(self, indicators: List[str], confidence: float, timestamp: float = None):
        """Ghi nhận một detection event để học hỏi"""
        if timestamp is None:
            timestamp = time.time()
            
        event = {
            'timestamp': timestamp,
            'indicators': indicators,
            'confidence': confidence,
            'thresholds_at_time': self.current_thresholds.copy()
        }
        
        self.detection_history.append(event)
        
        # Chỉ giữ lại events trong window
        cutoff_time = timestamp - (self.confidence_memory_window * 60)  # 10 phút
        self.detection_history = [e for e in self.detection_history if e['timestamp'] > cutoff_time]
        
        # Cập nhật successful detections nếu confidence cao
        if confidence >= 0.7:  # High confidence detection
            self.successful_detections += 1
            self._adapt_thresholds(indicators)
            print(f"🧠 ADAPTIVE LEARNING: Detection #{self.successful_detections} recorded (confidence: {confidence:.1%})")
            self._print_threshold_changes()
    
    def _adapt_thresholds(self, detected_indicators: List[str]):
        """
        Điều chỉnh ngưỡng dựa trên nguyên lý tâm lý học
        Agent trở nên "nhạy cảm" hơn với những vi phạm nhỏ hơn
        """
        old_thresholds = self.current_thresholds.copy()
        
        # Map detection indicators to threshold keys
        indicator_mapping = {
            'hand': 'hand_face_frequency',
            'bpm_change': 'bpm_change',
            'blinking': 'blink_rate',
            'gaze': 'gaze_stability',
            'lips': 'lip_compression'
        }
        
        for indicator in detected_indicators:
            # Map indicator to threshold key
            threshold_key = indicator_mapping.get(indicator, indicator)
            
            if threshold_key in self.current_thresholds:
                # Hạ ngưỡng theo tỷ lệ
                current_value = self.current_thresholds[threshold_key]
                new_value = current_value * self.sensitivity_increase_rate
                
                # Không hạ quá minimum threshold
                min_value = self.default_thresholds[threshold_key] * self.min_threshold_ratio
                self.current_thresholds[threshold_key] = max(new_value, min_value)
        
        # Thêm logic học hỏi cross-indicator - nhẹ nhàng hơn
        # Nếu phát hiện được BPM change, cũng hạ ngưỡng cho blink rate (correlation)
        if 'bpm_change' in detected_indicators:
            self._adjust_correlated_threshold('blink_rate', 0.99)  # Chỉ 1% adjustment
        
        # Nếu phát hiện hand-face contact, hạ ngưỡng cho gaze (stress correlation)
        if 'hand' in detected_indicators:
            self._adjust_correlated_threshold('gaze_stability', 0.99)  # Chỉ 1% adjustment
    
    def _adjust_correlated_threshold(self, threshold_key: str, factor: float):
        """Điều chỉnh ngưỡng của indicator liên quan"""
        if threshold_key in self.current_thresholds:
            current_value = self.current_thresholds[threshold_key]
            new_value = current_value * factor
            min_value = self.default_thresholds[threshold_key] * self.min_threshold_ratio
            self.current_thresholds[threshold_key] = max(new_value, min_value)
    
    def _print_threshold_changes(self):
        """In thông tin thay đổi ngưỡng"""
        print(f"📊 CURRENT ADAPTIVE THRESHOLDS:")
        for key, current in self.current_thresholds.items():
            default = self.default_thresholds[key]
            change_pct = ((current - default) / default) * 100
            print(f"   {key}: {current:.1f} ({change_pct:+.0f}% vs default)")
    
    def get_threshold(self, indicator: str) -> float:
        """Lấy ngưỡng hiện tại cho một indicator"""
        return self.current_thresholds.get(indicator, self.default_thresholds.get(indicator, 20.0))
    
    def get_detection_summary(self) -> Dict[str, Any]:
        """Lấy tóm tắt về lịch sử detection và học hỏi"""
        if not self.detection_history:
            return {
                'total_detections': 0, 
                'successful_detections': self.successful_detections,
                'avg_confidence': 0, 
                'learning_active': self.successful_detections > 0
            }
        
        confidences = [e['confidence'] for e in self.detection_history]
        indicators_count = {}
        for event in self.detection_history:
            for indicator in event['indicators']:
                indicators_count[indicator] = indicators_count.get(indicator, 0) + 1
        
        return {
            'total_detections': len(self.detection_history),
            'successful_detections': self.successful_detections,
            'avg_confidence': np.mean(confidences),
            'most_common_indicators': sorted(indicators_count.items(), key=lambda x: x[1], reverse=True),
            'learning_active': self.successful_detections > 0,
            'sensitivity_improvement': f"{(1 - self.sensitivity_increase_rate) * 100:.0f}% per detection"
        }


class MemorySystem:
    """
    PHASE 5: MEMORY & LEARNING System
    - Session recording với overlays
    - Adaptive threshold learning
    - Behavioral pattern analysis
    """
    
    def __init__(self, memory_dir: str = None):
        if memory_dir is None:
            # Tạo memory directory trong project root
            project_root = os.path.dirname(os.path.dirname(__file__))
            memory_dir = os.path.join(project_root, 'memory')
        
        self.memory_dir = memory_dir
        os.makedirs(self.memory_dir, exist_ok=True)
        
        # Initialize adaptive threshold manager with DEFAULT values
        self.threshold_manager = AdaptiveThresholdManager()
        
        # Current session data
        self.current_session = None
        self.session_start_time = None
        
        # NO LOADING - each session starts fresh
        print("🧠 MEMORY: Starting with fresh default thresholds (independent session)")
    
    def start_new_session(self, baseline_metrics: Dict[str, float] = None) -> str:
        """Bắt đầu session mới hoàn toàn độc lập với default thresholds"""
        session_id = f"session_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        timestamp = datetime.now().isoformat()
        
        # Reset threshold manager to defaults for this session
        self.threshold_manager = AdaptiveThresholdManager()
        
        if baseline_metrics is None:
            baseline_metrics = {}
        
        self.current_session = SessionMemory(
            session_id=session_id,
            timestamp=timestamp,
            baseline_metrics=baseline_metrics,
            detection_events=[],
            deception_count=0,
            confidence_scores=[],
            behavioral_patterns={},
            adaptive_thresholds=self.threshold_manager.current_thresholds.copy()
        )
        
        self.session_start_time = time.time()
        
        print(f"🧠 MEMORY SYSTEM: Started session {session_id}")
        return session_id
    
    def record_detection_event(self, indicators: List[str], confidence: float, 
                               psychological_metrics: Dict[str, float] = None,
                               timestamp: float = None):
        """
        Ghi nhận detection event và cập nhật adaptive thresholds
        Tập trung vào psychological metrics, không phụ thuộc text/voice
        """
        if not self.current_session or timestamp is None:
            timestamp = time.time()
        
        # Record in threshold manager for learning
        self.threshold_manager.record_detection(indicators, confidence, timestamp)
        
        # Record in current session
        event = {
            'timestamp': timestamp,
            'session_time': timestamp - self.session_start_time if self.session_start_time else 0,
            'indicators': indicators,
            'confidence': confidence,
            'psychological_metrics': psychological_metrics or {},
            'adaptive_thresholds_snapshot': self.threshold_manager.current_thresholds.copy()
        }
        
        self.current_session.detection_events.append(event)
        self.current_session.confidence_scores.append(confidence)
        
        # Update deception count for high confidence
        if confidence >= 0.7:
            self.current_session.deception_count += 1
        
        # Analyze behavioral patterns
        self._analyze_behavioral_patterns()
        
        print(f"📝 DETECTION RECORDED: {indicators} (confidence: {confidence:.1%})")
    
    def _analyze_behavioral_patterns(self):
        """
        Phân tích patterns hành vi tâm lý để cải thiện detection
        Không dựa vào text/voice, chỉ dùng psychological indicators
        """
        if not self.current_session or len(self.current_session.detection_events) < 2:
            return
        
        events = self.current_session.detection_events
        
        # Pattern 1: Escalation pattern - confidence tăng dần
        confidences = [e['confidence'] for e in events[-5:]]  # 5 events gần nhất
        if len(confidences) >= 3:
            trend = np.polyfit(range(len(confidences)), confidences, 1)[0]
            if trend > 0.1:  # Confidence tăng
                self.current_session.behavioral_patterns['escalation_detected'] = True
                self.current_session.behavioral_patterns['escalation_rate'] = float(trend)
        
        # Pattern 2: Indicator clustering - indicators nào thường xuất hiện cùng nhau
        indicator_pairs = {}
        for event in events:
            indicators = event['indicators']
            for i, ind1 in enumerate(indicators):
                for ind2 in indicators[i+1:]:
                    pair = tuple(sorted([ind1, ind2]))
                    indicator_pairs[pair] = indicator_pairs.get(pair, 0) + 1
        
        if indicator_pairs:
            most_common_pair = max(indicator_pairs.items(), key=lambda x: x[1])
            self.current_session.behavioral_patterns['common_indicator_pairs'] = dict(indicator_pairs)
            self.current_session.behavioral_patterns['strongest_correlation'] = {
                'indicators': most_common_pair[0],
                'frequency': most_common_pair[1]
            }
        
        # Pattern 3: Time-based patterns - có chu kỳ nào không
        event_times = [e['session_time'] for e in events]
        if len(event_times) >= 3:
            time_intervals = np.diff(event_times)
            avg_interval = np.mean(time_intervals)
            self.current_session.behavioral_patterns['avg_detection_interval'] = float(avg_interval)
            
            # Phát hiện bursts (nhiều detection trong thời gian ngắn)
            short_intervals = [t for t in time_intervals if t < 30]  # < 30 giây
            if len(short_intervals) >= 2:
                self.current_session.behavioral_patterns['burst_behavior'] = True
                self.current_session.behavioral_patterns['burst_count'] = len(short_intervals)
    
    def get_adaptive_threshold(self, indicator: str) -> float:
        """Lấy ngưỡng adaptive hiện tại cho indicator"""
        return self.threshold_manager.get_threshold(indicator)
    
    def get_session_summary(self) -> Dict[str, Any]:
        """Lấy tóm tắt session hiện tại"""
        if not self.current_session:
            return {'session_active': False}
        
        detection_summary = self.threshold_manager.get_detection_summary()
        
        return {
            'session_active': True,
            'session_id': self.current_session.session_id,
            'duration': time.time() - self.session_start_time if self.session_start_time else 0,
            'total_detections': len(self.current_session.detection_events),
            'deception_count': self.current_session.deception_count,
            'avg_confidence': np.mean(self.current_session.confidence_scores) if self.current_session.confidence_scores else 0,
            'behavioral_patterns': self.current_session.behavioral_patterns,
            'adaptive_learning': detection_summary,
            'current_thresholds': self.threshold_manager.current_thresholds
        }
    
    def save_session(self) -> str:
        """Lưu session hiện tại vào memory"""
        if not self.current_session:
            return None
        
        # Update adaptive thresholds trước khi save
        self.current_session.adaptive_thresholds = self.threshold_manager.current_thresholds.copy()
        
        # Save to file with timestamp (for analysis only, not for loading)
        filename = f"memory_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        filepath = os.path.join(self.memory_dir, filename)
        
        # Convert to dict for JSON serialization
        session_dict = asdict(self.current_session)
        
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(session_dict, f, indent=2, ensure_ascii=False)
        
        # NO 'latest' file - sessions are independent
        
        print(f"💾 MEMORY SAVED: {filepath}")
        return filepath
    
    # Removed _load_latest_memory - each session is independent
    
    def get_learning_insights(self) -> Dict[str, Any]:
        """Lấy insights về quá trình học của Agent"""
        detection_summary = self.threshold_manager.get_detection_summary()
        
        insights = {
            'learning_status': 'Active' if detection_summary['learning_active'] else 'Baseline',
            'total_experience': detection_summary['successful_detections'],
            'sensitivity_improvements': {},
            'behavioral_insights': []
        }
        
        # Tính toán độ cải thiện sensitivity
        for key, current in self.threshold_manager.current_thresholds.items():
            default = self.threshold_manager.default_thresholds[key]
            improvement_pct = ((default - current) / default) * 100
            if improvement_pct > 0:
                insights['sensitivity_improvements'][key] = f"+{improvement_pct:.0f}%"
        
        # Behavioral insights from current session
        if self.current_session and self.current_session.behavioral_patterns:
            patterns = self.current_session.behavioral_patterns
            
            if patterns.get('escalation_detected'):
                insights['behavioral_insights'].append(f"Escalation pattern detected (rate: {patterns['escalation_rate']:.3f})")
            
            if patterns.get('strongest_correlation'):
                corr = patterns['strongest_correlation']
                insights['behavioral_insights'].append(f"Strong correlation: {corr['indicators']} ({corr['frequency']} times)")
            
            if patterns.get('burst_behavior'):
                insights['behavioral_insights'].append(f"Burst behavior: {patterns['burst_count']} rapid detections")
        
        return insights


# Global memory system instance - initialized fresh for each session
memory_system = MemorySystem()