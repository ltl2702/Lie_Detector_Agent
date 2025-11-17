import time
import heapq
import platform
from collections import deque

try:
    import pygame
except Exception:
    pygame = None

from dataclasses import dataclass, field
from typing import List, Dict, Any


@dataclass(order=True)
class Alert:
    priority: int
    timestamp: float = field(compare=False)
    indicators: List[str] = field(compare=False, default_factory=list)
    confidence: float = field(compare=False, default=0.0)
    details: Dict[str, Any] = field(compare=False, default_factory=dict)


class AlertManager:
    """Priority-based alert manager with simple temporal clustering.

    - Indicators are queued.
    - If multiple indicators arrive within CLUSTER_WINDOW, they are merged into one alert
      with higher confidence and priority.
    - `process` returns an Alert object when its confidence crosses a threshold.
    """

    def __init__(self):
        self._heap = []  # min-heap by priority (lower number = lower priority)
        self.recent = []  # recent raw events for clustering
        self.history = deque(maxlen=200)

        self.CLUSTER_WINDOW = 3.0  # seconds to cluster nearby indicators
        self.LOOKBACK = 10.0  # keep recent events for this long
        self.WEIGHTS = {
            'bpm_change': 30,
            'hand': 20,
            'blinking': 15,
            'lips': 15,
            'gaze': 10,
            'avg_bpms': 5,
        }

        # Confidence logic
        self.CONFIDENCE_BASE = 0.2
        self.CONFIDENCE_PER_INDICATOR = 0.25
        self.ALERT_CONFIDENCE_THRESHOLD = 0.6

        # False-positive filtering
        self.last_alert_time = 0
        self.ALERT_COOLDOWN = 1.2
        self.pattern_memory = deque(maxlen=15)

    def _now(self):
        return time.time()

    def enqueue(self, alert: Alert):
        # use negative priority so heapq pops highest priority first
        heapq.heappush(self._heap, (-alert.priority, alert.timestamp, alert))

    def dequeue(self):
        if not self._heap:
            return None
        _, _, alert = heapq.heappop(self._heap)
        return alert
    
    def priority_to_level(self, p: int):
        if p < 25:
            return "LOW"
        elif p < 50:
            return "MEDIUM"
        elif p < 75:
            return "HIGH"
        return "CRITICAL"
    
    
    def compute_stress_score(self, indicators: List[str], stress_level: int):
        score = sum(self.WEIGHTS.get(i, 5) for i in indicators)
        score += stress_level * 10
        return max(0, min(100, int(score)))

    
    def reduce_false_positive(self, indicators: List[str]):
        now = self._now()
        key = tuple(sorted(indicators))

        # cooldown
        if now - self.last_alert_time < self.ALERT_COOLDOWN:
            return False

        # require repeated patterns
        self.pattern_memory.append((now, key))
        repeated = sum(1 for t, k in self.pattern_memory if k == key and now - t < 3)

        if repeated < 2 and len(indicators) < 2:
            return False

        self.last_alert_time = now
        return True

    def process(self, indicators: Dict[str, Dict], stress_level: int = 0, timestamp: float = None):
        """Process a dict of indicator tells. Returns Alert when an alert should be raised, else None.

        indicators: mapping from key->{'text':..., 'ttl':...}
        stress_level: integer severity (1-3) optionally used to boost priority
        """
        ts = timestamp or self._now()
        keys = list(indicators.keys())
        if not keys:
            return None

        # add to recent
        for k in keys:
            self.recent.append((ts, k))

        # prune recent
        cutoff = ts - self.LOOKBACK
        self.recent = [(t, k) for (t, k) in self.recent if t >= cutoff]

        # build cluster of events within CLUSTER_WINDOW of now
        cluster = [k for (t, k) in self.recent if t >= ts - self.CLUSTER_WINDOW]

        # compute priority from weights and stress_level
        score = 0
        for k in set(cluster):
            score += self.WEIGHTS.get(k, 5)

        # small boost by stress level
        score += stress_level * 10

        # compute confidence
        confidence = min(1.0, self.CONFIDENCE_BASE + len(set(cluster)) * self.CONFIDENCE_PER_INDICATOR)

        # priority = int(score)

        # alert = Alert(priority=priority, timestamp=ts, indicators=list(set(cluster)), confidence=confidence,
        #               details={'raw': indicators})

        # Stress Score 
        stress_score = self.compute_stress_score(cluster, stress_level)

        # Build alert object
        alert = Alert(
            priority=score,
            timestamp=ts,
            indicators=cluster,
            confidence=confidence,
            details={
                'raw': indicators,
                'stress_score': stress_score,
                'priority_level': self.priority_to_level(score)
            }
        )

        # enqueue for record keeping
        self.enqueue(alert)

        # If alert confidence is high enough, check for false positives before returning
        if confidence >= self.ALERT_CONFIDENCE_THRESHOLD:
            
            # GỌI HÀM LỌC TẠI ĐÂY
            # Lấy danh sách các 'tell' duy nhất từ cluster
            indicator_keys = list(set(cluster)) 
            
            if not self.reduce_false_positive(indicator_keys):
                # Bị lọc! Trả về None (không có alert)
                return None 
            
            # Vượt qua bộ lọc, trả về alert
            return alert
            
        # Confidence không đủ cao
        return None

    def get_pending(self, limit=5):
        return [item[2] for item in sorted(self._heap, reverse=True)][:limit]


_manager = AlertManager()


def process_indicators(indicators: Dict[str, Dict], stress_level: int = 0, timestamp: float = None):
    """Public API: process incoming tells. Returns Alert or None."""
    return _manager.process(indicators, stress_level, timestamp)


def play_alert_sound():
    """Play a short audio cue. Uses winsound on Windows, otherwise pygame if available."""
    try:
        if platform.system() == 'Windows':
            import winsound
            # frequency, duration
            winsound.Beep(750, 180)
            return
    except Exception:
        pass

    # fallback to pygame if available
    try:
        if pygame:
            if not pygame.mixer.get_init():
                pygame.mixer.init()
            # generate short tone with Sound object using array (not all platforms support)
            # simplest: load a tiny built-in beep if present, else try channel beep via set_volume
            freq = 440
            duration = 0.18
            # Many pygame installs won't support programmatic tone generation reliably; use silence-safe approach
            # Try to play a short default sound if available
            s = pygame.mixer.Sound(buffer=b"\x00\x00")
            s.play()
            time.sleep(duration)
    except Exception:
        # last resort: print visual fallback
        print("[ALERT SOUND]")


def overlay_text_for_alert(alert: Alert):
    """Return a short text summary suitable for overlaying on a frame."""
    if not alert:
        return ''
    return f"ALERT ({int(alert.confidence*100)}%): {', '.join(alert.indicators)}"


def get_pending_alerts(limit=5):
    return _manager.get_pending(limit)
