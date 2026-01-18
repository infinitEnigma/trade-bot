/** @format */

import React from "react";
import { Loader2 } from "lucide-react";

interface AnalyticsLoadingProps {
  progress: number; // 0-1
  message?: string;
  className?: string;
}

export const AnalyticsLoading: React.FC<AnalyticsLoadingProps> = ({
  progress,
  message = "Loading analytics data...",
  className = "",
}) => {
  const progressPercent = Math.round(progress * 100);

  return (
    <div className={`flex flex-col items-center justify-center py-12 ${className}`}>
      <div className="w-16 h-16 mb-6 bg-surface/50 rounded-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>

      <div className="text-center mb-6">
        <h3 className="text-lg font-semibold text-text mb-2">Analyzing Data</h3>
        <p className="text-textMuted">{message}</p>
      </div>

      {/* Progress Bar */}
      <div className="w-full max-w-md mb-4">
        <div className="w-full bg-surface rounded-full h-2 overflow-hidden">
          <div
            className="h-full bg-linear-to-r from-primary to-accent rounded-full transition-all duration-300 ease-out"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Progress Text */}
      <div className="text-sm text-textMuted">
        {progressPercent}% complete
      </div>

      {/* Loading Steps */}
      <div className="mt-6 space-y-2 text-xs text-textMuted">
        {progress < 0.3 && <div>• Loading historical price data...</div>}
        {progress >= 0.3 && progress < 0.7 && <div>• Calculating performance metrics...</div>}
        {progress >= 0.7 && progress < 1 && <div>• Analyzing risk factors...</div>}
        {progress >= 1 && <div>• Finalizing analytics...</div>}
      </div>
    </div>
  );
};

export default AnalyticsLoading;
