"""
Test script for Alert System Phase 3
Tests priority queue, clustering, and visual/audio cues
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

import time
import alert_system as alerts


def test_basic_alert_creation():
    """Test 1: Tạo alert cơ bản"""
    print("\n" + "="*60)
    print("TEST 1: Basic Alert Creation")
    print("="*60)
    
    alert = alerts.Alert(
        priority=50,
        timestamp=time.time(),
        indicators=['bpm_change', 'blinking'],
        confidence=0.75,
        details={'test': True}
    )
    
    print(f"✓ Alert created: priority={alert.priority}, confidence={alert.confidence}")
    print(f"  Indicators: {alert.indicators}")
    return True


def test_priority_queue():
    """Test 2: Kiểm tra priority queue"""
    print("\n" + "="*60)
    print("TEST 2: Priority Queue")
    print("="*60)
    
    manager = alerts.AlertManager()
    
    # Tạo các alert với priority khác nhau
    alert_low = alerts.Alert(priority=10, timestamp=time.time(), indicators=['gaze'])
    alert_med = alerts.Alert(priority=50, timestamp=time.time(), indicators=['bpm_change'])
    alert_high = alerts.Alert(priority=100, timestamp=time.time(), indicators=['hand', 'lips'])
    
    manager.enqueue(alert_low)
    manager.enqueue(alert_med)
    manager.enqueue(alert_high)
    
    print("✓ Enqueued 3 alerts (priority: 10, 50, 100)")
    
    # Dequeue - should get highest priority first
    first = manager.dequeue()
    print(f"✓ Dequeued first: priority={first.priority} (expected 100)")
    
    second = manager.dequeue()
    print(f"✓ Dequeued second: priority={second.priority} (expected 50)")
    
    return first.priority == 100 and second.priority == 50


def test_clustering():
    """Test 3: Clustering nhiều indicators"""
    print("\n" + "="*60)
    print("TEST 3: Alert Clustering")
    print("="*60)
    
    manager = alerts.AlertManager()
    
    # Simulate multiple indicators arriving within cluster window
    indicators1 = {
        'bpm_change': {'text': 'Heart rate increasing', 'ttl': 30}
    }
    
    indicators2 = {
        'bpm_change': {'text': 'Heart rate increasing', 'ttl': 30},
        'hand': {'text': 'Hand covering face', 'ttl': 30}
    }
    
    indicators3 = {
        'bpm_change': {'text': 'Heart rate increasing', 'ttl': 30},
        'hand': {'text': 'Hand covering face', 'ttl': 30},
        'lips': {'text': 'Lip compression', 'ttl': 30}
    }
    
    ts = time.time()
    
    # Process with increasing indicators (simulating clustering)
    alert1 = manager.process(indicators1, stress_level=1, timestamp=ts)
    print(f"  1 indicator: alert={alert1 is not None}, confidence={manager.recent}")
    
    time.sleep(0.5)  # Still within cluster window
    alert2 = manager.process(indicators2, stress_level=2, timestamp=ts + 0.5)
    print(f"  2 indicators: alert={alert2 is not None}")
    
    time.sleep(0.5)
    alert3 = manager.process(indicators3, stress_level=3, timestamp=ts + 1.0)
    print(f"  3 indicators: alert={alert3 is not None}")
    
    if alert3:
        print(f"✓ Clustered alert triggered!")
        print(f"  Priority: {alert3.priority}")
        print(f"  Confidence: {alert3.confidence:.2f}")
        print(f"  Clustered indicators: {alert3.indicators}")
        return True
    else:
        print("✗ No high-confidence alert triggered")
        return False


def test_visual_overlay():
    """Test 4: Visual overlay text"""
    print("\n" + "="*60)
    print("TEST 4: Visual Overlay")
    print("="*60)
    
    alert = alerts.Alert(
        priority=80,
        timestamp=time.time(),
        indicators=['bpm_change', 'hand', 'lips'],
        confidence=0.85
    )
    
    text = alerts.overlay_text_for_alert(alert)
    print(f"✓ Overlay text generated:")
    print(f"  '{text}'")
    
    return len(text) > 0


def test_audio_cue():
    """Test 5: Audio cue (beep)"""
    print("\n" + "="*60)
    print("TEST 5: Audio Cue")
    print("="*60)
    
    print("  Playing alert sound...")
    try:
        alerts.play_alert_sound()
        print("✓ Audio cue played successfully")
        return True
    except Exception as e:
        print(f"✗ Audio failed: {e}")
        return False


def test_integration_simulation():
    """Test 6: Simulation toàn bộ flow như trong main.py"""
    print("\n" + "="*60)
    print("TEST 6: Integration Simulation")
    print("="*60)
    
    # Reset manager
    alerts._manager = alerts.AlertManager()
    
    print("\nSimulating interrogation with multiple tells over time...")
    
    # Frame 1: Normal
    tells1 = {
        'avg_bpms': {'text': 'BPM: 72.0', 'ttl': 30}
    }
    alert = alerts.process_indicators(tells1, stress_level=1)
    print(f"Frame 1 (BPM only): alert={alert is not None}")
    
    time.sleep(0.2)
    
    # Frame 2: BPM spike
    tells2 = {
        'avg_bpms': {'text': 'BPM: 85.0', 'ttl': 30},
        'bpm_change': {'text': 'Heart rate increasing', 'ttl': 30}
    }
    alert = alerts.process_indicators(tells2, stress_level=2)
    print(f"Frame 2 (BPM spike): alert={alert is not None}")
    
    time.sleep(0.2)
    
    # Frame 3: Multiple tells (should trigger alert)
    tells3 = {
        'avg_bpms': {'text': 'BPM: 88.0', 'ttl': 30},
        'bpm_change': {'text': 'Heart rate increasing', 'ttl': 30},
        'hand': {'text': 'Hand covering face', 'ttl': 30},
        'blinking': {'text': 'Increased blinking', 'ttl': 30}
    }
    alert = alerts.process_indicators(tells3, stress_level=3)
    
    if alert:
        print(f"✓ Frame 3 (Multiple tells): ALERT TRIGGERED!")
        print(f"  {alerts.overlay_text_for_alert(alert)}")
        print(f"  Playing sound...")
        alerts.play_alert_sound()
        return True
    else:
        print(f"✗ Frame 3: No alert (confidence too low)")
        pending = alerts.get_pending_alerts()
        print(f"  Pending alerts: {len(pending)}")
        return False


def run_all_tests():
    """Run all tests"""
    print("\n" + "🔍 ALERT SYSTEM TEST SUITE")
    print("="*60)
    
    results = []
    
    results.append(("Basic Alert Creation", test_basic_alert_creation()))
    results.append(("Priority Queue", test_priority_queue()))
    results.append(("Alert Clustering", test_clustering()))
    results.append(("Visual Overlay", test_visual_overlay()))
    results.append(("Audio Cue", test_audio_cue()))
    results.append(("Integration Simulation", test_integration_simulation()))
    
    # Summary
    print("\n" + "="*60)
    print("📊 TEST SUMMARY")
    print("="*60)
    
    passed = 0
    for name, result in results:
        status = "✓ PASS" if result else "✗ FAIL"
        print(f"{status}: {name}")
        if result:
            passed += 1
    
    print(f"\nTotal: {passed}/{len(results)} tests passed")
    
    if passed == len(results):
        print("\n🎉 All tests passed! Alert system is working correctly.")
    else:
        print("\n⚠️  Some tests failed. Check output above for details.")
    
    return passed == len(results)


if __name__ == "__main__":
    success = run_all_tests()
    sys.exit(0 if success else 1)
