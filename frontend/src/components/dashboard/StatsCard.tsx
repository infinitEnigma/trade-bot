/** @format */

import { ChevronRight, LucideIcon } from "lucide-react";
import { MetricIcon } from "../ui/MetricIcon";

interface StatsCardProps {
  title: string;
  value: string | number;
  change: number;
  icon: LucideIcon;
  color: "primary" | "success" | "warning" | "info" | "danger";
  format?: "currency" | "percentage" | "number";
  loading?: boolean;
}

const StatsCard: React.FC<StatsCardProps> = ({
  title,
  value,
  change,
  icon,
  color,
  format = "number",
  loading = false,
}) => {
  const formatValue = (val: string | number) => {
    if (format === "currency") {
      return `$${Number(val).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
    }
    if (format === "percentage") {
      return `${Number(val) > 0 ? "+" : ""}${Number(val).toFixed(2)}%`;
    }
    return val.toLocaleString();
  };

  if (loading) {
    return (
      <div className="glass-card p-6 hover-lift animate-pulse">
        <div className="grid grid-rows-[auto_1fr_auto] gap-3">
          <div className="flex items-center justify-between">
            <div className="w-10 h-10 bg-white/10 rounded-lg"></div>
            <div className="w-20 h-4 bg-white/10 rounded"></div>
          </div>
          <div className="w-32 h-8 bg-white/10 rounded"></div>
          <div className="w-16 h-4 bg-white/10 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="glass-card p-6 hover-lift group cursor-pointer">
      <div className="grid grid-rows-[auto_1fr_auto] gap-3">
        <div className="flex items-center justify-between">
          <MetricIcon icon={icon} color={color} />
          <div
            className={`px-2 py-1 rounded-full text-xs font-medium ${
              change >= 0
                ? "bg-green-500/20 text-green-400"
                : "bg-red-500/20 text-red-400"
            }`}
          >
            {change >= 0 ? "↗" : "↘"} {Math.abs(change)}%
          </div>
        </div>
        <p className="text-2xl font-bold text-text-primary group-hover:scale-105 transition-transform">
          {formatValue(value)}
        </p>
        <div className="flex items-center justify-between">
          <p className="text-sm text-text-tertiary">{title}</p>
          <ChevronRight className="w-4 h-4 text-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </div>
    </div>
  );
};

export default StatsCard;
