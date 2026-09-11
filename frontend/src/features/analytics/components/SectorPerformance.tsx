/** @format */

import React from "react";
import { DollarSign } from "lucide-react";
import { Card } from "../../../shared/components/ui";
import { SectorPerformance as SectorPerformanceType } from "../types/analytics.types";

interface SectorPerformanceProps {
  sectorPerformance: SectorPerformanceType[];
}

/**
 * SectorPerformance component - displays sector breakdown and contributions
 */
export const SectorPerformance: React.FC<SectorPerformanceProps> = ({
  sectorPerformance
}) => {
  return (
    <Card className="p-6">
      <div className="space-y-4">
        {sectorPerformance.map((sector) => (
          <div key={sector.sector} className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <DollarSign className="w-4 h-4 text-primary" />
              </div>
              <div>
                <h4 className="font-medium text-text">{sector.sector}</h4>
                <p className="text-xs text-textMuted">{sector.contribution}% of portfolio</p>
              </div>
            </div>
            <div className="text-right">
              <span className={`font-medium ${sector.performance >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {sector.performance >= 0 ? '+' : ''}{sector.performance}%
              </span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
};
