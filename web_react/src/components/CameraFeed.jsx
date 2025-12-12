import React, { useEffect, useRef, useState } from 'react';
import { FaceMesh } from '@mediapipe/face_mesh';
import { Hands } from '@mediapipe/hands';
import { Camera } from '@mediapipe/camera_utils';
import { drawConnectors, drawLandmarks } from '@mediapipe/drawing_utils';
import { FACEMESH_TESSELATION, FACEMESH_RIGHT_EYE, FACEMESH_LEFT_EYE, FACEMESH_FACE_OVAL, FACEMESH_LIPS } from '@mediapipe/face_mesh';
import { HAND_CONNECTIONS } from '@mediapipe/hands';

// Constants for detection
const EYE_BLINK_THRESHOLD = 0.15;
const MAX_FRAMES = 120; // 4 seconds at 30fps
const HAND_FACE_DISTANCE_THRESHOLD = 0.05;

export default function CameraFeed({ sessionId, calibrated, onMetricsUpdate, onVideoRecorded, shouldStopRecording }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [error, setError] = useState(null);
  const [streamActive, setStreamActive] = useState(false);
  const faceMeshRef = useRef(null);
  const handsRef = useRef(null);
  const cameraRef = useRef(null);
  const resultsRef = useRef({ face: null, hands: null });
  const modelsReady = useRef({ faceMesh: false, hands: false });
  const initializingRef = useRef(false); // Prevent double initialization
  
  // Video recording
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const [recordingStopped, setRecordingStopped] = useState(false);
  
  // Metrics tracking
  const blinksBuffer = useRef([]);
  const handToFaceBuffer = useRef([]);
  const gazeBuffer = useRef([]);
  const frameCountRef = useRef(0);
  
  // Event alerts tracking for video overlay
  const [activeAlerts, setActiveAlerts] = useState([]);
  const alertHistoryRef = useRef([]);

  // Effect to stop recording when requested
  useEffect(() => {
    if (shouldStopRecording && mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      console.log('⏹️ Stopping recording on request...');
      const recorder = mediaRecorderRef.current;
      
      // Request final data before stopping
      if (recorder.state === 'recording') {
        recorder.requestData(); // Flush any remaining data
        setTimeout(() => {
          recorder.stop();
          setRecordingStopped(true);
        }, 100); // Small delay to ensure data is collected
      } else {
        recorder.stop();
        setRecordingStopped(true);
      }
    }
  }, [shouldStopRecording]);

  useEffect(() => {
    let currentStream = null;

    const startCamera = async () => {
      // Prevent double initialization
      if (initializingRef.current) {
        console.log('⏸️ Already initializing, skipping...');
        return;
      }
      initializingRef.current = true;
      
      try {
        console.log('🚀 Starting camera initialization...');
        // Truy cập camera trực tiếp từ browser
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { 
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: "user"
          }, 
          audio: false 
        });

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          currentStream = stream;
          setStreamActive(true);
          
          // Start continuous drawing loop for video
          videoRef.current.onloadedmetadata = () => {
            startDrawingLoop();
            // Start recording canvas immediately when video is ready
            setTimeout(() => {
              if (canvasRef.current && !mediaRecorderRef.current) {
                startRecording();
              }
            }, 500); // Reduced from 1000ms
          };
          
          // Initialize MediaPipe FaceMesh and Hands (only once)
          if (!faceMeshRef.current && !handsRef.current) {
            initializeMediaPipe();
          }
        }
      } catch (err) {
        console.error("Camera error:", err);
        setError("Cannot access camera. Please allow camera permission!");
        initializingRef.current = false; // Reset on error
      }
    };

    const startRecording = () => {
      try {
        // Record canvas stream (includes video + landmarks + alerts)
        if (!canvasRef.current) {
          console.error('❌ Canvas not ready for recording');
          return;
        }
        
        const canvasStream = canvasRef.current.captureStream(30); // 30 FPS
        
        // Try codecs in order - VP9/VP8 are better for browser playback
        const codecOptions = [
          'video/webm;codecs=vp9',        // WebM VP9 - best quality + playback
          'video/webm;codecs=vp8',        // WebM VP8 - good compatibility
          'video/webm;codecs=vp9,opus',   // VP9 with audio support
          'video/webm;codecs=vp8,opus',   // VP8 with audio support
          'video/mp4;codecs=avc1.42E01E', // MP4 fallback
          'video/webm',                   // Generic WebM
          'video/mp4'                     // Generic MP4
        ];
        
        let selectedOptions = { mimeType: 'video/webm' };
        let selectedExtension = 'webm'; // WebM is better for browser playback
        
        for (const codec of codecOptions) {
          if (MediaRecorder.isTypeSupported(codec)) {
            selectedOptions.mimeType = codec;
            // Use WebM extension for WebM codecs, MP4 for MP4 codecs
            selectedExtension = codec.startsWith('video/mp4') ? 'mp4' : 'webm';
            console.log('🎬 Recording canvas with codec:', codec, '→', selectedExtension);
            break;
          }
        }
        
        const mediaRecorder = new MediaRecorder(canvasStream, selectedOptions);
        recordedChunksRef.current = [];
        
        // Store extension for later use
        mediaRecorder.fileExtension = selectedExtension;
        
        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            recordedChunksRef.current.push(event.data);
          }
        };
        
        mediaRecorder.onstop = () => {
          // Use correct MIME type and extension
          const mimeType = mediaRecorder.mimeType || selectedOptions.mimeType;
          const extension = mediaRecorder.fileExtension || selectedExtension;
          const blob = new Blob(recordedChunksRef.current, { type: mimeType });
          
          // Add extension property to blob for filename
          blob.fileExtension = extension;
          
          console.log(`🎬 Canvas recording stopped: ${blob.size} bytes, ${mimeType} (${extension})`);
          console.log(`📊 Recorded ${alertHistoryRef.current.length} alert events`);
          if (onVideoRecorded && blob.size > 0) {
            onVideoRecorded(blob);
          } else {
            console.warn('⚠️ Video blob is empty!');
          }
        };
        
        mediaRecorder.onerror = (event) => {
          console.error('❌ MediaRecorder error:', event.error);
        };
        
        mediaRecorder.start(100); // Collect data every 100ms for smoother recording
        mediaRecorderRef.current = mediaRecorder;
        console.log('🔴 Recording started with', selectedOptions.mimeType);
      } catch (err) {
        console.error('Failed to start recording:', err);
      }
    };

    const initializeMediaPipe = async () => {
      try {
        console.log('🔧 Initializing MediaPipe models...');
        
        // Initialize FaceMesh
        const faceMesh = new FaceMesh({
          locateFile: (file) => {
            return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`;
          }
        });

        faceMesh.setOptions({
          maxNumFaces: 1,
          refineLandmarks: true,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5
        });

        faceMesh.onResults((results) => {
          resultsRef.current.face = results;
          // Mark model as ready on first results
          if (!modelsReady.current.faceMesh) {
            console.log('✅ FaceMesh initialized and ready');
            modelsReady.current.faceMesh = true;
            checkAllModelsReady();
          }
        });
        faceMeshRef.current = faceMesh;

        // Initialize Hands
        const hands = new Hands({
          locateFile: (file) => {
            return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
          }
        });

        hands.setOptions({
          maxNumHands: 2,
          modelComplexity: 1,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5
        });

        hands.onResults((results) => {
          resultsRef.current.hands = results;
          // Mark model as ready on first results
          if (!modelsReady.current.hands) {
            console.log('✅ Hands initialized and ready');
            modelsReady.current.hands = true;
            checkAllModelsReady();
          }
        });
        handsRef.current = hands;
        
        // Helper function to check if all models are ready
        const checkAllModelsReady = () => {
          if (modelsReady.current.faceMesh && modelsReady.current.hands) {
            console.log('🎉 All MediaPipe models ready!');
          }
        };

        // Start camera processing immediately (no wait)
        // Models will initialize in background
        if (videoRef.current) {
          const camera = new Camera(videoRef.current, {
            onFrame: async () => {
              // Only send frames after models are initialized
              if (faceMeshRef.current && handsRef.current && videoRef.current) {
                try {
                  await faceMeshRef.current.send({ image: videoRef.current });
                  await handsRef.current.send({ image: videoRef.current });
                } catch (err) {
                  // Silently handle initialization errors
                  if (!modelsReady.current.faceMesh || !modelsReady.current.hands) {
                    // Still initializing, suppress errors
                    return;
                  }
                  console.error('Frame processing error:', err);
                }
              }
            },
            width: 1280,
            height: 720
          });
          
          console.log('🎥 Starting MediaPipe camera feed...');
          camera.start();
          cameraRef.current = camera;
        }
      } catch (err) {
        console.error('❌ MediaPipe initialization error:', err);
        setError('Failed to initialize MediaPipe. Please refresh the page.');
        initializingRef.current = false; // Reset on error
      }
    };

    // Continuous drawing loop for video + landmarks
    const startDrawingLoop = () => {
      const draw = () => {
        if (videoRef.current && canvasRef.current && videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA) {
          drawResults();
        }
        requestAnimationFrame(draw);
      };
      draw();
    };

    // Helper: Calculate eye aspect ratio
    const getEyeAspectRatio = (landmarks, eyePoints) => {
      const vertical1 = Math.hypot(
        landmarks[eyePoints[1]].x - landmarks[eyePoints[3]].x,
        landmarks[eyePoints[1]].y - landmarks[eyePoints[3]].y
      );
      const vertical2 = Math.hypot(
        landmarks[eyePoints[2]].x - landmarks[eyePoints[0]].x,
        landmarks[eyePoints[2]].y - landmarks[eyePoints[0]].y
      );
      const horizontal = Math.hypot(
        landmarks[eyePoints[0]].x - landmarks[eyePoints[3]].x,
        landmarks[eyePoints[0]].y - landmarks[eyePoints[3]].y
      );
      return (vertical1 + vertical2) / (2.0 * horizontal);
    };

    // Helper: Check if blinking
    const isBlinking = (landmarks) => {
      // Right eye: 159, 145, 133, 33
      const rightEAR = getEyeAspectRatio(landmarks, [159, 145, 133, 33]);
      // Left eye: 386, 374, 362, 263
      const leftEAR = getEyeAspectRatio(landmarks, [386, 374, 362, 263]);
      const avgEAR = (rightEAR + leftEAR) / 2;
      return avgEAR < EYE_BLINK_THRESHOLD;
    };

    // Helper: Check hand-to-face contact
    const checkHandToFace = (handLandmarks, faceLandmarks) => {
      if (!handLandmarks || !faceLandmarks) return false;
      
      // Check key finger points (thumb tip=4, index tip=8, pinky tip=20)
      const fingerTips = [4, 8, 20];
      
      // Get face bounding region from FACEMESH_FACE_OVAL
      const facePoints = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288,
                          397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
                          172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
      
      for (const handLandmark of handLandmarks) {
        for (const fingerIdx of fingerTips) {
          const finger = handLandmark[fingerIdx];
          
          // Check distance to any face point
          for (const faceIdx of facePoints) {
            const facePoint = faceLandmarks[faceIdx];
            const distance = Math.hypot(
              finger.x - facePoint.x,
              finger.y - facePoint.y
            );
            
            if (distance < HAND_FACE_DISTANCE_THRESHOLD) {
              return true;
            }
          }
        }
      }
      return false;
    };

    // Calculate metrics from current landmarks
    const calculateMetrics = () => {
      frameCountRef.current++;
      
      let blink = false;
      let handToFace = false;
      const newAlerts = [];
      
      // Blink detection
      if (resultsRef.current.face && resultsRef.current.face.multiFaceLandmarks) {
        const landmarks = resultsRef.current.face.multiFaceLandmarks[0];
        blink = isBlinking(landmarks);
        
        if (blink) {
          newAlerts.push({
            type: 'blink',
            message: '👁️ Rapid Blinking',
            color: '#FFA500',
            timestamp: Date.now()
          });
        }
      }
      
      // Hand-to-face detection
      if (resultsRef.current.face && resultsRef.current.hands &&
          resultsRef.current.face.multiFaceLandmarks &&
          resultsRef.current.hands.multiHandLandmarks) {
        const faceLandmarks = resultsRef.current.face.multiFaceLandmarks[0];
        handToFace = checkHandToFace(
          resultsRef.current.hands.multiHandLandmarks,
          faceLandmarks
        );
        
        if (handToFace) {
          newAlerts.push({
            type: 'hand-to-face',
            message: '✋ Hand Near Face',
            color: '#FF6B6B',
            timestamp: Date.now()
          });
        }
      }
      
      // Update active alerts
      if (newAlerts.length > 0) {
        setActiveAlerts(newAlerts);
        alertHistoryRef.current.push(...newAlerts);
        
        // Keep history reasonable size
        if (alertHistoryRef.current.length > 1000) {
          alertHistoryRef.current = alertHistoryRef.current.slice(-500);
        }
      } else {
        setActiveAlerts([]);
      }
      
      // Update buffers
      blinksBuffer.current.push(blink);
      handToFaceBuffer.current.push(handToFace);
      
      // Keep buffer size limited
      if (blinksBuffer.current.length > MAX_FRAMES) {
        blinksBuffer.current.shift();
      }
      if (handToFaceBuffer.current.length > MAX_FRAMES) {
        handToFaceBuffer.current.shift();
      }
      
      // Calculate and emit metrics every 30 frames (1 second at 30fps)
      if (frameCountRef.current % 30 === 0 && onMetricsUpdate) {
        const blinkCount = blinksBuffer.current.filter(b => b).length;
        const handToFaceCount = handToFaceBuffer.current.filter(h => h).length;
        
        // Calculate per minute rates
        const secondsRecorded = blinksBuffer.current.length / 30;
        const blinkRate = secondsRecorded > 0 ? (blinkCount / secondsRecorded) * 60 : 0;
        const handToFaceFreq = secondsRecorded > 0 ? (handToFaceCount / secondsRecorded) * 60 : 0;
        
        onMetricsUpdate({
          blinkRate: Math.round(blinkRate),
          handToFaceFrequency: Math.round(handToFaceFreq * 10) / 10,
          currentBlink: blink,
          currentHandToFace: handToFace,
          frameCount: frameCountRef.current
        });
      }
    };

    // Draw alerts overlay on canvas
    const drawAlerts = (ctx, width, height) => {
      if (activeAlerts.length === 0) return;
      
      ctx.save();
      
      // Polyfill for roundRect if not supported
      if (!ctx.roundRect) {
        ctx.roundRect = function(x, y, w, h, r) {
          this.beginPath();
          this.moveTo(x + r, y);
          this.lineTo(x + w - r, y);
          this.quadraticCurveTo(x + w, y, x + w, y + r);
          this.lineTo(x + w, y + h - r);
          this.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
          this.lineTo(x + r, y + h);
          this.quadraticCurveTo(x, y + h, x, y + h - r);
          this.lineTo(x, y + r);
          this.quadraticCurveTo(x, y, x + r, y);
          this.closePath();
        };
      }
      
      // Draw each alert
      activeAlerts.forEach((alert, index) => {
        const y = 50 + (index * 40);
        const x = 20;
        
        // Draw alert background
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.roundRect(x, y, 250, 35, 8);
        ctx.fill();
        
        // Draw alert border
        ctx.strokeStyle = alert.color;
        ctx.lineWidth = 2;
        ctx.roundRect(x, y, 250, 35, 8);
        ctx.stroke();
        
        // Draw alert text
        ctx.fillStyle = alert.color;
        ctx.font = 'bold 16px Arial';
        ctx.textBaseline = 'middle';
        ctx.fillText(alert.message, x + 10, y + 17);
        
        // Draw pulse animation
        const age = Date.now() - alert.timestamp;
        if (age < 500) {
          const opacity = 1 - (age / 500);
          ctx.fillStyle = `rgba(255, 255, 255, ${opacity * 0.3})`;
          ctx.roundRect(x - 5, y - 5, 260, 45, 10);
          ctx.fill();
        }
      });
      
      ctx.restore();
    };

    const drawResults = () => {
      if (!canvasRef.current || !videoRef.current) return;

      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      
      // Set canvas size to match video
      if (canvas.width !== videoRef.current.videoWidth || canvas.height !== videoRef.current.videoHeight) {
        canvas.width = videoRef.current.videoWidth;
        canvas.height = videoRef.current.videoHeight;
      }

      // Save context state
      ctx.save();
      
      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // IMPORTANT: Always draw video first (background)
      if (videoRef.current.videoWidth > 0) {
        ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
      }

      // Draw face landmarks
      if (resultsRef.current.face && resultsRef.current.face.multiFaceLandmarks) {
        for (const landmarks of resultsRef.current.face.multiFaceLandmarks) {
          // Draw face mesh tesselation (lưới khuôn mặt)
          drawConnectors(ctx, landmarks, FACEMESH_TESSELATION, {
            color: '#C0C0C070',
            lineWidth: 0.5
          });
          
          // Draw face oval (đường viền mặt)
          drawConnectors(ctx, landmarks, FACEMESH_FACE_OVAL, {
            color: '#E0E0E0',
            lineWidth: 1
          });
          
          // Draw eyes (mắt)
          drawConnectors(ctx, landmarks, FACEMESH_RIGHT_EYE, {
            color: '#FF3030',
            lineWidth: 1
          });
          drawConnectors(ctx, landmarks, FACEMESH_LEFT_EYE, {
            color: '#30FF30',
            lineWidth: 1
          });
          
          // Draw lips (môi)
          drawConnectors(ctx, landmarks, FACEMESH_LIPS, {
            color: '#E0E0E0',
            lineWidth: 1
          });
        }
      }

      // Draw hand landmarks
      if (resultsRef.current.hands && resultsRef.current.hands.multiHandLandmarks) {
        for (const landmarks of resultsRef.current.hands.multiHandLandmarks) {
          // Draw hand connections (đường nối ngón tay)
          drawConnectors(ctx, landmarks, HAND_CONNECTIONS, {
            color: '#00FF00',
            lineWidth: 2
          });
          
          // Draw hand landmarks (các điểm trên bàn tay)
          drawLandmarks(ctx, landmarks, {
            color: '#FF0000',
            lineWidth: 1,
            radius: 3
          });
        }
      }
      
      // Draw event alerts overlay
      drawAlerts(ctx, canvas.width, canvas.height);
      
      // Restore context state
      ctx.restore();
      
      // Calculate metrics from landmarks (with error handling)
      try {
        if (modelsReady.current.faceMesh && modelsReady.current.hands) {
          calculateMetrics();
        }
      } catch (err) {
        console.error('Error calculating metrics:', err);
      }
    };

    startCamera();

    return () => {
      console.log('🧹 Cleaning up camera and MediaPipe...');
      // Stop recording
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      // Stop camera
      if (currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
      }
      if (cameraRef.current) {
        cameraRef.current.stop();
      }
      // Close MediaPipe models
      if (faceMeshRef.current) {
        faceMeshRef.current.close();
      }
      if (handsRef.current) {
        handsRef.current.close();
      }
      // Reset initialization flag
      initializingRef.current = false;
      modelsReady.current = { faceMesh: false, hands: false };
    };
  }, []);

  return (
    <div className="camera-feed-container bg-gray-800 rounded-lg overflow-hidden">
      <div className="aspect-video bg-gray-700 relative">
        {error && (
          <div className="absolute top-2 left-2 right-2 text-red-400 text-xs bg-red-900/80 p-2 rounded z-10">
            {error}
          </div>
        )}

        {!streamActive && !error && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-gray-500 text-sm animate-pulse">
              📷 Accessing camera...
            </div>
          </div>
        )}

        {/* Video element - direct camera feed (hidden, used for processing) */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="hidden"
        />

        {/* Canvas overlay - displays video + landmarks */}
        <canvas
          ref={canvasRef}
          className="w-full h-full object-cover transform scale-x-[-1]"
        />

        {/* Status overlay */}
        <div className="absolute bottom-2 left-2 text-xs text-gray-300 bg-black/50 px-2 py-1 rounded z-10">
          <span className={calibrated ? 'text-green-400' : 'text-yellow-400'}>
            {calibrated ? '● ANALYZING' : '● CALIBRATING'}
          </span>
        </div>
      </div>
    </div>
  );
}