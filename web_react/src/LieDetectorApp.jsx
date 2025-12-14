import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Activity,
  Eye,
  Hand,
  Heart,
  AlertTriangle,
  Target,
  History,
  Video,
  Square,
  ShieldAlert,
  Zap,
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

  // --- REFS CHO CALIBRATION (QUAN TRỌNG) ---
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
  const alertAudioRef = useRef(null);

  // Truth meter
  const [truthMeterPosition, setTruthMeterPosition] = useState(30);
  const [deceptionRisk, setDeceptionRisk] = useState(0);

  // Refs for socket
  const wsRef = useRef(null);

  // Handle ending session
  const handleEndSession = async () => {
    if (!sessionId) return;

    try {
      // Save session data
      const sessionData = {
        session_id: sessionId,
        session_name: `Session_${new Date()
          .toISOString()
          .replace(/[:.]/g, "-")
          .slice(0, -5)}`,
        start_time: Date.now() / 1000,
        end_time: Date.now() / 1000,
        baseline: baseline,
        tells: tells,
        metrics: {
          bpm: bpm,
          emotion: dominantEmotion,
          stress_level: stressLevel,
        },
      };

      // Call backend to end session
      await api.endSession(sessionId, sessionData);

      // Reset state
      setCameraActive(false);
      setSessionId(null);
      setBaseline({
        bpm: 0,
        blink_rate: 0,
        gaze_stability: 0,
        emotion: "neutral",
        hand_baseline_count: 0,
        calibrated: false,
      });
      setTells([]);
      setDeceptionRisk(0);
      setStressScore(0);
      setStressLevel("LOW STRESS");

      // Disconnect websocket
      if (wsRef.current) {
        wsRef.current.disconnect();
      }

      alert("Session ended and saved successfully!");
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

      socket.on("metrics_update", (data) => {
        updateMetrics(data);
      });

      socket.on("detection_tell", (data) => {
        if (data.message) {
          addTell(data.message, data.type || "detection");
        }
      });

      socket.on("high_stress_alert", (data) => {
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

  // --- 6. LOGIC TÍNH STRESS LEVEL (Tích hợp thêm để hiển thị Score) ---
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

    // 1. Blink Score (Nhạy hơn)
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
      // const normalRateMin = 10;
      // const normalRateMax = 30;

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
    // calculateStressLevel(metrics, Math.abs(bpm - baseline.bpm));
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
        // emotion: backendBaseline.emotion || "neutral",
        // emotion: dominantEmotion, // Cảm xúc chủ đạo lúc calibrate
        // emotion: maxEmo, // Ghi nhận Baseline Emotion là cảm xúc cao nhất lúc này
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

  // Real-time monitoring after calibration
  // useEffect(() => {
  //   if (cameraActive && !isCalibrating && baseline.calibrated) {
  //     const interval = setInterval(() => {
  //       // Update BPM with variation (Simulation)
  //       setBpm((prev) => {
  //         const variance = (Math.random() - 0.5) * 8;
  //         const newBpm = Math.max(50, Math.min(95, prev + variance));
  //         // Check for significant BPM change
  //         const delta = Math.abs(newBpm - baseline.bpm);
  //         if (delta > 10 && Math.random() > 0.7) {
  //           const changeType = newBpm > baseline.bpm ? "increase" : "decrease";
  //           addTell(
  //             `Heart rate ${changeType} (+${delta.toFixed(1)} BPM)`,
  //             "bpm"
  //           );
  //         }
  //         return newBpm;
  //       });

  //       // Random lip & gaze simulation (Backup if camera misses)
  //       if (Math.random() > 0.95) {
  //         setLipCompression(true);
  //         addTell("Lip compression detected", "lips");
  //         setTimeout(() => setLipCompression(false), 2000);
  //       }
  //       if (Math.random() > 0.98) {
  //         addTell("Gaze shift detected", "gaze");
  //       }
  //     }, 2000);

  //     return () => clearInterval(interval);
  //   }
  // }, [cameraActive, isCalibrating, baseline]);

  // // ========================================================================
  // // CORE MONITORING & SIMULATION ENGINE
  // // ========================================================================
  // useEffect(() => {
  //   // Chỉ chạy khi Camera Active, Đã Calibrate và Không đang Calibrate
  //   if (cameraActive && !isCalibrating && baseline.calibrated) {
  //     const interval = setInterval(() => {
  //       // Lấy tất cả dữ liệu cần thiết từ Refs (để không phụ thuộc vào render cycle)
  //       const currentMetrics = latestMetricsRef.current;
  //       const currentStress = stressScoreRef.current || 0; // Stress hiện tại (0-100)

  //       // ------------------------------------------------------------------
  //       // 1. HEART RATE LOGIC (BPM) - "CHASE THE STRESS"
  //       // ------------------------------------------------------------------
  //       setBpm((prevBpm) => {
  //         let nextBpm = prevBpm;
  //         const realBpm = currentMetrics?.bpm;

  //         // A. Ưu tiên dữ liệu thật (nếu tin cậy)
  //         if (realBpm && realBpm > 45) {
  //           // Smoothing: 80% số cũ + 20% số mới (tránh giật cục)
  //           nextBpm = prevBpm * 0.8 + realBpm * 0.2;
  //         }
  //         // B. Nếu mất dữ liệu thật -> Giả lập dựa trên Stress Score
  //         else {
  //           const base = baseline.bpm || 70;
  //           // Target: Stress càng cao, nhịp tim đích càng xa Baseline
  //           // VD: Stress 0 -> Target = Base. Stress 100 -> Target = Base + 40.
  //           const targetBpm = base + (currentStress / 100) * 40;

  //           // Movement: Mỗi giây nhích 10% về phía Target (Tạo cảm giác tim tăng dần)
  //           const distance = targetBpm - prevBpm;
  //           nextBpm = prevBpm + distance * 0.1;

  //           // Noise: Thêm nhiễu hô hấp tự nhiên (±1.5 nhịp)
  //           nextBpm += (Math.random() - 0.5) * 3;
  //         }

  //         // C. Kiểm tra Alert BPM
  //         // Dùng nextBpm vừa tính để so sánh ngay
  //         const bpmDelta = nextBpm - baseline.bpm;
  //         if (Math.abs(bpmDelta) > 10) {
  //           // Ngưỡng: Lệch 10 nhịp so với Baseline
  //           const type = bpmDelta > 0 ? "increase" : "decrease";
  //           const sign = bpmDelta > 0 ? "+" : "";
  //           addTell(
  //             `Heart rate ${type} (${sign}${bpmDelta.toFixed(0)} BPM)`,
  //             "bpm_monitor",
  //             4
  //           );
  //         }

  //         return Math.max(50, Math.min(160, nextBpm)); // Kẹp giá trị an toàn
  //       });

  //       // ------------------------------------------------------------------
  //       // 2. BLINK RATE LOGIC - STRESS RESPONSE
  //       // ------------------------------------------------------------------
  //       // Lấy Blink Rate thật hoặc giả lập
  //       let currentBlinkRate = currentMetrics?.blinkRate;

  //       // Nếu không có dữ liệu thật, giả lập Blink Rate dựa trên Stress
  //       if (!currentBlinkRate) {
  //         // Stress thấp (0-30): Blink ổn định quanh Baseline (VD: 15-20)
  //         // Stress cao (>60): Blink tăng vọt (Nervous) hoặc giảm sâu (Staring)
  //         const baseBlink = baseline.blink_rate || 15;

  //         if (currentStress > 60) {
  //           // Nervous simulation: Tăng tốc độ chớp mắt
  //           // Random biến động mạnh hơn khi stress cao
  //           currentBlinkRate = baseBlink + Math.random() * 20;
  //         } else {
  //           // Normal simulation
  //           currentBlinkRate = baseBlink + (Math.random() - 0.5) * 5;
  //         }
  //       }

  //       // Logic Alert cho Blink
  //       const blinkDelta = currentBlinkRate - baseline.blink_rate;

  //       // Ngưỡng Alert: Tăng > 12 lần/phút (Lo lắng) hoặc Giảm < -8 (Nhìn chằm chằm)
  //       if (blinkDelta > 12) {
  //         addTell(
  //           `Rapid Blinking (+${blinkDelta.toFixed(0)}/min)`,
  //           "blink_high",
  //           3
  //         );
  //       } else if (currentBlinkRate < 5 && baseline.blink_rate > 10) {
  //         // Chỉ báo Staring nếu baseline vốn dĩ cao hơn 10
  //         addTell(`Unusual Staring (< 5/min)`, "blink_low", 3);
  //       }

  //       // Cập nhật lại UI state cho mượt (nếu đang dùng số giả lập)
  //       setBlinkMetrics((prev) => ({
  //         ...prev,
  //         rate: Math.round(currentBlinkRate),
  //       }));

  //       // ------------------------------------------------------------------
  //       // 3. EMOTION LOGIC - REAL-TIME WORSENING DETECTION
  //       // ------------------------------------------------------------------
  //       if (currentMetrics?.emotionData) {
  //         // Tính tổng điểm tiêu cực hiện tại (Fear + Angry + Disgust + Sad)
  //         const currentNegScore =
  //           (currentMetrics.emotionData.fear || 0) +
  //           (currentMetrics.emotionData.angry || 0) +
  //           (currentMetrics.emotionData.disgust || 0) +
  //           (currentMetrics.emotionData.sad || 0);

  //         // So sánh với dữ liệu của vòng lặp trước (Previous Frame)
  //         if (prevMetricsRef.current && prevMetricsRef.current.emotionData) {
  //           const prevNegScore =
  //             (prevMetricsRef.current.emotionData.fear || 0) +
  //             (prevMetricsRef.current.emotionData.angry || 0) +
  //             (prevMetricsRef.current.emotionData.disgust || 0) +
  //             (prevMetricsRef.current.emotionData.sad || 0);

  //           const diff = currentNegScore - prevNegScore;

  //           // Nếu tiêu cực tăng > 10% trong vòng 1 giây -> Cảnh báo ngay
  //           if (diff > 10) {
  //             // Tìm cảm xúc nào tăng mạnh nhất để báo cụ thể
  //             const maxEmo = Object.entries(currentMetrics.emotionData).reduce(
  //               (a, b) => (a[1] > b[1] ? a : b)
  //             )[0];
  //             if (["fear", "angry", "disgust"].includes(maxEmo)) {
  //               addTell(
  //                 `Emotion worsening (Spike in ${maxEmo.toUpperCase()})`,
  //                 "emotion_worse",
  //                 5
  //               );
  //             } else {
  //               addTell(
  //                 `Negative emotion detected (+${diff.toFixed(0)}%)`,
  //                 "emotion_worse",
  //                 4
  //               );
  //             }
  //           }
  //         }
  //       }

  //       // ------------------------------------------------------------------
  //       // 4. CLEANUP & SAVE REF
  //       // ------------------------------------------------------------------
  //       // Lưu metrics hiện tại làm "Quá khứ" cho vòng lặp sau so sánh
  //       if (currentMetrics) {
  //         prevMetricsRef.current = {
  //           ...currentMetrics,
  //           bpm: currentMetrics.bpm, // Lưu ý: giữ bpm gốc nếu có
  //         };
  //       }
  //     }, 1000); // CHU KỲ: 1 GIÂY (Đủ mượt cho UI)

  //     return () => clearInterval(interval);
  //   }
  // }, [cameraActive, isCalibrating, baseline]);
  // Lưu ý: Không đưa 'bpm' vào dependency array để tránh vòng lặp vô tận,
  // chúng ta dùng functional update setBpm(prev => ...) là an toàn nhất.

  // useEffect: Monitor & Simulation (ADRENALINE MODE)
  useEffect(() => {
    // Chỉ chạy khi Camera Active, Đã Calibrate và Không đang Calibrate
    if (cameraActive && !isCalibrating && baseline.calibrated) {
      const interval = setInterval(() => {
        // Lấy dữ liệu từ Refs
        const currentMetrics = latestMetricsRef.current;
        const currentStress = stressScoreRef.current || 0; // Stress hiện tại (0-100)

        // ------------------------------------------------------------------
        // 1. HEART RATE LOGIC (BPM) - "ADRENALINE RUSH"
        // ------------------------------------------------------------------
        setBpm((prevBpm) => {
          let nextBpm = prevBpm;
          const realBpm = currentMetrics?.bpm;

          // A. Ưu tiên dữ liệu thật (nếu có và hợp lệ > 45)
          if (realBpm && realBpm > 45) {
            nextBpm = prevBpm * 0.8 + realBpm * 0.2;
          }
          // B. Giả lập dựa trên Stress Score (Logic mới: Nhạy hơn)
          else {
            const base = baseline.bpm || 70;

            // --- CHANGE 1: TĂNG TRẦN (CEILING) ---
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

        // ------------------------------------------------------------------
        // 2. BLINK RATE LOGIC (ĐỒNG BỘ VỚI STRESS)
        // ------------------------------------------------------------------
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

        // ------------------------------------------------------------------
        // 3. EMOTION LOGIC (Giữ nguyên - Đã tốt)
        // ------------------------------------------------------------------
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

  // --- 7. LOGIC ADD TELL + COUNTDOWN (Tích hợp TTL) ---
  const addTell = (message, type, ttl = 10) => {
    setTells((prev) => {
      // Chặn spam: Nếu đã có lỗi cùng loại trong list thì reset TTL của lỗi đó thay vì thêm mới
      const exists = prev.find((t) => t.type === type);
      if (exists) {
        return prev.map((t) =>
          t.type === type ? { ...t, ttl: ttl, message: message } : t
        );
      }

      const newTell = {
        id: Date.now() + Math.random(),
        message,
        type,
        ttl,
      };

      // Nếu lỗi nghiêm trọng -> Alert ngay
      if (["fear", "bpm_spike"].includes(type)) {
        triggerAlert({ message: message, type: "critical" });
      }

      return [...prev, newTell];
    });
  };

  // Effect đếm ngược TTL
  useEffect(() => {
    const timer = setInterval(() => {
      setTells((prevTells) => {
        if (prevTells.length === 0) return [];
        const updated = prevTells
          .map((t) => ({ ...t, ttl: t.ttl - 1 }))
          .filter((t) => t.ttl > 0);
        // updateTruthMeter(updated.length);
        return updated;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Logic: Tính Deception Risk dựa trên số lượng Tells hiện tại
  useEffect(() => {
    // Mỗi lỗi nhẹ +15%, lỗi nặng +25%. Tối đa 100%.
    const risk = Math.min(
      100,
      tells.reduce((acc, tell) => {
        const weight = ["fear", "bpm_spike", "blink_high"].includes(tell.type)
          ? 25
          : 15;
        return acc + weight;
      }, 0)
    );
    setDeceptionRisk(risk);
  }, [tells]);

  const updateTruthMeter = (tellCount) => {
    const actualTells = Math.max(0, tellCount); // Đếm chính xác số lỗi hiện tại
    const baseOffset = 30;
    const tellMultiplier = 20; // Mỗi tell tăng 20 điểm
    const position = Math.min(100, baseOffset + actualTells * tellMultiplier);
    setTruthMeterPosition(position);
  };

  // 3. THÊM useEffect MỚI: Tự động tính TruthMeter mỗi khi tells thay đổi
  useEffect(() => {
    // Logic tính toán:
    const actualTells = tells.length;

    // Nếu bạn muốn giữ logic "Kim chỉ mức độ nói dối" (Càng cao càng dối):
    const baseOffset = 20;
    const tellMultiplier = 20;
    const position = Math.min(100, baseOffset + actualTells * tellMultiplier);

    setTruthMeterPosition(position);
  }, [tells]); // Chỉ chạy khi tells thay đổi

  // const triggerAlert = (data) => {
  //   playAlertSound();
  //   setShowAlert(true);
  //   const alert = {
  //     id: Date.now(),
  //     message: data.message || "HIGH STRESS DETECTED",
  //     confidence: data.confidence || 0.8,
  //     indicators: data.indicators || [],
  //     timestamp: Date.now(),
  //   };
  //   setAlerts((prev) => [alert, ...prev].slice(0, 3));
  //   setTimeout(() => setShowAlert(false), 3000);
  // };

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

  // const playAlertSound = () => {
  //   try {
  //     const audioContext = new (window.AudioContext ||
  //       window.webkitAudioContext)();
  //     const oscillator = audioContext.createOscillator();
  //     const gainNode = audioContext.createGain();
  //     oscillator.connect(gainNode);
  //     gainNode.connect(audioContext.destination);
  //     oscillator.frequency.value = 750;
  //     oscillator.type = "sine";
  //     gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
  //     gainNode.gain.exponentialRampToValueAtTime(
  //       0.01,
  //       audioContext.currentTime + 0.18
  //     );
  //     oscillator.start(audioContext.currentTime);
  //     oscillator.stop(audioContext.currentTime + 0.18);
  //   } catch (error) {
  //     console.error("Error playing alert sound:", error);
  //   }
  // };

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
        <AlertSystem
          alerts={alerts}
          showAlert={showAlert}
          onDismiss={() => setShowAlert(false)}
        />
        {viewMode === "review" && selectedSession && (
          <ReviewMode
            sessionData={selectedSession}
            onClose={() => {
              setViewMode("history");
              setSelectedSession(null);
            }}
          />
        )}

        {/* Header */}
        <div className="mb-6 flex items-center justify-between gap-4">
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

            {/* Main Video */}
            <div className="col-span-6 space-y-4">
              {baseline.calibrated && cameraActive && (
                <TruthMeter
                  position={truthMeterPosition}
                  tellCount={tells.length}
                />
              )}
              <div className="relative">
                {cameraActive && sessionId ? (
                  <CameraFeed
                    sessionId={sessionId}
                    calibrated={baseline.calibrated}
                    onMetricsUpdate={handleFrontendMetrics}
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
                {/* Calibration Progress */}
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

              {/* Overlay Face Model (Only during Calibration/Setup) */}
              {cameraActive && !isCalibrating && !baseline.calibrated && (
                <div className="bg-gray-800 rounded-lg overflow-hidden relative">
                  <div className="aspect-video bg-gray-700 flex items-center justify-center relative">
                    <div className="w-64 h-80 border-2 border-green-400 rounded-lg relative">
                      {/* Mockup UI landmarks */}
                      <div className="absolute top-20 left-16 w-4 h-4 bg-green-400 rounded-full animate-pulse"></div>
                      <div className="absolute top-20 right-16 w-4 h-4 bg-green-400 rounded-full animate-pulse"></div>
                      {lipCompression && (
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-yellow-500 px-4 py-2 rounded flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4" />{" "}
                          <span className="text-sm font-semibold">
                            Lip Compression
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Status & Tells */}
              {/* {cameraActive && baseline.calibrated && (
                <>
                  <div className="flex gap-4 items-center">
                    <div
                      className={`bg-gray-900 bg-opacity-80 rounded-lg p-4 flex items-center gap-3 ${getBpmColor()}`}
                    >
                      <Heart className="w-7 h-7" />
                      <span className="text-3xl font-bold">
                        {bpm.toFixed(1)} BPM
                      </span>
                      {baseline.calibrated && (
                        <span className="text-sm font-semibold">
                          (
                          {(
                            ((bpm - baseline.bpm) / baseline.bpm) *
                            100
                          ).toFixed(0)}
                          %)
                        </span>
                      )}
                    </div>

                    <div className="bg-gray-900 bg-opacity-80 rounded-lg p-3">
                      <svg width="280" height="70">
                        <polyline
                          fill="none"
                          stroke="#10b981"
                          strokeWidth="3"
                          points={Array.from({ length: 50 }, (_, i) => {
                            const x = i * 5.6;
                            const y =
                              35 + Math.sin(i * 0.3 + Date.now() * 0.01) * 20;
                            return `${x},${y}`;
                          }).join(" ")}
                        />
                      </svg>
                    </div>
                  </div>
                </>
              )} */}

              {/* Status Bar & Detection Tells */}
              <div className="space-y-3">
                <div
                  className={`${
                    stressColor.includes("green")
                      ? "bg-green-900 border-green-600"
                      : stressColor.includes("yellow")
                      ? "bg-yellow-900 border-yellow-600"
                      : "bg-red-900 border-red-600"
                  } border-2 rounded-lg p-4 flex items-center justify-between transition-colors duration-500`}
                >
                  {/* --- PHẦN ĐƯỢC CHỈNH SỬA: HIỂN THỊ LEVEL VÀ SCORE --- */}
                  <div className="flex flex-col">
                    <span className="text-lg font-bold uppercase tracking-wide">
                      {isCalibrating
                        ? "Status: Calibrating..."
                        : baseline.calibrated
                        ? `Status: ${stressLevel}`
                        : "Status: Ready"}
                    </span>

                    {/* Hiển thị dòng Score nếu đã Calibrate xong */}
                    {baseline.calibrated && !isCalibrating && (
                      <div className="text-sm font-medium mt-1 flex items-center gap-3 text-white/90">
                        <span>Score: {stressScore.toFixed(0)}/100</span>

                        {/* Thanh progress bar nhỏ minh họa Score */}
                        <div className="w-24 h-2 bg-black/30 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-white/90 transition-all duration-500 ease-out"
                            style={{ width: `${Math.min(100, stressScore)}%` }}
                          ></div>
                        </div>
                      </div>
                    )}
                  </div>
                  {/* --------------------------------------------------- */}

                  {analyzing && (
                    <div className="flex gap-1.5">
                      <div className="w-3 h-3 bg-white rounded-full animate-pulse"></div>
                      <div
                        className="w-3 h-3 bg-white rounded-full animate-pulse"
                        style={{ animationDelay: "0.2s" }}
                      ></div>
                      <div
                        className="w-3 h-3 bg-white rounded-full animate-pulse"
                        style={{ animationDelay: "0.4s" }}
                      ></div>
                    </div>
                  )}
                </div>

                {/* Detection Tells (Giữ nguyên) */}
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
            {/* 3. RIGHT COLUMN: METRICS BREAKDOWN */}
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
    </div>
  );
}
