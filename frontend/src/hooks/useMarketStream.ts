/** @format */

import { useEffect, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

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
  autoConnect = true
}: UseMarketStreamOptions) => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [ticks, setTicks] = useState<Record<string, TickData>>({});
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);

  // Initialize socket connection
  useEffect(() => {
    if (!autoConnect) return;

    setConnecting(true);

    const socketInstance = io('https://rewireapp.ddns.net', {
      withCredentials: true,
      transports: ['websocket', 'polling'],
    });

    socketInstance.on('connect', () => {
      console.log('Market stream connected');
      setConnected(true);
      setConnecting(false);
    });

    socketInstance.on('disconnect', () => {
      console.log('Market stream disconnected');
      setConnected(false);
      setConnecting(false);
    });

    socketInstance.on('connect_error', (error) => {
      console.error('Market stream connection error:', error);
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

  // Listen for tick data
  useEffect(() => {
    if (!socket) return;

    symbols.forEach((symbol) => {
      socket.on(`market:${symbol}`, (tick: TickData) => {
        setTicks((prev) => ({
          ...prev,
          [symbol]: tick,
        }));

        if (onTick) {
          onTick(tick);
        }
      });
    });

    return () => {
      symbols.forEach((symbol) => {
        socket.off(`market:${symbol}`);
      });
    };
  }, [socket, symbols, onTick]);

  // Subscribe to symbols
  useEffect(() => {
    if (!socket || !connected) return;

    symbols.forEach((symbol) => {
      socket.emit('subscribe_market', symbol);
    });

    return () => {
      symbols.forEach((symbol) => {
        socket.emit('unsubscribe_market', symbol);
      });
    };
  }, [socket, connected, symbols]);

  // Manual subscribe function
  const subscribe = useCallback(
    (symbol: string) => {
      if (socket && connected) {
        socket.emit('subscribe_market', symbol);
      }
    },
    [socket, connected]
  );

  // Manual unsubscribe function
  const unsubscribe = useCallback(
    (symbol: string) => {
      if (socket) {
        socket.emit('unsubscribe_market', symbol);
      }
    },
    [socket]
  );

  // Send test message (for debugging)
  const sendTestMessage = useCallback(
    (message: any) => {
      if (socket && connected) {
        socket.emit('test', message);
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
