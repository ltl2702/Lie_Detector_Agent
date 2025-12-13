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
  // Lưu giá trị tại thời điểm bắt đầu Calibrate để tính Delta
  const calibrationStartRef = useRef({ handTouchTotal: 0, startTime: 0 });

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
  const [analyzing, setAnalyzing] = useState(false);
  const [stressLevel, setStressLevel] = useState("LOW STRESS");
  const [stressColor, setStressColor] = useState("text-green-400");

  // Detection tells
  const [tells, setTells] = useState([]);

  // Alert system
  const [alerts, setAlerts] = useState([]);
  const [showAlert, setShowAlert] = useState(false);
  const alertAudioRef = useRef(null);

  // Truth meter
  const [truthMeterPosition, setTruthMeterPosition] = useState(30);

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

  // Handle metrics calculated from frontend
  const handleFrontendMetrics = (metrics) => {
    console.log("Frontend metrics:", metrics);
    // 1. Cập nhật Refs để dùng cho tính toán Calibration
    latestMetricsRef.current = metrics;

    // 1. Xử lý update Emotion (Từ AI thật)
    if (metrics.type === "emotion_update") {
      console.log(
        "Emotion Update:",
        metrics.dominantEmotion,
        metrics.emotionConfidence
      );
      setEmotionData(metrics.emotionData);
      setDominantEmotion(metrics.dominantEmotion);
      setEmotionConfidence(metrics.emotionConfidence);

      // Logic so sánh với Baseline Emotion (Nếu đã calibrate)
      if (baseline.calibrated && baselineEmotion) {
        checkEmotionDeviation(metrics.emotionData);
      }
      return;
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

    // 3. Logic phát hiện nói dối (Chỉ chạy khi đã Calibrate)
    if (baseline.calibrated) {
      const normalRateMin = 10;
      const normalRateMax = 30;

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
  };

  // Hàm checkEmotionDeviation
  const checkEmotionDeviation = (currentEmotions) => {
    // Ngưỡng cảnh báo: Nếu một cảm xúc tiêu cực tăng đột biến > 20% so với baseline
    const negativeEmotions = ["fear", "disgust", "angry", "sad"];

    negativeEmotions.forEach((emo) => {
      const baseVal = baselineEmotion[emo] || 0;
      const currentVal = currentEmotions[emo] || 0;

      if (currentVal - baseVal > 25) {
        // Tăng hơn 25%
        addTell(
          `Sudden spike in ${emo.toUpperCase()} (+${(
            currentVal - baseVal
          ).toFixed(0)}%)`,
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

      // Lấy giá trị emotionData hiện tại (được update liên tục từ CameraFeed)
      const currentEmotionSnapshot = { ...emotionData };
      setBaselineEmotion(currentEmotionSnapshot);
      console.log("Captured Baseline Emotion:", currentEmotionSnapshot);

      const finalBaseline = {
        bpm: backendBaseline.bpm || 70, // Giữ giả lập hoặc từ backend
        blink_rate: measuredBlinkRate, // Dữ liệu thật
        gaze_stability: backendBaseline.gaze_stability || 0.15,
        // emotion: backendBaseline.emotion || "neutral",
        emotion: dominantEmotion, // Cảm xúc chủ đạo lúc calibrate
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
  useEffect(() => {
    if (cameraActive && !isCalibrating && baseline.calibrated) {
      const interval = setInterval(() => {
        // Update BPM with variation (Simulation)
        setBpm((prev) => {
          const variance = (Math.random() - 0.5) * 8;
          const newBpm = Math.max(50, Math.min(95, prev + variance));
          // Check for significant BPM change
          const delta = Math.abs(newBpm - baseline.bpm);
          if (delta > 10 && Math.random() > 0.7) {
            const changeType = newBpm > baseline.bpm ? "increase" : "decrease";
            addTell(
              `Heart rate ${changeType} (+${delta.toFixed(1)} BPM)`,
              "bpm"
            );
          }
          return newBpm;
        });

        // Update emotion data (Simulation)
        // setEmotionData((prev) => {
        //   const emotions = [
        //     "angry",
        //     "disgust",
        //     "fear",
        //     "happy",
        //     "sad",
        //     "surprise",
        //     "neutral",
        //   ];
        //   const newData = {};
        //   let total = 0;
        //   emotions.forEach((emotion) => {
        //     const change = (Math.random() - 0.5) * 15;
        //     newData[emotion] = Math.max(
        //       0,
        //       Math.min(100, (prev[emotion] || 0) + change)
        //     );
        //     total += newData[emotion];
        //   });
        //   emotions.forEach((emotion) => {
        //     newData[emotion] = (newData[emotion] / total) * 100;
        //   });
        //   let maxEmotion = "neutral";
        //   let maxValue = 0;
        //   emotions.forEach((emotion) => {
        //     if (newData[emotion] > maxValue) {
        //       maxValue = newData[emotion];
        //       maxEmotion = emotion;
        //     }
        //   });
        //   setDominantEmotion(maxEmotion);
        //   setEmotionConfidence(maxValue / 100);
        //   return newData;
        // });

        // Random lip & gaze simulation (Backup if camera misses)
        if (Math.random() > 0.95) {
          setLipCompression(true);
          addTell("Lip compression detected", "lips");
          setTimeout(() => setLipCompression(false), 2000);
        }
        if (Math.random() > 0.98) {
          addTell("Gaze shift detected", "gaze");
        }
      }, 2000);

      return () => clearInterval(interval);
    }
  }, [cameraActive, isCalibrating, baseline]);

  const addTell = (message, type) => {
    const newTell = {
      id: Date.now() + Math.random(),
      timestamp: Date.now() / 1000,
      message,
      type,
      ttl: 10,
    };

    setTells((prev) => {
      const filtered = prev.filter((t) => t.type !== type);
      return [...filtered, newTell];
    });

    updateTruthMeter(tells.length + 1);
  };

  const updateTruthMeter = (tellCount) => {
    const actualTells = Math.max(0, tellCount - 1);
    const baseOffset = 30;
    const tellMultiplier = 70 / 3;
    const position = Math.min(100, baseOffset + actualTells * tellMultiplier);
    setTruthMeterPosition(position);
  };

  const triggerAlert = (data) => {
    playAlertSound();
    setShowAlert(true);
    const alert = {
      id: Date.now(),
      message: data.message || "HIGH STRESS DETECTED",
      confidence: data.confidence || 0.8,
      indicators: data.indicators || [],
      timestamp: Date.now(),
    };
    setAlerts((prev) => [alert, ...prev].slice(0, 3));
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
      console.error("Error playing alert sound:", error);
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
            {/* <div className="col-span-3 space-y-4">
              <div className="bg-gray-800 rounded-lg p-5">
                <h3 className="text-lg font-bold mb-4 flex items-center justify-between">
                  <span>Emotion (FER)</span>
                  <span
                    className="text-sm px-3 py-1.5 rounded font-semibold"
                    style={{
                      backgroundColor: `${getEmotionColor(dominantEmotion)}20`,
                      color: getEmotionColor(dominantEmotion),
                    }}
                  >
                    {dominantEmotion} ({(emotionConfidence * 100).toFixed(0)}%)
                  </span>
                </h3>
                <div className="space-y-3">
                  {Object.entries(emotionData).map(([emotion, value]) => (
                    <div key={emotion}>
                      <div className="flex justify-between text-sm mb-1.5">
                        <span className="capitalize font-medium">
                          {emotion}
                        </span>
                        <span className="text-gray-400 font-semibold">
                          {value.toFixed(1)}%
                        </span>
                      </div>
                      <div className="h-3 bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${value}%`,
                            backgroundColor: getEmotionColor(emotion),
                          }}
                        ></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div> */}
            {/* Left Sidebar - Emotion */}
            <div className="col-span-3 space-y-4">
              <div className="bg-gray-800 rounded-lg p-5">
                {/* Header hiển thị Cảm xúc chính và Độ tin cậy tổng thể */}
                <h3 className="text-lg font-bold mb-4 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span>Emotion (FER)</span>
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
                          {value.toFixed(1)}%
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
              {baseline.calibrated && (
                <>
                  <div className="flex gap-4 items-center">
                    <div
                      className={`bg-gray-900 bg-opacity-80 rounded-lg p-4 flex items-center gap-3 ${getBpmColor()}`}
                    >
                      <Heart className="w-7 h-7" />
                      <span className="text-3xl font-bold">
                        {bpm.toFixed(1)} BPM
                      </span>
                      <span className="text-sm font-semibold">
                        (
                        {(((bpm - baseline.bpm) / baseline.bpm) * 100).toFixed(
                          0
                        )}
                        %)
                      </span>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div
                      className={`${
                        stressColor.includes("green")
                          ? "bg-green-900 border-green-600"
                          : "bg-red-900 border-red-600"
                      } border-2 rounded-lg p-4 flex items-center justify-between`}
                    >
                      <span className="text-lg font-bold">
                        {isCalibrating
                          ? "Status: Calibrating..."
                          : `Status: ${stressLevel}`}
                      </span>
                      {analyzing && (
                        <div className="flex gap-1.5">
                          <div className="w-3 h-3 bg-green-400 rounded-full animate-pulse"></div>
                        </div>
                      )}
                    </div>
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
                </>
              )}
            </div>

            {/* Right Sidebar - Blink & Hand */}
            <div className="col-span-3 space-y-4">
              {/* Blink Analysis */}
              <div className="bg-gray-800 rounded-lg p-5">
                <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                  <Eye className="w-5 h-5 text-blue-400" /> Blink Analysis
                </h3>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-gray-700/50 rounded p-3 text-center border border-gray-600">
                      <div className="text-sm text-gray-400 mb-1">Baseline</div>
                      <div className="text-xl font-bold text-gray-300">
                        {baseline.calibrated
                          ? baseline.blink_rate.toFixed(0)
                          : "--"}
                      </div>
                      <div className="text-xs text-gray-500">blinks/min</div>
                    </div>
                    <div className="bg-gray-700 rounded p-3 text-center border border-blue-500/30">
                      <div className="text-sm text-gray-400 mb-1">
                        Current Rate
                      </div>
                      <div
                        className={`text-2xl font-bold ${
                          !baseline.calibrated
                            ? "text-white"
                            : blinkMetrics.rate > baseline.blink_rate * 1.5
                            ? "text-red-500"
                            : "text-green-400"
                        }`}
                      >
                        {blinkMetrics.rate}
                      </div>
                      <div className="text-xs text-gray-500">blinks/min</div>
                    </div>
                  </div>
                  {/* {baseline.calibrated && (
                    <div className="bg-gray-900/50 rounded-lg p-3">
                      <div className="flex justify-between items-center text-sm mb-2">
                        <span className="text-gray-400">Deviation</span>
                        <span className="font-bold text-green-400">
                          {(blinkMetrics.rate - baseline.blink_rate).toFixed(0)}
                        </span>
                      </div>
                    </div>
                  )} */}
                  {/* Hàng 2: Deviation (Sự thay đổi) */}
                  {baseline.calibrated && (
                    <div className="bg-gray-900/50 rounded-lg p-3">
                      <div className="flex justify-between items-center text-sm mb-2">
                        <span className="text-gray-400">
                          Deviation vs Baseline
                        </span>
                        {(() => {
                          const diff = blinkMetrics.rate - baseline.blink_rate;
                          const percent =
                            baseline.blink_rate > 0
                              ? (diff / baseline.blink_rate) * 100
                              : 0;
                          const isHigh = percent > 50; // Cao hơn 50%
                          const isLow = percent < -50; // Thấp hơn 50%

                          return (
                            <span
                              className={`font-bold ${
                                isHigh
                                  ? "text-red-400"
                                  : isLow
                                  ? "text-yellow-400"
                                  : "text-green-400"
                              }`}
                            >
                              {diff > 0 ? "+" : ""}
                              {percent.toFixed(0)}%
                            </span>
                          );
                        })()}
                      </div>

                      {/* Progress Bar visualizing deviation */}
                      <div className="relative h-2 bg-gray-700 rounded-full overflow-hidden">
                        {/* Center marker */}
                        <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-white/30 z-10"></div>

                        {/* Bar */}
                        {(() => {
                          const diff = blinkMetrics.rate - baseline.blink_rate;
                          // Max range visual là +/- 20 nhịp
                          const clampedDiff = Math.max(-20, Math.min(20, diff));
                          const widthPercent =
                            (Math.abs(clampedDiff) / 20) * 50; // 0 -> 50% width

                          return (
                            <div
                              className={`absolute top-0 bottom-0 transition-all duration-500 ${
                                diff > 0
                                  ? "left-1/2 bg-red-500"
                                  : "right-1/2 bg-yellow-500"
                              }`}
                              style={{ width: `${widthPercent}%` }}
                            />
                          );
                        })()}
                      </div>
                      <div className="flex justify-between text-[10px] text-gray-500 mt-1">
                        <span>Low (Focus/Lying)</span>
                        <span>High (Stress)</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Hand-to-Face */}
              <div className="bg-gray-800 rounded-lg p-5">
                <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                  <Hand
                    className={`w-5 h-5 ${
                      handMetrics.isTouching
                        ? "text-red-500 animate-pulse"
                        : "text-green-400"
                    }`}
                  />{" "}
                  Hand-to-Face
                </h3>
                {handMetrics.isTouching && (
                  <div className="mb-4 bg-red-900/50 border border-red-500 text-red-200 px-3 py-2 rounded text-center animate-pulse font-bold">
                    ⚠️ TOUCHING FACE
                  </div>
                )}
                <div className="bg-gray-700 rounded p-4 text-center">
                  <div className="text-4xl font-bold text-white">
                    {handMetrics.count}
                  </div>
                  <div className="text-sm text-gray-400 uppercase tracking-wider mt-1">
                    Total Contacts
                  </div>
                </div>
                {baseline.calibrated && (
                  <div className="mt-3 text-xs text-gray-500 text-center">
                    Baseline: {baseline.hand_baseline_count} touches
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
