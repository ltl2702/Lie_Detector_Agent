"""
Simple camera test script to diagnose display issues
"""
import cv2
import sys

def test_camera():
    print("Testing camera access...")
    print("=" * 50)
    
    # Try opening camera with DirectShow (Windows)
    print("\n1. Trying DirectShow backend (Windows optimized)...")
    cap = cv2.VideoCapture(0, cv2.CAP_DSHOW)
    
    if not cap.isOpened():
        print("   Failed with DirectShow. Trying default backend...")
        cap = cv2.VideoCapture(0)
    
    if not cap.isOpened():
        print("   ERROR: Cannot access camera!")
        print("\nTroubleshooting steps:")
        print("   - Check if camera is being used by another application")
        print("   - Check camera permissions in Windows Settings")
        print("   - Try unplugging and replugging USB camera")
        return False
    
    print("   ✓ Camera opened successfully!")
    
    # Get camera properties
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS)
    
    print(f"\n2. Camera Properties:")
    print(f"   Resolution: {width}x{height}")
    print(f"   FPS: {fps}")
    
    # Try to read a frame
    print("\n3. Testing frame capture...")
    ret, frame = cap.read()
    
    if not ret or frame is None:
        print("   ERROR: Cannot read frame from camera!")
        cap.release()
        return False
    
    print(f"   ✓ Frame captured successfully! Shape: {frame.shape}")
    
    # Create window
    print("\n4. Creating display window...")
    window_name = 'Camera Test - Press ESC to exit'
    cv2.namedWindow(window_name, cv2.WINDOW_NORMAL)
    cv2.resizeWindow(window_name, 800, 600)
    
    print("\n" + "=" * 50)
    print("SUCCESS! Camera is working!")
    print("=" * 50)
    print("\nA window should appear showing your camera feed.")
    print("If you don't see it, check if it's minimized or behind other windows.")
    print("\nPress ESC to exit, or close this terminal to stop.")
    print("=" * 50)
    
    frame_count = 0
    
    while True:
        ret, frame = cap.read()
        
        if not ret:
            print("\nWarning: Failed to read frame")
            continue
        
        # Flip for mirror effect
        frame = cv2.flip(frame, 1)
        
        # Add text overlay
        frame_count += 1
        cv2.putText(frame, f'Frame: {frame_count}', (10, 30),
                   cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2)
        cv2.putText(frame, 'Press ESC to exit', (10, 70),
                   cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)
        cv2.putText(frame, 'Camera is working!', (10, frame.shape[0] - 20),
                   cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2)
        
        # Show frame
        cv2.imshow(window_name, frame)
        
        # Try to bring window to front (first few frames)
        if frame_count < 5:
            try:
                cv2.setWindowProperty(window_name, cv2.WND_PROP_TOPMOST, 1)
            except:
                pass
        
        # Check for ESC key
        key = cv2.waitKey(1) & 0xFF
        if key == 27:  # ESC
            print("\nExiting...")
            break
    
    # Cleanup
    cap.release()
    cv2.destroyAllWindows()
    print("Camera test completed successfully!")
    return True


if __name__ == "__main__":
    try:
        test_camera()
    except KeyboardInterrupt:
        print("\n\nInterrupted by user")
        cv2.destroyAllWindows()
    except Exception as e:
        print(f"\n\nERROR: {e}")
        import traceback
        traceback.print_exc()
        cv2.destroyAllWindows()
