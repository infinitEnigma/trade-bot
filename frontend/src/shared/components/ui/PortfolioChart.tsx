/** @format */

import React from "react";
import { Card } from "./Card";

interface PortfolioChartProps {
  data?: any;
  selectedSymbol?: string;
  onSymbolChange?: (symbol: string) => void;
}

/**
 * PortfolioChart placeholder component
 * TODO: Implement full portfolio chart functionality
 */
const PortfolioChart: React.FC<PortfolioChartProps> = ({
  data,
  selectedSymbol = "PERP_BTC_USDC",
  onSymbolChange
}) => {
  return (
    <Card className="h-80 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-text">Portfolio Performance</h3>
        <div className="text-sm text-textMuted">
          {selectedSymbol.replace('PERP_', '').replace('_USDC', '')}
        </div>
      </div>

      <div className="h-64 flex items-center justify-center bg-surface/50 rounded-lg border border-white/10">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 bg-primary/20 rounded-full flex items-center justify-center">
            <svg className="w-8 h-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <h4 className="text-lg font-medium text-text mb-2">Portfolio Chart</h4>
          <p className="text-sm text-textMuted">
            Advanced portfolio analytics coming soon
          </p>
        </div>
      </div>
    </Card>
  );
};

export default PortfolioChart;
