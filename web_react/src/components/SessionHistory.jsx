import React, { useState, useRef, useEffect } from "react";
import {
  History,
  Play,
  Calendar,
  Clock,
  TrendingUp,
  ChevronRight,
} from "lucide-react";

export default function SessionHistory({ onSelectSession }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSessions();
  }, []);

  const fetchSessions = async () => {
    try {
      const response = await fetch("http://localhost:5000/api/sessions");
      const data = await response.json();
      setSessions(data.sessions || []);
      setLoading(false);
    } catch (error) {
      console.error("Failed to fetch sessions:", error);
      setLoading(false);
    }
  };

  const formatDate = (timestamp) => {
    return new Date(timestamp * 1000).toLocaleString();
  };

  const formatDuration = (start, end) => {
    const duration = end - start;
    const mins = Math.floor(duration / 60);
    const secs = Math.floor(duration % 60);
    return `${mins}m ${secs}s`;
  };

  return (
    <div className="bg-gray-800 rounded-lg p-6">
      <div className="flex items-center gap-3 mb-6">
        <History className="w-6 h-6 text-blue-400" />
        <h2 className="text-2xl font-bold">Session History</h2>
      </div>

      {loading ? (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
          <p className="text-gray-400 mt-4">Loading sessions...</p>
        </div>
      ) : sessions.length === 0 ? (
        <div className="text-center py-12">
          <History className="w-16 h-16 mx-auto mb-4 text-gray-600" />
          <p className="text-gray-400">No sessions found</p>
          <p className="text-gray-500 text-sm mt-2">
            Start a new session to see it here
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.map((session, idx) => (
            <div
              key={idx}
              className="bg-gray-700 hover:bg-gray-650 rounded-lg p-4 cursor-pointer transition-all duration-200 group"
              onClick={() => onSelectSession(session)}
            >
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-lg font-semibold text-white group-hover:text-blue-400 transition">
                      {session.session_name}
                    </h3>
                    <span className="text-xs px-2 py-1 bg-red-900 text-red-400 rounded">
                      {session.tells?.length || 0} tells
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-4 text-sm text-gray-400">
                    <div className="flex items-center gap-1">
                      <Calendar className="w-4 h-4" />
                      <span>{formatDate(session.start_time)}</span>
                    </div>

                    {session.calibration_end_time && (
                      <div className="flex items-center gap-1">
                        <Clock className="w-4 h-4" />
                        <span>
                          {formatDuration(
                            session.start_time,
                            session.calibration_end_time
                          )}
                        </span>
                      </div>
                    )}

                    <div className="flex items-center gap-1">
                      <TrendingUp className="w-4 h-4" />
                      <span>FPS: {session.fps || "N/A"}</span>
                    </div>
                  </div>

                  {session.video_file && (
                    <div className="mt-3">
                      <div className="flex items-center gap-2">
                        <span className="inline-block px-2 py-1 bg-purple-900 text-purple-300 text-xs rounded whitespace-nowrap">
                          🎥 Video Available
                        </span>
                        <button
                          className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded transition"
                          onClick={(e) => {
                            e.stopPropagation();
                            const video = document.getElementById(
                              `session-video-${idx}`
                            );
                            if (video) {
                              video.style.display =
                                video.style.display === "none"
                                  ? "block"
                                  : "none";
                            }
                          }}
                        >
                          Xem video
                        </button>
                        <span className="text-xs text-gray-600 truncate">
                          {session.video_file}
                        </span>
                      </div>
                      <video
                        id={`session-video-${idx}`}
                        style={{
                          display: "none",
                          maxWidth: "320px",
                          marginTop: "8px",
                          borderRadius: "8px",
                        }}
                        controls
                        src={`http://localhost:5000/recordings/${session.video_file}`}
                      >
                        Your browser does not support video playback.
                      </video>
                    </div>
                  )}
                </div>

                <div className="ml-4 flex items-center gap-2">
                  <button
                    className="p-3 bg-blue-600 hover:bg-blue-700 rounded-lg transition group-hover:scale-110 duration-200"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectSession(session);
                    }}
                  >
                    <Play className="w-5 h-5" />
                  </button>
                  <ChevronRight className="w-5 h-5 text-gray-500 group-hover:text-blue-400 transition" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
