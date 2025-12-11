import React from 'react';
import { AlertTriangle, X } from 'lucide-react';

export default function AlertSystem({ alerts, showAlert, onDismiss }) {
  if (!showAlert || alerts.length === 0) return null;

  const latestAlert = alerts[0];

  return (
    <div className="fixed top-4 right-4 z-50 animate-bounce">
      <div className="bg-red-900 border-2 border-red-500 rounded-lg p-4 shadow-2xl max-w-md">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-6 h-6 text-red-400 flex-shrink-0 animate-pulse" />
          
          <div className="flex-1">
            <h3 className="text-lg font-bold text-red-300 mb-1">
              {latestAlert.message}
            </h3>
            
            {latestAlert.indicators && latestAlert.indicators.length > 0 && (
              <div className="text-sm text-red-200 mb-2">
                Indicators: {latestAlert.indicators.join(', ')}
              </div>
            )}
            
            <div className="text-xs text-red-300">
              Confidence: {(latestAlert.confidence * 100).toFixed(0)}%
            </div>
          </div>
          
          {onDismiss && (
            <button 
              onClick={onDismiss}
              className="text-red-400 hover:text-red-200"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
