/** @format */

import React from "react";

interface SectionHeaderProps {
  title: string | React.ReactNode;
  subtitle?: string;
  actions?: React.ReactNode;
}

export const SectionHeader: React.FC<SectionHeaderProps> = ({
  title,
  subtitle,
  actions,
}) => (
  <div className="flex items-start justify-between mb-6">
    <div>
      <h2 className="text-xl font-semibold text-text-primary">{title}</h2>
      {subtitle && (
        <p className="text-sm text-text-tertiary mt-1">{subtitle}</p>
      )}
    </div>
    {actions && <div className="flex gap-2">{actions}</div>}
  </div>
);
