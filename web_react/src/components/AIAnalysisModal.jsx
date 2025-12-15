import React from "react";
import {
  X,
  Brain,
  AlertTriangle,
  CheckCircle,
  AlertCircle,
} from "lucide-react";

export default function AIAnalysisModal({ analysis, onClose }) {
  if (!analysis) return null;

  const getSuspicionIcon = () => {
    switch (analysis.suspicion_level) {
      case "HIGH":
        return <AlertTriangle className="w-8 h-8 text-red-500" />;
      case "MEDIUM":
        return <AlertCircle className="w-8 h-8 text-yellow-500" />;
      case "LOW":
        return <CheckCircle className="w-8 h-8 text-green-500" />;
      default:
        return <Brain className="w-8 h-8 text-blue-500" />;
    }
  };

  const getSuspicionColor = () => {
    switch (analysis.suspicion_level) {
      case "HIGH":
        return "from-red-900 to-red-800 border-red-600";
      case "MEDIUM":
        return "from-yellow-900 to-yellow-800 border-yellow-600";
      case "LOW":
        return "from-green-900 to-green-800 border-green-600";
      default:
        return "from-blue-900 to-blue-800 border-blue-600";
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fadeIn">
      {/* Backdrop - semi-transparent */}
      <div
        className="absolute inset-0 bg-black bg-opacity-70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal Content */}
      <div className="relative bg-gray-900 rounded-2xl shadow-2xl border-2 max-w-3xl w-full max-h-[85vh] overflow-hidden animate-slideIn">
        {/* Header with gradient */}
        <div
          className={`bg-gradient-to-r ${getSuspicionColor()} p-6 border-b-2`}
        >
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              {getSuspicionIcon()}
              <div>
                <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                  🤖 AI Analysis Results
                </h2>
                <p className="text-sm text-gray-300 mt-1">
                  Powered by Google Gemini
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-white hover:text-gray-300 transition p-2 hover:bg-white hover:bg-opacity-10 rounded-lg"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          {/* Suspicion Level Badge */}
          <div className="mt-4 flex items-center gap-3">
            <span className="text-sm text-gray-300">Mức độ khả nghi:</span>
            <span
              className={`px-4 py-2 rounded-lg font-bold text-lg ${
                analysis.suspicion_level === "HIGH"
                  ? "bg-red-600 text-white"
                  : analysis.suspicion_level === "MEDIUM"
                  ? "bg-yellow-600 text-white"
                  : analysis.suspicion_level === "LOW"
                  ? "bg-green-600 text-white"
                  : "bg-blue-600 text-white"
              }`}
            >
              {analysis.suspicion_level}
              {analysis.suspicion_score && ` - ${analysis.suspicion_score}%`}
            </span>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="overflow-y-auto max-h-[calc(85vh-180px)] p-6 space-y-4">
          {/* Summary */}
          <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <h3 className="text-lg font-semibold text-white mb-2 flex items-center gap-2">
              📋 Tóm tắt
            </h3>
            <p className="text-gray-300 leading-relaxed">{analysis.summary}</p>
          </div>

          {/* Recommendation */}
          <div className="bg-gradient-to-br from-blue-900 to-blue-800 rounded-lg p-4 border-2 border-blue-600">
            <h3 className="text-lg font-semibold text-white mb-2 flex items-center gap-2">
              💡 Khuyến nghị
            </h3>
            <p className="text-blue-100 font-medium leading-relaxed">
              {analysis.recommendation}
            </p>
          </div>

          {/* Reasoning */}
          <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <h3 className="text-lg font-semibold text-white mb-2 flex items-center gap-2">
              🔍 Lý do phân tích
            </h3>
            <p className="text-gray-300 leading-relaxed whitespace-pre-wrap">
              {analysis.reasoning}
            </p>
          </div>

          {/* Key Indicators */}
          {analysis.key_indicators && analysis.key_indicators.length > 0 && (
            <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
              <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                🎯 Dấu hiệu quan trọng
              </h3>
              <ul className="space-y-3">
                {analysis.key_indicators.map((indicator, idx) => {
                  // Handle both string and object formats
                  if (typeof indicator === "string") {
                    return (
                      <li
                        key={idx}
                        className="flex items-start gap-3 text-gray-300"
                      >
                        <span className="text-blue-400 text-xl flex-shrink-0">•</span>
                        <span className="leading-relaxed">{indicator}</span>
                      </li>
                    );
                  } else if (typeof indicator === "object") {
                    // Try to extract time info
                    let timeInfo = null;
                    if (indicator.time_range) {
                      timeInfo = `⏱️ ${indicator.time_range}`;
                    } else if (indicator.time) {
                      timeInfo = `⏱️ ${indicator.time}`;
                    } else if (indicator.timestamp) {
                      // Convert epoch seconds to mm:ss from session start if possible
                      let t = Number(indicator.timestamp);
                      let base = null;
                      if (analysis.session_start_time) {
                        base = Number(analysis.session_start_time);
                      } else if (analysis.start_time) {
                        base = Number(analysis.start_time);
                      }
                      if (!isNaN(t) && base && !isNaN(base)) {
                        const rel = Math.max(0, t - base);
                        const min = Math.floor(rel / 60);
                        const sec = Math.floor(rel % 60).toString().padStart(2, '0');
                        timeInfo = `⏱️ ${min}:${sec}`;
                      } else if (!isNaN(t) && t < 100000) {
                        // If already relative seconds
                        const min = Math.floor(t / 60);
                        const sec = Math.floor(t % 60).toString().padStart(2, '0');
                        timeInfo = `⏱️ ${min}:${sec}`;
                      } else if (!isNaN(t)) {
                        // Fallback: show raw
                        timeInfo = `⏱️ ${t}`;
                      }
                    }
                    return (
                      <li key={idx} className="flex items-start gap-3">
                        <span className="text-blue-400 text-xl flex-shrink-0">•</span>
                        <div className="leading-relaxed">
                          <div className="text-white font-semibold flex items-center gap-2">
                            {indicator.indicator || "Dấu hiệu"}
                            {timeInfo && (
                              <span className="text-xs text-yellow-300 font-normal">{timeInfo}</span>
                            )}
                          </div>
                          <div className="text-gray-400 text-sm mt-1">
                            {indicator.interpretation || ""}
                          </div>
                          {indicator.anomaly_note && (
                            <div className="text-yellow-400 text-sm mt-1">
                              ⚠️ {indicator.anomaly_note}
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  }
                  return null;
                })}
              </ul>
            </div>
          )}

          {/* Suggested Questions */}
          {analysis.suggested_questions &&
            analysis.suggested_questions.length > 0 && (
              <div className="bg-gradient-to-br from-purple-900 to-purple-800 rounded-lg p-4 border-2 border-purple-600">
                <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                  ❓ Câu hỏi đề xuất cho vòng tiếp theo
                </h3>
                <ul className="space-y-2">
                  {analysis.suggested_questions.map((question, idx) => {
                    // Handle both string and object formats
                    const questionText =
                      typeof question === "string"
                        ? question
                        : question.question ||
                          question.text ||
                          JSON.stringify(question);

                    return (
                      <li
                        key={idx}
                        className="flex items-start gap-3 text-purple-100"
                      >
                        <span className="text-yellow-400 text-xl flex-shrink-0">
                          {idx + 1}.
                        </span>
                        <span className="leading-relaxed">{questionText}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

          {/* Error message if any */}
          {analysis.error && (
            <div className="bg-red-900 bg-opacity-30 border border-red-600 rounded-lg p-4">
              <h3 className="text-lg font-semibold text-red-400 mb-2">
                ⚠️ Lỗi phân tích
              </h3>
              <p className="text-red-300 text-sm">{analysis.error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-700 p-4 bg-gray-850">
          <button
            onClick={onClose}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg transition transform hover:scale-105"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
