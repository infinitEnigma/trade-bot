/** @format */

import React from "react";
import { LucideIcon } from "lucide-react";

interface MetricIconProps {
  icon: LucideIcon;
  color?: "primary" | "success" | "warning" | "info" | "danger";
  size?: "sm" | "md" | "lg";
}

export const MetricIcon: React.FC<MetricIconProps> = ({
  icon: Icon,
  color = "primary",
  size = "md",
}) => {
  const sizeClasses = {
    sm: "w-8 h-8",
    md: "w-10 h-10",
    lg: "w-12 h-12",
  };

  const iconSizeClasses = {
    sm: "w-4 h-4",
    md: "w-5 h-5",
    lg: "w-6 h-6",
  };

  return (
    <div
      className={`${sizeClasses[size]} rounded-lg bg-${color}/10 flex items-center justify-center`}
    >
      <Icon className={`${iconSizeClasses[size]} text-${color}`} />
    </div>
  );
};
