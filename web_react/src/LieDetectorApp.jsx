import React, { useState, useEffect, useRef } from "react";
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
  const latestMetricsRef = useRef({ blinkRate: 0, handTouchTotal: 0 });
  const calibrationStartRef = useRef({ handTouchTotal: 0, startTime: 0 });

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

  const wsRef = useRef(null);

  // --- STATE DỮ LIỆU ---
  const [baseline, setBaseline] = useState({
    bpm: 70, // Default value để tránh lỗi chia cho 0 khi render
    blink_rate: 15,
    gaze_stability: 0.15,
    emotion: "neutral",
    hand_baseline_count: 0,
    calibrated: false,
  });

  // Real-time metrics
  const [bpm, setBpm] = useState(0);
  const [blinkMetrics, setBlinkMetrics] = useState({ rate: 0, count: 0 });
  const [handMetrics, setHandMetrics] = useState({
    count: 0,
    isTouching: false,
  });

  // Baseline emotion distribution
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

  // Các biến hành vi & Stress
  const [gestureScore, setGestureScore] = useState(85);
  const [lipCompression, setLipCompression] = useState(false);
  const [gazeDetected, setGazeDetected] = useState(false); // State cho Gaze Shift UI
  const [analyzing, setAnalyzing] = useState(false);

  // Stress Level State (Logic Mới tích hợp)
  const [stressLevel, setStressLevel] = useState("LOW STRESS");
  const [stressScore, setStressScore] = useState(0);
  const [stressColor, setStressColor] = useState("text-green-400");

  // Detection tells & Alerts
  const [tells, setTells] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [showAlert, setShowAlert] = useState(false);
  const [truthMeterPosition, setTruthMeterPosition] = useState(30);

  // --- 1. XỬ LÝ END SESSION (Logic gốc) ---
  const handleEndSession = async () => {
    if (!sessionId) return;
    try {
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
        metrics: { bpm, emotion: dominantEmotion, stress_level: stressLevel },
      };

      await api.endSession(sessionId, sessionData);

      // Reset state
      setCameraActive(false);
      setSessionId(null);
      setBaseline({
        bpm: 70,
        blink_rate: 15,
        gaze_stability: 0,
        emotion: "neutral",
        hand_baseline_count: 0,
        calibrated: false,
      });
      setTells([]);
      setStressScore(0);
      setStressLevel("LOW STRESS");

      if (wsRef.current) wsRef.current.disconnect();
      alert("Session ended and saved successfully!");
    } catch (error) {
      console.error("Error ending session:", error);
      alert("Failed to end session");
    }
  };

  // --- 2. SOCKET IO (Logic gốc) ---
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

      socket.on("metrics_update", (data) => updateMetrics(data));

      socket.on("detection_tell", (data) => {
        if (data.message) addTell(data.message, data.type || "detection", 10);
      });

      socket.on("high_stress_alert", (data) => triggerAlert(data));

      return () => {
        if (socket) socket.disconnect();
      };
    }
  }, [cameraActive, baseline.calibrated, sessionId]);

  // --- 3. LOGIC UPDATE METRICS TỪ SOCKET ---
  const updateMetrics = (data) => {
    if (data.bpm) setBpm(data.bpm);
    if (data.emotion_data) setEmotionData(data.emotion_data);
    if (data.dominant_emotion) setDominantEmotion(data.dominant_emotion);
    if (data.emotion_confidence) setEmotionConfidence(data.emotion_confidence);
    if (data.gesture_score) setGestureScore(data.gesture_score);

    // Cập nhật Stress Level từ Backend (nếu có)
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
          ttl: 10, // Default TTL cho socket tells
        }))
      );
    }
  };

  // --- 4. LOGIC XỬ LÝ METRICS TỪ FRONTEND (Logic Gốc Quan Trọng) ---
  const handleFrontendMetrics = (metrics) => {
    console.log("Frontend metrics:", metrics);
    latestMetricsRef.current = metrics;

    // 1. Xử lý update Emotion
    if (metrics.emotionData) {
      setEmotionData(metrics.emotionData);
      setDominantEmotion(metrics.dominantEmotion);
      setEmotionConfidence(metrics.emotionConfidence);

      if (isCalibrating) {
        Object.entries(metrics.emotionData).forEach(([key, val]) => {
          calibrationEmotionsAccRef.current[key] =
            (calibrationEmotionsAccRef.current[key] || 0) + val;
        });
      }

      if (baseline.calibrated && baselineEmotion) {
        checkEmotionDeviation(metrics.emotionData);
      }
    }

    // 2. Cập nhật UI State
    setBlinkMetrics({ rate: metrics.blinkRate, count: metrics.blinkCount });
    setHandMetrics({
      count: metrics.handTouchTotal || 0,
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
          "blink_high",
          10
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
          "blink_low",
          10
        );
      }

      // Hand-to-face contact
      if (metrics.currentHandToFace) {
        addTell("Hand-to-face contact detected", "gesture", 8);
      }

      // Lip Compression
      if (metrics.isLipCompressed) {
        addTell("Lip compression detected", "lips", 9);
      }

      // Gaze Shift
      if (metrics.gazeShiftIntensity > 0.15) {
        addTell("Gaze shift detected", "gaze", 10);
      }

      // Tính toán Stress Score liên tục
      calculateStressLevel(metrics, Math.abs(bpm - baseline.bpm));
    }
  };

  // --- 5. LOGIC CHECK EMOTION DEVIATION (Logic Gốc) ---
  const checkEmotionDeviation = (currentEmotions) => {
    if (!baselineEmotion) return;
    const negativeEmotions = ["fear", "sad", "disgust", "angry"];
    const SPIKE_THRESHOLD = 20;

    negativeEmotions.forEach((emo) => {
      const baseVal = baselineEmotion[emo] || 0;
      const currentVal = currentEmotions[emo] || 0;
      const deviation = currentVal - baseVal;

      if (deviation > SPIKE_THRESHOLD) {
        let severity = "emotion_spike";
        let alertMsg = `Sudden spike in ${emo.toUpperCase()} (+${deviation.toFixed(
          0
        )}%)`;

        if (emo === "fear" && currentVal > 40) {
          alertMsg = `HIGH FEAR DETECTED (${currentVal.toFixed(0)}%)`;
          triggerAlert({
            message: alertMsg,
            confidence: 0.9,
            indicators: ["fear"],
          });
        }
        addTell(alertMsg, severity, 8);
      }
    });

    if (baseline.emotion === "neutral" || baseline.emotion === "happy") {
      const baseDominant = baseline.emotion;
      const currentVal = currentEmotions[baseDominant] || 0;
      const baseVal = baselineEmotion[baseDominant] || 0;
      if (baseVal - currentVal > 40) {
        addTell(
          `Loss of Composure (Baseline ${baseDominant} dropped)`,
          "composure_loss",
          8
        );
      }
    }
  };

  // --- 6. LOGIC TÍNH STRESS LEVEL (Tích hợp thêm để hiển thị Score) ---
  const calculateStressLevel = (metrics, bpmDelta) => {
    let score = 0;
    // Blink Score
    if (metrics.blinkRate > Math.max(35, baseline.blink_rate * 1.5))
      score += 25;
    else if (metrics.blinkRate < 5) score += 20;

    // Emotion Score
    if (metrics.dominantEmotion === "fear") score += 30;
    else if (["disgust", "angry"].includes(metrics.dominantEmotion))
      score += 20;
    else if (metrics.dominantEmotion === "sad") score += 10;

    // BPM Score
    if (bpmDelta > 20) score += 20;
    else if (bpmDelta > 10) score += 10;

    // Behavior Score
    if (metrics.currentHandToFace) score += 15;
    if (metrics.isLipCompressed) score += 15;
    if (metrics.gazeShiftIntensity > 0.15) score += 10;

    const finalScore = Math.min(100, score);
    setStressScore(finalScore);

    if (finalScore < 30) {
      setStressLevel("LOW STRESS");
      setStressColor("text-green-400");
    } else if (finalScore < 60) {
      setStressLevel("MEDIUM STRESS");
      setStressColor("text-yellow-400");
    } else {
      setStressLevel("HIGH STRESS");
      setStressColor("text-red-500");
    }
  };

  // --- 7. LOGIC ADD TELL + COUNTDOWN (Tích hợp TTL) ---
  const addTell = (message, type, ttl = 10) => {
    setTells((prev) => {
      // Tránh spam cùng loại alert
      if (prev.some((t) => t.type === type)) return prev;

      const newTell = {
        id: Date.now() + Math.random(),
        timestamp: Date.now() / 1000,
        message,
        type,
        ttl: ttl, // Sử dụng TTL truyền vào hoặc mặc định 10s
      };

      // Cập nhật Truth Meter ngay lập tức
      updateTruthMeter(prev.length + 1);
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
        updateTruthMeter(updated.length);
        return updated;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const updateTruthMeter = (tellCount) => {
    const actualTells = Math.max(0, tellCount); // Đếm chính xác số lỗi đang hiện
    const baseOffset = 30;
    const tellMultiplier = 20; // Mỗi lỗi tăng 20%
    const position = Math.min(100, baseOffset + actualTells * tellMultiplier);
    setTruthMeterPosition(position);
  };

  // --- 8. LOGIC CALIBRATION (Logic Gốc) ---
  const startCalibration = async () => {
    try {
      setCameraActive(true);
      setIsCalibrating(true);
      setCalibrationProgress(0);
      setTells([]);

      calibrationEmotionsAccRef.current = {
        angry: 0,
        disgust: 0,
        fear: 0,
        happy: 0,
        sad: 0,
        surprise: 0,
        neutral: 0,
      };
      calibrationStartRef.current = {
        handTouchTotal: latestMetricsRef.current.handTouchTotal || 0,
        startTime: Date.now(),
      };
      console.log(
        "Calibration Started. Snapshot:",
        calibrationStartRef.current
      );

      const response = await api.startSession();
      setSessionId(response.data.session_id);

      const calibrationInterval = setInterval(() => {
        setCalibrationProgress((prev) => {
          if (prev >= 100) {
            clearInterval(calibrationInterval);
            completeCalibration();
            return 100;
          }
          return prev + 1; // 30s total
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
          console.warn("Backend baseline fetch failed");
        }
      }

      // Tính toán Real Data
      const measuredBlinkRate = latestMetricsRef.current.blinkRate || 15;
      const startHand = calibrationStartRef.current.handTouchTotal || 0;
      const endHand = latestMetricsRef.current.handTouchTotal || 0;
      const measuredHandCount = Math.max(0, endHand - startHand);

      console.log(
        `Calibration Result -> BlinkRate: ${measuredBlinkRate}, HandTouches: ${measuredHandCount}`
      );

      let maxScore = -1;
      let calculatedBaselineEmotion = "neutral";
      Object.entries(calibrationEmotionsAccRef.current).forEach(
        ([key, val]) => {
          if (val > maxScore) {
            maxScore = val;
            calculatedBaselineEmotion = key;
          }
        }
      );
      if (maxScore === 0) calculatedBaselineEmotion = "neutral";

      console.log(
        "FINAL BASELINE EMOTION:",
        calculatedBaselineEmotion.toUpperCase()
      );
      setBaselineEmotion({ ...emotionData });

      const finalBaseline = {
        bpm: backendBaseline.bpm || 75,
        blink_rate: measuredBlinkRate,
        gaze_stability: backendBaseline.gaze_stability || 0.15,
        emotion: calculatedBaselineEmotion,
        hand_baseline_count: measuredHandCount,
        calibrated: true,
      };

      setBaseline(finalBaseline);
      setBpm(finalBaseline.bpm);
      setIsCalibrating(false);
      setAnalyzing(true);
    } catch (error) {
      console.error("Error completing calibration:", error);
      setIsCalibrating(false);
    }
  };

  // --- 9. SIMULATION EFFECTS (Logic Gốc + BPM Logic) ---
  useEffect(() => {
    if (cameraActive && !isCalibrating && baseline.calibrated) {
      const interval = setInterval(() => {
        // Update BPM
        setBpm((prev) => {
          const variance = (Math.random() - 0.5) * 8;
          const newBpm = Math.max(50, Math.min(120, prev + variance));
          const delta = Math.abs(newBpm - baseline.bpm);
          if (delta > 10 && Math.random() > 0.7) {
            const changeType = newBpm > baseline.bpm ? "increase" : "decrease";
            addTell(
              `Heart rate ${changeType} (+${delta.toFixed(1)} BPM)`,
              "bpm",
              7
            );
          }
          return newBpm;
        });

        // Backup Simulation for Lip/Gaze if needed (Optional)
        if (Math.random() > 0.95) {
          // setLipCompression(true); // Chỉ dùng nếu không có AI detect
          // setTimeout(() => setLipCompression(false), 2000);
        }
      }, 2000);
      return () => clearInterval(interval);
    }
  }, [cameraActive, isCalibrating, baseline]);

  // Alert Helpers
  const triggerAlert = (data) => {
    playAlertSound();
    setShowAlert(true);
    setAlerts((prev) =>
      [
        {
          id: Date.now(),
          message: data.message || "HIGH STRESS",
          timestamp: Date.now(),
        },
        ...prev,
      ].slice(0, 3)
    );
    setTimeout(() => setShowAlert(false), 3000);
  };

  const playAlertSound = () => {
    try {
      const audioContext = new (window.AudioContext ||
        window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      oscillator.frequency.value = 750;
      oscillator.type = "sine";
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(
        0.01,
        audioContext.currentTime + 0.18
      );
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.18);
    } catch (error) {
      console.error("Audio error", error);
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

  // --- RENDER (Giao diện Mới đã tối ưu) ---
  return (
    <div className="min-h-screen bg-gray-900 text-white p-6 font-sans">
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
                  : "bg-gray-700 text-gray-300"
              }`}
            >
              <Video className="w-4 h-4" /> <span>Live Detection</span>
            </button>
            <button
              onClick={() => setViewMode("history")}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg transition ${
                viewMode === "history"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-700 text-gray-300"
              }`}
            >
              <History className="w-4 h-4" /> <span>Session History</span>
            </button>
          </div>
          {baseline.calibrated && viewMode === "live" && (
            <button
              onClick={handleEndSession}
              className="bg-red-600 hover:bg-red-700 px-4 py-2 rounded-lg flex items-center gap-2 transition font-bold"
            >
              <Square className="w-4 h-4" /> End Session
            </button>
          )}
        </div>

        {viewMode === "history" ? (
          <SessionHistory
            onSelectSession={(s) => {
              setSelectedSession(s);
              setViewMode("review");
            }}
          />
        ) : (
          <div className="grid grid-cols-12 gap-6">
            {/* 1. LEFT COLUMN: EMOTION DETAILS */}
            <div className="col-span-3 space-y-4">
              <div className="bg-gray-800 rounded-lg p-5 border border-gray-700 shadow-lg">
                <h3 className="text-lg font-bold mb-4 text-gray-200">
                  Real-time Emotion
                </h3>
                <div className="mb-6 text-center p-4 rounded-lg bg-gray-900 border border-gray-700">
                  <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">
                    Dominant
                  </div>
                  <div
                    className="text-2xl font-black uppercase"
                    style={{ color: getEmotionColor(dominantEmotion) }}
                  >
                    {dominantEmotion}
                  </div>
                  <div className="text-sm text-gray-500 mt-1">
                    Confidence: {(emotionConfidence * 100).toFixed(0)}%
                  </div>
                  {baseline.calibrated && (
                    <div className="text-xs text-gray-500 mt-2 border-t border-gray-700 pt-1">
                      Baseline:{" "}
                      <span
                        className="uppercase font-bold"
                        style={{ color: getEmotionColor(baseline.emotion) }}
                      >
                        {baseline.emotion}
                      </span>
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  {Object.entries(emotionData).map(([emotion, value]) => (
                    <div key={emotion}>
                      <div className="flex justify-between text-xs mb-1">
                        <span
                          className={`capitalize font-medium ${
                            emotion === dominantEmotion
                              ? "text-white"
                              : "text-gray-400"
                          }`}
                        >
                          {emotion}
                        </span>
                        <span className="text-gray-500">
                          {value.toFixed(0)}%
                        </span>
                      </div>
                      <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-300"
                          style={{
                            width: `${value}%`,
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

            {/* 2. CENTER COLUMN: CAMERA & ALERTS */}
            <div className="col-span-6 space-y-4">
              {/* Stress Bar */}
              {baseline.calibrated && (
                <div
                  className={`border-2 rounded-lg p-3 flex items-center justify-between shadow-lg transition-colors duration-500 ${
                    stressLevel.includes("HIGH")
                      ? "bg-red-900/40 border-red-500"
                      : stressLevel.includes("MEDIUM")
                      ? "bg-yellow-900/40 border-yellow-500"
                      : "bg-green-900/40 border-green-500"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Zap className={`w-6 h-6 ${stressColor}`} />
                    <div>
                      <div
                        className={`text-xl font-black tracking-widest ${stressColor}`}
                      >
                        {stressLevel}
                      </div>
                      <div className="text-xs text-gray-400">
                        Analysis Confidence: High
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-white">
                      {stressScore}
                      <span className="text-sm text-gray-400">/100</span>
                    </div>
                    <div className="text-xs text-gray-400">Stress Score</div>
                  </div>
                </div>
              )}

              {/* Truth Meter */}
              {baseline.calibrated && (
                <TruthMeter
                  position={truthMeterPosition}
                  tellCount={tells.length}
                />
              )}

              {/* Main Camera Area */}
              <div className="relative rounded-xl overflow-hidden shadow-2xl border border-gray-700 bg-black">
                {cameraActive ? (
                  <CameraFeed
                    sessionId={sessionId || "temp"}
                    calibrated={baseline.calibrated}
                    onMetricsUpdate={handleFrontendMetrics}
                  />
                ) : (
                  <div className="aspect-video flex flex-col items-center justify-center bg-gray-800">
                    <Eye className="w-20 h-20 text-gray-600 mb-4" />
                    <button
                      onClick={startCalibration}
                      className="px-8 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold shadow-lg transition transform hover:scale-105"
                    >
                      START CALIBRATION
                    </button>
                    <p className="mt-4 text-gray-400 text-sm">
                      Please sit still and look at the camera
                    </p>
                  </div>
                )}

                {/* Calibration Overlay */}
                {isCalibrating && (
                  <div className="absolute inset-0 bg-black/80 z-20 flex flex-col items-center justify-center">
                    <div className="w-64">
                      <div className="flex justify-between text-blue-400 mb-2 font-bold">
                        <span>Calibrating...</span>
                        <span>{calibrationProgress}%</span>
                      </div>
                      <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-500 transition-all duration-300"
                          style={{ width: `${calibrationProgress}%` }}
                        ></div>
                      </div>
                    </div>
                    <p className="mt-4 text-gray-300 animate-pulse">
                      Analyzing neutral expressions and environment...
                    </p>
                  </div>
                )}

                {/* ALERTS OVERLAY (ĐẾM NGƯỢC) */}
                <div className="absolute bottom-4 left-4 right-4 flex flex-col gap-2 z-10 pointer-events-none">
                  {tells.map((tell) => (
                    <div
                      key={tell.id}
                      className="bg-red-900/90 backdrop-blur-md border-l-4 border-red-500 p-3 rounded shadow-lg animate-in slide-in-from-bottom-2 flex justify-between items-center"
                    >
                      <div className="flex items-center gap-3">
                        <AlertTriangle className="w-5 h-5 text-red-400 animate-pulse" />
                        <div>
                          <span className="block font-bold text-white text-sm">
                            {tell.message}
                          </span>
                          <span className="text-[10px] text-red-200 uppercase tracking-wider">
                            {tell.type.replace("_", " ")}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-red-950 border border-red-800">
                        <span className="font-mono font-bold text-red-400 text-sm">
                          {tell.ttl}s
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

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
