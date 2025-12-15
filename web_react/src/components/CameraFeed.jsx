import React, { useEffect, useRef, useState } from "react";
import { FaceMesh } from "@mediapipe/face_mesh";
import { Hands } from "@mediapipe/hands";
import { Camera } from "@mediapipe/camera_utils";
import { drawConnectors, drawLandmarks } from "@mediapipe/drawing_utils";
import {
  FACEMESH_TESSELATION,
  FACEMESH_RIGHT_EYE,
  FACEMESH_LEFT_EYE,
  FACEMESH_FACE_OVAL,
  FACEMESH_LIPS,
} from "@mediapipe/face_mesh";
import { HAND_CONNECTIONS } from "@mediapipe/hands";
import { pipeline } from "@xenova/transformers";

const EMOTION_MAP = {
  joy: "happy",
  sadness: "sad",
  anger: "angry",
  fear: "fear",
  surprise: "surprise",
  disgust: "disgust",
  neutral: "neutral",
};

// Constants for detection
const EYE_BLINK_THRESHOLD = 0.42; // Eye Aspect Ratio threshold
const MAX_FRAMES = 120; // 4 seconds at 30fps
const HAND_FACE_DISTANCE_THRESHOLD = 0.08;

export default function CameraFeed({
  sessionId,
  calibrated,
  onMetricsUpdate,
  onVideoRecorded,
  onRecorderReady,
  onModelsLoaded,
}) {
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
  // Ref cho AI Model
  const classifierRef = useRef(null);
  const [modelLoading, setModelLoading] = useState(true);

  // MediaRecorder for video recording
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const [isRecording, setIsRecording] = useState(false);

  // THÊM REF MỚI ĐỂ LƯU KẾT QUẢ EMOTION GẦN NHẤT
  const latestEmotionRef = useRef({
    emotionData: {
      angry: 0,
      disgust: 0,
      fear: 0,
      happy: 0,
      sad: 0,
      surprise: 0,
      neutral: 100,
    },
    dominantEmotion: "neutral",
    emotionConfidence: 0,
  });

  const lastAnalysisTime = useRef(0); // Để throttle (không chạy mỗi frame)
  // THÊM CÁC REF ĐỂ THEO DÕI TRẠNG THÁI CŨ (để phát hiện thay đổi)
  const prevBlinkState = useRef(false);
  const prevHandState = useRef(false);

  // Ref để đếm tổng số lần (Count) thay vì Buffer frame
  const totalBlinks = useRef(0);
  const totalHandTouches = useRef(0);
  // 1. Ref để chứa danh sách thời điểm chớp mắt (dùng cho Sliding Window)
  const blinkTimestamps = useRef([]);
  // 2. Dùng cho Count: Đếm số lần trong chu kỳ 60s hiện tại
  const currentCycleBlinks = useRef(0);
  const cycleStartTime = useRef(Date.now()); // Mốc thời gian bắt đầu chu kỳ 60s

  // 3. Logic phát hiện (Debounce/Edge detection)
  const isBlinkingRef = useRef(false);

  const lastBlinkTime = useRef(0);
  const lastHandTouchTime = useRef(0);

  // Metrics tracking
  const blinksBuffer = useRef([]);
  const handToFaceBuffer = useRef([]);
  const gazeBuffer = useRef([]);
  const frameCountRef = useRef(0);
  // Hàm tính khoảng cách giữa 2 điểm (Euclidean distance)
  const getDistance = (p1, p2) => {
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
  };
  // Tính toán Lip Compression (Mím môi)
  // Dựa trên logic Python: get_aspect_ratio(face[0], face[17], face[61], face[291])
  const calculateLipRatio = (landmarks) => {
    const top = landmarks[0]; // Môi trên
    const bottom = landmarks[17]; // Môi dưới
    const left = landmarks[61]; // Khóe miệng trái
    const right = landmarks[291]; // Khóe miệng phải

    const height = getDistance(top, bottom);
    const width = getDistance(left, right);

    // Tránh chia cho 0
    if (width === 0) return 0;
    return height / width;
  };

  // Tính toán Eye Gaze (Hướng nhìn)
  // Dựa trên logic Python: so sánh tâm mống mắt với tâm mắt
  const calculateGazeShift = (landmarks) => {
    // Landmarks mắt phải (Right Eye)
    const rightIris = {
      x: (landmarks[471].x + landmarks[469].x) / 2,
      y: (landmarks[471].y + landmarks[469].y) / 2,
    };
    const rightEyeCenter = {
      x: (landmarks[33].x + landmarks[133].x) / 2,
      y: (landmarks[33].y + landmarks[133].y) / 2,
    };
    const rightEyeWidth = Math.abs(landmarks[33].x - landmarks[133].x);

    // Landmarks mắt trái (Left Eye)
    const leftIris = {
      x: (landmarks[476].x + landmarks[474].x) / 2,
      y: (landmarks[476].y + landmarks[474].y) / 2,
    };
    const leftEyeCenter = {
      x: (landmarks[362].x + landmarks[263].x) / 2,
      y: (landmarks[362].y + landmarks[263].y) / 2,
    };
    const leftEyeWidth = Math.abs(landmarks[362].x - landmarks[263].x);

    // Tính độ lệch (Gaze Relative)
    const rightGaze = getDistance(rightIris, rightEyeCenter) / rightEyeWidth;
    const leftGaze = getDistance(leftIris, leftEyeCenter) / leftEyeWidth;

    return (rightGaze + leftGaze) / 2;
  };

  // Load Model Hugging Face
  useEffect(() => {
    const loadModel = async () => {
      try {
        console.log("Loading Emotion Model...");
        const classifier = await pipeline(
          "image-classification",
          "Xenova/facial_emotions_image_detection"
        );
        classifierRef.current = classifier;
        setModelLoading(false);
        console.log("✅ Emotion Model Loaded!");
      } catch (err) {
        console.error("Failed to load emotion model", err);
      }
    };
    loadModel();
  }, []);

  // Logic phân tích cảm xúc
  const analyzeEmotion = async (videoElement, faceLandmarks) => {
    if (!classifierRef.current || !faceLandmarks) return null;

    try {
      // 1. Cắt khuôn mặt từ video (Bounding Box)
      // Lấy tọa độ min/max x,y từ landmarks
      let minX = 1,
        minY = 1,
        maxX = 0,
        maxY = 0;
      faceLandmarks.forEach((pt) => {
        if (pt.x < minX) minX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y > maxY) maxY = pt.y;
      });

      // Thêm padding cho khung hình mặt
      const padding = 0.1;
      minX = Math.max(0, minX - padding);
      minY = Math.max(0, minY - padding);
      maxX = Math.min(1, maxX + padding);
      maxY = Math.min(1, maxY + padding);

      // Tạo canvas tạm để crop
      const tempCanvas = document.createElement("canvas");
      const tempCtx = tempCanvas.getContext("2d");
      const videoW = videoElement.videoWidth;
      const videoH = videoElement.videoHeight;

      const cropX = minX * videoW;
      const cropY = minY * videoH;
      const cropW = (maxX - minX) * videoW;
      const cropH = (maxY - minY) * videoH;

      tempCanvas.width = cropW;
      tempCanvas.height = cropH;

      // Vẽ phần mặt lên canvas tạm
      tempCtx.drawImage(
        videoElement,
        cropX,
        cropY,
        cropW,
        cropH,
        0,
        0,
        cropW,
        cropH
      );

      // Lấy Data URL
      const imageMap = tempCanvas.toDataURL("image/jpeg", 0.8);

      // 2. Chạy Model Inference
      const results = await classifierRef.current(imageMap, { topk: 7 });

      // 3. Chuẩn hóa kết quả trả về format của App
      // results dạng: [{ label: 'happy', score: 0.9 }, ...]
      const emotionData = {
        angry: 0,
        disgust: 0,
        fear: 0,
        happy: 0,
        sad: 0,
        surprise: 0,
        neutral: 0,
      };
      let totalScore = 0;
      results.forEach((res) => {
        totalScore += res.score;
      });

      // Tìm cảm xúc chủ đạo
      let dominantEmotion = "neutral";
      let maxPercent = 0;

      results.forEach((res) => {
        // Map label từ model sang key của app
        const key = EMOTION_MAP[res.label] || res.label;

        if (emotionData.hasOwnProperty(key)) {
          // Tính phần trăm dựa trên tổng score thực tế để đảm bảo tổng luôn là 100%
          // Ví dụ: score 0.65 / total 1.0 * 100 = 65.0
          const percent = (res.score / totalScore) * 100;

          emotionData[key] = parseFloat(percent.toFixed(1)); // Làm tròn 1 số thập phân

          if (percent > maxPercent) {
            maxPercent = percent;
            dominantEmotion = key;
          }
        }
      });

      return {
        emotionData,
        dominantEmotion,
        confidence: maxPercent / 100, // Trả về dạng 0.0-1.0
      };
    } catch (err) {
      console.error("Emotion analysis error:", err);
      return null;
    }
  };

  // useEffect(() => {
  //   let currentStream = null;

  //   const startCamera = async () => {
  //     try {
  //       // Truy cập camera trực tiếp từ browser
  //       const stream = await navigator.mediaDevices.getUserMedia({
  //         video: {
  //           width: { ideal: 1280 },
  //           height: { ideal: 720 },
  //           facingMode: "user",
  //         },
  //         audio: false,
  //       });

  //       if (videoRef.current) {
  //         videoRef.current.srcObject = stream;
  //         currentStream = stream;
  //         setStreamActive(true);

  //         // Start continuous drawing loop for video
  //         videoRef.current.onloadedmetadata = () => {
  //           startDrawingLoop();
  //         };

  //         // Initialize MediaPipe FaceMesh and Hands
  //         initializeMediaPipe();
  //       }
  //     } catch (err) {
  //       console.error("Camera error:", err);
  //       setError("Cannot access camera. Please allow camera permission!");
  //     }
  //   };

  useEffect(() => {
    let currentStream = null;

    const initializeMediaPipe = async () => {
      try {
        console.log("🔧 Initializing MediaPipe models...");
        setModelsLoading(true);

        // Prevent double initialization in React StrictMode
        if (faceMeshRef.current || handsRef.current) {
          console.log("⚠️ MediaPipe already initialized, skipping...");
          setModelsLoading(false);
          return true;
        }

        // Initialize FaceMesh
        const faceMesh = new FaceMesh({
          locateFile: (file) => {
            // Force non-SIMD version to avoid WASM errors
            if (file.includes("simd")) {
              file = file.replace("_simd", "");
            }
            return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`;
          },
        });

        faceMesh.setOptions({
          maxNumFaces: 1,
          refineLandmarks: true,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });

        faceMesh.onResults((results) => {
          resultsRef.current.face = results;
          if (!modelsReady.current.faceMesh) {
            console.log("✅ FaceMesh ready");
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
        console.log("✅ FaceMesh created");

        // Initialize Hands
        const hands = new Hands({
          locateFile: (file) => {
            return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
          },
        });

        hands.setOptions({
          maxNumHands: 2,
          modelComplexity: 1,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });

        hands.onResults((results) => {
          resultsRef.current.hands = results;
          if (!modelsReady.current.hands) {
            console.log("✅ Hands ready");
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
        console.log("✅ Hands created");

        // Wait for WASM modules to load
        console.log("⏳ Loading MediaPipe WASM modules...");
        await new Promise((resolve) => setTimeout(resolve, 2000));

        console.log("✅ All MediaPipe models ready!");
        setModelsLoading(false);

        if (onModelsLoaded) {
          onModelsLoaded(true);
        }

        return true;
      } catch (err) {
        console.error("MediaPipe initialization error:", err);
        setError("Failed to initialize MediaPipe. Please refresh the page.");
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
        console.log("📷 Opening camera...");
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: "user",
          },
          audio: true, // Enable audio for better MediaRecorder compatibility
        });

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          currentStream = stream;
          setStreamActive(true);

          // Wait for video to be ready, then start MediaPipe processing
          videoRef.current.onloadedmetadata = () => {
            console.log("📹 Video stream ready");
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

                  const options = { mimeType: "video/webm;codecs=vp9,opus" };
                  const mediaRecorder = new MediaRecorder(
                    canvasStream,
                    options
                  );

                  mediaRecorder.ondataavailable = (event) => {
                    if (event.data.size > 0) {
                      recordedChunksRef.current.push(event.data);
                    }
                  };

                  mediaRecorder.onstop = () => {
                    const blob = new Blob(recordedChunksRef.current, {
                      type: "video/webm",
                    });
                    console.log("📹 Recording stopped, blob size:", blob.size);
                    if (onVideoRecorded) {
                      onVideoRecorded(blob);
                    }
                    recordedChunksRef.current = [];
                  };

                  mediaRecorderRef.current = mediaRecorder;
                  console.log(
                    "✅ MediaRecorder initialized (from canvas with landmarks)"
                  );

                  // Notify parent component
                  if (onRecorderReady) {
                    onRecorderReady(mediaRecorder);
                  }
                } catch (err) {
                  console.error("MediaRecorder initialization error:", err);
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
                if (
                  !modelsReady.current.faceMesh ||
                  !modelsReady.current.hands
                ) {
                  return;
                }
                console.error("Frame processing error:", err);
              }
            }
          },
          width: 1280,
          height: 720,
        });

        console.log("🎥 Starting MediaPipe camera processing...");
        camera.start();
        cameraRef.current = camera;
      }
    };

    // const initializeMediaPipe = async () => {
    //   try {
    //     console.log("🔧 Initializing MediaPipe models...");

    //     // Initialize FaceMesh
    //     const faceMesh = new FaceMesh({
    //       locateFile: (file) => {
    //         return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`;
    //       },
    //     });

    //     faceMesh.setOptions({
    //       maxNumFaces: 1,
    //       refineLandmarks: true,
    //       minDetectionConfidence: 0.5,
    //       minTrackingConfidence: 0.5,
    //     });

    //     faceMesh.onResults((results) => {
    //       resultsRef.current.face = results;
    //       // Mark model as ready on first results
    //       if (!modelsReady.current.faceMesh) {
    //         console.log("✅ FaceMesh ready");
    //         modelsReady.current.faceMesh = true;
    //       }
    //     });
    //     faceMeshRef.current = faceMesh;

    //     // Initialize Hands
    //     const hands = new Hands({
    //       locateFile: (file) => {
    //         return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
    //       },
    //     });

    //     hands.setOptions({
    //       maxNumHands: 2,
    //       modelComplexity: 1,
    //       minDetectionConfidence: 0.5,
    //       minTrackingConfidence: 0.5,
    //     });

    //     hands.onResults((results) => {
    //       resultsRef.current.hands = results;
    //       // Mark model as ready on first results
    //       if (!modelsReady.current.hands) {
    //         console.log("✅ Hands ready");
    //         modelsReady.current.hands = true;
    //       }
    //     });
    //     handsRef.current = hands;

    //     // Wait for models to fully initialize before starting camera
    //     console.log("⏳ Waiting for MediaPipe WASM modules to load...");
    //     await new Promise((resolve) => setTimeout(resolve, 2000));

    //     // Start camera processing
    //     if (videoRef.current) {
    //       const camera = new Camera(videoRef.current, {
    //         onFrame: async () => {
    //           // Only send frames after models are initialized
    //           if (faceMeshRef.current && handsRef.current && videoRef.current) {
    //             try {
    //               await faceMeshRef.current.send({ image: videoRef.current });
    //               await handsRef.current.send({ image: videoRef.current });
    //             } catch (err) {
    //               // Silently handle initialization errors
    //               if (
    //                 !modelsReady.current.faceMesh ||
    //                 !modelsReady.current.hands
    //               ) {
    //                 // Still initializing, suppress errors
    //                 return;
    //               }
    //               console.error("Frame processing error:", err);
    //             }
    //           }
    //         },
    //         width: 1280,
    //         height: 720,
    //       });

    //       console.log("🎥 Starting MediaPipe camera feed...");
    //       camera.start();
    //       cameraRef.current = camera;
    //     }
    //   } catch (err) {
    //     console.error("MediaPipe initialization error:", err);
    //     setError("Failed to initialize MediaPipe. Please refresh the page.");
    //   }
    // };

    // Continuous drawing loop for video + landmarks
    const startDrawingLoop = () => {
      const draw = () => {
        if (
          videoRef.current &&
          canvasRef.current &&
          videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA
        ) {
          drawResults();
        }
        requestAnimationFrame(draw);
      };
      draw();
    };

    // Thay thế hàm cũ bằng hàm này
    const getEyeAspectRatio = (landmarks, eyePoints) => {
      // eyePoints thứ tự: [Top, Bottom, Inner, Outer]
      // Right eye: [159, 145, 133, 33]
      // Left eye: [386, 374, 362, 263]
      if (!landmarks || landmarks.length === 0) {
        return 0;
      }

      const top = landmarks[eyePoints[0]];
      const bottom = landmarks[eyePoints[1]];
      const inner = landmarks[eyePoints[2]];
      const outer = landmarks[eyePoints[3]];

      // Tính chiều cao mắt (Khoảng cách giữa mí trên và mí dưới)
      const vertical = Math.hypot(top.x - bottom.x, top.y - bottom.y);

      // Tính chiều rộng mắt (Khoảng cách giữa khóe mắt trong và ngoài)
      const horizontal = Math.hypot(inner.x - outer.x, inner.y - outer.y);

      // Tránh chia cho 0
      if (horizontal === 0) return 0;

      return vertical / horizontal;
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
      const facePoints = [
        10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365,
        379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234,
        127, 162, 21, 54, 103, 67, 109,
      ];

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
      const now = Date.now(); // Lấy thời gian hiện tại

      if (now - cycleStartTime.current > 60000) {
        console.log(
          "⏱️ 60s Cycle Reset! Prev Count:",
          currentCycleBlinks.current
        );
        currentCycleBlinks.current = 0;
        cycleStartTime.current = now;
      }

      const landmarks = resultsRef.current.face.multiFaceLandmarks[0];

      if (!landmarks || landmarks.length === 0) {
        return {
          blinkRate: 0,
          blinkCount: 0,
          currentHandToFace: false,
          handTouchTotal: 0,
          emotionData: {},
          dominantEmotion: "neutral",
          emotionConfidence: 0,
          isLipCompressed: false,
          gazeShiftIntensity: 0,
        };
      }

      let handToFace = false;
      let lipCompression = false;
      let gazeShift = 0;
      let isBlinkingNow = false;
      let isTouchingFaceNow = false;
      let currentEAR = 0; // Eye Aspect Ratio

      // Blink detection
      if (
        resultsRef.current.face &&
        resultsRef.current.face.multiFaceLandmarks
      ) {
        const landmarks = resultsRef.current.face.multiFaceLandmarks[0];
        // Detect Blink
        isBlinkingNow = isBlinking(landmarks);
        // Logic đếm (Chỉ tăng khi chuyển từ Mở -> Nhắm và cooldown 300ms)
        if (isBlinkingNow && !isBlinkingRef.current) {
          if (now - lastBlinkTime.current > 300) {
            // Tăng biến đếm của chu kỳ hiện tại (sẽ reset về 0 mỗi phút)
            currentCycleBlinks.current += 1;

            // Thêm timestamp vào mảng để tính Rate (Sliding Window)
            blinkTimestamps.current.push(now);

            lastBlinkTime.current = now;
          }
        }
        isBlinkingRef.current = isBlinkingNow;

        // Lip Compression Detection
        // Ngưỡng 0.35
        const lipRatio = calculateLipRatio(landmarks);
        if (lipRatio < 0.35) {
          lipCompression = true;
        }
        // Gaze Shift Detection
        gazeShift = calculateGazeShift(landmarks);
      }

      // Hand-to-face detection
      if (
        resultsRef.current.face &&
        resultsRef.current.hands &&
        resultsRef.current.face.multiFaceLandmarks &&
        resultsRef.current.hands.multiHandLandmarks
      ) {
        const faceLandmarks = resultsRef.current.face.multiFaceLandmarks[0];
        isTouchingFaceNow = checkHandToFace(
          resultsRef.current.hands.multiHandLandmarks,
          faceLandmarks
        );
      }

      // Cập nhật tổng số lần nháy mắt
      if (isBlinkingNow && !prevBlinkState.current) {
        if (now - lastBlinkTime.current > 300) {
          // Cooldown 300ms
          totalBlinks.current += 1;
          blinkTimestamps.current.push(now);
          lastBlinkTime.current = now;
          console.log("👁️ Valid Blink Detected! Total:", totalBlinks.current);
        }
      }
      prevBlinkState.current = isBlinkingNow;
      // Lọc bỏ các lần chớp mắt đã quá 60 giây (60000ms)
      // Để tính rate chính xác trong 1 phút gần nhất
      // Lọc bỏ các lần chớp quá 60s
      blinkTimestamps.current = blinkTimestamps.current.filter(
        (t) => now - t <= 60000
      );

      // Tính Rate hiện tại
      let currentBlinkRate = blinkTimestamps.current.length;
      const timeElapsedSeconds = frameCountRef.current / 30; // Giả sử 30fps
      if (timeElapsedSeconds < 60 && timeElapsedSeconds > 5) {
        // Chỉ ước lượng nếu số lần blink > 1 để tránh nhảy số quá lớn khi mới vào
        if (currentBlinkRate > 1) {
          currentBlinkRate = Math.round(
            (currentBlinkRate / timeElapsedSeconds) * 60
          );
        }
      }
      // Cập nhật tổng số lần chạm tay lên mặt
      if (isTouchingFaceNow && !prevHandState.current) {
        // Cooldown 2 giây để tránh đếm trùng 1 hành động
        if (now - lastHandTouchTime.current > 2000) {
          totalHandTouches.current += 1;
          lastHandTouchTime.current = now;
          console.log(
            "✋ HAND TOUCH DETECTED! Total:",
            totalHandTouches.current
          );
        }
      }
      prevHandState.current = isTouchingFaceNow;

      // Trigger Emotion Analysis mỗi 1 giây (30 frames)
      let aiEmotionResult = null;
      if (frameCountRef.current % 30 === 0 && resultsRef.current.face) {
        const landmarks = resultsRef.current.face.multiFaceLandmarks[0];

        // Gọi AI chạy ngầm (Async)
        analyzeEmotion(videoRef.current, landmarks).then((result) => {
          if (result) {
            // CHỈ LƯU VÀO REF, KHÔNG GỌI onMetricsUpdate TẠI ĐÂY NỮA
            console.log(
              "🤖 AI Emotion Updated (Internal):",
              result.dominantEmotion
            );
            latestEmotionRef.current = {
              emotionData: result.emotionData,
              dominantEmotion: result.dominantEmotion,
              emotionConfidence: result.confidence,
            };
          }
        });
      }

      // Calculate and emit metrics every 30 frames (1 second at 30fps)
      if (frameCountRef.current % 30 === 0 && onMetricsUpdate) {
        console.log(
          `Debug Metrics - EAR: ${currentEAR.toFixed(
            3
          )} (Threshold: ${EYE_BLINK_THRESHOLD})
          }`
        );

        // Tính Rate bằng Sliding Window:
        // Lọc bỏ các timestamp cũ hơn 60s
        blinkTimestamps.current = blinkTimestamps.current.filter(
          (t) => now - t <= 60000
        );

        // Rate = Số lượng blink còn lại trong cửa sổ 60s
        let slidingWindowRate = blinkTimestamps.current.length;

        // Calculate per minute rates
        const secondsRecorded = blinksBuffer.current.length / 30;
        // Tính phút đã trôi qua để tính tốc độ chớp mắt trung bình
        const minutesElapsed = frameCountRef.current / 30 / 60;

        // Blink Rate = Tổng số lần chớp / số phút (tránh chia cho 0)
        const calculatedBlinkRate =
          minutesElapsed > 0.1
            ? Math.round(totalBlinks.current / minutesElapsed)
            : 0;

        onMetricsUpdate({
          blinkRate: slidingWindowRate, // Tốc độ trung bình (lần/phút)
          // blinkRate: frozenBlinkRateRef.current, // Tốc độ hiển thị (lần/phút) - cập nhật mỗi 60s
          blinkCount: currentCycleBlinks.current, // Tổng số lần chớp trong chu kỳ 60s hiện tại
          handTouchTotal: totalHandTouches.current,
          currentHandToFace: isTouchingFaceNow,
          isLipCompressed: lipCompression, // True/False
          gazeShiftIntensity: gazeShift, // Float (độ lớn của việc đảo mắt)
          frameCount: frameCountRef.current,
          ...latestEmotionRef.current, // Thêm kết quả cảm xúc mới nhất
        });
      }
    };

    const drawResults = () => {
      if (!canvasRef.current || !videoRef.current) return;

      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");

      // Set canvas size to match video
      if (
        canvas.width !== videoRef.current.videoWidth ||
        canvas.height !== videoRef.current.videoHeight
      ) {
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
      if (
        resultsRef.current.face &&
        resultsRef.current.face.multiFaceLandmarks
      ) {
        for (const landmarks of resultsRef.current.face.multiFaceLandmarks) {
          // Draw face mesh tesselation (lưới khuôn mặt)
          drawConnectors(ctx, landmarks, FACEMESH_TESSELATION, {
            color: "#C0C0C070",
            lineWidth: 0.5,
          });

          // Draw face oval (đường viền mặt)
          drawConnectors(ctx, landmarks, FACEMESH_FACE_OVAL, {
            color: "#E0E0E0",
            lineWidth: 1,
          });

          // Draw eyes (mắt)
          drawConnectors(ctx, landmarks, FACEMESH_RIGHT_EYE, {
            color: "#FF3030",
            lineWidth: 1,
          });
          drawConnectors(ctx, landmarks, FACEMESH_LEFT_EYE, {
            color: "#30FF30",
            lineWidth: 1,
          });

          // Draw lips (môi)
          drawConnectors(ctx, landmarks, FACEMESH_LIPS, {
            color: "#E0E0E0",
            lineWidth: 1,
          });
        }
      }

      // Draw hand landmarks
      if (
        resultsRef.current.hands &&
        resultsRef.current.hands.multiHandLandmarks
      ) {
        for (const landmarks of resultsRef.current.hands.multiHandLandmarks) {
          // Draw hand connections (đường nối ngón tay)
          drawConnectors(ctx, landmarks, HAND_CONNECTIONS, {
            color: "#00FF00",
            lineWidth: 2,
          });

          // Draw hand landmarks (các điểm trên bàn tay)
          drawLandmarks(ctx, landmarks, {
            color: "#FF0000",
            lineWidth: 1,
            radius: 3,
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
        console.error("Error calculating metrics:", err);
      }
    };

    startCamera();

    return () => {
      console.log("🧹 Cleaning up camera and MediaPipe...");
      if (
        mediaRecorderRef.current &&
        mediaRecorderRef.current.state !== "inactive"
      ) {
        mediaRecorderRef.current.stop();
      }
      if (currentStream) {
        currentStream.getTracks().forEach((track) => track.stop());
      }
      if (cameraRef.current) {
        cameraRef.current.stop();
      }

      // Clear canvas
      if (canvasRef.current) {
        const ctx = canvasRef.current.getContext("2d");
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
    if (
      calibrated &&
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state === "inactive"
    ) {
      try {
        recordedChunksRef.current = [];
        mediaRecorderRef.current.start();
        setIsRecording(true);
        console.log("🎥 MediaRecorder started recording");
      } catch (err) {
        console.error("Failed to start recording:", err);
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

        {modelLoading && (
          <div className="absolute top-3 left-3 bg-blue-600 text-white text-xs px-2 py-1 rounded z-20 animate-pulse">
            Loading AI Model...
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

        {!streamActive && !error && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-gray-500 text-sm animate-pulse">
              Opening camera...
            </div>
          </div>
        )}

        {/* Video element - direct camera feed (hidden, used for processing) */}
        <video ref={videoRef} autoPlay playsInline muted className="hidden" />

        {/* Canvas overlay - displays video + landmarks */}
        <canvas
          ref={canvasRef}
          className="w-full h-full object-cover transform scale-x-[-1]"
        />

        {/* Status overlay */}
        {streamActive && !modelsLoading && (
          <div className="absolute bottom-2 left-2 text-xs text-gray-300 bg-black/50 px-2 py-1 rounded z-10">
            <span className={calibrated ? "text-green-400" : "text-yellow-400"}>
              {calibrated ? "● ANALYZING" : "● CALIBRATING"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
