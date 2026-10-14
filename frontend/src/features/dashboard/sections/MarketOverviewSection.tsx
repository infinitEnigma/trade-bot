/** @format */

import React, { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { Card } from "../../../shared/components/ui/Card";

const PriceChart = React.lazy(
  () => import("../../../shared/components/charts/PriceChart")
);

/**
 * Market overview — the consistent core across every tier. The public market
 * chart (symbol + timeframe selection, price + 24h change, source chip and
 * error state all live inside PriceChart). No auth-dependent props: the data
 * layer already serves BASIC users from the public ticker path.
 */
export const MarketOverviewSection: React.FC = () => (
  <div className="mb-8 contain-layout">
    <Suspense
      fallback={
        <Card className="h-96 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </Card>
      }
    >
      <PriceChart />
    </Suspense>
  </div>
);
