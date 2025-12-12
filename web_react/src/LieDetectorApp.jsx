import React, { useState, useEffect, useRef } from 'react';
import { Activity, Eye, Hand, Heart, AlertTriangle, TrendingUp, Target, History, Video, Square } from 'lucide-react';
import { io } from 'socket.io-client';
import axios from 'axios';
import api from './services/api';
import CameraFeed from './components/CameraFeed';
import TruthMeter from './components/TruthMeter';
import AlertSystem from './components/AlertSystem';
import ReviewMode from './components/ReviewMode';
import SessionHistory from './components/SessionHistory';
import AIAnalysisModal from './components/AIAnalysisModal';

export default function LieDetectorApp() {
  const [viewMode, setViewMode] = useState('live'); // 'live', 'history', 'review'
  const [selectedSession, setSelectedSession] = useState(null);
  
  const [cameraActive, setCameraActive] = useState(false);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [calibrationProgress, setCalibrationProgress] = useState(0);
  const [sessionId, setSessionId] = useState(null);
  
  // Baseline data
  const [baseline, setBaseline] = useState({
    bpm: 0,
    blink_rate: 0,
    gaze_stability: 0,
    emotion: 'neutral',
    hand_face_frequency: 0,
    calibrated: false
  });
  
  // Real-time metrics
  const [bpm, setBpm] = useState(0);
  const [blinkRate, setBlinkRate] = useState([45, 62, 78, 85, 72, 58, 45, 38, 42, 55]);
  const [emotionData, setEmotionData] = useState({
    angry: 0,
    disgust: 0,
    fear: 15,
    happy: 5,
    sad: 10,
    surprise: 5,
    neutral: 65
  });
  const [dominantEmotion, setDominantEmotion] = useState('neutral');
  const [emotionConfidence, setEmotionConfidence] = useState(0.65);
  const [gestureScore, setGestureScore] = useState(85);
  const [lipCompression, setLipCompression] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [stressLevel, setStressLevel] = useState('LOW STRESS');
  const [stressColor, setStressColor] = useState('text-green-400');
  
  // Detection tells
  const [tells, setTells] = useState([]);
  
  // Alert system
  const [alerts, setAlerts] = useState([]);
  const [showAlert, setShowAlert] = useState(false);
  const alertAudioRef = useRef(null);
  
  // Truth meter
  const [truthMeterPosition, setTruthMeterPosition] = useState(30);
  
  // Refs
  const wsRef = useRef(null);
  const pollingRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const videoBlobRef = useRef(null);
  
  // Video recording
  const [sessionVideoBlob, setSessionVideoBlob] = useState(null);
  
  // AI Analysis
  const [aiAnalysis, setAiAnalysis] = useState(null);
  const [showAiAnalysis, setShowAiAnalysis] = useState(false);
  
  // Handle ending session
  const handleEndSession = async () => {
    if (!sessionId) return;
    
    const confirmEnd = window.confirm('Are you sure you want to end this session? The video will be saved.');
    if (!confirmEnd) return;
    
    // Immediately hide all UI components
    const currentSessionId = sessionId;
    setSessionId(null);
    setCameraActive(false);
    
    try {
      let uploadedVideoFile = null;
      let videoBlobToUpload = null;
      
      // Stop MediaRecorder directly and wait for blob
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        console.log('⏹️ Stopping MediaRecorder...');
        
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
        console.log('📹 Video blob from ref, size:', videoBlobToUpload?.size || 0);
      }
      
      // Stop calibration
      setBaseline(prev => ({ ...prev, calibrated: false }));
      
      // Upload video if available
      if (videoBlobToUpload && videoBlobToUpload.size > 0) {
        console.log('📤 Uploading video, size:', videoBlobToUpload.size);
        const formData = new FormData();
        formData.append('video', videoBlobToUpload, 'session_video.webm');
        formData.append('session_id', currentSessionId);
        
        try {
          const uploadRes = await axios.post('http://localhost:5000/api/upload_video', formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
          });
          
          if (uploadRes.data && uploadRes.data.video_file) {
            uploadedVideoFile = uploadRes.data.video_file;
            console.log('✅ Video uploaded:', uploadedVideoFile);
          }
        } catch (uploadErr) {
          console.error('Failed to upload video:', uploadErr);
        }
      } else {
        console.warn('⚠️ No video blob available to upload');
      }
      
      // Save session data
      const sessionData = {
        session_id: currentSessionId,
        session_name: `Session_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)}`,
        start_time: Date.now() / 1000,
        end_time: Date.now() / 1000,
        baseline: baseline,
        tells: tells.map(t => ({
          message: t.message,
          type: t.type,
          timestamp: Date.now() / 1000
        })),
        metrics: {
          bpm: bpm,
          emotion: dominantEmotion,
          stress_level: stressLevel,
          gesture_score: gestureScore
        },
        video_file: uploadedVideoFile
      };
      
      // Call backend to end session and save video
      const response = await api.endSession(currentSessionId, sessionData);
      
      // Show AI analysis if available
      if (response.data?.ai_analysis) {
        console.log('🤖 Received AI analysis:', response.data.ai_analysis);
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
        emotion: 'neutral',
        hand_face_frequency: 0,
        calibrated: false
      });
      setTells([]);
      setAlerts([]);
      setShowAlert(false);
      setTruthMeterPosition(30);
      setBpm(0);
      setStressLevel('LOW STRESS');
      setStressColor('text-green-400');
      setSessionVideoBlob(null);
      videoBlobRef.current = null;
      
      const videoFile = response.data.video_file || uploadedVideoFile;
      alert(`Session ended successfully!\n${videoFile ? `Video saved: ${videoFile}` : 'Session saved.'}`);
    } catch (error) {
      console.error('Error ending session:', error);
      alert('Failed to end session');
    }
  };

  // Connect to Socket.IO for real-time updates
  useEffect(() => {
    if (cameraActive && baseline.calibrated && sessionId) {
      console.log('Connecting to Socket.IO server...');
      
      // Create Socket.IO connection
      const socket = io('http://localhost:5000', {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: 5
      });
      
      wsRef.current = socket;
      
      socket.on('connect', () => {
        console.log('✅ Socket.IO connected:', socket.id);
        // Join session room
        socket.emit('join_session', { session_id: sessionId });
      });
      
      socket.on('disconnect', () => {
        console.log('Socket.IO disconnected');
      });
      
      socket.on('connect_error', (error) => {
        console.log('Socket.IO connection error, switching to polling');
        // Fallback to polling
        startPolling();
      });
      
      // Listen for metrics updates
      socket.on('metrics_update', (data) => {
        console.log('Received metrics update:', data);
        updateMetrics(data);
      });
      
      // Listen for detection tells
      socket.on('detection_tell', (data) => {
        console.log('Received detection tell:', data);
        if (data.message) {
          addTell(data.message, data.type || 'detection');
        }
      });
      
      // Listen for alerts
      socket.on('high_stress_alert', (data) => {
        console.log('HIGH STRESS ALERT:', data);
        triggerAlert(data);
      });
      
      return () => {
        if (socket) {
          socket.disconnect();
        }
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
      setStressColor(data.stress_level.includes('HIGH') ? 'text-red-400' : 
                    data.stress_level.includes('MEDIUM') ? 'text-yellow-400' : 'text-green-400');
    }
    if (data.tells && Array.isArray(data.tells)) {
      setTells(data.tells.map((t, idx) => ({
        id: Date.now() + idx,
        message: t,
        type: 'detection',
        ttl: 10
      })));
    }
  };

  // Handle metrics calculated from frontend
  const handleFrontendMetrics = (metrics) => {
    console.log('Frontend metrics:', metrics);
    
    // Update blink rate display
    if (metrics.blinkRate !== undefined) {
      setBlinkRate(prev => {
        const newData = [...prev.slice(1), metrics.blinkRate];
        return newData;
      });
    }
    
    // Check for tells based on baseline
    if (baseline.calibrated) {
      // Increased blinking (>150% of baseline)
      if (metrics.blinkRate > baseline.blink_rate * 1.5) {
        addTell('Increased blinking detected', 'blink');
      }
      
      // Decreased blinking (<50% of baseline)
      if (metrics.blinkRate < baseline.blink_rate * 0.5 && metrics.blinkRate > 0) {
        addTell('Decreased blinking detected', 'blink');
      }
      
      // Hand-to-face contact
      if (metrics.currentHandToFace) {
        addTell('Hand-to-face contact', 'gesture');
      }
      
      // High hand-to-face frequency (>3 per minute)
      if (metrics.handToFaceFrequency > 3) {
        addTell(`Frequent hand-to-face touching (${metrics.handToFaceFrequency}/min)`, 'gesture');
      }
    }
  };
  // Start calibration process
  const startCalibration = async () => {
    try {
      setCameraActive(true);
      setIsCalibrating(true);
      setCalibrationProgress(0);
      setTells([]);
      
      // Start new session on backend
      const response = await api.startSession();
      setSessionId(response.data.session_id);
      
      // Simulate calibration progress (30 seconds)
      const calibrationInterval = setInterval(() => {
        setCalibrationProgress(prev => {
          if (prev >= 100) {
            clearInterval(calibrationInterval);
            completeCalibration();
            return 100;          }
          return prev + 1; // +1 every 300ms = 30 seconds
        });
      }, 300);
    } catch (error) {
      console.error('Error starting calibration:', error);
      setIsCalibrating(false);
      setCameraActive(false);
    }
  };

  const completeCalibration = async () => {
    try {
      // Mark session as calibrated on backend
      if (sessionId) {
        await api.calibrateSession(sessionId);
        
        const response = await api.getBaseline(sessionId);
        const backendBaseline = response.data.baseline;
        
        setBaseline({
          bpm: backendBaseline.bpm || 68,
          blink_rate: backendBaseline.blink_rate || 18,
          gaze_stability: backendBaseline.gaze_stability || 0.15,
          emotion: backendBaseline.emotion || 'neutral',
          hand_face_frequency: backendBaseline.hand_face_frequency || 0.05,
          calibrated: true
        });
        
        setBpm(backendBaseline.bpm || 68);
      } else {
        setBaseline({
          bpm: 68 + Math.random() * 10,
          blink_rate: 15 + Math.random() * 5,
          gaze_stability: 0.15,
          emotion: 'neutral',
          hand_face_frequency: 0.05,
          calibrated: true
        });
      }
      
      setIsCalibrating(false);
      setAnalyzing(true);
      
      console.log('Calibration complete');
    } catch (error) {
      console.error('Error completing calibration:', error);
      setIsCalibrating(false);
    }
  };

  // Real-time monitoring after calibration
  useEffect(() => {
    if (cameraActive && !isCalibrating && baseline.calibrated) {
      const interval = setInterval(() => {
        // Update BPM with variation
        setBpm(prev => {
          const variance = (Math.random() - 0.5) * 8;
          const newBpm = Math.max(50, Math.min(95, prev + variance));
          
          // Check for significant BPM change
          const delta = Math.abs(newBpm - baseline.bpm);
          if (delta > 10 && Math.random() > 0.7) {
            const changeType = newBpm > baseline.bpm ? 'increase' : 'decrease';
            addTell(`Heart rate ${changeType} (+${delta.toFixed(1)} BPM)`, 'bpm');
          }
          
          return newBpm;
        });
        
        // Update blink rate
        setBlinkRate(prev => {
          const newRate = [...prev.slice(1), Math.floor(Math.random() * 60 + 30)];
          
          // Check for abnormal blinking
          const recentAvg = newRate.slice(-5).reduce((a, b) => a + b) / 5;
          if (Math.random() > 0.85) {
            if (recentAvg > 70) {
              addTell('Increased blinking detected', 'blink');
            } else if (recentAvg < 30) {
              addTell('Decreased blinking detected', 'blink');
            }
          }
          
          return newRate;
        });
        
        // Update emotion data
        setEmotionData(prev => {
          const emotions = ['angry', 'disgust', 'fear', 'happy', 'sad', 'surprise', 'neutral'];
          const newData = {};
          let total = 0;
          
          emotions.forEach(emotion => {
            const change = (Math.random() - 0.5) * 15;
            newData[emotion] = Math.max(0, Math.min(100, (prev[emotion] || 0) + change));
            total += newData[emotion];
          });
          
          // Normalize to 100%
          emotions.forEach(emotion => {
            newData[emotion] = (newData[emotion] / total) * 100;
          });
          
          // Find dominant emotion
          let maxEmotion = 'neutral';
          let maxValue = 0;
          emotions.forEach(emotion => {
            if (newData[emotion] > maxValue) {
              maxValue = newData[emotion];
              maxEmotion = emotion;
            }
          });
          
          setDominantEmotion(maxEmotion);
          setEmotionConfidence(maxValue / 100);
          
          return newData;
        });
        
        // Update gesture score
        setGestureScore(prev => {
          const newScore = Math.max(60, Math.min(100, prev + (Math.random() - 0.5) * 10));
          
          // Detect hand-face contact
          if (newScore > 85 && Math.random() > 0.8) {
            addTell('Frequent hand-face contact', 'hand');
          }
          
          return newScore;
        });
        
        // Random lip compression detection
        if (Math.random() > 0.9) {
          setLipCompression(true);
          addTell('Lip compression detected', 'lips');
          setTimeout(() => setLipCompression(false), 2000);
        }
        
        // Gaze shift detection
        if (Math.random() > 0.92) {
          addTell('Gaze shift detected', 'gaze');
        }
        
      }, 2000);
      
      return () => clearInterval(interval);
    }
  }, [cameraActive, isCalibrating, baseline]);

  // TTL countdown for tells - auto-remove when expired
  useEffect(() => {
    if (tells.length === 0 || !cameraActive) return;
    
    const interval = setInterval(() => {
      setTells(prev => {
        const updated = prev.map(tell => ({
          ...tell,
          ttl: tell.ttl - 1
        })).filter(tell => tell.ttl > 0);
        
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
      ttl: 10 // 10 seconds
    };
    
    setTells(prev => {
      // Remove existing tell of same type
      const filtered = prev.filter(t => t.type !== type);
      return [...filtered, newTell];
    });
    
    // Update truth meter based on tells count
    updateTruthMeter(tells.length + 1);
  };
  
  const updateTruthMeter = (tellCount) => {
    // Exclude BPM from tell count (if BPM is always shown)
    const actualTells = Math.max(0, tellCount - 1);
    // Base offset 30% + faster movement (70% / 3 tells max)
    const baseOffset = 30;
    const tellMultiplier = 70 / 3;
    const position = Math.min(100, baseOffset + (actualTells * tellMultiplier));
    setTruthMeterPosition(position);
  };
  
  const triggerAlert = (data) => {
    // Play alert sound
    playAlertSound();
    
    // Show visual alert
    setShowAlert(true);
    const alert = {
      id: Date.now(),
      message: data.message || 'HIGH STRESS DETECTED',
      confidence: data.confidence || 0.8,
      indicators: data.indicators || [],
      timestamp: Date.now()
    };
    setAlerts(prev => [alert, ...prev].slice(0, 3));
    
    // Auto-hide after 3 seconds
    setTimeout(() => setShowAlert(false), 3000);
  };
  
  const playAlertSound = () => {
    try {
      // Create audio context for beep sound (750 Hz, 180ms)
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.frequency.value = 750; // 750 Hz frequency
      oscillator.type = 'sine';
      
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.18);
      
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.18); // 180ms duration
    } catch (error) {
      console.error('Error playing alert sound:', error);
    }
  };

  const getBpmColor = () => {
    if (!baseline.calibrated) return 'text-gray-400';
    const delta = Math.abs(bpm - baseline.bpm);
    if (delta < 5) return 'text-green-400';
    if (delta < 10) return 'text-yellow-400';
    return 'text-red-400';
  };

  const getEmotionColor = (emotion) => {
    const colors = {
      angry: '#ef4444',
      disgust: '#84cc16',
      fear: '#8b5cf6',
      happy: '#fbbf24',
      sad: '#3b82f6',
      surprise: '#ec4899',
      neutral: '#6b7280'
    };
    return colors[emotion] || '#6b7280';
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
        {viewMode === 'review' && selectedSession && (
          <ReviewMode 
            sessionData={selectedSession}
            onClose={() => {
              setViewMode('history');
              setSelectedSession(null);
            }}
          />
        )}
        
        {/* Header with View Switcher */}
        <div className="mb-6 flex items-center justify-between gap-4">
          {/* View Mode Buttons */}
          <div className="flex gap-2">
            <button
              onClick={() => setViewMode('live')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg transition ${
                viewMode === 'live' 
                  ? 'bg-blue-600 text-white' 
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              <Video className="w-4 h-4" />
              <span>Live Detection</span>
            </button>
            <button
              onClick={() => setViewMode('history')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg transition ${
                viewMode === 'history' 
                  ? 'bg-blue-600 text-white' 
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              <History className="w-4 h-4" />
              <span>Session History</span>
            </button>
          </div>

          {/* Baseline Info & End Session Button */}
          <div className="flex items-center gap-3">
            {baseline.calibrated && viewMode === 'live' && (
              <>
                <div className="flex items-center gap-2 text-sm bg-green-900 bg-opacity-30 px-3 py-1 rounded-lg border border-green-600">
                  <Target className="w-4 h-4 text-green-400" />
                  <span className="text-green-400">Baseline: {baseline.bpm.toFixed(1)} BPM | {baseline.blink_rate.toFixed(1)}/min</span>
                </div>
                <button
                  onClick={handleEndSession}
                  className="bg-red-600 hover:bg-red-700 px-4 py-2 rounded-lg flex items-center gap-2 transition"
                >
                  <Square className="w-4 h-4" />
                  End Session
                </button>
              </>
            )}
          </div>
        </div>

        {viewMode === 'history' ? (
          /* Session History View */
          <SessionHistory 
            onSelectSession={(session) => {
              setSelectedSession(session);
              setViewMode('review');
            }}
          />
        ) : (
          /* Live Detection View */
        <div className="grid grid-cols-12 gap-6">
          {/* Left Sidebar - Emotion Analysis */}
          <div className="col-span-3 space-y-4">
            {/* Emotion Analysis - FER Style */}
            <div className="bg-gray-800 rounded-lg p-5">
              <h3 className="text-lg font-bold mb-4 flex items-center justify-between">
                <span>Emotion (FER)</span>
                <span className={`text-sm px-3 py-1.5 rounded font-semibold`} style={{
                  backgroundColor: `${getEmotionColor(dominantEmotion)}20`,
                  color: getEmotionColor(dominantEmotion)
                }}>
                  {dominantEmotion} ({(emotionConfidence * 100).toFixed(0)}%)
                </span>
              </h3>
              <div className="space-y-3">
                {Object.entries(emotionData).map(([emotion, value]) => (
                  <div key={emotion}>
                    <div className="flex justify-between text-sm mb-1.5">
                      <span className="capitalize font-medium">{emotion}</span>
                      <span className="text-gray-400 font-semibold">{value.toFixed(1)}%</span>
                    </div>
                    <div className="h-3 bg-gray-700 rounded-full overflow-hidden">
                      <div 
                        className="h-full rounded-full transition-all duration-500"
                        style={{ 
                          width: `${value}%`,
                          backgroundColor: getEmotionColor(emotion)
                        }}
                      ></div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 pt-4 border-t border-gray-700 text-sm text-gray-400">
                <p>Detection via FER (Facial Emotion Recognition) with MTCNN</p>
              </div>
            </div>
          </div>

          {/* Main Content */}
          <div className="col-span-6 space-y-4">
            {/* Truth Meter - Above Video */}
            {baseline.calibrated && cameraActive && (
              <TruthMeter position={truthMeterPosition} tellCount={tells.length} />
            )}

            {/* Video Feed with Calibration Overlay */}
            <div className="relative">
              {cameraActive && sessionId ? (
                <CameraFeed 
                  sessionId={sessionId} 
                  calibrated={baseline.calibrated} 
                  onMetricsUpdate={handleFrontendMetrics}
                  onVideoRecorded={(blob) => {
                    console.log('📹 Video received from CameraFeed, size:', blob.size);
                    videoBlobRef.current = blob;
                    setSessionVideoBlob(blob);
                  }}
                  onRecorderReady={(recorder) => {
                    mediaRecorderRef.current = recorder;
                    console.log('🎤 MediaRecorder ref saved');
                  }}
                />
              ) : (
                <div className="bg-gray-800 rounded-lg overflow-hidden relative">
                  <div className="aspect-video bg-gray-700 flex items-center justify-center relative">
                    <div className="text-center">
                      <Eye className="w-16 h-16 mx-auto mb-4 text-gray-500" />
                      <p className="text-gray-400 mb-2">Camera Feed Inactive</p>
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
                    <span className="text-xs font-semibold text-blue-400">{calibrationProgress}%</span>
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

            {/* Calibration waiting visualization - only show during active session waiting for calibration */}
            {cameraActive && sessionId && !isCalibrating && !baseline.calibrated && (
              <div className="bg-gray-800 rounded-lg overflow-hidden relative">
                <div className="aspect-video bg-gray-700 flex items-center justify-center relative">
                  <div className="relative">
                    <div className="w-64 h-80 border-2 border-green-400 rounded-lg relative">
                      {/* Facial landmarks */}
                      <div className="absolute top-20 left-16 w-4 h-4 bg-green-400 rounded-full animate-pulse"></div>
                      <div className="absolute top-20 right-16 w-4 h-4 bg-green-400 rounded-full animate-pulse"></div>
                      <div className="absolute top-32 left-1/2 -translate-x-1/2 w-4 h-4 bg-green-400 rounded-full animate-pulse"></div>
                      <div className="absolute bottom-24 left-1/2 -translate-x-1/2 w-12 h-6 border-2 border-yellow-400 rounded-full"></div>
                    </div>
                  </div>
                </div>
              </div>
            )}
            
            {cameraActive && baseline.calibrated && (
              <>
                {/* Heart Rate Display with Graph */}
                <div className="flex gap-4 items-center">
                  {/* Current BPM */}
                  <div className={`bg-gray-900 bg-opacity-80 rounded-lg p-4 flex items-center gap-3 ${getBpmColor()}`}>
                    <Heart className="w-7 h-7" />
                    <span className="text-3xl font-bold">{bpm.toFixed(1)} BPM</span>
                    {baseline.calibrated && (
                      <span className="text-sm font-semibold">
                        ({((bpm - baseline.bpm) / baseline.bpm * 100).toFixed(0)}%)
                      </span>
                    )}
                  </div>

                  {/* Mini Graph */}
                  <div className="bg-gray-900 bg-opacity-80 rounded-lg p-3">
                    <svg width="280" height="70">
                      <polyline
                        fill="none"
                        stroke="#10b981"
                        strokeWidth="3"
                        points={Array.from({ length: 50 }, (_, i) => {
                          const x = i * 5.6;
                          const y = 35 + Math.sin(i * 0.3 + Date.now() * 0.01) * 20;
                          return `${x},${y}`;
                        }).join(' ')}
                      />
                    </svg>
                  </div>
                </div>
              </>
            )}

            {/* Status Bar & Detection Tells */}
            <div className="space-y-3">
              <div className={`${stressColor.includes('green') ? 'bg-green-900 border-green-600' : stressColor.includes('yellow') ? 'bg-yellow-900 border-yellow-600' : 'bg-red-900 border-red-600'} border-2 rounded-lg p-4 flex items-center justify-between`}>
                <div>
                  <span className="text-lg font-bold">
                    {isCalibrating ? 'Status: Calibrating baseline...' : 
                     baseline.calibrated ? `Status: ${stressLevel}` : 
                     'Status: Ready to calibrate'}
                  </span>
                </div>
                {analyzing && (
                  <div className="flex gap-1.5">
                    <div className="w-3 h-3 bg-green-400 rounded-full animate-pulse"></div>
                    <div className="w-3 h-3 bg-green-400 rounded-full animate-pulse" style={{animationDelay: '0.2s'}}></div>
                    <div className="w-3 h-3 bg-green-400 rounded-full animate-pulse" style={{animationDelay: '0.4s'}}></div>
                  </div>
                )}
              </div>
              
              {/* Detection Tells - only show during active session */}
              {cameraActive && baseline.calibrated && tells.map(tell => (
                <div key={tell.id} className="bg-yellow-900 bg-opacity-50 border-2 border-yellow-600 rounded-lg p-3 flex items-center justify-between animate-pulse">
                  <span className="text-base font-semibold text-yellow-200">{tell.message}</span>
                  <span className="text-sm text-yellow-400 font-bold">{tell.ttl}s</span>
                </div>
              ))}
            </div>
          </div>

          {/* Right Sidebar - Analytics */}
          <div className="col-span-3 space-y-4">
            {/* Blink Pattern */}
            <div className="bg-gray-800 rounded-lg p-5">
              <h3 className="text-lg font-bold mb-4">Blink Pattern</h3>
              <div className="h-32 flex items-end gap-1.5">
                {blinkRate.map((rate, i) => (
                  <div 
                    key={i}
                    className="flex-1 bg-blue-500 rounded-t transition-all duration-300"
                    style={{ height: `${rate}%` }}
                  ></div>
                ))}
              </div>
              {baseline.calibrated && (
                <div className="mt-3 text-sm text-gray-400 font-medium">
                  Baseline: {baseline.blink_rate.toFixed(1)}/min
                </div>
              )}
            </div>

            {/* Hand-to-Face Gesture */}
            <div className="bg-gray-800 rounded-lg p-5">
              <h3 className="text-lg font-bold mb-4">Hand-to-Face Contact</h3>
              <div className="flex items-center justify-center">
                <div className="relative w-40 h-40">
                  <svg className="w-full h-full transform -rotate-90">
                    <circle
                      cx="80"
                      cy="80"
                      r="70"
                      stroke="#374151"
                      strokeWidth="10"
                      fill="none"
                    />
                    <circle
                      cx="80"
                      cy="80"
                      r="70"
                      stroke="#10b981"
                      strokeWidth="10"
                      fill="none"
                      strokeDasharray={`${gestureScore * 4.4} 440`}
                      className="transition-all duration-500"
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <Hand className="w-10 h-10 text-green-400 mb-2" />
                    <span className="text-2xl font-bold">{Math.round(gestureScore)}</span>
                  </div>
                </div>
              </div>
              {baseline.calibrated && (
                <div className="mt-3 text-sm text-gray-400 text-center font-medium">
                  Baseline frequency: {(baseline.hand_face_frequency * 100).toFixed(1)}%
                </div>
              )}
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
    </div>
  );
}

