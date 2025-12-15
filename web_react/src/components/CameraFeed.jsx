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

export default function CameraFeed({ sessionId, calibrated, onMetricsUpdate, onVideoRecorded, onRecorderReady }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [error, setError] = useState(null);
  const [streamActive, setStreamActive] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(true);
  const faceMeshRef = useRef(null);
  const handsRef = useRef(null);
  const cameraRef = useRef(null);
  const resultsRef = useRef({ face: null, hands: null });
  const modelsReady = useRef({ faceMesh: false, hands: false });
  const drawingRef = useRef(false); // Prevent concurrent drawing
  
  // MediaRecorder for video recording
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const [isRecording, setIsRecording] = useState(false);
  
  // Metrics tracking
  const blinksBuffer = useRef([]);
  const handToFaceBuffer = useRef([]);
  const gazeBuffer = useRef([]);
  const frameCountRef = useRef(0);

  useEffect(() => {
    let currentStream = null;

    const initializeMediaPipe = async () => {
      try {
        console.log('🔧 Initializing MediaPipe models...');
        setModelsLoading(true);
        
        // Prevent double initialization in React StrictMode
        if (faceMeshRef.current || handsRef.current) {
          console.log('⚠️ MediaPipe already initialized, skipping...');
          setModelsLoading(false);
          return true;
        }
        
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
          if (!modelsReady.current.faceMesh) {
            console.log('✅ FaceMesh ready');
            modelsReady.current.faceMesh = true;
          }
          // Request draw on next animation frame (throttled)
          if (!drawingRef.current) {
            drawingRef.current = true;
            requestAnimationFrame(() => {
              drawResults();
              drawingRef.current = false;
            });
          }
        });
        
        faceMeshRef.current = faceMesh;
        console.log('✅ FaceMesh created');

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
          if (!modelsReady.current.hands) {
            console.log('✅ Hands ready');
            modelsReady.current.hands = true;
          }
          // Request draw on next animation frame (throttled)
          if (!drawingRef.current) {
            drawingRef.current = true;
            requestAnimationFrame(() => {
              drawResults();
              drawingRef.current = false;
            });
          }
        });
        
        handsRef.current = hands;
        console.log('✅ Hands created');

        // Wait for WASM modules to load
        console.log('⏳ Loading MediaPipe WASM modules...');
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        console.log('✅ All MediaPipe models ready!');
        setModelsLoading(false);
        
        return true;
      } catch (err) {
        console.error('MediaPipe initialization error:', err);
        setError('Failed to initialize MediaPipe. Please refresh the page.');
        setModelsLoading(false);
        return false;
      }
    };

    const startCamera = async () => {
      try {
        // First, initialize MediaPipe models
        const modelsInitialized = await initializeMediaPipe();
        if (!modelsInitialized) {
          return;
        }
        
        // Then access camera
        console.log('📷 Opening camera...');
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { 
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: "user"
          }, 
          audio: true // Enable audio for better MediaRecorder compatibility
        });

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          currentStream = stream;
          setStreamActive(true);
          
          // Wait for video to be ready, then start MediaPipe processing
          videoRef.current.onloadedmetadata = () => {
            console.log('📹 Video stream ready');
            startMediaPipeProcessing();
            
            // Setup MediaRecorder after canvas is ready
            setTimeout(() => {
              if (canvasRef.current) {
                try {
                  // Capture stream from canvas (with landmarks)
                  const canvasStream = canvasRef.current.captureStream(30); // 30 fps
                  
                  // Add audio from original stream
                  const audioTracks = stream.getAudioTracks();
                  if (audioTracks.length > 0) {
                    canvasStream.addTrack(audioTracks[0]);
                  }
                  
                  const options = { mimeType: 'video/webm;codecs=vp9,opus' };
                  const mediaRecorder = new MediaRecorder(canvasStream, options);
                  
                  mediaRecorder.ondataavailable = (event) => {
                    if (event.data.size > 0) {
                      recordedChunksRef.current.push(event.data);
                    }
                  };
                  
                  mediaRecorder.onstop = () => {
                    const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
                    console.log('📹 Recording stopped, blob size:', blob.size);
                    if (onVideoRecorded) {
                      onVideoRecorded(blob);
                    }
                    recordedChunksRef.current = [];
                  };
                  
                  mediaRecorderRef.current = mediaRecorder;
                  console.log('✅ MediaRecorder initialized (from canvas with landmarks)');
                  
                  // Notify parent component
                  if (onRecorderReady) {
                    onRecorderReady(mediaRecorder);
                  }
                } catch (err) {
                  console.error('MediaRecorder initialization error:', err);
                }
              }
            }, 2000); // Wait 2s for canvas to be ready
          };
        }
      } catch (err) {
        console.error("Camera error:", err);
        setError("Cannot access camera. Please allow camera permission!");
        setModelsLoading(false);
      }
    };

    const startMediaPipeProcessing = () => {
      // Start camera processing with MediaPipe
      if (videoRef.current && faceMeshRef.current && handsRef.current) {
        const camera = new Camera(videoRef.current, {
          onFrame: async () => {
            // Only send frames after models are ready
            if (faceMeshRef.current && handsRef.current && videoRef.current) {
              try {
                await faceMeshRef.current.send({ image: videoRef.current });
                await handsRef.current.send({ image: videoRef.current });
              } catch (err) {
                // Silently handle errors during processing
                if (!modelsReady.current.faceMesh || !modelsReady.current.hands) {
                  return;
                }
                console.error('Frame processing error:', err);
              }
            }
          },
          width: 1280,
          height: 720
        });
        
        console.log('🎥 Starting MediaPipe camera processing...');
        camera.start();
        cameraRef.current = camera;
      }
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
      
      // Blink detection
      if (resultsRef.current.face && resultsRef.current.face.multiFaceLandmarks) {
        const landmarks = resultsRef.current.face.multiFaceLandmarks[0];
        blink = isBlinking(landmarks);
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
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      if (currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
      }
      if (cameraRef.current) {
        cameraRef.current.stop();
      }
      
      // Clear canvas
      if (canvasRef.current) {
        const ctx = canvasRef.current.getContext('2d');
        ctx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
      
      // Clear video source
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      
      // Clean up MediaPipe instances
      if (faceMeshRef.current) {
        faceMeshRef.current.close();
        faceMeshRef.current = null;
      }
      if (handsRef.current) {
        handsRef.current.close();
        handsRef.current = null;
      }
      modelsReady.current = { faceMesh: false, hands: false };
    };
  }, []);
  
  // Start/stop recording based on calibration status
  useEffect(() => {
    if (calibrated && mediaRecorderRef.current && mediaRecorderRef.current.state === 'inactive') {
      try {
        recordedChunksRef.current = [];
        mediaRecorderRef.current.start();
        setIsRecording(true);
        console.log('🎥 MediaRecorder started recording');
      } catch (err) {
        console.error('Failed to start recording:', err);
      }
    }
  }, [calibrated]);

  return (
    <div className="camera-feed-container bg-gray-800 rounded-lg overflow-hidden">
      <div className="aspect-video bg-gray-700 relative">
        {error && (
          <div className="absolute top-2 left-2 right-2 text-red-400 text-xs bg-red-900/80 p-2 rounded z-10">
            {error}
          </div>
        )}

        {modelsLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900/80 z-20">
            <div className="text-center">
              <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
              <div className="text-gray-300 text-sm font-semibold mb-2">
                Loading MediaPipe Models...
              </div>
              <div className="text-gray-400 text-xs">
                Please wait while we initialize face and hand detection
              </div>
            </div>
          </div>
        )}

        {!streamActive && !error && !modelsLoading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-gray-500 text-sm animate-pulse">
              Opening camera...
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
        {streamActive && !modelsLoading && (
          <div className="absolute bottom-2 left-2 text-xs text-gray-300 bg-black/50 px-2 py-1 rounded z-10">
            <span className={calibrated ? 'text-green-400' : 'text-yellow-400'}>
              {calibrated ? '● ANALYZING' : '● CALIBRATING'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}