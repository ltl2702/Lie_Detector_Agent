import cv2
import sys
from pathlib import Path

def convert_to_web_format(input_file):
    """Convert video to web-compatible H.264 format"""
    input_path = Path(input_file)
    if not input_path.exists():
        print(f"❌ File not found: {input_file}")
        return False
    
    output_file = str(input_path).replace('.mp4', '_web.mp4')
    
    print(f"🎬 Converting: {input_file}")
    print(f"📁 Output: {output_file}")
    
    # Open input video
    cap = cv2.VideoCapture(input_file)
    if not cap.isOpened():
        print(f"❌ Failed to open video")
        return False
    
    # Get video properties
    fps = cap.get(cv2.CAP_PROP_FPS)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    
    print(f"📊 FPS: {fps}, Size: {width}x{height}, Frames: {total_frames}")
    
    # Try different codecs for web compatibility
    codecs_to_try = [
        ('X264', 'H.264/X264'),
        ('avc1', 'H.264/AVC1'),
        ('H264', 'H.264'),
        ('mp4v', 'MPEG-4')
    ]
    
    out = None
    used_codec = None
    
    for codec_name, codec_desc in codecs_to_try:
        try:
            fourcc = cv2.VideoWriter_fourcc(*codec_name)
            out = cv2.VideoWriter(output_file, fourcc, fps, (width, height))
            if out.isOpened():
                print(f"✅ Using codec: {codec_desc}")
                used_codec = codec_name
                break
            else:
                print(f"⚠️ {codec_desc} not available")
        except:
            print(f"⚠️ {codec_desc} failed")
    
    if not out or not out.isOpened():
        print(f"❌ Failed to create output video writer with any codec")
        cap.release()
        return False
    
    print("⏳ Converting...")
    frame_count = 0
    
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        
        out.write(frame)
        frame_count += 1
        
        if frame_count % 100 == 0:
            progress = (frame_count / total_frames) * 100 if total_frames > 0 else 0
            print(f"   {frame_count}/{total_frames} frames ({progress:.1f}%)")
    
    cap.release()
    out.release()
    
    print(f"✅ Conversion complete!")
    print(f"📁 Saved to: {output_file}")
    print(f"📊 Total frames processed: {frame_count}")
    
    return True

if __name__ == "__main__":
    if len(sys.argv) < 2:
        # Convert the latest video
        input_file = r"D:\Lie_Detector_Agent\recordings\interrogation_2025-12-11_23-13.mp4"
    else:
        input_file = sys.argv[1]
    
    convert_to_web_format(input_file)
