"""
Test script to verify all components are working
Run this before using the main application
"""

import sys

def test_imports():
    """Test if all required packages are installed"""
    print("=" * 50)
    print("Testing imports...")
    print("=" * 50)
    
    packages = {
        'pygame': 'pygame',
        'cv2': 'opencv-python',
        'mediapipe': 'mediapipe',
        'numpy': 'numpy',
        'scipy': 'scipy',
        'fer': 'fer',
        'matplotlib': 'matplotlib',
        'tensorflow': 'tensorflow'
    }
    
    failed = []
    
    for module, package in packages.items():
        try:
            __import__(module)
            print(f"{package}")
        except ImportError:
            print(f"{package} - NOT INSTALLED")
            failed.append(package)
    
    if failed:
        print("\nMissing packages. Install with:")
        print(f"pip install {' '.join(failed)}")
        return False
    
    print("\nAll packages installed!")
    return True


def test_camera():
    """Test if camera is accessible"""
    print("\n" + "=" * 50)
    print("Testing camera...")
    print("=" * 50)
    
    try:
        import cv2
        
        cap = cv2.VideoCapture(0)
        if cap.isOpened():
            ret, frame = cap.read()
            if ret:
                print(f"Camera working - Frame shape: {frame.shape}")
                cap.release()
                return True
            else:
                print("Camera opened but cannot read frames")
                cap.release()
                return False
        else:
            print("Cannot open camera")
            return False
    except Exception as e:
        print(f"Error: {e}")
        return False


def test_mediapipe():
    """Test MediaPipe face and hand detection"""
    print("\n" + "=" * 50)
    print("Testing MediaPipe...")
    print("=" * 50)
    
    try:
        import cv2
        import mediapipe as mp
        import numpy as np
        
        # Create a dummy image
        test_image = np.zeros((480, 640, 3), dtype=np.uint8)
        
        mp_face = mp.solutions.face_mesh
        mp_hands = mp.solutions.hands
        
        with mp_face.FaceMesh() as face_mesh:
            results = face_mesh.process(cv2.cvtColor(test_image, cv2.COLOR_BGR2RGB))
            print("Face mesh initialized")
        
        with mp_hands.Hands() as hands:
            results = hands.process(cv2.cvtColor(test_image, cv2.COLOR_BGR2RGB))
            print("Hand detection initialized")
        
        return True
    except Exception as e:
        print(f"Error: {e}")
        return False


def test_fer():
    """Test FER emotion detector"""
    print("\n" + "=" * 50)
    print("Testing FER (this may take a moment)...")
    print("=" * 50)
    
    try:
        from fer import FER
        import numpy as np
        
        # Create dummy image
        test_image = np.zeros((480, 640, 3), dtype=np.uint8)
        
        detector = FER(mtcnn=True)
        print("FER initialized")
        
        # This will take a moment on first run (downloading models)
        result = detector.detect_emotions(test_image)
        print("FER detection working")
        
        return True
    except Exception as e:
        print(f"Error: {e}")
        print("Note: FER may need to download models on first run")
        return False


def test_files():
    """Test if required files exist"""
    print("\n" + "=" * 50)
    print("Testing files...")
    print("=" * 50)
    
    import os
    
    required_files = [
        'main.py',
        'deception_detection.py',
        'utils.py'
    ]
    
    optional_files = [
        'meter.png'
    ]
    
    all_ok = True
    
    for file in required_files:
        if os.path.exists(file):
            print(f"{file}")
        else:
            print(f"{file} - MISSING")
            all_ok = False
    
    for file in optional_files:
        if os.path.exists(file):
            print(f"{file} (optional)")
        else:
            print(f"{file} (optional) - will be auto-generated")
    
    return all_ok


def test_output_folder():
    """Test if we can create output folder"""
    print("\n" + "=" * 50)
    print("Testing output folder...")
    print("=" * 50)
    
    try:
        import os
        
        folder = "interrogations"
        if not os.path.exists(folder):
            os.makedirs(folder)
            print(f"Created folder: {folder}")
        else:
            print(f"Folder exists: {folder}")
        
        # Test write permission
        test_file = os.path.join(folder, "test.txt")
        with open(test_file, 'w') as f:
            f.write("test")
        os.remove(test_file)
        print("Write permission OK")
        
        return True
    except Exception as e:
        print(f"Error: {e}")
        return False


def run_all_tests():
    """Run all tests"""
    print("\n")
    print("╔" + "=" * 48 + "╗")
    print("║" + " " * 10 + "LIE DETECTOR SYSTEM TEST" + " " * 14 + "║")
    print("╚" + "=" * 48 + "╝")
    
    tests = [
        ("Imports", test_imports),
        ("Camera", test_camera),
        ("MediaPipe", test_mediapipe),
        ("FER", test_fer),
        ("Files", test_files),
        ("Output", test_output_folder)
    ]
    
    results = {}
    
    for name, test_func in tests:
        try:
            results[name] = test_func()
        except Exception as e:
            print(f"\n{name} test failed with exception: {e}")
            results[name] = False
    
    # Summary
    print("\n" + "=" * 50)
    print("TEST SUMMARY")
    print("=" * 50)
    
    passed = sum(results.values())
    total = len(results)
    
    for name, result in results.items():
        status = "PASS" if result else "FAIL"
        print(f"{name:15} {status}")
    
    print("\n" + "=" * 50)
    print(f"Result: {passed}/{total} tests passed")
    print("=" * 50)
    
    if passed == total:
        print("\n🎉 All tests passed! System is ready to use.")
        print("Run 'python main.py' to start the application.")
        return 0
    else:
        print("\nSome tests failed. Please fix the issues above.")
        print("Check README.md for troubleshooting tips.")
        return 1


if __name__ == "__main__":
    exit_code = run_all_tests()
    sys.exit(exit_code)