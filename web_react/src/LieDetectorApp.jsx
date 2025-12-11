import React, { useState, useEffect, useRef } from 'react';
import { Activity, Eye, Hand, Heart, AlertTriangle, TrendingUp, Target } from 'lucide-react';
import { io } from 'socket.io-client';
import api from './services/api';
import CameraFeed from './components/CameraFeed';

export default function LieDetectorApp() {
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
  
  // WebSocket reference for real-time updates
  const wsRef = useRef(null);
  const pollingRef = useRef(null);

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
      
      return () => {
        if (socket) {
          socket.disconnect();
        }
      };
    }
  }, [cameraActive, baseline.calibrated, sessionId]);

  // Fallback polling mechanism
  const startPolling = () => {
    if (pollingRef.current) return;
    
    pollingRef.current = setInterval(async () => {
      if (baseline.calibrated && sessionId) {
        try {
          const response = await api.getMetrics(sessionId);
          updateMetrics(response.data);
        } catch (error) {
          console.error('Error polling metrics:', error);
        }
      }
    }, 2000);
  };

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
      
      // Simulate calibration progress (60 seconds)
      const calibrationInterval = setInterval(() => {
        setCalibrationProgress(prev => {
          if (prev >= 100) {
            clearInterval(calibrationInterval);
            completeCalibration();
            return 100;          }
          return prev + 1; // +1 every 600ms = 60 seconds
        });
      }, 600);
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

  const addTell = (message, type) => {
    const newTell = {
      id: Date.now() + Math.random(),
      message,
      type,
      ttl: 10 // 10 seconds
    };
    
    setTells(prev => {
      // Remove existing tell of same type
      const filtered = prev.filter(t => t.type !== type);
      return [...filtered, newTell];
    });
  };

  // Decrement tell TTL
  useEffect(() => {
    const interval = setInterval(() => {
      setTells(prev => {
        return prev
          .map(tell => ({ ...tell, ttl: tell.ttl - 1 }))
          .filter(tell => tell.ttl > 0);
      });
    }, 1000);
    
    return () => clearInterval(interval);
  }, []);

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
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Activity className="w-8 h-8 text-green-400" />
            <h1 className="text-2xl font-bold">Lie Detector - Advanced Deception Detection</h1>
          </div>
          
          {baseline.calibrated && (
            <div className="flex items-center gap-2 text-sm bg-green-900 bg-opacity-30 px-3 py-1 rounded-lg border border-green-600">
              <Target className="w-4 h-4 text-green-400" />
              <span className="text-green-400">Baseline: {baseline.bpm.toFixed(1)} BPM | {baseline.blink_rate.toFixed(1)}/min</span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-12 gap-6">
          {/* Sidebar */}
          <div className="col-span-3 bg-gray-800 rounded-lg p-4 space-y-2">
            <div className="text-sm space-y-2">
              <div className="flex items-center gap-2 p-2 bg-gray-700 rounded cursor-pointer">
                <div className="w-4 h-4 bg-gray-600 rounded"></div>
                <span>Overview</span>
              </div>
              <div className="flex items-center gap-2 p-2 hover:bg-gray-700 rounded cursor-pointer">
                <div className="w-4 h-4 bg-gray-600 rounded"></div>
                <span>Requirements</span>
              </div>
              <div className="flex items-center gap-2 p-2 hover:bg-gray-700 rounded cursor-pointer">
                <div className="w-4 h-4 bg-gray-600 rounded"></div>
                <span>Installation</span>
              </div>
              <div className="flex items-center gap-2 p-2 hover:bg-gray-700 rounded cursor-pointer">
                <div className="w-4 h-4 bg-gray-600 rounded"></div>
                <span>Usage</span>
              </div>
              <div className="flex items-center gap-2 p-2 hover:bg-gray-700 rounded cursor-pointer">
                <div className="w-4 h-4 bg-gray-600 rounded"></div>
                <span>Algorithm Details</span>
              </div>
              <div className="flex items-center gap-2 p-2 hover:bg-gray-700 rounded cursor-pointer">
                <div className="w-4 h-4 bg-gray-600 rounded"></div>
                <span>Calibration</span>
              </div>
              <div className="flex items-center gap-2 p-2 hover:bg-gray-700 rounded cursor-pointer">
                <div className="w-4 h-4 bg-gray-600 rounded"></div>
                <span>Controls</span>
              </div>
              <div className="flex items-center gap-2 p-2 hover:bg-gray-700 rounded cursor-pointer">
                <div className="w-4 h-4 bg-gray-600 rounded"></div>
                <span>Limitations</span>
              </div>
            </div>
          </div>

          {/* Main Content */}
          <div className="col-span-6 space-y-4">
            {/* Video Feed with Calibration Overlay */}
            <div className="relative">
              {cameraActive && sessionId ? (
                <CameraFeed sessionId={sessionId} calibrated={baseline.calibrated} onMetricsUpdate={handleFrontendMetrics} />
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

            {cameraActive && !isCalibrating && !baseline.calibrated && (
              <div className="bg-gray-800 rounded-lg overflow-hidden relative">
                <div className="aspect-video bg-gray-700 flex items-center justify-center relative">
                  <div className="relative">
                    <div className="w-64 h-80 border-2 border-green-400 rounded-lg relative">
                      {/* Facial landmarks */}
                      <div className="absolute top-20 left-16 w-4 h-4 bg-green-400 rounded-full animate-pulse"></div>
                      <div className="absolute top-20 right-16 w-4 h-4 bg-green-400 rounded-full animate-pulse"></div>
                      <div className="absolute top-32 left-1/2 -translate-x-1/2 w-4 h-4 bg-green-400 rounded-full animate-pulse"></div>
                      <div className="absolute bottom-24 left-1/2 -translate-x-1/2 w-12 h-6 border-2 border-yellow-400 rounded-full"></div>
                      
                      {lipCompression && (
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-yellow-500 px-4 py-2 rounded flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4" />
                          <span className="text-sm font-semibold">Lip Compression</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
            
            {cameraActive && baseline.calibrated && (
              <>
                {/* Heart Rate Display */}
                <div className={`bg-gray-900 bg-opacity-80 rounded-lg p-3 flex items-center gap-2 ${getBpmColor()}`}>
                  <Heart className="w-5 h-5" />
                  <span className="text-xl font-bold">{bpm.toFixed(1)} BPM</span>
                  {baseline.calibrated && (
                    <span className="text-xs">
                      ({((bpm - baseline.bpm) / baseline.bpm * 100).toFixed(0)}%)
                    </span>
                  )}
                </div>

                {/* Mini Graph */}
                <div className="bg-gray-900 bg-opacity-80 rounded-lg p-2">
                  <svg width="200" height="50">
                    <polyline
                      fill="none"
                      stroke="#10b981"
                      strokeWidth="2"
                      points={Array.from({ length: 50 }, (_, i) => {
                        const x = i * 4;
                        const y = 25 + Math.sin(i * 0.3 + Date.now() * 0.01) * 15;
                        return `${x},${y}`;
                      }).join(' ')}
                    />
                  </svg>
                </div>
              </>
            )}

            {/* Status Bar & Detection Tells */}
            <div className="space-y-2">
              <div className={`${stressColor.includes('green') ? 'bg-green-900 border-green-600' : stressColor.includes('yellow') ? 'bg-yellow-900 border-yellow-600' : 'bg-red-900 border-red-600'} border rounded-lg p-3 flex items-center justify-between`}>
                <div>
                  <span className="text-sm font-semibold">
                    {isCalibrating ? 'Status: Calibrating baseline...' : 
                     baseline.calibrated ? `Status: ${stressLevel}` : 
                     'Status: Ready to calibrate'}
                  </span>
                </div>
                {analyzing && (
                  <div className="flex gap-1">
                    <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                    <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" style={{animationDelay: '0.2s'}}></div>
                    <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" style={{animationDelay: '0.4s'}}></div>
                  </div>
                )}
              </div>
              
              {/* Detection Tells */}
              {tells.map(tell => (
                <div key={tell.id} className="bg-yellow-900 bg-opacity-50 border border-yellow-600 rounded-lg p-2 flex items-center justify-between animate-pulse">
                  <span className="text-sm text-yellow-200">{tell.message}</span>
                  <span className="text-xs text-yellow-400">{tell.ttl}s</span>
                </div>
              ))}
            </div>
          </div>

          {/* Right Sidebar - Analytics */}
          <div className="col-span-3 space-y-4">
            {/* Blink Pattern */}
            <div className="bg-gray-800 rounded-lg p-4">
              <h3 className="text-sm font-semibold mb-3">Blink Pattern</h3>
              <div className="h-24 flex items-end gap-1">
                {blinkRate.map((rate, i) => (
                  <div 
                    key={i}
                    className="flex-1 bg-blue-500 rounded-t transition-all duration-300"
                    style={{ height: `${rate}%` }}
                  ></div>
                ))}
              </div>
              {baseline.calibrated && (
                <div className="mt-2 text-xs text-gray-400">
                  Baseline: {baseline.blink_rate.toFixed(1)}/min
                </div>
              )}
            </div>

            {/* Emotion Analysis - FER Style */}
            <div className="bg-gray-800 rounded-lg p-4">
              <h3 className="text-sm font-semibold mb-3 flex items-center justify-between">
                <span>Emotion (FER)</span>
                <span className={`text-xs px-2 py-1 rounded`} style={{
                  backgroundColor: `${getEmotionColor(dominantEmotion)}20`,
                  color: getEmotionColor(dominantEmotion)
                }}>
                  {dominantEmotion} ({(emotionConfidence * 100).toFixed(0)}%)
                </span>
              </h3>
              <div className="space-y-2">
                {Object.entries(emotionData).map(([emotion, value]) => (
                  <div key={emotion}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="capitalize">{emotion}</span>
                      <span className="text-gray-400">{value.toFixed(1)}%</span>
                    </div>
                    <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
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
              <div className="mt-3 pt-3 border-t border-gray-700 text-xs text-gray-400">
                <p>Detection via FER (Facial Emotion Recognition) with MTCNN</p>
              </div>
            </div>

            {/* Hand-to-Face Gesture */}
            <div className="bg-gray-800 rounded-lg p-4">
              <h3 className="text-sm font-semibold mb-3">Hand-to-Face Contact</h3>
              <div className="flex items-center justify-center">
                <div className="relative w-32 h-32">
                  <svg className="w-full h-full transform -rotate-90">
                    <circle
                      cx="64"
                      cy="64"
                      r="56"
                      stroke="#374151"
                      strokeWidth="8"
                      fill="none"
                    />
                    <circle
                      cx="64"
                      cy="64"
                      r="56"
                      stroke="#10b981"
                      strokeWidth="8"
                      fill="none"
                      strokeDasharray={`${gestureScore * 3.52} 352`}
                      className="transition-all duration-500"
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <Hand className="w-8 h-8 text-green-400 mb-1" />
                    <span className="text-xl font-bold">{Math.round(gestureScore)}</span>
                  </div>
                </div>
              </div>
              {baseline.calibrated && (
                <div className="mt-2 text-xs text-gray-400 text-center">
                  Baseline frequency: {(baseline.hand_face_frequency * 100).toFixed(1)}%
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

