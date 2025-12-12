import React, { useState, useEffect } from 'react';
import { Play, Pause, RotateCcw, SkipBack, SkipForward, Clock, Calendar, TrendingUp } from 'lucide-react';

export default function ReviewMode({ sessionData, onClose }) {
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoError, setVideoError] = useState(null);
  const [videoLoaded, setVideoLoaded] = useState(false);
  const videoRef = React.useRef(null);

  // Use video duration if available, otherwise calculate from session times
  const duration = videoDuration > 0 && isFinite(videoDuration)
    ? videoDuration 
    : (sessionData?.end_time && sessionData?.start_time)
      ? (sessionData.end_time - sessionData.start_time)
      : (sessionData?.events?.length > 0 
        ? sessionData.events[sessionData.events.length - 1].timestamp 
        : 0);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackSpeed;
    }
  }, [playbackSpeed]);

  useEffect(() => {
    if (playing && videoRef.current && videoLoaded) {
      videoRef.current.play().catch(err => {
        console.error('Error playing video:', err);
        setPlaying(false);
      });
    } else if (videoRef.current) {
      videoRef.current.pause();
    }
  }, [playing, videoLoaded]);

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      const dur = videoRef.current.duration;
      console.log('Video loaded, duration:', dur, 'isFinite:', isFinite(dur));
      if (isFinite(dur) && dur > 0) {
        setVideoDuration(dur);
      } else {
        console.warn('⚠️ Video duration is invalid, using session time');
        // Calculate from session data
        const calculatedDuration = sessionData?.end_time && sessionData?.start_time
          ? (sessionData.end_time - sessionData.start_time)
          : 60; // Default to 60 seconds if unknown
        setVideoDuration(calculatedDuration);
      }
      setVideoLoaded(true);
    }
  };

  const handleVideoError = (e) => {
    console.error('Video error:', e);
    const errorDetails = {
      target: e.target?.tagName,
      src: e.target?.src || e.target?.currentSrc,
      error: videoRef.current?.error,
      errorCode: videoRef.current?.error?.code,
      errorMessage: videoRef.current?.error?.message,
      networkState: videoRef.current?.networkState,
      readyState: videoRef.current?.readyState
    };
    console.error('Video error details:', errorDetails);
    
    // Provide user-friendly error message based on error code
    let errorMsg = 'Failed to load video';
    if (videoRef.current?.error?.code === 4) {
      errorMsg = 'Video format not supported by browser. Try opening in VLC player.';
    } else if (videoRef.current?.error?.code === 3) {
      errorMsg = 'Video file is corrupted or incomplete';
    } else if (videoRef.current?.error?.code === 2) {
      errorMsg = 'Network error loading video';
    }
    
    setVideoError(errorMsg);
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
    return `${mins}:${secs.toString().padStart(2, '0')}`;
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

  const eventsAtCurrentTime = sessionData?.events?.filter(
    e => Math.abs(e.timestamp - currentTime) < 2
  ) || [];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-90 z-50 flex items-center justify-center p-6">
      <div className="bg-gray-900 rounded-lg w-full max-w-6xl h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <div>
            <h2 className="text-xl font-bold text-white">Session Review</h2>
            <p className="text-sm text-gray-400">
              {sessionData?.session_name} - {formatDate(sessionData?.start_time)}
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
                    src={`http://localhost:5000/api/video/${encodeURIComponent(sessionData.video_file)}`}
                    className="max-w-full max-h-full"
                    onTimeUpdate={handleTimeUpdate}
                    onLoadedMetadata={handleLoadedMetadata}
                    onError={handleVideoError}
                    onEnded={() => setPlaying(false)}
                    controls={false}
                  />
                  {!videoLoaded && !videoError && (
                    <div className="absolute inset-0 flex items-center justify-center bg-gray-900 bg-opacity-75">
                      <div className="text-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-3"></div>
                        <p className="text-gray-400">Loading video...</p>
                        <p className="text-xs text-gray-500 mt-1 max-w-md truncate px-4">{sessionData.video_file}</p>
                      </div>
                    </div>
                  )}
                  {videoError && (
                    <div className="absolute inset-0 flex items-center justify-center bg-gray-900 bg-opacity-75">
                      <div className="text-center max-w-lg">
                        <Clock className="w-16 h-16 mx-auto mb-2 text-red-500" />
                        <p className="text-red-400 mb-2">{videoError}</p>
                        <p className="text-xs text-gray-500 mb-4 max-w-md truncate px-4">{sessionData.video_file}</p>
                        <div className="flex gap-2 justify-center">
                          <a
                            href={`http://localhost:5000/api/video/${encodeURIComponent(sessionData.video_file)}`}
                            download
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-white text-sm transition"
                          >
                            📥 Download Video
                          </a>
                          <button
                            onClick={() => window.open(`http://localhost:5000/api/video/${encodeURIComponent(sessionData.video_file)}`, '_blank')}
                            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-white text-sm transition"
                          >
                            🔗 Open in New Tab
                          </button>
                        </div>
                        <p className="text-xs text-gray-400 mt-3">
                          💡 Tip: Try opening with VLC Media Player
                        </p>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center">
                  <Clock className="w-16 h-16 mx-auto mb-2 text-gray-500" />
                  <p className="text-gray-400">No video file available</p>
                  <p className="text-sm text-gray-500 mt-1">Time: {formatTime(currentTime)} / {formatTime(duration)}</p>
                </div>
              )}
            </div>

            {/* Timeline */}
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="space-y-3">
                {/* Playback Controls */}
                <div className="flex items-center justify-center gap-3">
                  <button 
                    onClick={() => handleSeekToTime(Math.max(0, currentTime - 10))}
                    className="p-2 hover:bg-gray-700 rounded-lg transition disabled:opacity-50"
                    disabled={!videoLoaded}
                  >
                    <SkipBack className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => setPlaying(!playing)}
                    className="p-3 bg-blue-600 hover:bg-blue-700 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={!videoLoaded}
                  >
                    {playing ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6" />}
                  </button>
                  <button 
                    onClick={() => handleSeekToTime(Math.min(duration, currentTime + 10))}
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
                  {sessionData?.events?.map((event, idx) => (
                    <div
                      key={idx}
                      className={`absolute top-0 bottom-0 w-1 ${
                        event.stress_level >= 3 ? 'bg-red-500' :
                        event.stress_level >= 2 ? 'bg-yellow-500' :
                        'bg-blue-500'
                      } opacity-50`}
                      style={{ left: `${(event.timestamp / duration) * 100}%` }}
                    />
                  ))}

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
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded ${
                        event.stress_level >= 3 ? 'bg-red-900 text-red-400' :
                        event.stress_level >= 2 ? 'bg-yellow-900 text-yellow-400' :
                        'bg-blue-900 text-blue-400'
                      }`}>
                        {event.tell_type}
                      </span>
                      <span className="text-xs text-gray-400">
                        {formatTime(event.timestamp)}
                      </span>
                    </div>
                    <p className="text-sm text-white">{event.tell_text}</p>
                    <div className="flex items-center justify-between mt-2 text-xs">
                      <span className="text-gray-400">Confidence:</span>
                      <span className="text-white">{(event.confidence * 100).toFixed(0)}%</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Session Stats */}
            <div className="mt-6 pt-4 border-t border-gray-700">
              <h3 className="text-sm font-semibold mb-3 text-gray-400">Session Statistics</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">Total Events:</span>
                  <span className="text-white font-semibold">{sessionData?.events?.length || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Duration:</span>
                  <span className="text-white font-semibold">{formatTime(duration)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">FPS:</span>
                  <span className="text-white font-semibold">{sessionData?.fps || 0}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
