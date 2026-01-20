/** @format */

import React from "react";
import { AnalyticsTimeWindow } from "../../../features/analytics";

interface TimeWindowSelectorProps {
  timeWindows: AnalyticsTimeWindow[];
  selectedWindow: AnalyticsTimeWindow;
  onWindowChange: (window: AnalyticsTimeWindow) => void;
  className?: string;
  disabled?: boolean;
}

export const TimeWindowSelector: React.FC<TimeWindowSelectorProps> = ({
  timeWindows,
  selectedWindow,
  onWindowChange,
  className = "",
  disabled = false,
}) => {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <span className="text-sm text-textMuted font-medium">Time Range:</span>
      <div className="flex gap-1">
        {timeWindows.map((window) => (
          <button
            key={window.value}
            onClick={() => onWindowChange(window)}
            disabled={disabled}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all duration-200 ${
              selectedWindow.value === window.value
                ? "bg-primary text-white shadow-lg shadow-primary/25"
                : "bg-surface hover:bg-surface/80 text-textMuted hover:text-text border border-white/10"
            } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            {window.label}
          </button>
        ))}
      </div>
    </div>
  );
};

export default TimeWindowSelector;
