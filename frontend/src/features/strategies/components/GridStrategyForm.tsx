/** @format */

/**
 * GridStrategyForm — the ONLY live create/edit form (engine reality: one
 * strategy, `GridTradingStrategy`, config resolved by `resolveGridConfig`).
 *
 * Field policy (product decision 2026-10-12):
 *  - Contains ONLY fields the grid engine consumes: symbol, gridSize,
 *    gridRange, orderQuantity, takeProfit (verified end-to-end:
 *    `engine/src/strategies/grid-config.ts` validates the same bounds this
 *    form's zod schema enforces, and `grid.ts` reads `takeProfitPercent`).
 *  - NO leverage: Lighter has no per-order leverage (margin is an
 *    account/market initial-margin-fraction setting), and our admission cap
 *    uses the platform's `SESSION_CAP_LEVERAGE` policy — a per-strategy
 *    field could never do anything. Position size is the Notional size
 *    picker at start.
 *  - NO stop-loss: grid doesn't implement one; it belongs to the future
 *    Trend Following form (with entry/exit thresholds), not here.
 *  - NO type picker: type is GRID, fixed. Trend/Arbitrage are separate
 *    cards in `StrategyTypeChooser`.
 *
 * Body-only: `StrategyForm` owns the overlay shell.
 */

import React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { tradingApi } from "../../../infrastructure/api";
import { Strategy, StrategyType } from "../../../shared/types";
import { getStrategyConfig } from "../types/strategies.types";

// RHF `valueAsNumber` yields NaN for a left-empty number input; zod must see
// undefined (absent optional), never NaN ("expected number, received NaN" —
// which made every create with an empty Take Profit fail validation).
// `setValueAs` is the typing-safe place for this (a z.preprocess on the
// schema would widen its INPUT type to unknown and break zodResolver's
// generics against useForm<GridStrategyFormData>).
const emptyToNumber = (value: unknown): number | undefined => {
  if (value === "" || value === null || value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? undefined : parsed;
};

const gridStrategySchema = z.object({
  name: z.string().min(1, "Strategy name is required").max(100),
  symbol: z.string().min(1, "Trading symbol is required"),
  gridSize: z.number().min(2).max(100).optional(),
  gridRange: z.number().min(1).max(50).optional(),
  orderQuantity: z.number().positive("Order size must be positive").optional(),
  takeProfit: z.number().positive().optional(),
});

type GridStrategyFormData = z.infer<typeof gridStrategySchema>;

// Symbols grouped by the venue that lists them. The two venues use different
// symbol conventions — Kodiak/Orderly perps are `PERP_<X>_USDC`; Lighter lists
// bare perp markets (`ETH`) and slash-quoted spot markets (`ETH/USDC`).
// Strategy creation stays venue-agnostic (the account is only bound at
// start), but the picker must not let a user silently pick a symbol that
// only exists on the *other* venue (L20). `kind` labels each option
// truthfully against the venue's own `market_type` (live orderBooks,
// testnet 2026-10-12: BTC/SOL/ETH = perp; ETH/USDC, LIT/USDC = spot) —
// a spot market is a different animal for a grid bot and must not hide in
// the group. The start gate (`assertSymbolSupported`) remains the
// authoritative backstop.
const SYMBOL_GROUPS: {
  venue: string;
  symbols: Array<{ value: string; kind: "perp" | "spot" }>;
}[] = [
  {
    venue: "Kodiak / Orderly",
    symbols: [
      { value: "PERP_BTC_USDC", kind: "perp" },
      { value: "PERP_ETH_USDC", kind: "perp" },
      { value: "PERP_SOL_USDC", kind: "perp" },
      { value: "PERP_AVAX_USDC", kind: "perp" },
      { value: "PERP_MATIC_USDC", kind: "perp" },
      { value: "PERP_LINK_USDC", kind: "perp" },
    ],
  },
  {
    venue: "Lighter",
    symbols: [
      { value: "BTC", kind: "perp" },
      { value: "SOL", kind: "perp" },
      { value: "ETH", kind: "perp" },
      { value: "ETH/USDC", kind: "spot" },
      { value: "LIT/USDC", kind: "spot" },
    ],
  },
];

const optionLabel = (value: string, kind: "perp" | "spot"): string =>
  `${value.replace("PERP_", "").replace("_USDC", "")} · ${kind}`;

interface GridStrategyFormProps {
  /** Present ⇒ edit mode (always a GRID strategy — enforced by `StrategyForm`). */
  strategy?: Strategy;
  onClose: () => void;
  /** `created` carries the freshly created strategy (create flow only). */
  onSuccess: (created?: Strategy | null) => void;
}

export const GridStrategyForm: React.FC<GridStrategyFormProps> = ({
  strategy,
  onClose,
  onSuccess,
}) => {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<GridStrategyFormData>({
    resolver: zodResolver(gridStrategySchema),
    defaultValues: strategy
      ? (() => {
          const strategyConfig = getStrategyConfig(strategy);
          if (!strategyConfig || strategyConfig.type !== StrategyType.GRID) {
            // Defensive: orchestrator only routes GRID rows here; an odd row
            // still opens with safe blanks rather than another type's fields.
            return { name: strategy.name };
          }
          const config = strategyConfig.config;
          return {
            name: strategy.name,
            symbol: config.symbol,
            gridSize: config.gridSize,
            gridRange: config.gridRange,
            orderQuantity: config.orderQuantity,
            takeProfit: config.takeProfit,
          };
        })()
      : {
          gridSize: 10,
          gridRange: 5,
          orderQuantity: 1,
        },
  });

  const buildConfig = (data: GridStrategyFormData): Record<string, unknown> => {
    const config: Record<string, unknown> = {
      symbol: data.symbol,
      gridSize: data.gridSize,
      gridRange: data.gridRange,
      orderQuantity: data.orderQuantity,
    };
    if (data.takeProfit) config.takeProfit = data.takeProfit;
    return config;
  };

  const createMutation = useMutation({
    mutationFn: (data: GridStrategyFormData) =>
      tradingApi.createStrategy({
        name: data.name,
        type: StrategyType.GRID,
        config: buildConfig(data),
      }),
    onSuccess: response => {
      onSuccess(response?.data);
    },
    onError: (error: unknown) => {
      toast.error(readErrorMessage(error, "Failed to create strategy"));
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: GridStrategyFormData) =>
      tradingApi.updateStrategy(strategy!.id, {
        name: data.name,
        type: StrategyType.GRID,
        config: buildConfig(data),
      }),
    onSuccess: () => {
      onSuccess();
    },
    onError: (error: unknown) => {
      toast.error(readErrorMessage(error, "Failed to update strategy"));
    },
  });

  const onSubmit = (data: GridStrategyFormData) => {
    if (strategy) {
      updateMutation.mutate(data);
    } else {
      createMutation.mutate(data);
    }
  };

  const isLoading = createMutation.isPending || updateMutation.isPending;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-6">
      {/* Basic Information */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label
            htmlFor="grid-strategy-name"
            className="block text-sm font-medium text-text-secondary mb-2"
          >
            Strategy Name
          </label>
          <input
            id="grid-strategy-name"
            {...register("name")}
            type="text"
            className="input w-full"
            placeholder="My Grid Strategy"
          />
          {errors.name && (
            <p className="text-danger text-sm mt-1">{errors.name.message}</p>
          )}
        </div>

        <div>
          <label
            htmlFor="grid-strategy-symbol"
            className="block text-sm font-medium text-text-secondary mb-2"
          >
            Trading Symbol
          </label>
          <select
            id="grid-strategy-symbol"
            {...register("symbol")}
            className="input w-full"
          >
            {SYMBOL_GROUPS.map(group => (
              <optgroup key={group.venue} label={group.venue}>
                {group.symbols.map(({ value, kind }) => (
                  <option key={value} value={value}>
                    {optionLabel(value, kind)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <p className="text-xs text-text-tertiary mt-1">
            Pick the symbol from the venue your exchange account uses — the
            strategy can only start on an account that lists it. · perp =
            perpetual future, · spot = spot market.
          </p>
          {errors.symbol && (
            <p className="text-danger text-sm mt-1">{errors.symbol.message}</p>
          )}
        </div>
      </div>

      {/* Grid Configuration */}
      <div className="space-y-4">
        <h3 className="text-lg font-medium text-text-primary">
          Grid Configuration
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label
              htmlFor="grid-strategy-grid-size"
              className="block text-sm font-medium text-text-secondary mb-2"
            >
              Grid Size (2-100 levels)
            </label>
            <input
              id="grid-strategy-grid-size"
              {...register("gridSize", { setValueAs: emptyToNumber })}
              type="number"
              min="2"
              max="100"
              className="input w-full"
            />
            {errors.gridSize && (
              <p className="text-danger text-sm mt-1">
                {errors.gridSize.message}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="grid-strategy-grid-range"
              className="block text-sm font-medium text-text-secondary mb-2"
            >
              Grid Range (1-50%)
            </label>
            <input
              id="grid-strategy-grid-range"
              {...register("gridRange", { setValueAs: emptyToNumber })}
              type="number"
              min="1"
              max="50"
              step="0.1"
              className="input w-full"
            />
            {errors.gridRange && (
              <p className="text-danger text-sm mt-1">
                {errors.gridRange.message}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="grid-strategy-order-size"
              className="block text-sm font-medium text-text-secondary mb-2"
            >
              Order Size (base asset units)
            </label>
            <input
              id="grid-strategy-order-size"
              {...register("orderQuantity", { setValueAs: emptyToNumber })}
              type="number"
              min="0.01"
              step="0.01"
              className="input w-full"
            />
            <p className="text-xs text-text-tertiary mt-1">
              Units of the base asset (e.g. ETH), not USD. Venue minimums apply
              per market — Lighter testnet lists ETH ≥ 0.005, BTC ≥ 0.0002, SOL
              ≥ 0.050 (live orderBooks, 2026-10-12); an order below the minimum
              is rejected at placement.
            </p>
            {errors.orderQuantity && (
              <p className="text-danger text-sm mt-1">
                {errors.orderQuantity.message}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Exit */}
      <div className="space-y-4">
        <h3 className="text-lg font-medium text-text-primary">
          Take Profit (Optional)
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="grid-strategy-take-profit"
              className="block text-sm font-medium text-text-secondary mb-2"
            >
              Take Profit (%)
            </label>
            <input
              id="grid-strategy-take-profit"
              {...register("takeProfit", { setValueAs: emptyToNumber })}
              type="number"
              min="0"
              step="0.1"
              className="input w-full"
              placeholder="Leave empty to disable"
            />
            <p className="text-xs text-text-tertiary mt-1">
              Closes the grid above the executed entry. Without it, exits sit
              one grid step above each buy level.
            </p>
            {errors.takeProfit && (
              <p className="text-danger text-sm mt-1">
                {errors.takeProfit.message}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Form Actions */}
      <div className="flex justify-end gap-3 pt-6 border-t border-border-light">
        <button type="button" onClick={onClose} className="btn-secondary">
          Cancel
        </button>
        <button
          type="submit"
          disabled={isLoading}
          className="btn-primary flex items-center gap-2"
        >
          {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
          {strategy ? "Update Strategy" : "Create Strategy"}
        </button>
      </div>
    </form>
  );
};

/** Same error-shape handling the old form had (Error / axios / fallback). */
function readErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "response" in error) {
    const response = (error as { response?: { data?: unknown } }).response;
    const data = response?.data;
    if (
      typeof data === "object" &&
      data !== null &&
      "error" in data &&
      typeof (data as { error: unknown }).error === "string"
    ) {
      return (data as { error: string }).error;
    }
  }
  return fallback;
}
