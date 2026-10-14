/** @format */

import React from "react";

interface StatsCardProps {
  title: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  format?: "currency" | "number" | "pnl";
  /** Extra honesty line under the title (e.g. partial-total warnings, F3). */
  note?: string;
}

export const StatsCard = ({
  title,
  value,
  icon: Icon,
  format,
  note,
}: StatsCardProps) => (
  <div className="glass-card p-6">
    <div className="flex items-center justify-between mb-4">
      <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
        <Icon className="w-5 h-5 text-primary" />
      </div>
    </div>
    <h3
      className={`text-lg font-bold mb-1 ${
        format === "pnl"
          ? value >= 0
            ? "text-success"
            : "text-danger"
          : "text-text"
      }`}
    >
      {format === "currency"
        ? `$${value.toLocaleString()}`
        : format === "pnl"
          ? `${value >= 0 ? "+" : "-"}$${Math.abs(value).toLocaleString()}`
          : value}
    </h3>
    <p className="text-xs text-textMuted">{title}</p>
    {note ? <p className="text-xs text-warning mt-1">{note}</p> : null}
  </div>
);
