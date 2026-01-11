/** @format */

import { ChevronRight } from "lucide-react";

interface StatsCardProps {
  title: string;
  value: string | number;
  change: number;
  icon: React.ReactNode;
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
  const colorClasses = {
    primary: "from-primary to-accent",
    success: "from-green-500 to-emerald-500",
    warning: "from-amber-500 to-yellow-500",
    info: "from-blue-500 to-cyan-500",
    danger: "from-red-500 to-pink-500",
  };

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
        <div className="flex items-center justify-between mb-4">
          <div className="w-10 h-10 rounded-lg skeleton"></div>
          <div className="w-20 h-4 skeleton rounded"></div>
        </div>
        <div className="w-32 h-8 skeleton rounded mb-2"></div>
        <div className="w-16 h-4 skeleton rounded"></div>
      </div>
    );
  }

  return (
    <div className="glass-card p-6 hover-lift group cursor-pointer">
      <div className="flex items-center justify-between mb-4">
        <div
          className={`p-3 rounded-xl bg-linear-to-br ${colorClasses[color]} bg-opacity-10 group-hover:bg-opacity-20 transition-all`}
        >
          {icon}
        </div>
        <div
          className={`px-3 py-1 rounded-full text-xs font-medium ${
            change >= 0
              ? "bg-green-500/20 text-green-400"
              : "bg-red-500/20 text-red-400"
          }`}
        >
          {change >= 0 ? "↗" : "↘"} {Math.abs(change)}%
        </div>
      </div>
      <div className="space-y-2">
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
