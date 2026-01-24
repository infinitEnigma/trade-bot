/** @format */

import { useState, useRef, useEffect, useCallback } from "react";
import { UserLevel } from "@trade-bot/shared";
import { globalAnalyticsManager } from "../../../shared/services/analytics-manager";
import { analyticsService } from "../services/analyticsService";
import { AnalyticsOptions, AnalyticsData } from "../types/analytics.types";

/**
 * Analytics hook - manages analytics data fetching and state with global coordination
 */
export const useAnalytics = ({
    symbol,
    timeWindow,
    enabled = true,
    userLevel = UserLevel.BASIC, // Default to basic for safety
    user, // Add user parameter for stable subscription ID
}: AnalyticsOptions & { userLevel?: UserLevel; user?: any }) => {
    const [progress, setProgress] = useState(0);
    const [data, setData] = useState<AnalyticsData | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const abortControllerRef = useRef<AbortController | null>(null);
    const subscriptionIdRef = useRef<string | null>(null);

    // Generate unique subscription ID using user data for stability and meaning
    const subscriptionId = `analytics-${user?.id || 'anonymous'}-${symbol}-${timeWindow.value}`;

    // Callback for analytics data updates
    const handleAnalyticsUpdate = useCallback((newData: AnalyticsData | null, errorMessage?: string) => {
        if (errorMessage) {
            setError(errorMessage);
            setLoading(false);
            setProgress(0);
        } else if (newData) {
            setData(newData);
            setError(null);
            setLoading(false);
            setProgress(1);
        } else {
            // No data available
            setData(null);
            setLoading(false);
            setProgress(0);
        }
    }, []);

    // Subscribe to global analytics manager
    useEffect(() => {
        if (!enabled) return;

        console.log(`📊 useAnalytics: Subscribing ${subscriptionId} for ${symbol}`);

        // Cancel any existing subscription
        if (subscriptionIdRef.current) {
            // Note: In a real implementation, we'd need an unsubscribe method
            // For now, we'll rely on the manager's cleanup
        }

        //setLoading(true);
        //setProgress(0);
        //setError(null);

        // Subscribe to analytics updates
        const unsubscribe = globalAnalyticsManager.subscribe(
            subscriptionId,
            symbol,
            timeWindow,
            userLevel,
            handleAnalyticsUpdate
        );

        subscriptionIdRef.current = subscriptionId;

        // Cleanup function
        return () => {
            console.log(`📊 useAnalytics: Unsubscribing ${subscriptionId}`);
            unsubscribe();
            subscriptionIdRef.current = null;
        };
    }, [symbol, timeWindow.value, timeWindow.days, enabled, userLevel, subscriptionId, handleAnalyticsUpdate]);

    // Get time windows
    const timeWindows = analyticsService.getTimeWindows();

    // Manual refetch function
    const refetch = useCallback(async () => {
        if (!enabled) return;

        setLoading(true);
        setProgress(0);
        setError(null);

        try {
            await globalAnalyticsManager.forceRefresh(symbol, timeWindow, userLevel);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to refresh analytics');
            setLoading(false);
        }
    }, [symbol, timeWindow, userLevel, enabled]);

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
        loading,
        error,
        progress,
        timeWindows,
        refetch,
    };
};
