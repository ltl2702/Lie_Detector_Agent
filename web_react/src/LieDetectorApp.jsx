import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Activity,
  Eye,
  Hand,
  Heart,
  AlertTriangle,
  TrendingUp,
  Target,
  History,
  Video,
  Square,
} from "lucide-react";
import { io } from "socket.io-client";
import api from "./services/api";
import CameraFeed from "./components/CameraFeed";
import TruthMeter from "./components/TruthMeter";
import AlertSystem from "./components/AlertSystem";
import ReviewMode from "./components/ReviewMode";
import SessionHistory from "./components/SessionHistory";

export default function LieDetectorApp() {
  const [viewMode, setViewMode] = useState("live"); // 'live', 'history', 'review'
  const [selectedSession, setSelectedSession] = useState(null);

  const [cameraActive, setCameraActive] = useState(false);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [calibrationProgress, setCalibrationProgress] = useState(0);
  const [sessionId, setSessionId] = useState(null);

  // REFS CHO CALIBRATION
  // Lưu metric mới nhất từ Camera gửi sang
  const latestMetricsRef = useRef({ blinkRate: 0, handTouchTotal: 0 });
  const prevMetricsRef = useRef(null);
  // Lưu giá trị tại thời điểm bắt đầu Calibrate để tính Delta
  const calibrationStartRef = useRef({ handTouchTotal: 0, startTime: 0 });

  const stressScoreRef = useRef(0);

  // Ref để cộng dồn cảm xúc trong suốt quá trình calibrate
  const calibrationEmotionsAccRef = useRef({
    angry: 0,
    disgust: 0,
    fear: 0,
    happy: 0,
    sad: 0,
    surprise: 0,
    neutral: 0,
  });

  // Baseline data
  const [baseline, setBaseline] = useState({
    bpm: 0,
    blink_rate: 0,
    gaze_stability: 0,
    emotion: "neutral",
    hand_baseline_count: 0, // Lưu số lần chạm trong lúc calibrate
    calibrated: false,
  });

  // Real-time metrics
  const [bpm, setBpm] = useState(0);

  const [blinkMetrics, setBlinkMetrics] = useState({ rate: 0, count: 0 });
  const [handMetrics, setHandMetrics] = useState({
    count: 0,
    isTouching: false,
  });

  // Thêm state để lưu trữ baseline emotion distribution
  const [baselineEmotion, setBaselineEmotion] = useState(null);

  const [emotionData, setEmotionData] = useState({
    angry: 0,
    disgust: 0,
    fear: 15,
    happy: 5,
    sad: 10,
    surprise: 5,
    neutral: 65,
  });
  const [dominantEmotion, setDominantEmotion] = useState("neutral");
  const [emotionConfidence, setEmotionConfidence] = useState(0.65);
  const [gestureScore, setGestureScore] = useState(85);
  const [lipCompression, setLipCompression] = useState(false);
  const [gazeDetected, setGazeDetected] = useState(false); // State cho Gaze Shift UI
  const [analyzing, setAnalyzing] = useState(false);
  const [stressLevel, setStressLevel] = useState("LOW STRESS");
  const [stressScore, setStressScore] = useState(0);
  const [stressColor, setStressColor] = useState("text-green-400");

  // Detection tells
  const [tells, setTells] = useState([]);

  // Alert system
  const [alerts, setAlerts] = useState([]);
  const [showAlert, setShowAlert] = useState(false);

  // Truth meter
  const [truthMeterPosition, setTruthMeterPosition] = useState(30);

  const wsRef = useRef(null);
  const pollingRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const videoBlobRef = useRef(null);

  // Video recording
  const [sessionVideoBlob, setSessionVideoBlob] = useState(null);

  // AI Analysis
  const [aiAnalysis, setAiAnalysis] = useState(null);
  const [showAiAnalysis, setShowAiAnalysis] = useState(false);
  const [isAnalyzingSession, setIsAnalyzingSession] = useState(false);

  // Handle ending session
  // const handleEndSession = async () => {
  //   if (!sessionId) return;

  //   try {
  //     // Save session data
  //     const sessionData = {
  //       session_id: sessionId,
  //       session_name: `Session_${new Date()
  //         .toISOString()
  //         .replace(/[:.]/g, "-")
  //         .slice(0, -5)}`,
  //       start_time: Date.now() / 1000,
  //       end_time: Date.now() / 1000,
  //       baseline: baseline,
  //       tells: tells.map((t) => ({
  //         message: t.message,
  //         type: t.type,
  //         timestamp: Date.now() / 1000,
  //       })),
  //       metrics: {
  //         bpm: bpm,
  //         emotion: dominantEmotion,
  //         stress_level: stressLevel,
  //       },
  //     };

  //     // Call backend to end session
  //     await api.endSession(sessionId, sessionData);

  //     // Reset state
  //     setCameraActive(false);
  //     setSessionId(null);
  //     setBaseline({
  //       bpm: 0,
  //       blink_rate: 0,
  //       gaze_stability: 0,
  //       emotion: "neutral",
  //       hand_baseline_count: 0,
  //       calibrated: false,
  //     });
  //     setTells([]);

  //     // Disconnect websocket
  //     if (wsRef.current) {
  //       wsRef.current.disconnect();
  //     }

  //     alert("Session ended and saved successfully!");
  //   } catch (error) {
  //     console.error("Error ending session:", error);
  //     alert("Failed to end session");
  //   }
  // };

  // Handle ending session
  const handleEndSession = async () => {
    if (!sessionId) return;

    const confirmEnd = window.confirm(
      "Are you sure you want to end this session? The video will be saved."
    );
    if (!confirmEnd) return;

    // Immediately hide all UI components
    const currentSessionId = sessionId;
    setSessionId(null);
    setCameraActive(false);

    try {
      let uploadedVideoFile = null;
      let videoBlobToUpload = null;

      // Stop MediaRecorder directly and wait for blob
      if (
        mediaRecorderRef.current &&
        mediaRecorderRef.current.state === "recording"
      ) {
        console.log("⏹️ Stopping MediaRecorder...");

        // Create promise to wait for onstop event
        const stopPromise = new Promise((resolve) => {
          const originalOnStop = mediaRecorderRef.current.onstop;
          mediaRecorderRef.current.onstop = (event) => {
            if (originalOnStop) originalOnStop(event);
            // Wait for blob to be saved to ref
            setTimeout(() => resolve(), 200);
          };
        });

        mediaRecorderRef.current.stop();
        await stopPromise;

        // Get blob from ref
        videoBlobToUpload = videoBlobRef.current;
        console.log(
          "📹 Video blob from ref, size:",
          videoBlobToUpload?.size || 0
        );
      }

      // Stop calibration
      setBaseline((prev) => ({ ...prev, calibrated: false }));

      // Upload video if available
      if (videoBlobToUpload && videoBlobToUpload.size > 0) {
        console.log("📤 Uploading video, size:", videoBlobToUpload.size);
        const formData = new FormData();
        formData.append("video", videoBlobToUpload, "session_video.webm");
        formData.append("session_id", currentSessionId);

        try {
          const uploadRes = await axios.post(
            "http://localhost:5000/api/upload_video",
            formData,
            {
              headers: { "Content-Type": "multipart/form-data" },
            }
          );

          if (uploadRes.data && uploadRes.data.video_file) {
            uploadedVideoFile = uploadRes.data.video_file;
            console.log("✅ Video uploaded:", uploadedVideoFile);
          }
        } catch (uploadErr) {
          console.error("Failed to upload video:", uploadErr);
        }
      } else {
        console.warn("⚠️ No video blob available to upload");
      }

      // Save session data
      const sessionData = {
        session_id: currentSessionId,
        session_name: `Session_${new Date()
          .toISOString()
          .replace(/[:.]/g, "-")
          .slice(0, -5)}`,
        start_time: Date.now() / 1000,
        end_time: Date.now() / 1000,
        baseline: baseline,
        tells: tells.map((t) => ({
          message: t.message,
          type: t.type,
          timestamp: Date.now() / 1000,
        })),
        metrics: {
          bpm: bpm,
          emotion: dominantEmotion,
          stress_level: stressLevel,
          gesture_score: gestureScore,
        },
        video_file: uploadedVideoFile,
      };

      // Call backend to end session and save video
      setIsAnalyzingSession(true);
      const response = await api.endSession(currentSessionId, sessionData);
      setIsAnalyzingSession(false);

      // Show AI analysis if available
      if (response.data?.ai_analysis) {
        console.log("🤖 Received AI analysis:", response.data.ai_analysis);
        setAiAnalysis(response.data.ai_analysis);
        setShowAiAnalysis(true);
      }

      // Disconnect websocket
      if (wsRef.current) {
        wsRef.current.disconnect();
      }

      // Reset remaining state (sessionId and cameraActive already set at start)
      setIsCalibrating(false);
      setCalibrationProgress(0);
      setAnalyzing(false);
      setLipCompression(false);
      setBaseline({
        bpm: 0,
        blink_rate: 0,
        gaze_stability: 0,
        emotion: "neutral",
        hand_face_frequency: 0,
        calibrated: false,
      });
      setTells([]);
      setAlerts([]);
      setShowAlert(false);
      setTruthMeterPosition(30);
      setBpm(0);
      setStressLevel("LOW STRESS");
      setStressColor("text-green-400");
      setSessionVideoBlob(null);
      videoBlobRef.current = null;

      const videoFile = response.data.video_file || uploadedVideoFile;
      alert(
        `Session ended successfully!\n${
          videoFile ? `Video saved: ${videoFile}` : "Session saved."
        }`
      );
    } catch (error) {
      console.error("Error ending session:", error);
      alert("Failed to end session");
    }
  };

  // Connect to Socket.IO for real-time updates
  useEffect(() => {
    if (cameraActive && baseline.calibrated && sessionId) {
      console.log("Connecting to Socket.IO server...");

      const socket = io("http://localhost:5000", {
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: 5,
      });

      wsRef.current = socket;

      socket.on("connect", () => {
        console.log("✅ Socket.IO connected:", socket.id);
        socket.emit("join_session", { session_id: sessionId });
      });

      socket.on("disconnect", () => {
        console.log("Socket.IO disconnected");
      });

      socket.on("connect_error", (error) => {
        console.log("Socket.IO connection error, switching to polling");
        // Fallback to polling
        startPolling();
      });

      // Listen for metrics updates
      socket.on("metrics_update", (data) => {
        console.log("Received metrics update:", data);
        updateMetrics(data);
      });

      // Listen for detection tells
      socket.on("detection_tell", (data) => {
        console.log("Received detection tell:", data);
        if (data.message) {
          addTell(data.message, data.type || "detection");
        }
      });

      // Listen for alerts
      socket.on("high_stress_alert", (data) => {
        console.log("HIGH STRESS ALERT:", data);
        triggerAlert(data);
      });

      return () => {
        if (socket) socket.disconnect();
      };
    }
  }, [cameraActive, baseline.calibrated, sessionId]);

  const updateMetrics = (data) => {
    if (data.bpm) setBpm(data.bpm);
    if (data.emotion_data) setEmotionData(data.emotion_data);
    if (data.dominant_emotion) setDominantEmotion(data.dominant_emotion);
    if (data.emotion_confidence) setEmotionConfidence(data.emotion_confidence);
    if (data.gesture_score) setGestureScore(data.gesture_score);

    if (data.stress_level) {
      setStressLevel(data.stress_level);
      setStressColor(
        data.stress_level.includes("HIGH")
          ? "text-red-400"
          : data.stress_level.includes("MEDIUM")
          ? "text-yellow-400"
          : "text-green-400"
      );
    }
    if (data.tells && Array.isArray(data.tells)) {
      setTells(
        data.tells.map((t, idx) => ({
          id: Date.now() + idx,
          message: t,
          type: "detection",
          ttl: 10,
        }))
      );
    }
  };

  // LOGIC TÍNH STRESS LEVEL
  const calculateStressLevel = useCallback((metrics, bpmDelta) => {
    console.log("CALCULATE STRESS RUNNING", {
      blink: metrics.blinkRate,
      emotion: metrics.emotionData,
      gaze: metrics.gazeShiftIntensity,
      hand: metrics.currentHandToFace,
      lip: metrics.isLipCompressed,
    });

    let score = 0;

    if (metrics.bpm && metrics.bpm > 40) {
      setBpm(metrics.bpm);
      // Cập nhật vào Ref để tính toán delta ở interval sau
      latestMetricsRef.current.bpm = metrics.bpm;
    }

    // 1. Blink Score
    // Nếu Baseline là 15, thì > 25 là bắt đầu stress (Logic cũ > 35 quá cao)
    const blinkThresholdHigh = Math.max(25, baseline.blink_rate * 1.3);
    if (metrics.blinkRate > blinkThresholdHigh) score += 20;
    // Stare (Nhìn chằm chằm) cũng là dấu hiệu
    if (metrics.blinkRate < 5 && metrics.blinkRate < baseline.blink_rate * 0.5)
      score += 15;

    // 2. Emotion Score
    const fear = metrics.emotionData?.fear || 0;
    const sad = metrics.emotionData?.sad || 0;
    const angry = metrics.emotionData?.angry || 0;
    const disgust = metrics.emotionData?.disgust || 0;

    if (fear > 18) score += 35;
    if (angry > 15) score += 20;
    if (disgust > 10) score += 20;
    if (sad > 15) score += 10;

    // 3. BPM Score
    if (bpmDelta > 15) score += 25; // Nhịp tim tăng 15 nhịp là nhiều
    else if (bpmDelta > 8) score += 10;

    // 4. Behavior Score
    if (metrics.currentHandToFace) score += 15;
    if (metrics.isLipCompressed) score += 15;
    if (metrics.gazeShiftIntensity > 0.15) score += 10;

    const finalScore = Math.min(100, score);
    setStressScore(finalScore);
    stressScoreRef.current = finalScore;

    let newLevel = "LOW STRESS";
    let newColor = "text-green-400";

    if (finalScore >= 65) {
      newLevel = "HIGH STRESS";
      newColor = "text-red-500";
    } else if (finalScore >= 35) {
      newLevel = "MEDIUM STRESS";
      newColor = "text-yellow-400";
    }

    setStressLevel(newLevel);
    setStressColor(newColor);
    setStressScore(finalScore);

    // Log biến cục bộ, không log state
    console.log(`Score: ${finalScore} -> Level: ${newLevel}`);
  }, []);

  // Handle metrics calculated from frontend
  const handleFrontendMetrics = (metrics) => {
    console.log("Frontend metrics:", metrics);
    // 1. Cập nhật Refs để dùng cho tính toán Calibration
    latestMetricsRef.current = metrics;

    // 1. Xử lý update Emotion
    if (metrics.emotionData) {
      setEmotionData(metrics.emotionData);
      setDominantEmotion(metrics.dominantEmotion);
      setEmotionConfidence(metrics.emotionConfidence);

      // Logic tích lũy Emotion khi Calibrate
      if (isCalibrating) {
        Object.entries(metrics.emotionData).forEach(([key, val]) => {
          calibrationEmotionsAccRef.current[key] =
            (calibrationEmotionsAccRef.current[key] || 0) + val;
        });
      }

      // Logic check Deviation
      if (baseline.calibrated && baselineEmotion) {
        checkEmotionDeviation(metrics.emotionData);
      }
    }

    // 2. Cập nhật UI State
    setBlinkMetrics({
      rate: metrics.blinkRate,
      count: metrics.blinkCount,
    });

    setHandMetrics({
      count: metrics.handTouchTotal || 0, // Đảm bảo lấy đúng tên biến từ CameraFeed
      isTouching: metrics.currentHandToFace,
    });

    setLipCompression(metrics.isLipCompressed || false);
    setGazeDetected(metrics.gazeShiftIntensity > 0.15); // Cập nhật cho UI

    // 3. Logic phát hiện nói dối (Chỉ chạy khi đã Calibrate)
    if (baseline.calibrated && metrics.blinkRate !== undefined) {
      // Logic Blink Rate
      const highBlinkThreshold = Math.max(35, baseline.blink_rate * 1.5);
      if (metrics.blinkRate > highBlinkThreshold) {
        addTell(
          `Rapid Blinking: ${metrics.blinkRate}/min (Nervousness)`,
          "blink_high"
        );
      }

      const lowBlinkThreshold = Math.max(5, baseline.blink_rate * 0.5);
      if (
        metrics.blinkRate < 8 &&
        metrics.blinkRate < lowBlinkThreshold &&
        metrics.frameCount > 450
      ) {
        addTell(
          `Unusual Staring: ${metrics.blinkRate}/min (Cognitive Load)`,
          "blink_low"
        );
      }

      // Hand-to-face contact
      // Chỉ báo warning, việc đếm số đã được xử lý ở CameraFeed và hiển thị qua handMetrics.count
      if (metrics.currentHandToFace) {
        addTell("Hand-to-face contact detected", "gesture");
      }

      // Lip Compression
      if (metrics.isLipCompressed) {
        addTell("Lip compression detected", "lips");
      }

      // Gaze Shift
      if (metrics.gazeShiftIntensity > 0.15) {
        addTell("Gaze shift detected", "gaze");
      }
    }

    // Tính toán Stress Score liên tục
    const bpmDelta = metrics.bpm
      ? Math.abs(metrics.bpm - baseline.bpm)
      : Math.abs(bpm - baseline.bpm);

    calculateStressLevel(metrics, bpmDelta);
  };

  // Hàm checkEmotionDeviation: So sánh Emotion hiện tại với Baseline Emotion
  const checkEmotionDeviation = (currentEmotions) => {
    const negativeEmotions = ["fear", "sad", "disgust", "angry"];
    negativeEmotions.forEach((emo) => {
      const base = baselineEmotion[emo] || 0;
      const current = currentEmotions[emo] || 0;
      if (current - base > 25) {
        // Tăng đột biến 25%
        addTell(
          `Spike in ${emo.toUpperCase()} (+${(current - base).toFixed(0)}%)`,
          "emotion_spike"
        );
      }
    });
  };

  // Start calibration process
  const startCalibration = async () => {
    try {
      setCameraActive(true);
      setIsCalibrating(true);
      setCalibrationProgress(0);
      setTells([]);

      // Reset accumulator cảm xúc
      calibrationEmotionsAccRef.current = {
        angry: 0,
        disgust: 0,
        fear: 0,
        happy: 0,
        sad: 0,
        surprise: 0,
        neutral: 0,
      };

      // --- SNAPSHOT: Lưu trạng thái bắt đầu để tính Delta ---
      calibrationStartRef.current = {
        handTouchTotal: latestMetricsRef.current.handTouchTotal || 0,
        startTime: Date.now(),
      };
      console.log(
        "Calibration Started. Snapshot:",
        calibrationStartRef.current
      );

      // Start new session on backend
      const response = await api.startSession();
      setSessionId(response.data.session_id);

      // Simulate calibration progress (30 seconds)
      const calibrationInterval = setInterval(() => {
        setCalibrationProgress((prev) => {
          if (prev >= 100) {
            clearInterval(calibrationInterval);
            completeCalibration();
            return 100;
          }
          return prev + 1; // +1 every 300ms = 30 seconds
        });
      }, 300);
    } catch (error) {
      console.error("Error starting calibration:", error);
      setIsCalibrating(false);
      setCameraActive(false);
    }
  };

  const completeCalibration = async () => {
    try {
      let backendBaseline = {};

      if (sessionId) {
        await api.calibrateSession(sessionId);
        try {
          const response = await api.getBaseline(sessionId);
          backendBaseline = response.data.baseline || {};
        } catch (e) {
          console.warn("Backend baseline fetch failed, using local metrics");
        }
      }

      // --- TÍNH TOÁN DỮ LIỆU THỰC TẾ (REAL DATA) ---

      // 1. Blink Rate: Lấy giá trị hiện tại (được tính bằng Sliding Window ở CameraFeed)
      const measuredBlinkRate = latestMetricsRef.current.blinkRate || 15;

      // 2. Hand Touches: Tính số lần chạm trong quá trình chờ (Cuối - Đầu)
      const startHand = calibrationStartRef.current.handTouchTotal || 0;
      const endHand = latestMetricsRef.current.handTouchTotal || 0;
      const measuredHandCount = Math.max(0, endHand - startHand);

      console.log(
        `Calibration Result -> BlinkRate: ${measuredBlinkRate}, HandTouches: ${measuredHandCount}`
      );

      let maxScore = -1;
      let calculatedBaselineEmotion = "neutral";

      // Duyệt qua accumulator để tìm cảm xúc có tổng điểm cao nhất
      console.log(
        "📊 Raw Emotion Accumulator:",
        calibrationEmotionsAccRef.current
      );

      Object.entries(calibrationEmotionsAccRef.current).forEach(
        ([key, val]) => {
          if (val > maxScore) {
            maxScore = val;
            calculatedBaselineEmotion = key;
          }
        }
      );

      // Nếu không bắt được gì (maxScore = 0) thì fallback về neutral
      if (maxScore === 0) calculatedBaselineEmotion = "neutral";

      // Log kết quả ra console theo yêu cầu
      console.log("---------------------------------------------");
      console.log("CALIBRATION COMPLETE");
      console.log(
        "FINAL BASELINE EMOTION:",
        calculatedBaselineEmotion.toUpperCase()
      );
      console.log("---------------------------------------------");

      // Lưu snapshot phân phối cảm xúc hiện tại để làm mốc so sánh Deviation
      setBaselineEmotion({ ...emotionData });

      const finalBaseline = {
        bpm: backendBaseline.bpm || 68 + Math.random() * 14, // Giữ giả lập hoặc từ backend
        blink_rate: measuredBlinkRate, // Dữ liệu thật
        gaze_stability: backendBaseline.gaze_stability || 0.15,
        emotion: calculatedBaselineEmotion, // Ghi nhận Baseline Emotion là cảm xúc cao nhất lúc này
        hand_baseline_count: measuredHandCount, // Dữ liệu thật
        calibrated: true,
      };

      setBaseline(finalBaseline);
      setBpm(finalBaseline.bpm);

      setIsCalibrating(false);
      setAnalyzing(true);

      console.log("Calibration complete");
    } catch (error) {
      console.error("Error completing calibration:", error);
      setIsCalibrating(false);
    }
  };

  // useEffect: Monitor & Simulation (ADRENALINE MODE)
  useEffect(() => {
    // Chỉ chạy khi Camera Active, Đã Calibrate và Không đang Calibrate
    if (cameraActive && !isCalibrating && baseline.calibrated) {
      const interval = setInterval(() => {
        // Lấy dữ liệu từ Refs
        const currentMetrics = latestMetricsRef.current;
        const currentStress = stressScoreRef.current || 0; // Stress hiện tại (0-100)

        // 1. HEART RATE LOGIC (BPM) - "ADRENALINE RUSH"
        setBpm((prevBpm) => {
          let nextBpm = prevBpm;
          const realBpm = currentMetrics?.bpm;

          // A. Ưu tiên dữ liệu thật (nếu có và hợp lệ > 45)
          if (realBpm && realBpm > 45) {
            nextBpm = prevBpm * 0.8 + realBpm * 0.2;
          }
          // B. Giả lập dựa trên Stress Score
          else {
            const base = baseline.bpm || 70;

            // Stress 100 -> Tăng thêm 35 nhịp.
            // VD: Base 70 -> Target 105. (Đủ lớn để trigger alert > 10)
            // Với Medium Stress (50) -> Target ~ 87. Delta = 17 (> 10 -> Alert ngay)
            const stressFactor = (currentStress / 100) * 35;
            const targetBpm = base + stressFactor;

            const distance = targetBpm - prevBpm;

            // --- CHANGE 2: TỐC ĐỘ PHẢN ỨNG (ADRENALINE) ---
            let speed = 0.05; // Mặc định: Tăng chậm

            // Nếu Stress đang cao (> 50) và Tim cần tăng -> Tăng tốc gấp 3 lần (0.15)
            if (currentStress > 50 && distance > 0) {
              speed = 0.15;
            }
            // Nếu Stress giảm -> Tim hồi phục từ từ
            else if (distance < 0) {
              speed = 0.1;
            }

            nextBpm = prevBpm + distance * speed;

            // --- CHANGE 3: ĐỘ RUNG (JITTER) ---
            // Stress càng cao, tim đập càng loạn (không đều)
            // Low stress: ±1. High stress: ±3.5
            const jitter = currentStress > 60 ? 3.5 : 1.2;
            nextBpm += (Math.random() - 0.5) * jitter;
          }

          // C. Alert BPM
          const bpmDelta = nextBpm - baseline.bpm;

          // Ngưỡng Alert: Giữ nguyên 10, nhưng nhờ logic trên nên sẽ dễ chạm ngưỡng này hơn
          if (Math.abs(bpmDelta) > 10) {
            const type = bpmDelta > 0 ? "increase" : "decrease";
            const sign = bpmDelta > 0 ? "+" : "";
            // TTL 4s: Cảnh báo hiện lâu hơn một chút
            addTell(
              `Heart rate ${type} (${sign}${bpmDelta.toFixed(0)} BPM)`,
              "bpm_monitor",
              4
            );
          }

          // Kẹp giá trị an toàn
          return Math.max(55, Math.min(160, nextBpm));
        });

        // 2. BLINK RATE LOGIC
        let currentBlinkRate = currentMetrics?.blinkRate;
        if (!currentBlinkRate) {
          const baseBlink = baseline.blink_rate || 15;

          // Nếu Stress > 50 (Medium/High): Blink rate bắt đầu biến động mạnh
          if (currentStress > 50) {
            // 70% cơ hội là chớp mắt nhanh (Nervous)
            if (Math.random() > 0.3) {
              currentBlinkRate = baseBlink + 10 + Math.random() * 15; // VD: 15 + 10 + rand = 25-40
            } else {
              // 30% cơ hội là nhìn chằm chằm (Staring - Cognitive Load)
              currentBlinkRate = baseBlink - 8 + Math.random() * 4; // VD: 15 - 8 = 7
            }
          } else {
            // Low stress: Ổn định
            currentBlinkRate = baseBlink + (Math.random() - 0.5) * 4;
          }
        }

        const blinkDelta = currentBlinkRate - baseline.blink_rate;
        // Giảm ngưỡng Alert xuống một chút để nhạy hơn
        if (blinkDelta > 10) {
          addTell(
            `Rapid Blinking (+${blinkDelta.toFixed(0)}/min)`,
            "blink_high",
            3
          );
        } else if (currentBlinkRate < 6 && baseline.blink_rate > 12) {
          addTell(`Unusual Staring (< 6/min)`, "blink_low", 3);
        }
        setBlinkMetrics((prev) => ({
          ...prev,
          rate: Math.round(currentBlinkRate),
        }));

        // 3. EMOTION LOGIC
        if (currentMetrics?.emotionData) {
          const currentNegScore =
            (currentMetrics.emotionData.fear || 0) +
            (currentMetrics.emotionData.angry || 0) +
            (currentMetrics.emotionData.disgust || 0) +
            (currentMetrics.emotionData.sad || 0);

          if (prevMetricsRef.current && prevMetricsRef.current.emotionData) {
            const prevNegScore =
              (prevMetricsRef.current.emotionData.fear || 0) +
              (prevMetricsRef.current.emotionData.angry || 0) +
              (prevMetricsRef.current.emotionData.disgust || 0) +
              (prevMetricsRef.current.emotionData.sad || 0);

            const diff = currentNegScore - prevNegScore;
            if (diff > 10) {
              const maxEmo = Object.entries(currentMetrics.emotionData).reduce(
                (a, b) => (a[1] > b[1] ? a : b)
              )[0];
              if (["fear", "angry", "disgust"].includes(maxEmo)) {
                addTell(
                  `Emotion worsening (Spike in ${maxEmo.toUpperCase()})`,
                  "emotion_worse",
                  5
                );
              } else {
                addTell(
                  `Negative emotion detected (+${diff.toFixed(0)}%)`,
                  "emotion_worse",
                  4
                );
              }
            }
          }
        }

        // 4. CLEANUP
        if (currentMetrics) {
          prevMetricsRef.current = {
            ...currentMetrics,
            bpm: currentMetrics.bpm,
          };
        }
      }, 1000);

      return () => clearInterval(interval);
    }
  }, [cameraActive, isCalibrating, baseline]);

  // TTL countdown for tells - auto-remove when expired
  useEffect(() => {
    if (tells.length === 0 || !cameraActive) return;

    const interval = setInterval(() => {
      setTells((prev) => {
        const updated = prev
          .map((tell) => ({
            ...tell,
            ttl: tell.ttl - 1,
          }))
          .filter((tell) => tell.ttl > 0);

        return updated;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [tells.length, cameraActive]);

  const addTell = (message, type) => {
    const newTell = {
      id: Date.now() + Math.random(),
      timestamp: Date.now() / 1000,
      message,
      type,
      ttl: 10, // 10 seconds
    };

    setTells((prev) => {
      // Remove existing tell of same type
      const filtered = prev.filter((t) => t.type !== type);
      return [...filtered, newTell];
    });

    // Backend: Send EVERY tell occurrence (including duplicates) for accurate counting
    if (wsRef.current && wsRef.current.connected && sessionId) {
      wsRef.current.emit("frontend_tell", {
        session_id: sessionId,
        type: type,
        message: message,
        timestamp: newTell.timestamp,
      });
      console.log("📤 Tell sent to backend:", type, message);
    }

    // Update truth meter based on tells count
    updateTruthMeter(tells.length + 1);
  };

  const updateTruthMeter = (tellCount) => {
    // Exclude BPM from tell count (if BPM is always shown)
    const actualTells = Math.max(0, tellCount - 1);
    // Base offset 30% + faster movement (70% / 3 tells max)
    const baseOffset = 30;
    const tellMultiplier = 70 / 3;
    const position = Math.min(100, baseOffset + actualTells * tellMultiplier);
    setTruthMeterPosition(position);
  };

  const triggerAlert = (data) => {
    playAlertSound();
    setShowAlert(true);
    const newAlert = {
      id: Date.now(),
      message: data.message || "ANOMALY DETECTED",
      type: data.type || "warning",
      timestamp: Date.now(),
    };
    setAlerts((prev) => [newAlert, ...prev].slice(0, 3));
    setTimeout(() => setShowAlert(false), 3000);
  };

  const audioCtxRef = useRef(null);
  // LOGIC XỬ LÝ ÂM THANH
  const initAudioContext = () => {
    if (!audioCtxRef.current) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      audioCtxRef.current = new AudioContext();
    }
    if (audioCtxRef.current.state === "suspended") {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  };

  const playAlertSound = () => {
    try {
      const ctx = initAudioContext();
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      oscillator.frequency.setValueAtTime(800, ctx.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(
        400,
        ctx.currentTime + 0.2
      );
      oscillator.type = "sawtooth";

      gainNode.gain.setValueAtTime(0.1, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);

      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + 0.2);
    } catch (error) {
      console.error("Audio error:", error);
    }
  };

  const getBpmColor = () => {
    if (!baseline.calibrated) return "text-gray-400";
    const delta = Math.abs(bpm - baseline.bpm);
    if (delta < 5) return "text-green-400";
    if (delta < 10) return "text-yellow-400";
    return "text-red-400";
  };

  const getEmotionColor = (emotion) => {
    const colors = {
      angry: "#ef4444",
      disgust: "#84cc16",
      fear: "#8b5cf6",
      happy: "#fbbf24",
      sad: "#3b82f6",
      surprise: "#ec4899",
      neutral: "#6b7280",
    };
    return colors[emotion] || "#6b7280";
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <div className="max-w-7xl mx-auto">
        {/* Alert System */}
        <AlertSystem
          alerts={alerts}
          showAlert={showAlert}
          onDismiss={() => setShowAlert(false)}
        />

        {/* Review Mode Modal */}
        {viewMode === "review" && selectedSession && (
          <ReviewMode
            sessionData={selectedSession}
            onClose={() => {
              setViewMode("history");
              setSelectedSession(null);
            }}
          />
        )}

        {/* Header with View Switcher */}
        <div className="mb-6 flex items-center justify-between gap-4">
          {/* View Mode Buttons */}
          <div className="flex gap-2">
            <button
              onClick={() => setViewMode("live")}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg transition ${
                viewMode === "live"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-700 text-gray-300 hover:bg-gray-600"
              }`}
            >
              <Video className="w-4 h-4" /> <span>Live Detection</span>
            </button>
            <button
              onClick={() => setViewMode("history")}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg transition ${
                viewMode === "history"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-700 text-gray-300 hover:bg-gray-600"
              }`}
            >
              <History className="w-4 h-4" /> <span>Session History</span>
            </button>
          </div>
          <div className="flex items-center gap-3">
            {baseline.calibrated && viewMode === "live" && (
              <>
                <div className="flex items-center gap-2 text-sm bg-green-900 bg-opacity-30 px-3 py-1 rounded-lg border border-green-600">
                  <Target className="w-4 h-4 text-green-400" />
                  <span className="text-green-400">
                    Baseline: {baseline.bpm.toFixed(1)} BPM
                  </span>
                </div>
                <button
                  onClick={handleEndSession}
                  className="bg-red-600 hover:bg-red-700 px-4 py-2 rounded-lg flex items-center gap-2 transition"
                >
                  <Square className="w-4 h-4" /> End Session
                </button>
              </>
            )}
          </div>
        </div>

        {viewMode === "history" ? (
          <SessionHistory
            onSelectSession={(session) => {
              setSelectedSession(session);
              setViewMode("review");
            }}
          />
        ) : (
          /* LIVE VIEW */
          <div className="grid grid-cols-12 gap-6">
            {/* Left Sidebar - Emotion */}
            <div className="col-span-3 space-y-4">
              <div className="bg-gray-800 rounded-lg p-5">
                {/* Header hiển thị Cảm xúc chính và Độ tin cậy tổng thể */}
                <h3 className="text-lg font-bold mb-4 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span>Emotion</span>
                    <span
                      className="text-sm px-3 py-1.5 rounded font-semibold capitalize"
                      style={{
                        backgroundColor: `${getEmotionColor(
                          dominantEmotion
                        )}20`,
                        color: getEmotionColor(dominantEmotion),
                      }}
                    >
                      {dominantEmotion}
                    </span>
                  </div>

                  {/* Thanh hiển thị Confidence (Độ tin cậy của AI) */}
                  <div className="flex items-center justify-between text-xs text-gray-400">
                    <span>AI Confidence:</span>
                    <span className="text-white font-mono">
                      {(emotionConfidence * 100).toFixed(1)}%
                    </span>
                  </div>
                  {baseline.calibrated && (
                    <div className="flex items-center justify-between text-xs text-gray-400 border-t border-gray-700 pt-2 mt-1">
                      <span>Baseline Emotion:</span>
                      <span
                        className="font-bold uppercase tracking-wider"
                        style={{ color: getEmotionColor(baseline.emotion) }}
                      >
                        {baseline.emotion}
                      </span>
                    </div>
                  )}
                </h3>

                {/* Danh sách các thanh xác suất từng cảm xúc */}
                <div className="space-y-3">
                  {Object.entries(emotionData).map(([emotion, value]) => (
                    <div key={emotion}>
                      <div className="flex justify-between text-sm mb-1.5">
                        <span className="capitalize font-medium text-gray-300">
                          {emotion}
                        </span>
                        {/* Hiển thị % chính xác của từng cảm xúc */}
                        <span className="text-gray-400 font-semibold text-xs">
                          {typeof value === "number" ? value.toFixed(1) : value}
                          %
                        </span>
                      </div>

                      {/* Thanh Progress Bar */}
                      <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500 ease-out"
                          style={{
                            width: `${value}%`, // value trong emotionData đã là thang 100
                            backgroundColor: getEmotionColor(emotion),
                            opacity: value > 0 ? 1 : 0.3,
                          }}
                        ></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Main Content */}
            <div className="col-span-6 space-y-4">
              {/* Truth Meter - Above Video */}
              {baseline.calibrated && cameraActive && (
                <TruthMeter
                  position={truthMeterPosition}
                  tellCount={tells.length}
                />
              )}

              {/* Video Feed with Calibration Overlay */}
              <div className="relative">
                {cameraActive && sessionId ? (
                  // <CameraFeed
                  //   sessionId={sessionId}
                  //   calibrated={baseline.calibrated}
                  //   onMetricsUpdate={handleFrontendMetrics}
                  // />
                  <CameraFeed
                    sessionId={sessionId}
                    calibrated={baseline.calibrated}
                    onMetricsUpdate={handleFrontendMetrics}
                    onVideoRecorded={(blob) => {
                      console.log(
                        "📹 Video received from CameraFeed, size:",
                        blob.size
                      );
                      videoBlobRef.current = blob;
                      setSessionVideoBlob(blob);
                    }}
                    onRecorderReady={(recorder) => {
                      mediaRecorderRef.current = recorder;
                      console.log("🎤 MediaRecorder ref saved");
                    }}
                  />
                ) : (
                  <div className="bg-gray-800 rounded-lg overflow-hidden relative">
                    <div className="aspect-video bg-gray-700 flex items-center justify-center relative">
                      <div className="text-center">
                        <Eye className="w-16 h-16 mx-auto mb-4 text-gray-500" />
                        <p className="text-gray-400 mb-2">
                          Camera Feed Inactive
                        </p>
                        <button
                          onClick={startCalibration}
                          className="mt-4 px-6 py-2 bg-green-600 hover:bg-green-700 rounded-lg transition font-semibold"
                        >
                          Start Calibration
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Calibration Progress - Top Right Corner Overlay */}
                {cameraActive && isCalibrating && (
                  <div className="absolute top-3 right-3 bg-blue-900 bg-opacity-90 backdrop-blur-sm border border-blue-400 rounded-md px-3 py-2 shadow-lg z-10">
                    <div className="flex items-center gap-2">
                      <Activity className="w-4 h-4 text-blue-400 animate-spin" />
                      <span className="text-xs font-semibold text-blue-400">
                        {calibrationProgress}%
                      </span>
                    </div>
                    <div className="w-24 h-1 bg-gray-700 rounded-full overflow-hidden mt-1.5">
                      <div
                        className="h-full bg-blue-500 rounded-full transition-all duration-300"
                        style={{ width: `${calibrationProgress}%` }}
                      ></div>
                    </div>
                  </div>
                )}
              </div>

              {cameraActive && !isCalibrating && !baseline.calibrated && (
                <div className="bg-gray-800 rounded-lg overflow-hidden relative">
                  <div className="aspect-video bg-gray-700 flex items-center justify-center relative">
                    <div className="relative">
                      <div className="w-64 h-80 border-2 border-green-400 rounded-lg relative">
                        {/* Mockup UI landmarks */}
                        <div className="absolute top-20 left-16 w-4 h-4 bg-green-400 rounded-full animate-pulse"></div>
                        <div className="absolute top-20 right-16 w-4 h-4 bg-green-400 rounded-full animate-pulse"></div>
                        <div className="absolute top-32 left-1/2 -translate-x-1/2 w-4 h-4 bg-green-400 rounded-full animate-pulse"></div>
                        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 w-12 h-6 border-2 border-yellow-400 rounded-full"></div>

                        {lipCompression && (
                          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-yellow-500 px-4 py-2 rounded flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4" />
                            <span className="text-sm font-semibold">
                              Lip Compression
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Status Bar & Detection Tells */}
              <div className="space-y-3">
                <div
                  className={`${
                    stressColor.includes("green")
                      ? "bg-green-900 border-green-600"
                      : stressColor.includes("yellow")
                      ? "bg-yellow-900 border-yellow-600"
                      : "bg-red-900 border-red-600"
                  } border-2 rounded-lg p-4 flex items-center justify-between`}
                >
                  <div>
                    <span className="text-lg font-bold">
                      {isCalibrating
                        ? "Status: Calibrating baseline..."
                        : baseline.calibrated
                        ? `Status: ${stressLevel}`
                        : "Status: Ready to calibrate"}
                    </span>
                  </div>
                  {analyzing && (
                    <div className="flex gap-1.5">
                      <div className="w-3 h-3 bg-green-400 rounded-full animate-pulse"></div>
                      <div
                        className="w-3 h-3 bg-green-400 rounded-full animate-pulse"
                        style={{ animationDelay: "0.2s" }}
                      ></div>
                      <div
                        className="w-3 h-3 bg-green-400 rounded-full animate-pulse"
                        style={{ animationDelay: "0.4s" }}
                      ></div>
                    </div>
                  )}
                </div>

                {/* Detection Tells */}
                {tells.map((tell) => (
                  <div
                    key={tell.id}
                    className="bg-yellow-900 bg-opacity-50 border-2 border-yellow-600 rounded-lg p-3 flex items-center justify-between animate-pulse"
                  >
                    <span className="text-base font-semibold text-yellow-200">
                      {tell.message}
                    </span>
                    <span className="text-sm text-yellow-400 font-bold">
                      {tell.ttl}s
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Right Sidebar - Blink & Hand */}
            <div className="col-span-3 space-y-4">
              {/* Heart Rate */}
              <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
                <h4 className="text-gray-400 text-xs font-bold uppercase mb-2 flex items-center gap-2">
                  <Heart className="w-4 h-4 text-red-500" /> Heart Rate
                </h4>
                <div className="flex items-end justify-between">
                  <div>
                    <span className="text-3xl font-bold text-white">
                      {bpm.toFixed(0)}
                    </span>
                    <span className="text-sm text-gray-500 ml-1">BPM</span>
                  </div>
                  {baseline.calibrated && (
                    <div
                      className={`text-sm font-bold ${
                        Math.abs(bpm - baseline.bpm) > 10
                          ? "text-red-400"
                          : "text-green-400"
                      }`}
                    >
                      {bpm > baseline.bpm ? "+" : ""}
                      {(bpm - baseline.bpm).toFixed(0)} vs Base
                    </div>
                  )}
                </div>
              </div>

              {/* Blink Analysis */}
              <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
                <h4 className="text-gray-400 text-xs font-bold uppercase mb-2 flex items-center gap-2">
                  <Eye className="w-4 h-4 text-blue-400" /> Blink Rate
                </h4>
                <div className="flex justify-between items-center mb-2">
                  <div className="text-2xl font-bold">
                    {blinkMetrics.rate}{" "}
                    <span className="text-sm font-normal text-gray-500">
                      /min
                    </span>
                  </div>
                  {baseline.calibrated && (
                    <div className="text-xs px-2 py-1 bg-gray-700 rounded text-gray-300">
                      Base: {baseline.blink_rate}
                    </div>
                  )}
                </div>
                {/* Visual Indicator */}
                <div className="w-full bg-gray-700 h-1.5 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 ${
                      blinkMetrics.rate > 35
                        ? "bg-red-500"
                        : blinkMetrics.rate < 5
                        ? "bg-yellow-500"
                        : "bg-green-500"
                    }`}
                    style={{
                      width: `${Math.min(
                        100,
                        (blinkMetrics.rate / 50) * 100
                      )}%`,
                    }}
                  ></div>
                </div>
                <div className="flex justify-between text-[10px] text-gray-500 mt-1">
                  <span>Stare</span>
                  <span>Normal</span>
                  <span>Panic</span>
                </div>
              </div>

              {/* Behavioral Flags */}
              <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
                <h4 className="text-gray-400 text-xs font-bold uppercase mb-3 flex items-center gap-2">
                  <Activity className="w-4 h-4 text-orange-400" /> Behavioral
                  Flags
                </h4>

                <div className="space-y-2">
                  {/* Hand */}
                  <div
                    className={`flex items-center justify-between p-2 rounded transition-colors ${
                      handMetrics.isTouching
                        ? "bg-red-900/30 border border-red-500/50"
                        : "bg-gray-700/30"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Hand
                        className={`w-4 h-4 ${
                          handMetrics.isTouching
                            ? "text-red-400"
                            : "text-gray-500"
                        }`}
                      />
                      <span className="text-sm text-gray-300">
                        Hand-to-Face
                      </span>
                    </div>
                    <span
                      className={`text-xs font-bold ${
                        handMetrics.isTouching
                          ? "text-red-400 animate-pulse"
                          : "text-gray-500"
                      }`}
                    >
                      {handMetrics.isTouching ? "DETECTED" : "SAFE"}
                    </span>
                  </div>

                  {/* Lip */}
                  <div
                    className={`flex items-center justify-between p-2 rounded transition-colors ${
                      lipCompression
                        ? "bg-yellow-900/30 border border-yellow-500/50"
                        : "bg-gray-700/30"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <AlertTriangle
                        className={`w-4 h-4 ${
                          lipCompression ? "text-yellow-400" : "text-gray-500"
                        }`}
                      />
                      <span className="text-sm text-gray-300">
                        Lip Compression
                      </span>
                    </div>
                    <span
                      className={`text-xs font-bold ${
                        lipCompression ? "text-yellow-400" : "text-gray-500"
                      }`}
                    >
                      {lipCompression ? "DETECTED" : "SAFE"}
                    </span>
                  </div>

                  {/* Gaze */}
                  <div
                    className={`flex items-center justify-between p-2 rounded transition-colors ${
                      gazeDetected
                        ? "bg-purple-900/30 border border-purple-500/50"
                        : "bg-gray-700/30"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Eye
                        className={`w-4 h-4 ${
                          gazeDetected ? "text-purple-400" : "text-gray-500"
                        }`}
                      />
                      <span className="text-sm text-gray-300">Gaze Shift</span>
                    </div>
                    <span
                      className={`text-xs font-bold ${
                        gazeDetected ? "text-purple-400" : "text-gray-500"
                      }`}
                    >
                      {gazeDetected ? "DETECTED" : "STABLE"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* AI Analysis Modal - Shows on top of everything */}
      {showAiAnalysis && aiAnalysis && (
        <AIAnalysisModal
          analysis={aiAnalysis}
          onClose={() => {
            setShowAiAnalysis(false);
            setAiAnalysis(null);
          }}
        />
      )}

      {/* AI Analysis Loading Overlay */}
      {isAnalyzingSession && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-gray-800 rounded-2xl p-8 shadow-2xl border border-purple-500/30 max-w-md animate-pulse">
            <div className="flex flex-col items-center space-y-4">
              <div className="relative">
                <div className="w-16 h-16 border-4 border-purple-500/30 border-t-purple-500 rounded-full animate-spin"></div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <svg
                    className="w-8 h-8 text-purple-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                    />
                  </svg>
                </div>
              </div>
              <div className="text-center">
                <h3 className="text-xl font-bold text-white mb-2">
                  AI Đang Phân Tích...
                </h3>
                <p className="text-gray-400 text-sm">
                  Vui lòng đợi trong giây lát
                </p>
                <p className="text-purple-400 text-xs mt-2">
                  AI đang xử lý dữ liệu phiên làm việc
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
