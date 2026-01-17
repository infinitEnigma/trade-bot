/** @format */

import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "../lib/api";
import { Strategy, StrategyType } from "@trade-bot/shared";
import { X, Loader2 } from "lucide-react";

// Form validation schema
const strategySchema = z.object({
  name: z.string().min(1, "Strategy name is required").max(100),
  type: z.enum([
    StrategyType.GRID,
    StrategyType.TREND_FOLLOWING,
    StrategyType.ARBITRAGE,
  ]),
  symbol: z.string().min(1, "Trading symbol is required"),
  leverage: z.number().min(1).max(20).optional(),
  gridSize: z.number().min(2).max(100).optional(),
  gridRange: z.number().min(1).max(50).optional(),
  orderQuantity: z
    .number()
    .positive("Order quantity must be positive")
    .optional(),
  takeProfit: z.number().positive().optional(),
  entryThreshold: z.number().optional(),
  exitThreshold: z.number().optional(),
  stopLoss: z.number().positive().optional(),
});

type StrategyFormData = z.infer<typeof strategySchema>;

interface StrategyFormProps {
  strategy?: Strategy;
  onClose: () => void;
  onSuccess: () => void;
}

const AVAILABLE_SYMBOLS = [
  "PERP_BTC_USDC",
  "PERP_ETH_USDC",
  "PERP_SOL_USDC",
  "PERP_AVAX_USDC",
  "PERP_MATIC_USDC",
  "PERP_LINK_USDC",
];

export const StrategyForm: React.FC<StrategyFormProps> = ({
  strategy,
  onClose,
  onSuccess,
}) => {
  const [selectedType, setSelectedType] = useState<StrategyType>(
    strategy?.type || StrategyType.GRID
  );

  const {
    register,
    handleSubmit,
    formState: { errors },
    setValue,
    reset,
  } = useForm<StrategyFormData>({
    resolver: zodResolver(strategySchema),
    defaultValues: strategy
      ? {
          name: strategy.name,
          type: strategy.type,
          symbol: (strategy.config as any)?.symbol || "",
          leverage: (strategy.config as any)?.leverage || 1,
          gridSize: (strategy.config as any)?.gridSize || 10,
          gridRange: (strategy.config as any)?.gridRange || 5,
          orderQuantity: (strategy.config as any)?.orderQuantity || 1,
          takeProfit: (strategy.config as any)?.takeProfit,
          entryThreshold: (strategy.config as any)?.entryThreshold,
          exitThreshold: (strategy.config as any)?.exitThreshold,
          stopLoss: (strategy.config as any)?.stopLoss,
        }
      : {
          type: StrategyType.GRID,
          leverage: 1,
          gridSize: 10,
          gridRange: 5,
          orderQuantity: 1,
        },
  });

  // Create strategy mutation
  const createMutation = useMutation({
    mutationFn: (data: StrategyFormData) => {
      const config: Record<string, unknown> = {
        symbol: data.symbol,
        leverage: data.leverage,
      };

      // Add type-specific config
      if (data.type === StrategyType.GRID) {
        config.gridSize = data.gridSize;
        config.gridRange = data.gridRange;
        config.orderQuantity = data.orderQuantity;
      }

      // Add optional fields if provided
      if (data.takeProfit) config.takeProfit = data.takeProfit;
      if (data.entryThreshold) config.entryThreshold = data.entryThreshold;
      if (data.exitThreshold) config.exitThreshold = data.exitThreshold;
      if (data.stopLoss) config.stopLoss = data.stopLoss;

      return api.createStrategy({
        name: data.name,
        type: data.type,
        config,
      });
    },
    onSuccess: () => {
      onSuccess();
      reset();
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error || "Failed to create strategy");
    },
  });

  // Update strategy mutation
  const updateMutation = useMutation({
    mutationFn: (data: StrategyFormData) => {
      const config: Record<string, unknown> = {
        symbol: data.symbol,
        leverage: data.leverage,
      };

      // Add type-specific config
      if (data.type === StrategyType.GRID) {
        config.gridSize = data.gridSize;
        config.gridRange = data.gridRange;
        config.orderQuantity = data.orderQuantity;
      }

      // Add optional fields if provided
      if (data.takeProfit) config.takeProfit = data.takeProfit;
      if (data.entryThreshold) config.entryThreshold = data.entryThreshold;
      if (data.exitThreshold) config.exitThreshold = data.exitThreshold;
      if (data.stopLoss) config.stopLoss = data.stopLoss;

      return api.updateStrategy(strategy!.id, {
        name: data.name,
        type: data.type,
        config,
      });
    },
    onSuccess: () => {
      onSuccess();
      reset();
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error || "Failed to update strategy");
    },
  });

  const onSubmit = (data: StrategyFormData) => {
    if (strategy) {
      updateMutation.mutate(data);
    } else {
      createMutation.mutate(data);
    }
  };

  const isLoading = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <h2 className="text-xl font-bold text-white">
            {strategy ? "Edit Strategy" : "Create New Strategy"}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white p-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-6">
          {/* Basic Information */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Strategy Name
              </label>
              <input
                {...register("name")}
                type="text"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                placeholder="My Grid Strategy"
              />
              {errors.name && (
                <p className="text-red-400 text-sm mt-1">
                  {errors.name.message}
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Strategy Type
              </label>
              <select
                {...register("type")}
                onChange={e => {
                  const newType = e.target.value as StrategyType;
                  setSelectedType(newType);
                  setValue("type", newType);
                }}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
              >
                <option value={StrategyType.GRID}>Grid Trading</option>
                <option value={StrategyType.TREND_FOLLOWING}>
                  Trend Following
                </option>
                <option value={StrategyType.ARBITRAGE}>Arbitrage</option>
              </select>
            </div>
          </div>

          {/* Trading Symbol */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Trading Symbol
            </label>
            <select
              {...register("symbol")}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
            >
              {AVAILABLE_SYMBOLS.map(symbol => (
                <option key={symbol} value={symbol}>
                  {symbol.replace("PERP_", "").replace("_USDC", "")}
                </option>
              ))}
            </select>
            {errors.symbol && (
              <p className="text-red-400 text-sm mt-1">
                {errors.symbol.message}
              </p>
            )}
          </div>

          {/* Leverage */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Leverage (1x - 20x)
            </label>
            <input
              {...register("leverage", { valueAsNumber: true })}
              type="number"
              min="1"
              max="20"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
            />
            {errors.leverage && (
              <p className="text-red-400 text-sm mt-1">
                {errors.leverage.message}
              </p>
            )}
          </div>

          {/* Grid Trading Configuration */}
          {selectedType === StrategyType.GRID && (
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-white">
                Grid Configuration
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Grid Size (2-100 levels)
                  </label>
                  <input
                    {...register("gridSize", { valueAsNumber: true })}
                    type="number"
                    min="2"
                    max="100"
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  {errors.gridSize && (
                    <p className="text-red-400 text-sm mt-1">
                      {errors.gridSize.message}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Grid Range (1-50%)
                  </label>
                  <input
                    {...register("gridRange", { valueAsNumber: true })}
                    type="number"
                    min="1"
                    max="50"
                    step="0.1"
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  {errors.gridRange && (
                    <p className="text-red-400 text-sm mt-1">
                      {errors.gridRange.message}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Order Quantity
                  </label>
                  <input
                    {...register("orderQuantity", { valueAsNumber: true })}
                    type="number"
                    min="0.01"
                    step="0.01"
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  {errors.orderQuantity && (
                    <p className="text-red-400 text-sm mt-1">
                      {errors.orderQuantity.message}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Risk Management */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium text-white">
              Risk Management (Optional)
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Take Profit (%)
                </label>
                <input
                  {...register("takeProfit", { valueAsNumber: true })}
                  type="number"
                  min="0"
                  step="0.1"
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  placeholder="Leave empty to disable"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Stop Loss (%)
                </label>
                <input
                  {...register("stopLoss", { valueAsNumber: true })}
                  type="number"
                  min="0"
                  step="0.1"
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  placeholder="Leave empty to disable"
                />
              </div>
            </div>
          </div>

          {/* Form Actions */}
          <div className="flex justify-end gap-3 pt-6 border-t border-gray-700">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-300 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
            >
              {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
              {strategy ? "Update Strategy" : "Create Strategy"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
