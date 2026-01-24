/** @format */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
//import { Strategy } from "@trade-bot/shared";
import { strategyService } from "../services/strategyService";
import { BotInstance, StrategyFormData } from "../types/strategies.types";
import { toast } from "sonner";

/**
 * Strategy hook - manages strategy CRUD operations and state
 */
export const useStrategies = () => {
    const queryClient = useQueryClient();

    // Fetch strategies
    const {
        data: strategies = [],
        isLoading,
        error,
    } = useQuery({
        queryKey: ["strategies"],
        queryFn: () => strategyService.getStrategies(),
        staleTime: 30000, // 30 seconds
        gcTime: 300000, // 5 minutes
    });

    // Fetch bot instances
    const { data: bots = [] } = useQuery<BotInstance[]>({
        queryKey: ["bot-instances"],
        queryFn: () => strategyService.getAllBotInstances(),
        staleTime: 30000,
        gcTime: 300000,
    });

    // Create strategy mutation
    const createMutation = useMutation({
        mutationFn: (data: StrategyFormData) => strategyService.createStrategy(data),
        onSuccess: (newStrategy) => {
            if (newStrategy) {
                queryClient.invalidateQueries({ queryKey: ["strategies"] });
                toast.success("Strategy created successfully!");
            }
        },
        onError: (error: unknown) => {
            const errorMessage = error instanceof Error
                ? error.message
                : typeof error === 'object' && error !== null && 'message' in error
                    ? (error as { message: string }).message
                    : "Failed to create strategy";
            toast.error(errorMessage);
        },
    });

    // Update strategy mutation
    const updateMutation = useMutation({
        mutationFn: ({ id, data }: { id: string; data: Partial<StrategyFormData> }) =>
            strategyService.updateStrategy(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["strategies"] });
            toast.success("Strategy updated successfully!");
        },
        onError: (error: unknown) => {
            const errorMessage = error instanceof Error
                ? error.message
                : typeof error === 'object' && error !== null && 'message' in error
                    ? (error as { message: string }).message
                    : "Failed to update strategy";
            toast.error(errorMessage);
        },
    });

    // Delete strategy mutation
    const deleteMutation = useMutation({
        mutationFn: (id: string) => strategyService.deleteStrategy(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["strategies"] });
            queryClient.invalidateQueries({ queryKey: ["bot-instances"] });
            toast.success("Strategy deleted successfully!");
        },
        onError: () => {
            toast.error("Failed to delete strategy");
        },
    });

    // Helper function to get bot for strategy
    const getBotForStrategy = (strategyId: string): BotInstance | undefined => {
        if (!Array.isArray(bots)) {
            return undefined;
        }
        return bots.find((bot) => bot.strategy_id === strategyId);
    };

    // Helper function to format currency
    const formatCurrency = (value: number): string => {
        return new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: "USD",
        }).format(value);
    };

    return {
        // Data
        strategies,
        bots,

        // Loading states
        isLoading,
        isCreating: createMutation.isPending,
        isUpdating: updateMutation.isPending,
        isDeleting: deleteMutation.isPending,

        // Errors
        error,

        // Actions
        createStrategy: createMutation.mutate,
        updateStrategy: updateMutation.mutate,
        deleteStrategy: deleteMutation.mutate,

        // Helpers
        getBotForStrategy,
        formatCurrency,

        // Service methods
        validateStrategyConfig: strategyService.validateStrategyConfig,
        formatStrategyType: strategyService.formatStrategyType,
        getStrategyTypeColor: strategyService.getStrategyTypeColor,
    };
};
