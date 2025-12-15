import React, { useState, useEffect, useMemo } from "react";
import {
  Play,
  Pause,
  RotateCcw,
  SkipBack,
  SkipForward,
  Clock,
  Calendar,
  TrendingUp,
} from "lucide-react";

export default function ReviewMode({ sessionData, onClose }) {
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoError, setVideoError] = useState(null);
  const [videoLoaded, setVideoLoaded] = useState(false);
  const videoRef = React.useRef(null);
  const hasAutoPlayedRef = React.useRef(false); // Flag to prevent multiple auto-plays

  // Convert tells to events format if events array is empty
  const events = useMemo(() => {
    if (sessionData?.events && sessionData.events.length > 0) {
      return sessionData.events;
    }

    // Convert tells to events format
    if (sessionData?.tells && sessionData.tells.length > 0) {
      return sessionData.tells.map((tell) => ({
        timestamp: tell.timestamp || 0,
        tell_type: tell.type || "detection",
        tell_text: tell.message || "",
        stress_level: ["lips", "blink", "bpm"].includes(tell.type) ? 2 : 1,
        confidence: 0.8,
      }));
    }

    return [];
  }, [sessionData]);

  // Calibration typically takes 30 seconds before analysis starts
  const CALIBRATION_DURATION = 30;

  // Use video duration only (analysis phase only, not including calibration)
  // Don't use session duration as it includes calibration time
  const duration =
    videoDuration > 0 && isFinite(videoDuration)
      ? videoDuration
      : events.length > 0
      ? Math.max(
          ...events.map((e) => e.timestamp - (sessionData?.start_time || 0))
        ) - CALIBRATION_DURATION
      : 22; // Default fallback for webm videos without duration

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackSpeed;
    }
  }, [playbackSpeed]);

  // Force video to load metadata on mount
  useEffect(() => {
    if (videoRef.current && sessionData?.video_file) {
      console.log("🎬 Loading video:", sessionData.video_file);
      videoRef.current.load();
    }
  }, [sessionData?.video_file]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (playing && videoLoaded) {
      console.log("▶️ Attempting to play video", {
        readyState: video.readyState,
        paused: video.paused,
        currentTime: video.currentTime,
      });

      // Check if video is ready to play (readyState >= 2 means enough data loaded)
      if (video.readyState >= 2) {
        const playPromise = video.play();
        if (playPromise !== undefined) {
          playPromise
            .then(() => {
              console.log("✅ Video playing successfully");
            })
            .catch((err) => {
              console.error("❌ Error playing video:", err);
              setPlaying(false);
            });
        }
      } else {
        console.warn(
          "⚠️ Video not ready to play yet, readyState:",
          video.readyState
        );
        // Wait for video to be ready
        const onCanPlay = () => {
          console.log("✅ Video can now play");
          video.play().catch((err) => {
            console.error("❌ Error playing video after canplay:", err);
            setPlaying(false);
          });
          video.removeEventListener("canplay", onCanPlay);
        };
        video.addEventListener("canplay", onCanPlay);
      }
    } else if (!playing) {
      console.log("⏸️ Pausing video");
      video.pause();
    }
  }, [playing, videoLoaded]);

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      const duration = videoRef.current.duration;
      console.log("📹 Video metadata loaded:", {
        duration,
        readyState: videoRef.current.readyState,
        networkState: videoRef.current.networkState,
        videoWidth: videoRef.current.videoWidth,
        videoHeight: videoRef.current.videoHeight,
      });

      // Always set videoLoaded to true even if duration is invalid
      // Video can still play, we'll use session duration as fallback
      setVideoLoaded(true);

      if (duration && !isNaN(duration) && isFinite(duration)) {
        setVideoDuration(duration);
        console.log("✅ Video duration set:", duration);
      } else {
        console.warn("⚠️ Invalid duration, using session duration fallback");
        setVideoDuration(0); // Force fallback to session duration
      }
    }
  };

  const handleVideoError = (e) => {
    console.error("Video error:", e);
    setVideoError("Failed to load video");
    setVideoLoaded(false);
  };

  const handleSeekToTime = (time) => {
    if (videoRef.current && videoLoaded) {
      videoRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const formatDate = (timestamp) => {
    return new Date(timestamp * 1000).toLocaleString();
  };

  const handleSeek = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = x / rect.width;
    const newTime = percentage * duration;
    handleSeekToTime(newTime);
  };

  const eventsAtCurrentTime = events.filter((event) => {
    // Convert absolute timestamp to relative seconds from analysis start (after calibration)
    const eventTime =
      event.timestamp - (sessionData?.start_time || 0) - CALIBRATION_DURATION;
    return eventTime >= 0 && Math.abs(eventTime - currentTime) < 2;
  });

  return (
    <div className="fixed inset-0 bg-black bg-opacity-90 z-50 flex items-center justify-center p-6">
      <div className="bg-gray-900 rounded-lg w-full max-w-6xl h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <div>
            <h2 className="text-xl font-bold text-white">Session Review</h2>
            <p className="text-sm text-gray-400">
              {sessionData?.session_name} -{" "}
              {formatDate(sessionData?.start_time)}
            </p>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition"
          >
            Close
          </button>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex gap-4 p-4 overflow-hidden">
          {/* Video/Timeline Area */}
          <div className="flex-1 flex flex-col gap-4">
            {/* Video Player */}
            <div className="flex-1 bg-gray-800 rounded-lg overflow-hidden flex items-center justify-center relative">
              {sessionData?.video_file ? (
                <>
                  <video
                    ref={videoRef}
                    className="max-w-full max-h-full object-contain"
                    style={{ display: "block", width: "auto", height: "auto", transform: "scaleX(-1)" }}
                    onTimeUpdate={handleTimeUpdate}
                    onLoadedMetadata={handleLoadedMetadata}
                    onError={handleVideoError}
                    onEnded={() => setPlaying(false)}
                    onCanPlay={() => {
                      // Auto-play only once when video first becomes ready
                      if (videoRef.current && !hasAutoPlayedRef.current) {
                        console.log(
                          "✅ Video can play - auto-starting playback (first time)"
                        );
                        hasAutoPlayedRef.current = true;
                        setPlaying(true);
                      }
                    }}
                    controls={false}
                    crossOrigin="anonymous"
                    preload="auto"
                    playsInline
                    src={`http://localhost:5000/recordings/${sessionData.video_file}`}
                  >
                    Your browser does not support video playback.
                  </video>
                  {!videoLoaded && !videoError && (
                    <div className="absolute inset-0 flex items-center justify-center bg-gray-900 bg-opacity-75 z-10">
                      <div className="text-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-3"></div>
                        <p className="text-gray-400">Loading video...</p>
                        <p className="text-xs text-gray-500 mt-1 max-w-md truncate px-4">
                          {sessionData.video_file}
                        </p>
                      </div>
                    </div>
                  )}
                  {videoError && (
                    <div className="absolute inset-0 flex items-center justify-center bg-gray-900 bg-opacity-75">
                      <div className="text-center">
                        <Clock className="w-16 h-16 mx-auto mb-2 text-red-500" />
                        <p className="text-red-400">{videoError}</p>
                        <p className="text-xs text-gray-500 mt-1 max-w-md truncate px-4">
                          {sessionData.video_file}
                        </p>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center">
                  <Clock className="w-16 h-16 mx-auto mb-2 text-gray-500" />
                  <p className="text-gray-400">No video file available</p>
                  <p className="text-sm text-gray-500 mt-1">
                    Time: {formatTime(currentTime)} / {formatTime(duration)}
                  </p>
                </div>
              )}
            </div>

            {/* Timeline */}
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="space-y-3">
                {/* Playback Controls */}
                <div className="flex items-center justify-center gap-3">
                  <button
                    onClick={() =>
                      handleSeekToTime(Math.max(0, currentTime - 10))
                    }
                    className="p-2 hover:bg-gray-700 rounded-lg transition disabled:opacity-50"
                    disabled={!videoLoaded}
                  >
                    <SkipBack className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => {
                      console.log("🎮 Play/Pause button clicked", {
                        currentPlaying: playing,
                        willBe: !playing,
                        videoLoaded,
                      });
                      setPlaying(!playing);
                    }}
                    className="p-3 bg-blue-600 hover:bg-blue-700 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={!videoLoaded}
                  >
                    {playing ? (
                      <Pause className="w-6 h-6" />
                    ) : (
                      <Play className="w-6 h-6" />
                    )}
                  </button>
                  <button
                    onClick={() =>
                      handleSeekToTime(Math.min(duration, currentTime + 10))
                    }
                    className="p-2 hover:bg-gray-700 rounded-lg transition disabled:opacity-50"
                    disabled={!videoLoaded}
                  >
                    <SkipForward className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => handleSeekToTime(0)}
                    className="p-2 hover:bg-gray-700 rounded-lg transition disabled:opacity-50"
                    disabled={!videoLoaded}
                  >
                    <RotateCcw className="w-5 h-5" />
                  </button>

                  {/* Speed Control */}
                  <select
                    value={playbackSpeed}
                    onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
                    className="bg-gray-700 text-white px-3 py-2 rounded-lg text-sm"
                  >
                    <option value={0.5}>0.5x</option>
                    <option value={1}>1x</option>
                    <option value={1.5}>1.5x</option>
                    <option value={2}>2x</option>
                  </select>
                </div>

                {/* Timeline Slider */}
                <div
                  className="relative h-12 bg-gray-700 rounded-lg cursor-pointer overflow-hidden"
                  onClick={handleSeek}
                >
                  {/* Event markers */}
                  {events.map((event, idx) => {
                    // Adjust event time to be relative to analysis start
                    const eventTime =
                      event.timestamp -
                      (sessionData?.start_time || 0) -
                      CALIBRATION_DURATION;
                    if (eventTime < 0) return null; // Skip events during calibration

                    return (
                      <div
                        key={idx}
                        className={`absolute top-0 bottom-0 w-1 ${
                          event.stress_level >= 3
                            ? "bg-red-500"
                            : event.stress_level >= 2
                            ? "bg-yellow-500"
                            : "bg-blue-500"
                        } opacity-50`}
                        style={{ left: `${(eventTime / duration) * 100}%` }}
                      />
                    );
                  })}

                  {/* Progress */}
                  <div
                    className="absolute top-0 bottom-0 bg-blue-500 opacity-30"
                    style={{ width: `${(currentTime / duration) * 100}%` }}
                  />

                  {/* Playhead */}
                  <div
                    className="absolute top-0 bottom-0 w-1 bg-white shadow-lg"
                    style={{ left: `${(currentTime / duration) * 100}%` }}
                  />
                </div>

                <div className="flex justify-between text-xs text-gray-400">
                  <span>{formatTime(currentTime)}</span>
                  <span>{formatTime(duration)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Events Sidebar */}
          <div className="w-80 bg-gray-800 rounded-lg p-4 overflow-y-auto">
            <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-blue-400" />
              Events at {formatTime(currentTime)}
            </h3>

            {eventsAtCurrentTime.length === 0 ? (
              <p className="text-gray-500 text-sm">No events at this time</p>
            ) : (
              <div className="space-y-2">
                {eventsAtCurrentTime.map((event, idx) => (
                  <div
                    key={idx}
                    className="bg-gray-700 rounded-lg p-3 cursor-pointer hover:bg-gray-600 transition"
                    onClick={() => setSelectedEvent(event)}
                  >
                    <div className="flex items-start justify-between mb-1">
                      <span
                        className={`text-xs font-semibold px-2 py-0.5 rounded ${
                          event.stress_level >= 3
                            ? "bg-red-900 text-red-400"
                            : event.stress_level >= 2
                            ? "bg-yellow-900 text-yellow-400"
                            : "bg-blue-900 text-blue-400"
                        }`}
                      >
                        {event.tell_type}
                      </span>
                      <span className="text-xs text-gray-400">
                        {formatTime(event.timestamp)}
                      </span>
                    </div>
                    <p className="text-sm text-white">{event.tell_text}</p>
                  
                
                  </div>
                ))}
              </div>
            )}

            {/* Session Stats */}
            <div className="mt-6 pt-4 border-t border-gray-700">
              <h3 className="text-sm font-semibold mb-3 text-gray-400">
                Session Statistics
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">Total Events:</span>
                  <span className="text-white font-semibold">
                    {events.length}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Analysis Duration:</span>
                  <span className="text-white font-semibold">
                    {formatTime(duration)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">FPS:</span>
                  <span className="text-white font-semibold">
                    {sessionData?.fps || 30}
                  </span>
                </div>
              </div>
            </div>

            {/* AI Analysis */}
            {sessionData?.ai_analysis && (
              <div className="mt-6 pt-4 border-t border-gray-700">
                <h3 className="text-sm font-semibold mb-3 text-gray-400 flex items-center gap-2">
                  🤖 AI Analysis
                </h3>

                {/* Suspicion Level */}
                <div className="mb-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-gray-400">
                      Mức độ khả nghi:
                    </span>
                    <span
                      className={`text-xs font-bold px-2 py-1 rounded ${
                        sessionData.ai_analysis.suspicion_level === "HIGH"
                          ? "bg-red-900 text-red-400"
                          : sessionData.ai_analysis.suspicion_level === "MEDIUM"
                          ? "bg-yellow-900 text-yellow-400"
                          : "bg-green-900 text-green-400"
                      }`}
                    >
                      {sessionData.ai_analysis.suspicion_level}
                      {sessionData.ai_analysis.suspicion_score &&
                        ` (${sessionData.ai_analysis.suspicion_score}%)`}
                    </span>
                  </div>
                </div>

                {/* Summary */}
                <div className="mb-3 p-2 bg-gray-700 rounded text-xs text-gray-300">
                  <strong className="text-white">Tóm tắt:</strong>
                  <br />
                  {sessionData.ai_analysis.summary}
                </div>

                {/* Recommendation */}
                <div className="mb-3 p-2 bg-blue-900 bg-opacity-20 border border-blue-700 rounded text-xs">
                  <strong className="text-blue-400">Khuyến nghị:</strong>
                  <br />
                  <span className="text-gray-300">
                    {sessionData.ai_analysis.recommendation}
                  </span>
                </div>

                {/* Reasoning */}
                <div className="mb-3 p-2 bg-gray-700 rounded text-xs text-gray-300">
                  <strong className="text-white">Lý do:</strong>
                  <br />
                  {sessionData.ai_analysis.reasoning}
                </div>

                {/* Key Indicators */}
                {sessionData.ai_analysis.key_indicators &&
                  sessionData.ai_analysis.key_indicators.length > 0 && (
                    <div className="mb-3">
                      <strong className="text-xs text-white">
                        Dấu hiệu quan trọng:
                      </strong>
                      <ul className="mt-1 space-y-2 text-xs text-gray-300">
                        {sessionData.ai_analysis.key_indicators.map(
                          (indicator, idx) => {
                            // Handle both string and object formats
                            if (typeof indicator === "string") {
                              return (
                                <li
                                  key={idx}
                                  className="flex items-start gap-1"
                                >
                                  <span className="text-blue-400">•</span>
                                  <span>{indicator}</span>
                                </li>
                              );
                            } else if (typeof indicator === "object") {
                              return (
                                <li key={idx} className="flex flex-col gap-1">
                                  <div className="flex items-start gap-1">
                                    <span className="text-blue-400">•</span>
                                    <span className="font-semibold text-white">
                                      {indicator.indicator || "Dấu hiệu"}
                                    </span>
                                  </div>
                                  {indicator.interpretation && (
                                    <span className="ml-3 text-gray-400">
                                      {indicator.interpretation}
                                    </span>
                                  )}
                                  {indicator.anomaly_note && (
                                    <span className="ml-3 text-yellow-400">
                                      ⚠️ {indicator.anomaly_note}
                                    </span>
                                  )}
                                </li>
                              );
                            }
                            return null;
                          }
                        )}
                      </ul>
                    </div>
                  )}

                {/* Suggested Questions */}
                {sessionData.ai_analysis.suggested_questions &&
                  sessionData.ai_analysis.suggested_questions.length > 0 && (
                    <div>
                      <strong className="text-xs text-white">
                        Câu hỏi nên hỏi thêm:
                      </strong>
                      <ul className="mt-1 space-y-1 text-xs text-gray-300">
                        {sessionData.ai_analysis.suggested_questions.map(
                          (question, idx) => (
                            <li key={idx} className="flex items-start gap-1">
                              <span className="text-yellow-400">?</span>
                              <span>{question}</span>
                            </li>
                          )
                        )}
                      </ul>
                    </div>
                  )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
