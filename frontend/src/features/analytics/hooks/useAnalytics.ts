/** @format */

import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { analyticsService } from "../services/analyticsService";
import { AnalyticsOptions } from "../types/analytics.types";

/**
 * Analytics hook - manages analytics data fetching and state
 */
export const useAnalytics = ({
    symbol,
    timeWindow,
    enabled = true,
}: AnalyticsOptions) => {
    const [progress, setProgress] = useState(0);
    const abortControllerRef = useRef<AbortController | null>(null);

    // Fetch analytics data
    const {
        data,
        isLoading,
        error,
        refetch,
    } = useQuery({
        queryKey: ["analytics", symbol, timeWindow.value],
        queryFn: async () => {
            // Cancel any existing request
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }

            const abortController = new AbortController();
            abortControllerRef.current = abortController;

            try {
                setProgress(0);
                const result = await analyticsService.loadAnalyticsData(
                    symbol,
                    timeWindow,
                    (progress) => setProgress(progress),
                    abortController.signal
                );
                setProgress(1);
                return result;
            } catch (err) {
                if (!abortController.signal.aborted) {
                    throw err;
                }
                return null;
            } finally {
                abortControllerRef.current = null;
            }
        },
        enabled,
        staleTime: 5 * 60 * 1000, // 5 minutes
        gcTime: 30 * 60 * 1000, // 30 minutes
        retry: (failureCount, error: any) => {
            if (error?.name === 'AbortError') return false;
            return failureCount < 2;
        },
    });

    // Get time windows
    const timeWindows = analyticsService.getTimeWindows();

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
        };
    }, []);

    return {
        data,
        loading: isLoading,
        error: error?.message || null,
        progress,
        timeWindows,
        refetch,
    };
};
