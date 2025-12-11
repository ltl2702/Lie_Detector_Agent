import React from 'react';

export default function TruthMeter({ position, tellCount }) {
  return (
    <div className="bg-gray-900 bg-opacity-80 rounded-lg p-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-semibold text-gray-300">TRUTH METER</span>
        <span className="text-[10px] text-gray-400">{tellCount} indicators</span>
      </div>
      
      {/* Meter Bar */}
      <div className="relative h-6 bg-gradient-to-r from-green-600 via-yellow-500 to-red-600 rounded overflow-hidden">
        {/* Labels */}
        <div className="absolute inset-0 flex items-center justify-between px-2 text-[9px] font-bold text-white">
          <span className="drop-shadow-lg">TRUTH</span>
          <span className="drop-shadow-lg">LIE</span>
        </div>
        
        {/* Indicator */}
        <div 
          className="absolute top-0 bottom-0 w-2 bg-white border border-gray-900 shadow-lg transition-all duration-500 ease-out"
          style={{ left: `${position}%`, transform: 'translateX(-50%)' }}
        >
          {/* Arrow pointer top */}
          <div className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-0 h-0 border-l-2 border-r-2 border-b-2 border-l-transparent border-r-transparent border-b-white"></div>
          {/* Arrow pointer bottom */}
          <div className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-0 h-0 border-l-2 border-r-2 border-t-2 border-l-transparent border-r-transparent border-t-white"></div>
        </div>
      </div>
      
      {/* Status Text */}
      <div className="mt-1 text-center">
        <span className={`text-[10px] font-bold ${
          position < 40 ? 'text-green-400' : 
          position < 70 ? 'text-yellow-400' : 'text-red-400'
        }`}>
          {position < 40 ? 'Likely Truth' : 
           position < 70 ? 'Uncertain' : 'Likely Deception'}
        </span>
      </div>
    </div>
  );
}
