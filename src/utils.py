import tkinter as tk
from tkinter import filedialog
import os


def get_video_file():
    """
    Open file dialog to select a video file
    Returns path to selected video file or None
    """
    # Hide the root tkinter window
    root = tk.Tk()
    root.withdraw()
    root.attributes('-topmost', True)
    
    # File dialog
    file_path = filedialog.askopenfilename(
        title="Select Video File",
        filetypes=[
            ("Video files", "*.mp4 *.avi *.mov *.mkv *.flv *.wmv"),
            ("MP4 files", "*.mp4"),
            ("AVI files", "*.avi"),
            ("All files", "*.*")
        ]
    )
    
    root.destroy()
    
    if file_path and os.path.exists(file_path):
        print(f"Selected: {file_path}")
        return file_path
    else:
        print("No file selected")
        return None


def format_timestamp(seconds):
    """
    Convert seconds to MM:SS format
    
    Args:
        seconds: Time in seconds
        
    Returns:
        String in MM:SS format
    """
    mins = int(seconds // 60)
    secs = int(seconds % 60)
    return f"{mins:02d}:{secs:02d}"


def get_video_info(video_path):
    """
    Get information about a video file
    
    Args:
        video_path: Path to video file
        
    Returns:
        Dictionary with video info (fps, width, height, frame_count, duration)
    """
    import cv2
    
    cap = cv2.VideoCapture(video_path)
    
    info = {
        'fps': cap.get(cv2.CAP_PROP_FPS),
        'width': int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
        'height': int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),
        'frame_count': int(cap.get(cv2.CAP_PROP_FRAME_COUNT)),
        'duration': 0
    }
    
    if info['fps'] > 0:
        info['duration'] = info['frame_count'] / info['fps']
    
    cap.release()
    
    return info


def create_output_folder(base_name="interrogations"):
    """
    Create output folder for recordings if it doesn't exist
    
    Args:
        base_name: Base name for the folder
        
    Returns:
        Path to the created folder
    """
    if not os.path.exists(base_name):
        os.makedirs(base_name)
        print(f"Created folder: {base_name}")
    return base_name


def save_session_metadata(filename, metadata):
    """
    Save session metadata to a text file
    
    Args:
        filename: Path to the video file
        metadata: Dictionary containing session data
    """
    txt_filename = filename.replace('.avi', '_metadata.txt')
    
    with open(txt_filename, 'w') as f:
        f.write("=" * 50 + "\n")
        f.write("LIE DETECTOR SESSION METADATA\n")
        f.write("=" * 50 + "\n\n")
        
        for key, value in metadata.items():
            f.write(f"{key}: {value}\n")
        
        f.write("\n" + "=" * 50 + "\n")
    
    print(f"Metadata saved to: {txt_filename}")


def get_available_cameras():
    """
    Get list of available camera indices
    
    Returns:
        List of available camera indices
    """
    import cv2
    
    available = []
    for i in range(10):  # Check first 10 indices
        cap = cv2.VideoCapture(i)
        if cap.isOpened():
            available.append(i)
            cap.release()
    
    return available