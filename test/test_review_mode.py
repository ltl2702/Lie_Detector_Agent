"""
Test script for Review Mode - Phase 4
Tests timeline tracking, key moments, and statistical summary
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

import time
import review_mode
import json


def test_review_session_creation():
    """Test 1: Create ReviewSession"""
    print("\n" + "="*60)
    print("TEST 1: ReviewSession Creation")
    print("="*60)
    
    session = review_mode.ReviewSession("test_session")
    print(f"✓ Session created: {session.session_name}")
    print(f"  Start time: {session.start_time}")
    
    return True


def test_tracking_events():
    """Test 2: Track tells over time"""
    print("\n" + "="*60)
    print("TEST 2: Event Tracking")
    print("="*60)
    
    session = review_mode.ReviewSession("tracking_test")
    
    # Simulate calibration
    for i in range(10):
        tells = {'avg_bpms': {'text': 'BPM: 70.0', 'ttl': 30}}
        session.add_event(tells, stress_level=1, frame_number=i)
        time.sleep(0.01)
    
    session.set_calibration_complete()
    print(f"✓ Calibration tracked: {len(session.events)} events")
    
    # Simulate interrogation with increasing stress
    for i in range(10, 30):
        tells = {
            'avg_bpms': {'text': f'BPM: {75 + i}.0', 'ttl': 30},
            'bpm_change': {'text': 'Heart rate increasing', 'ttl': 30}
        }
        stress = 2 if i < 20 else 3
        session.add_event(tells, stress_level=stress, confidence=0.5, frame_number=i)
        time.sleep(0.01)
    
    print(f"✓ Interrogation tracked: {len(session.events)} total events")
    print(f"  Stress levels: {len(session.stress_levels)} frames")
    print(f"  BPM values: {len(session.bpm_values)} samples")
    
    return len(session.events) > 20


def test_key_moments():
    """Test 3: Key moment markers"""
    print("\n" + "="*60)
    print("TEST 3: Key Moment Markers")
    print("="*60)
    
    session = review_mode.ReviewSession("moments_test")
    
    # Add some events
    for i in range(20):
        tells = {'avg_bpms': {'text': f'BPM: {70 + i}.0', 'ttl': 30}}
        session.add_event(tells, stress_level=1, frame_number=i)
    
    # Add key moments
    session.add_key_moment(['bpm_change', 'hand'], 0.85, "alert_cluster")
    time.sleep(0.1)
    session.add_key_moment(['blinking', 'lips'], 0.92, "alert_cluster")
    time.sleep(0.1)
    session.add_manual_marker("Suspect avoided eye contact")
    
    print(f"✓ Key moments added: {len(session.key_moments)}")
    for i, moment in enumerate(session.key_moments, 1):
        print(f"  {i}. [{moment.timestamp:.2f}s] {moment.reason}: {moment.tells}")
        if moment.notes:
            print(f"     Note: {moment.notes}")
    
    return len(session.key_moments) == 3


def test_statistics():
    """Test 4: Statistical summary generation"""
    print("\n" + "="*60)
    print("TEST 4: Statistical Summary")
    print("="*60)
    
    session = review_mode.ReviewSession("stats_test")
    
    # Simulate realistic session
    # Calibration phase (low stress)
    for i in range(30):
        tells = {'avg_bpms': {'text': 'BPM: 72.0', 'ttl': 30}}
        session.add_event(tells, stress_level=1, frame_number=i)
        time.sleep(0.001)
    
    session.set_calibration_complete()
    
    # Interrogation phase (varying stress)
    tell_types = ['bpm_change', 'hand', 'blinking', 'lips', 'gaze']
    for i in range(30, 100):
        tells = {'avg_bpms': {'text': f'BPM: {75 + (i-30)*0.5}.0', 'ttl': 30}}
        
        # Add random tells
        if i % 5 == 0:
            tells['bpm_change'] = {'text': 'Heart rate increasing', 'ttl': 30}
        if i % 7 == 0:
            tells['hand'] = {'text': 'Hand covering face', 'ttl': 30}
        if i % 10 == 0:
            tells['blinking'] = {'text': 'Increased blinking', 'ttl': 30}
        
        stress = 1 if i < 50 else (2 if i < 75 else 3)
        session.add_event(tells, stress_level=stress, frame_number=i)
        
        # Add key moments for high stress
        if stress == 3 and i % 8 == 0:
            session.add_key_moment(list(tells.keys())[:3], 0.9, "alert_cluster")
        
        time.sleep(0.001)
    
    # Get statistics
    stats = session.get_statistics()
    
    print(f"✓ Statistics generated:")
    print(f"  Duration: {stats.duration:.1f}s")
    print(f"  Total tells: {stats.total_tells}")
    print(f"  Tells/minute: {stats.tells_per_minute:.1f}")
    print(f"  Avg stress: {stats.avg_stress_level:.2f}")
    print(f"  BPM range: {stats.min_bpm:.1f} - {stats.max_bpm:.1f}")
    print(f"  Key moments: {stats.key_moments_count}")
    print(f"  Stress distribution:")
    for level, pct in stats.stress_distribution.items():
        print(f"    {level}: {pct:.1f}%")
    
    return stats.total_tells > 0


def test_save_load():
    """Test 5: Save and load session"""
    print("\n" + "="*60)
    print("TEST 5: Save/Load Session")
    print("="*60)
    
    # Create and populate session
    session1 = review_mode.ReviewSession("save_test")
    for i in range(20):
        tells = {
            'avg_bpms': {'text': f'BPM: {70 + i}.0', 'ttl': 30},
            'bpm_change': {'text': 'Heart rate increasing', 'ttl': 30}
        }
        session1.add_event(tells, stress_level=2, frame_number=i)
    
    session1.add_key_moment(['bpm_change'], 0.8, "alert_cluster")
    session1.video_file = "test_video.avi"
    
    # Save
    filepath = session1.save("test_session.json")
    print(f"✓ Session saved to: {filepath}")
    
    # Load
    session2 = review_mode.ReviewSession.load("test_session.json")
    print(f"✓ Session loaded: {session2.session_name}")
    print(f"  Events: {len(session2.events)}")
    print(f"  Key moments: {len(session2.key_moments)}")
    print(f"  Video file: {session2.video_file}")
    
    # Verify
    success = (len(session1.events) == len(session2.events) and
               len(session1.key_moments) == len(session2.key_moments))
    
    # Cleanup
    if os.path.exists("test_session.json"):
        os.remove("test_session.json")
        print("  (cleanup: test file removed)")
    
    return success


def test_print_summary():
    """Test 6: Print formatted summary"""
    print("\n" + "="*60)
    print("TEST 6: Print Summary")
    print("="*60)
    
    # Create realistic session
    session = review_mode.ReviewSession("summary_test")
    
    # Quick simulation
    for i in range(50):
        tells = {'avg_bpms': {'text': f'BPM: {72 + i*0.5:.1f}', 'ttl': 30}}
        if i % 5 == 0:
            tells['hand'] = {'text': 'Hand covering face', 'ttl': 30}
        if i % 7 == 0:
            tells['blinking'] = {'text': 'Increased blinking', 'ttl': 30}
        
        stress = min(3, 1 + i // 20)
        session.add_event(tells, stress_level=stress, frame_number=i)
        time.sleep(0.001)
    
    session.add_key_moment(['hand', 'blinking'], 0.9, "alert_cluster")
    
    # Print summary
    session.print_summary()
    
    print("\n✓ Summary printed successfully")
    
    return True


def run_all_tests():
    """Run all tests"""
    print("\n" + "🎬 REVIEW MODE TEST SUITE")
    print("="*60)
    
    results = []
    
    results.append(("ReviewSession Creation", test_review_session_creation()))
    results.append(("Event Tracking", test_tracking_events()))
    results.append(("Key Moment Markers", test_key_moments()))
    results.append(("Statistical Summary", test_statistics()))
    results.append(("Save/Load Session", test_save_load()))
    results.append(("Print Summary", test_print_summary()))
    
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
        print("\n🎉 All tests passed! Review Mode is working correctly.")
        print("\n📝 Usage:")
        print("  1. Record session with 'Record Session' checkbox enabled")
        print("  2. Session auto-saves as .json file after recording")
        print("  3. Click 'Review Mode' button to load and playback")
        print("  4. Controls: SPACE (pause), ←/→ (seek), M (next moment), S (stats)")
    else:
        print("\n⚠️  Some tests failed. Check output above for details.")
    
    return passed == len(results)


if __name__ == "__main__":
    success = run_all_tests()
    sys.exit(0 if success else 1)
