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
  const [viewMode, setViewMode] = useState("live");
  const [selectedSession, setSelectedSession] = useState(null);

  const [cameraActive, setCameraActive] = useState(false);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [calibrationProgress, setCalibrationProgress] = useState(0);
  const [sessionId, setSessionId] = useState(null);

  // --- REFS ---
  const latestMetricsRef = useRef({ blinkRate: 0, handTouchTotal: 0 });
  const calibrationStartRef = useRef({ handTouchTotal: 0, startTime: 0 });
  const calibrationEmotionsAccRef = useRef({});
  const wsRef = useRef(null);

  // --- STATE DỮ LIỆU ---
  const [baseline, setBaseline] = useState({
    bpm: 70,
    blink_rate: 15,
    gaze_stability: 0.15,
    emotion: "neutral",
    hand_baseline_count: 0,
    calibrated: false,
  });

  const [bpm, setBpm] = useState(0);
  const [blinkMetrics, setBlinkMetrics] = useState({ rate: 0, count: 0 });
  const [handMetrics, setHandMetrics] = useState({
    count: 0,
    isTouching: false,
  });

  const [baselineEmotion, setBaselineEmotion] = useState(null);
  const [emotionData, setEmotionData] = useState({
    angry: 0,
    disgust: 0,
    fear: 0,
    happy: 0,
    sad: 0,
    surprise: 0,
    neutral: 100,
  });
  const [dominantEmotion, setDominantEmotion] = useState("neutral");
  const [emotionConfidence, setEmotionConfidence] = useState(0);

  const [lipCompression, setLipCompression] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  // --- STATE PHÂN TÍCH STRESS ---
  const [stressScore, setStressScore] = useState(0); // 0 - 100
  const [stressLevel, setStressLevel] = useState("LOW STRESS"); // LOW, MEDIUM, HIGH
  const [stressColor, setStressColor] = useState("text-green-400");

  // --- ALERTS & TELLS ---
  const [tells, setTells] = useState([]); // { id, message, type, ttl }
  const [alerts, setAlerts] = useState([]);
  const [showAlert, setShowAlert] = useState(false);
  const [truthMeterPosition, setTruthMeterPosition] = useState(30);

  // --- 1. XỬ LÝ END SESSION ---
  const handleEndSession = async () => {
    if (!sessionId) return;
    try {
      const sessionData = {
        session_id: sessionId,
        session_name: `Session_${new Date()
          .toISOString()
          .slice(0, 19)
          .replace("T", "_")}`,
        start_time: Date.now() / 1000,
        end_time: Date.now() / 1000,
        baseline: baseline,
        tells: tells,
        metrics: { bpm, emotion: dominantEmotion, stress_level: stressLevel },
      };

      await api.endSession(sessionId, sessionData);

      // Reset
      setCameraActive(false);
      setSessionId(null);
      setBaseline((prev) => ({ ...prev, calibrated: false }));
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

  // --- 2. XỬ LÝ REAL-TIME METRICS TỪ CAMERA ---
  const handleFrontendMetrics = (metrics) => {
    latestMetricsRef.current = metrics;

    // Cập nhật State cơ bản
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
    }

    setBlinkMetrics({ rate: metrics.blinkRate, count: metrics.blinkCount });
    setHandMetrics({
      count: metrics.handTouchTotal || 0,
      isTouching: metrics.currentHandToFace,
    });
    setLipCompression(metrics.isLipCompressed || false);

    // CHỈ CHẠY PHÂN TÍCH NẾU ĐÃ CALIBRATE
    if (baseline.calibrated) {
      analyzeLyingIndicators(metrics);
    }
  };

  // --- 3. LOGIC PHÂN TÍCH NÓI DỐI & TẠO CẢNH BÁO ---
  const analyzeLyingIndicators = (metrics) => {
    const currentTells = [];

    // --- A. BLINK ANALYSIS (Mắt) ---
    // Rule: Chớp mắt > 35 hoặc gấp 1.5 lần baseline => Lo lắng
    const highBlinkThresh = Math.max(35, baseline.blink_rate * 1.5);
    if (metrics.blinkRate > highBlinkThresh) {
      triggerTell(
        `Rapid Blinking: ${metrics.blinkRate}/min (Nervousness)`,
        "blink_high",
        10
      );
    }

    // Rule: Chớp mắt < 5 hoặc < 50% baseline => Nhìn chằm chằm (Cố kiểm soát hoặc tải nhận thức cao)
    const lowBlinkThresh = Math.max(5, baseline.blink_rate * 0.5);
    if (
      metrics.blinkRate < 5 &&
      metrics.blinkRate < lowBlinkThresh &&
      metrics.frameCount > 450
    ) {
      triggerTell(
        `Unusual Staring: ${metrics.blinkRate}/min (Cognitive Load)`,
        "blink_low",
        10
      );
    }

    // --- B. EMOTION ANALYSIS (Cảm xúc) ---
    // Rule: Người nói dối thường lộ vẻ sợ hãi, giận dữ hoặc khinh bỉ
    const negativeEmotions = ["fear", "angry", "disgust", "sad"];
    if (
      negativeEmotions.includes(metrics.dominantEmotion) &&
      metrics.emotionConfidence > 0.6
    ) {
      triggerTell(
        `Negative Emotion: ${metrics.dominantEmotion.toUpperCase()}`,
        "emotion_neg",
        8
      );
    }

    // --- C. BEHAVIOR (Hành vi) ---
    // Rule: Chạm tay lên mặt
    if (metrics.currentHandToFace) {
      triggerTell("Hand-to-face contact detected", "hand_face", 7);
    }

    // Rule: Mím môi (Dấu hiệu che giấu)
    if (metrics.isLipCompressed) {
      triggerTell("Lip compression detected (Withholding info)", "lip_comp", 7);
    }

    // Rule: Đảo mắt (Gaze Shift)
    if (metrics.gazeShiftIntensity > 0.15) {
      triggerTell("Gaze shift detected (Avoidance)", "gaze_shift", 5);
    }

    // --- D. HEART RATE (Giả lập logic so sánh BPM) ---
    // (Trong thực tế cần BPM từ sensor hoặc rPPG chính xác)
    const bpmDelta = Math.abs(bpm - baseline.bpm);
    if (bpmDelta > 15) {
      const type = bpm > baseline.bpm ? "increase" : "decrease";
      triggerTell(
        `Heart rate ${type} (+${bpmDelta.toFixed(0)} BPM)`,
        "bpm_alert",
        10
      );
    }

    // --- E. TÍNH TOÁN STRESS LEVEL ---
    calculateStressLevel(metrics, bpmDelta);
  };

  // Hàm thêm cảnh báo (chỉ thêm nếu chưa tồn tại loại đó)
  const triggerTell = (message, type, ttl) => {
    setTells((prev) => {
      // Nếu alert loại này đang tồn tại, không spam thêm, chỉ reset TTL nếu cần
      if (prev.some((t) => t.type === type)) return prev;

      const newTell = {
        id: Date.now(),
        message,
        type,
        ttl, // Time to live (seconds)
      };

      // Update Truth Meter khi có tell mới
      updateTruthMeter(prev.length + 1);
      return [...prev, newTell];
    });
  };

  // --- 4. TÍNH TOÁN MỨC ĐỘ STRESS (WEIGHTED SCORE) ---
  const calculateStressLevel = (metrics, bpmDelta) => {
    let score = 0;

    // 1. Blink Score (Max 30)
    if (metrics.blinkRate > Math.max(35, baseline.blink_rate * 1.5))
      score += 25;
    else if (metrics.blinkRate < 5) score += 20;

    // 2. Emotion Score (Max 30)
    // Fear/Disgust là dấu hiệu nói dối mạnh
    if (metrics.dominantEmotion === "fear") score += 30;
    else if (
      metrics.dominantEmotion === "disgust" ||
      metrics.dominantEmotion === "angry"
    )
      score += 20;
    else if (metrics.dominantEmotion === "sad") score += 10;

    // 3. BPM Score (Max 20)
    if (bpmDelta > 20) score += 20;
    else if (bpmDelta > 10) score += 10;

    // 4. Gestures (Max 20)
    if (metrics.currentHandToFace) score += 15;
    if (metrics.isLipCompressed) score += 15;

    // Tổng hợp
    // Normalize score max 100
    const finalScore = Math.min(100, score);
    setStressScore(finalScore);

    // Phân loại
    if (finalScore < 25) {
      setStressLevel("LOW STRESS");
      setStressColor("text-green-400");
    } else if (finalScore < 60) {
      setStressLevel("MEDIUM STRESS");
      setStressColor("text-yellow-400");
    } else {
      setStressLevel("HIGH STRESS");
      setStressColor("text-red-500");

      // Nếu quá cao, trigger loa cảnh báo
      if (finalScore > 80 && !showAlert) {
        triggerAlert({ message: "CRITICAL STRESS LEVEL DETECTED" });
      }
    }
  };

  // --- 5. USE EFFECT CHO ALERT COUNTDOWN (QUAN TRỌNG) ---
  useEffect(() => {
    // Chạy mỗi giây để giảm TTL của các cảnh báo
    const timer = setInterval(() => {
      setTells((prevTells) => {
        if (prevTells.length === 0) return [];

        // Giảm ttl đi 1, lọc bỏ những cái <= 0
        const updatedTells = prevTells
          .map((t) => ({ ...t, ttl: t.ttl - 1 }))
          .filter((t) => t.ttl > 0);

        // Update lại Truth Meter dựa trên số lượng tell còn lại
        updateTruthMeter(updatedTells.length);
        return updatedTells;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // --- Helper Functions ---
  const updateTruthMeter = (count) => {
    // Base 30, mỗi tell + 20, max 100
    const val = Math.min(100, 30 + count * 20);
    setTruthMeterPosition(val);
  };

  const triggerAlert = (data) => {
    // playAlertSound(); // (Giữ nguyên hàm âm thanh cũ của bạn nếu có)
    setShowAlert(true);
    setAlerts((prev) =>
      [
        { id: Date.now(), message: data.message, timestamp: Date.now() },
        ...prev,
      ].slice(0, 3)
    );
    setTimeout(() => setShowAlert(false), 3000);
  };

  const startCalibration = async () => {
    setCameraActive(true);
    setIsCalibrating(true);
    setCalibrationProgress(0);
    setTells([]);
    calibrationEmotionsAccRef.current = {};
    calibrationStartRef.current = {
      handTouchTotal: latestMetricsRef.current.handTouchTotal || 0,
      startTime: Date.now(),
    };

    // Giả lập process
    const interval = setInterval(() => {
      setCalibrationProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          completeCalibration();
          return 100;
        }
        return prev + 2; // Nhanh hơn chút cho demo
      });
    }, 100);
  };

  const completeCalibration = () => {
    // Tìm cảm xúc chủ đạo trong lúc calibrate
    let maxScore = -1;
    let baseEmo = "neutral";
    Object.entries(calibrationEmotionsAccRef.current).forEach(([k, v]) => {
      if (v > maxScore) {
        maxScore = v;
        baseEmo = k;
      }
    });

    const measuredBlink = latestMetricsRef.current.blinkRate || 15;
    const finalBaseline = {
      bpm: 75, // Giả định hoặc lấy từ sensor
      blink_rate: measuredBlink === 0 ? 15 : measuredBlink,
      emotion: baseEmo,
      hand_baseline_count: 0,
      calibrated: true,
    };

    setBaseline(finalBaseline);
    setBpm(finalBaseline.bpm);
    setBaselineEmotion(emotionData); // Lưu snapshot cảm xúc
    setIsCalibrating(false);
    setAnalyzing(true);
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

  // Simulation BPM variation for visual effect
  useEffect(() => {
    if (baseline.calibrated) {
      const i = setInterval(() => {
        setBpm((prev) => {
          const variance = (Math.random() - 0.5) * 4;
          return Math.max(50, Math.min(120, prev + variance));
        });
      }, 1000);
      return () => clearInterval(i);
    }
  }, [baseline.calibrated]);

  // --- RENDER ---
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

                {/* Dominant Emotion Card */}
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
                </div>

                {/* List Emotions */}
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
              {/* Top Status Bar */}
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
                        <span>Calibrating Baseline...</span>
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

                {/* ALERTS OVERLAY (Hiển thị trực tiếp trên video) */}
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
                  {/* Hand to Face */}
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

                  {/* Lip Compression */}
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
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
