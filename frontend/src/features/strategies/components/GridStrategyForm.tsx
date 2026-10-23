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
 *  - Stop-loss: an OPTIONAL aggregate stop (`stopLoss` → engine
 *    `stopLossPercent`, bounds 0.1–50). It is a persisted risk-off state
 *    machine (freeze entries → cancel BUYs → reduce-only exit the grid's
 *    confirmed inventory), not a per-level or trailing stop. Engine
 *    `resolveGridConfig` validates the same bounds; absent = disabled.
 *  - NO type picker: type is GRID, fixed. Trend/Arbitrage are separate
 *    cards in `StrategyTypeChooser`.
 *
 * Body-only: `StrategyForm` owns the overlay shell.
 */

import React, { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { computeGridExposure } from "@trade-bot/shared";
import { tradingApi } from "../../../infrastructure/api";
import { marketApi } from "../../../infrastructure/api/market";
import { accountsApi } from "../../../infrastructure/api/accounts";
import { useAuth } from "../../auth";
import { Strategy, StrategyType } from "../../../shared/types";
import type { GridPreviewInput } from "../../../shared/components/charts/gridPreview";
import { getStrategyConfig } from "../types/strategies.types";
import {
  buildChartSymbolGroups,
  type ChartSymbolGroup,
} from "../utils/chartSymbolPicker";
import {
  extractFreshGridReferencePrice,
  GRID_REFERENCE_PRICE_MAX_AGE_MS,
} from "../utils/gridExposureEstimate";

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
  // Venue pair (migration 026): required, atomic, top-level. Legacy null rows
  // show "unknown venue" and block save until a pair is chosen.
  exchange: z.enum(["kodiak", "lighter"], "Choose the venue exchange"),
  environment: z.enum(["testnet", "mainnet"], "Choose the venue environment"),
  symbol: z.string().min(1, "Trading symbol is required"),
  gridSize: z.number().min(2).max(100).optional(),
  gridRange: z.number().min(1).max(50).optional(),
  orderQuantity: z.number().positive("Order size must be positive").optional(),
  takeProfit: z.number().positive().optional(),
  // Aggregate stop-loss (v1, Model A) — bounds mirror the engine resolver
  // (0.1–50%). Empty ⇒ disabled (INACTIVE).
  stopLoss: z.number().min(0.1).max(50).optional(),
});

type GridStrategyFormData = z.infer<typeof gridStrategySchema>;

/** Venue-tagged symbol option (encoded `exchange|environment|symbol` value). */
interface VenueSymbolOption {
  value: string;
  label: string;
  exchange: "kodiak" | "lighter";
  environment: "testnet" | "mainnet";
  symbol: string;
}

const encodeVenueOption = (o: {
  exchange: string;
  environment: string;
  symbol: string;
}): string => `${o.exchange}|${o.environment}|${o.symbol}`;

const decodeVenueOption = (value: string): VenueSymbolOption | null => {
  const [exchange, environment, ...rest] = value.split("|");
  const symbol = rest.join("|");
  if (!symbol) return null;
  if (exchange !== "kodiak" && exchange !== "lighter") return null;
  if (environment !== "testnet" && environment !== "mainnet") return null;
  return {
    value,
    label: symbol.replace("PERP_", "").replace("_USDC", ""),
    exchange,
    environment,
    symbol,
  };
};

const flattenGroups = (groups: ChartSymbolGroup[]): VenueSymbolOption[] => {
  const options: VenueSymbolOption[] = [];
  for (const group of groups) {
    for (const symbol of group.symbols) {
      options.push({
        value: encodeVenueOption({
          exchange: group.exchange,
          environment: group.environment,
          symbol,
        }),
        label: symbol.replace("PERP_", "").replace("_USDC", ""),
        exchange: group.exchange,
        environment: group.environment,
        symbol,
      });
    }
  }
  return options;
};

interface GridStrategyFormProps {
  /** Present ⇒ edit mode (always a GRID strategy — enforced by `StrategyForm`). */
  strategy?: Strategy;
  onClose: () => void;
  /** `created` carries the freshly created strategy (create flow only). */
  onSuccess: (created?: Strategy | null) => void;
  /**
   * F5: publishes the grid being configured, live as the operator types, so
   * the chart panel can draw it beside the form. Called on every change of
   * the three geometry fields — the parent's setter is identity-stable and
   * compares values, so this cannot cause a render loop.
   */
  onPreviewChange?: (preview: GridPreviewInput | null) => void;
}

export const GridStrategyForm: React.FC<GridStrategyFormProps> = ({
  strategy,
  onClose,
  onSuccess,
  onPreviewChange,
}) => {
  const { user } = useAuth();
  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors },
  } = useForm<GridStrategyFormData>({
    resolver: zodResolver(gridStrategySchema),
    defaultValues: strategy
      ? (() => {
          const strategyConfig = getStrategyConfig(strategy);
          if (!strategyConfig || strategyConfig.type !== StrategyType.GRID) {
            return { name: strategy.name } as GridStrategyFormData;
          }
          const config = strategyConfig.config;
          const venueStrategy = strategy as Strategy & {
            exchange?: "kodiak" | "lighter" | null;
            environment?: "testnet" | "mainnet" | null;
          };
          return {
            name: strategy.name,
            exchange: venueStrategy.exchange ?? undefined,
            environment: venueStrategy.environment ?? undefined,
            symbol: config.symbol,
            gridSize: config.gridSize,
            gridRange: config.gridRange,
            orderQuantity: config.orderQuantity,
            takeProfit: config.takeProfit,
            stopLoss: config.stopLoss,
          } as GridStrategyFormData;
        })()
      : ({
          name: "",
          exchange: undefined,
          environment: undefined,
          symbol: "",
          gridSize: 10,
          gridRange: 5,
          orderQuantity: 1,
        } as unknown as GridStrategyFormData),
  });

  // 026: options come from the live venue catalogs over ACTIVE accounts
  // (same source + grouping as the chart dropdown), never hardcoded.
  const accountsQuery = useQuery({
    queryKey: ["exchange-accounts", user?.id],
    queryFn: () => accountsApi.listAccounts(),
    enabled: !!user,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });
  const activeVenues = useMemo(() => {
    const venues: Array<{
      exchange: "kodiak" | "lighter";
      environment: "testnet" | "mainnet";
    }> = [];
    const seen = new Set<string>();
    for (const account of accountsQuery.data?.data?.accounts ?? []) {
      if (account.status !== "ACTIVE") continue;
      const key = `${account.exchange}:${account.environment}`;
      if (seen.has(key)) continue;
      seen.add(key);
      venues.push({
        exchange: account.exchange,
        environment: account.environment,
      });
    }
    return venues;
  }, [accountsQuery.data]);
  const catalogsQuery = useQuery({
    queryKey: [
      "form-venue-catalogs",
      activeVenues.map(v => `${v.exchange}:${v.environment}`),
    ],
    queryFn: async () =>
      Promise.all(
        activeVenues.map(async venue => {
          try {
            const res = await marketApi.getVenueSymbols(venue);
            return {
              ...venue,
              available: res?.data?.available === true,
              symbols: Array.isArray(res?.data?.symbols)
                ? (res.data.symbols as string[])
                : [],
            };
          } catch {
            return { ...venue, available: false, symbols: [] as string[] };
          }
        })
      ),
    enabled: activeVenues.length > 0,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const venueGroups = useMemo(
    () => buildChartSymbolGroups(catalogsQuery.data ?? [], []),
    [catalogsQuery.data]
  );
  const venueOptions = useMemo(() => flattenGroups(venueGroups), [venueGroups]);
  const [selectedOption, setSelectedOption] = useState<string>("");
  const selectedVenue = useMemo(
    () => (selectedOption ? decodeVenueOption(selectedOption) : null),
    [selectedOption]
  );

  // The generic ticker endpoint is Kodiak-only. Use venue-aware history so
  // Lighter estimates cannot accidentally use a Kodiak reference price.
  const exposurePriceQuery = useQuery({
    queryKey: [
      "grid-exposure-reference-price",
      selectedVenue?.exchange ?? null,
      selectedVenue?.environment ?? null,
      selectedVenue?.symbol ?? null,
    ],
    enabled: selectedVenue !== null,
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    retry: 1,
    queryFn: async () => {
      if (!selectedVenue) throw new Error("Choose a venue and symbol first");
      const to = Math.floor(Date.now() / 1000);
      const response = await marketApi.getTvHistory({
        symbol: selectedVenue.symbol,
        resolution: "1",
        from: to - 10 * 60,
        to,
        exchange: selectedVenue.exchange,
        environment: selectedVenue.environment,
      });
      const reference = extractFreshGridReferencePrice(response);
      if (!reference) {
        throw new Error("A fresh venue reference price is unavailable");
      }
      return reference;
    },
  });

  // Default the venue+symbol from the strategy (edit) or the first catalog
  // option (create) once catalogs resolve.
  // eslint disable-next-line react-hooks/set-state-in-effect -- setting the
  // initial venue selection once on mount is the intended default-fill behaviour.
  useLayoutEffect(() => {
    if (selectedOption || venueOptions.length === 0) return;
    if (!strategy) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedOption(venueOptions[0].value);
      return;
    }
    const venueStrategy = strategy as Strategy & {
      exchange?: "kodiak" | "lighter" | null;
      environment?: "testnet" | "mainnet" | null;
    };
    const cfg = getStrategyConfig(strategy);
    const sym = cfg?.type === StrategyType.GRID ? cfg.config.symbol : "";
    if (venueStrategy.exchange && venueStrategy.environment && sym) {
      const match = encodeVenueOption({
        exchange: venueStrategy.exchange,
        environment: venueStrategy.environment,
        symbol: sym,
      });
      if (venueOptions.some(o => o.value === match)) {
        setSelectedOption(match);
        return;
      }
    }
  }, [selectedOption, venueOptions, strategy]);

  // Keep the venue pair + symbol fields in sync with the encoded picker.
  useEffect(() => {
    const decoded = selectedOption ? decodeVenueOption(selectedOption) : null;
    // TEMP DEBUG
    // eslint disable-next-line no-console
    //console.error("SYNC EFFECT:", selectedOption, JSON.stringify(decoded));
    if (!decoded) return;
    setValue("exchange", decoded.exchange, { shouldValidate: true });
    setValue("environment", decoded.environment, { shouldValidate: true });
    setValue("symbol", decoded.symbol, { shouldValidate: true });
  }, [selectedOption, setValue]);

  // F5: publish the live grid geometry so the chart beside this form can draw
  // the band while the operator types. The venue travels with the preview
  // (026) — the panel withholds the band when it differs from the chart.
  const [previewGridSize, previewGridRange, previewOrderQuantity] = useWatch({
    control,
    name: ["gridSize", "gridRange", "orderQuantity"],
  });

  const hasValidExposureConfig =
    typeof previewGridSize === "number" &&
    Number.isInteger(previewGridSize) &&
    previewGridSize >= 2 &&
    previewGridSize <= 100 &&
    typeof previewGridRange === "number" &&
    Number.isFinite(previewGridRange) &&
    previewGridRange >= 1 &&
    previewGridRange <= 50 &&
    typeof previewOrderQuantity === "number" &&
    Number.isFinite(previewOrderQuantity) &&
    previewOrderQuantity > 0;

  const exposureEstimate = useMemo(() => {
    const reference = exposurePriceQuery.data;
    if (
      !reference ||
      exposurePriceQuery.isError ||
      !hasValidExposureConfig
    ) {
      return null;
    }

    const ageMs = Date.now() - reference.timestampMs;
    if (
      ageMs > GRID_REFERENCE_PRICE_MAX_AGE_MS ||
      ageMs < -60_000 ||
      !Number.isFinite(reference.price) ||
      reference.price <= 0
    ) {
      return null;
    }

    try {
      return computeGridExposure(reference.price, reference.price, {
        gridSize: previewGridSize,
        gridRangePercent: previewGridRange,
        orderQuantity: previewOrderQuantity,
      });
    } catch {
      return null;
    }
  }, [
    exposurePriceQuery.data,
    exposurePriceQuery.isError,
    hasValidExposureConfig,
    previewGridSize,
    previewGridRange,
    previewOrderQuantity,
  ]);
  useEffect(() => {
    const decoded = selectedOption ? decodeVenueOption(selectedOption) : null;
    if (!decoded) {
      onPreviewChange?.(null);
      return;
    }
    onPreviewChange?.({
      symbol: decoded.symbol,
      exchange: decoded.exchange,
      environment: decoded.environment,
      gridSize:
        typeof previewGridSize === "number" ? previewGridSize : undefined,
      gridRange:
        typeof previewGridRange === "number" ? previewGridRange : undefined,
    });
  }, [selectedOption, previewGridSize, previewGridRange, onPreviewChange]);

  const buildConfig = (data: GridStrategyFormData): Record<string, unknown> => {
    // Geometry only — the venue travels top-level, never inside config.
    const config: Record<string, unknown> = {
      symbol: data.symbol,
      gridSize: data.gridSize,
      gridRange: data.gridRange,
      orderQuantity: data.orderQuantity,
    };
    if (data.takeProfit) config.takeProfit = data.takeProfit;
    if (data.stopLoss) config.stopLoss = data.stopLoss;
    return config;
  };

  const createMutation = useMutation({
    mutationFn: (data: GridStrategyFormData) =>
      tradingApi.createStrategy({
        name: data.name,
        type: StrategyType.GRID,
        exchange: data.exchange,
        environment: data.environment,
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
        exchange: data.exchange,
        environment: data.environment,
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

  // 026: legacy-null venue → block edit until a pair is chosen. The form shows
  // "venue unknown — choose venue" and disables submit until a venue+symbol is
  // picked (the zod exchange/environment enums already block save).
  const hasStrategyVenue =
    strategy !== undefined &&
    (
      strategy as Strategy & {
        exchange?: "kodiak" | "lighter" | null;
        environment?: "testnet" | "mainnet" | null;
      }
    ).exchange != null &&
    (
      strategy as Strategy & {
        exchange?: "kodiak" | "lighter" | null;
        environment?: "testnet" | "mainnet" | null;
      }
    ).environment != null;

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
            value={selectedOption}
            onChange={event => setSelectedOption(event.target.value)}
            className="input w-full"
          >
            {venueOptions.length === 0 && (
              <option value="">Loading venue symbols…</option>
            )}
            {venueGroups.map(group => (
              <optgroup key={group.label} label={group.label}>
                {group.symbols.map(symbol => {
                  const value = encodeVenueOption({
                    exchange: group.exchange,
                    environment: group.environment,
                    symbol,
                  });
                  return (
                    <option key={value} value={value}>
                      {symbol.replace("PERP_", "").replace("_USDC", "")}
                    </option>
                  );
                })}
              </optgroup>
            ))}
          </select>
          <p className="text-xs text-text-tertiary mt-1">
            Venue + symbol are stored together — the strategy can only start or
            attach on an account of that venue.
          </p>
          {errors.symbol && (
            <p className="text-danger text-sm mt-1">{errors.symbol.message}</p>
          )}
          {(errors.exchange || errors.environment) && (
            <p className="text-danger text-sm mt-1">
              {errors.exchange?.message ?? errors.environment?.message}
            </p>
          )}
          {!hasStrategyVenue && strategy !== undefined && (
            <p className="text-xs text-warning mt-1">
              Venue unknown — choose venue.
            </p>
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

      {/* Advisory only: backend admission independently validates price and exposure. */}
      <section
        aria-label="Grid exposure estimate"
        className="rounded-lg border border-border-light p-4 space-y-3"
      >
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-medium text-text-primary">
            Estimated grid exposure
          </h3>
          <span className="text-xs text-text-tertiary">Estimate only</span>
        </div>
        <p className="text-xs text-text-tertiary">
          Uses the selected venue's latest one-minute candle and the shared
          grid calculator before venue-specific tick quantization. Actual orders
          and live exposure can differ.
        </p>

        {!selectedVenue ? (
          <p className="text-sm text-text-secondary">
            Choose a venue and symbol to estimate exposure.
          </p>
        ) : !hasValidExposureConfig ? (
          <p className="text-sm text-text-secondary">
            Enter a valid grid size, range, and positive order size to calculate
            an estimate.
          </p>
        ) : exposurePriceQuery.isPending ||
          (exposurePriceQuery.isFetching && !exposurePriceQuery.data) ? (
          <p className="text-sm text-text-secondary">
            Loading fresh market data for {selectedVenue.exchange}{" "}
            {selectedVenue.environment}…
          </p>
        ) : !exposureEstimate ? (
          <p role="status" className="text-sm text-warning">
            Exposure estimate unavailable: a fresh, valid reference price could
            not be verified. This is not approval to start trading.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-md bg-surface-secondary p-3">
                <p className="text-xs text-text-tertiary">
                  Reference price
                </p>
                <p className="font-semibold text-text-primary">
                  {formatUsd(exposurePriceQuery.data!.price, 8)}
                </p>
                <p className="text-xs text-text-tertiary">
                  Candle{" "}
                  {new Date(
                    exposurePriceQuery.data!.timestampMs
                  ).toLocaleTimeString()}
                </p>
              </div>
              <div className="rounded-md bg-surface-secondary p-3">
                <p className="text-xs text-text-tertiary">
                  Estimated resting buy notional
                </p>
                <p className="font-semibold text-text-primary">
                  {formatUsd(exposureEstimate.estimatedRestingNotional)}
                </p>
                <p className="text-xs text-text-tertiary">
                  {exposureEstimate.buyLevels.length} eligible buy levels
                </p>
              </div>
              <div className="rounded-md bg-surface-secondary p-3">
                <p className="text-xs text-text-tertiary">
                  Largest eligible buy order
                </p>
                <p className="font-semibold text-text-primary">
                  {formatUsd(exposureEstimate.maxOrderNotional)}
                </p>
              </div>
            </div>

            <details className="text-sm">
              <summary className="cursor-pointer text-text-secondary">
                Per-level notional ({exposureEstimate.levels.length} grid
                levels; eligible buy levels are included in the total)
              </summary>
              <div className="mt-2 max-h-48 overflow-y-auto rounded-md border border-border-light">
                <div className="grid grid-cols-[0.6fr_1fr_1fr_1fr] gap-2 px-3 py-2 text-xs font-medium text-text-tertiary">
                  <span>Level</span>
                  <span className="text-right">Price</span>
                  <span className="text-right">Per-order notional</span>
                  <span className="text-right">Status</span>
                </div>
                {exposureEstimate.levels.map(level => (
                  <div
                    key={level.index}
                    className="grid grid-cols-[0.6fr_1fr_1fr_1fr] gap-2 border-t border-border-light px-3 py-2 text-xs"
                  >
                    <span className="text-text-secondary">
                      {level.index + 1}
                    </span>
                    <span className="text-right text-text-primary">
                      {formatUsd(level.price, 8)}
                    </span>
                    <span className="text-right text-text-primary">
                      {formatUsd(level.orderNotional)}
                    </span>
                    <span className="text-right text-text-secondary">
                      {level.buyEligible ? "Eligible buy" : "Not eligible"}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          </>
        )}

        <p className="text-xs text-text-tertiary">
          Guidance only — backend admission revalidates venue price and grid
          exposure before authorization. Missing or stale data is never treated
          as zero exposure.
        </p>
      </section>

      {/* Exit */}
      <div className="space-y-4">
        <h3 className="text-lg font-medium text-text-primary">Exit</h3>
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

          <div>
            <label
              htmlFor="grid-strategy-stop-loss"
              className="block text-sm font-medium text-text-secondary mb-2"
            >
              Stop Loss (%)
            </label>
            <input
              id="grid-strategy-stop-loss"
              {...register("stopLoss", { setValueAs: emptyToNumber })}
              type="number"
              min="0.1"
              max="50"
              step="0.1"
              className="input w-full"
              placeholder="Leave empty to disable"
            />
            <p className="text-xs text-text-tertiary mt-1">
              Aggregate risk-off: if price falls this far below your average
              entry (or the build price while flat), the grid stops buying,
              cancels open buys, and sells its confirmed inventory to flat. Not
              a per-level or trailing stop.
            </p>
            {errors.stopLoss && (
              <p className="text-danger text-sm mt-1">
                {errors.stopLoss.message}
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
          disabled={isLoading || (!hasStrategyVenue && strategy !== undefined)}
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


/** Format USD estimates without implying precision beyond the source data. */
function formatUsd(value: number, maximumFractionDigits = 2): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits,
  }).format(value);
}
