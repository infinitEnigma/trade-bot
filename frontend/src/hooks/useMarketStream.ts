/** @format */

import { useEffect, useState, useCallback, useRef } from "react";
import { io, Socket } from "socket.io-client";

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
  const [socket, setSocket] = useState<Socket | null>(null);
  const [ticks, setTicks] = useState<Record<string, TickData>>({});
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);

  // Refs for throttling and batching
  const pendingTicksRef = useRef<Record<string, TickData>>({});
  const throttleTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const batchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize socket connection
  useEffect(() => {
    if (!autoConnect) return;

    setConnecting(true);

    const socketInstance = io("https://rewireapp.ddns.net", {
      withCredentials: true,
      transports: ["websocket", "polling"],
    });

    socketInstance.on("connect", () => {
      console.log("Market stream connected");
      setConnected(true);
      setConnecting(false);
    });

    socketInstance.on("disconnect", () => {
      console.log("Market stream disconnected");
      setConnected(false);
      setConnecting(false);
    });

    socketInstance.on("connect_error", error => {
      console.error("Market stream connection error:", error);
      setConnecting(false);
    });

    setSocket(socketInstance);

    return () => {
      socketInstance.disconnect();
      setSocket(null);
      setConnected(false);
      setConnecting(false);
    };
  }, [autoConnect]);

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

  // Listen for tick data with throttling
  useEffect(() => {
    if (!socket) return;

    const handleTick = (tick: TickData) => {
      // Add to pending updates
      pendingTicksRef.current[tick.symbol] = tick;

      // Clear existing timeout
      if (throttleTimeoutRef.current) {
        clearTimeout(throttleTimeoutRef.current);
      }

      // Set new throttled update (max 10 updates per second = 100ms intervals)
      throttleTimeoutRef.current = setTimeout(batchUpdateTicks, 100);
    };

    symbols.forEach(symbol => {
      socket.on(`market:${symbol}`, handleTick);
    });

    return () => {
      // Clear any pending timeouts
      if (throttleTimeoutRef.current) {
        clearTimeout(throttleTimeoutRef.current);
        throttleTimeoutRef.current = null;
      }
      if (batchTimeoutRef.current) {
        clearTimeout(batchTimeoutRef.current);
        batchTimeoutRef.current = null;
      }

      symbols.forEach(symbol => {
        socket.off(`market:${symbol}`, handleTick);
      });
    };
  }, [socket, symbols, batchUpdateTicks]);

  // Subscribe to symbols
  useEffect(() => {
    if (!socket || !connected) return;

    symbols.forEach(symbol => {
      socket.emit("subscribe_market", symbol);
    });

    return () => {
      symbols.forEach(symbol => {
        socket.emit("unsubscribe_market", symbol);
      });
    };
  }, [socket, connected, symbols]);

  // Manual subscribe function
  const subscribe = useCallback(
    (symbol: string) => {
      if (socket && connected) {
        socket.emit("subscribe_market", symbol);
      }
    },
    [socket, connected]
  );

  // Manual unsubscribe function
  const unsubscribe = useCallback(
    (symbol: string) => {
      if (socket) {
        socket.emit("unsubscribe_market", symbol);
      }
    },
    [socket]
  );

  // Send test message (for debugging)
  const sendTestMessage = useCallback(
    (message: any) => {
      if (socket && connected) {
        socket.emit("test", message);
      }
    },
    [socket, connected]
  );

  return {
    socket,
    ticks,
    connected,
    connecting,
    subscribe,
    unsubscribe,
    sendTestMessage,
  };
};

export default useMarketStream;
