/** @format */

import { useEffect, useState, useCallback, useRef } from "react";
import { websocketSubscriptionManager } from "../utils/websocket-manager";

export interface TickData {
  symbol: string;
  price: number;
  volume: number;
  timestamp: number;
  bid: number;
  ask: number;
  change24h: number;
}

interface UseMarketStreamOptions {
  symbols: string[];
  onTick?: (data: TickData) => void;
  autoConnect?: boolean;
}

export const useMarketStream = ({
  symbols,
  onTick,
  autoConnect = true,
}: UseMarketStreamOptions) => {
  const [ticks, setTicks] = useState<Record<string, TickData>>({});

  // Refs for throttling and subscription management
  const pendingTicksRef = useRef<Record<string, TickData>>({});
  const throttleTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const subscriptionIdsRef = useRef<Map<string, string>>(new Map());

  // Throttled batch update function (max 10 updates per second)
  const batchUpdateTicks = useCallback(() => {
    const pendingTicks = pendingTicksRef.current;
    if (Object.keys(pendingTicks).length === 0) return;

    // Clear pending ticks
    pendingTicksRef.current = {};

    // Batch update all ticks at once
    setTicks(prev => ({ ...prev, ...pendingTicks }));

    // Call onTick for each updated symbol
    if (onTick) {
      Object.values(pendingTicks).forEach(tick => onTick(tick));
    }
  }, [onTick]);

  // Handle incoming tick data with throttling
  const handleTickData = useCallback((tick: TickData) => {
    // Add to pending updates
    pendingTicksRef.current[tick.symbol] = tick;

    // Clear existing timeout
    if (throttleTimeoutRef.current) {
      clearTimeout(throttleTimeoutRef.current);
    }

    // Set new throttled update (max 10 updates per second = 100ms intervals)
    throttleTimeoutRef.current = setTimeout(batchUpdateTicks, 100);
  }, [batchUpdateTicks]);

  // Subscribe to symbols using shared manager
  useEffect(() => {
    if (!autoConnect || symbols.length === 0) return;

    const currentSubscriptions = subscriptionIdsRef.current;

    // Subscribe to new symbols
    symbols.forEach(symbol => {
      if (!currentSubscriptions.has(symbol)) {
        const callbackId = websocketSubscriptionManager.subscribe(symbol, handleTickData);
        currentSubscriptions.set(symbol, callbackId);
      }
    });

    // Unsubscribe from symbols no longer needed
    for (const [symbol, callbackId] of currentSubscriptions) {
      if (!symbols.includes(symbol)) {
        websocketSubscriptionManager.unsubscribe(symbol, callbackId);
        currentSubscriptions.delete(symbol);
      }
    }

    return () => {
      // Cleanup all subscriptions when component unmounts
      for (const [symbol, callbackId] of currentSubscriptions) {
        websocketSubscriptionManager.unsubscribe(symbol, callbackId);
      }
      currentSubscriptions.clear();

      // Clear any pending timeouts
      if (throttleTimeoutRef.current) {
        clearTimeout(throttleTimeoutRef.current);
        throttleTimeoutRef.current = null;
      }
    };
  }, [symbols, autoConnect, handleTickData]);

  // Manual subscribe function
  const subscribe = useCallback((symbol: string) => {
    if (!subscriptionIdsRef.current.has(symbol)) {
      const callbackId = websocketSubscriptionManager.subscribe(symbol, handleTickData);
      subscriptionIdsRef.current.set(symbol, callbackId);
    }
  }, [handleTickData]);

  // Manual unsubscribe function
  const unsubscribe = useCallback((symbol: string) => {
    const callbackId = subscriptionIdsRef.current.get(symbol);
    if (callbackId) {
      websocketSubscriptionManager.unsubscribe(symbol, callbackId);
      subscriptionIdsRef.current.delete(symbol);
    }
  }, []);

  // Send test message (for debugging)
  const sendTestMessage = useCallback((message: any) => {
    // This would need to be implemented in the WebSocket manager if needed
    console.log('Test message:', message);
  }, []);

  // Get connection status from manager
  const connected = websocketSubscriptionManager.getTotalRefCount() > 0;
  const connecting = false; // WebSocket manager handles this internally

  return {
    ticks,
    connected,
    connecting,
    subscribe,
    unsubscribe,
    sendTestMessage,
  };
};

export default useMarketStream;
