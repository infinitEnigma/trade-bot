/** @format */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

//import { WebSocketClient, WebSocketStatus } from "../../../infrastructure/websocket/client";

/**
 * Tests for the WebSocketClient reconnect hardening:
 * - single-flight connect (no duplicate sockets / retry schedules)
 * - reconnectTimer guard against double-scheduling
 * - slow-retry-forever instead of permanent give-up
 * The singleton class is loaded fresh with mocked socket.io-client so each
 * test starts from a pristine instance.
 */

const socketInstances: any[] = [];

vi.mock("socket.io-client", () => ({
  io: vi.fn(() => {
    const handlers: Record<string, Array<(...args: any[]) => void>> = {};
    const anyHandlers: Array<(event: string, ...args: any[]) => void> = [];
    const socket = {
      connected: false,
      connect: vi.fn(),
      disconnect: vi.fn(() => {
        socket.connected = false;
        handlers["disconnect"]?.forEach(fn => fn("io client disconnect"));
      }),
      emit: vi.fn(),
      on: vi.fn((event: string, fn: (...args: any[]) => void) => {
        (handlers[event] ??= []).push(fn);
      }),
      onAny: vi.fn((fn: (event: string, ...args: any[]) => void) => {
        anyHandlers.push(fn);
      }),
      __emit: (event: string, ...args: any[]) => {
        anyHandlers.forEach(fn => fn(event, ...args));
        handlers[event]?.forEach(fn => fn(...args));
      },
      __handlers: handlers,
    };
    socketInstances.push(socket);
    return socket;
  }),
}));

vi.mock("../../../infrastructure/config", () => ({
  getWebSocketUrl: () => "ws://test",
}));

import { io } from "socket.io-client";
import {
  WebSocketClient,
  WebSocketStatus,
} from "../../../infrastructure/websocket/client";

function lastSocket(): any {
  return socketInstances[socketInstances.length - 1];
}

describe("WebSocketClient reconnect hardening", () => {
  let client: WebSocketClient;
  let statusSpy: (status: WebSocketStatus) => void;

  beforeEach(() => {
    vi.useFakeTimers();
    socketInstances.length = 0;
    vi.mocked(io).mockClear();
    // Fresh private instance via the class constructor bypass.
    client = new (WebSocketClient as any)();
    statusSpy = vi.fn();
    client.onStatusChange(statusSpy);
  });

  afterEach(() => {
    client.cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function emitConnect(): void {
    lastSocket().connected = true;
    lastSocket().__emit("connect");
  }

  function emitConnectError(): void {
    lastSocket().__emit("connect_error", new Error("boom"));
  }

  it("single-flight: concurrent connect() calls share one socket and one promise", () => {
    const p1 = client.connect();
    const p2 = client.connect();

    expect(vi.mocked(io)).toHaveBeenCalledTimes(1);
    expect(p1).toBe(p2);
  });

  it("connect() resolves through the in-flight promise on connect event", async () => {
    const promise = client.connect();
    emitConnect();

    await expect(promise).resolves.toBe(lastSocket());
    expect(client.getStatus()).toBe("connected");
  });

  it("connect_error rejects the in-flight promise exactly once and schedules one retry", async () => {
    const promise = client.connect();
    emitConnectError();

    await expect(promise).rejects.toThrow("boom");
    expect(client.getStatus()).toBe("reconnecting");

    // Advance past the first backoff delay (~3s for attempt 1) - the retry
    // calls connect() again, creating a second socket (never two at once).
    vi.advanceTimersByTime(5_000);
    expect(vi.mocked(io)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(io)).not.toHaveBeenCalledTimes(3);
  });

  it("reconnectTimer guard: double failure in quick succession schedules one retry", () => {
    // The connect() promise rejects on connect_error below; swallow the
    // expected rejection (we're testing retry scheduling, not the promise).
    client.connect().catch(() => {});
    // Simulate both a disconnect and a connect_error for the same failure.
    lastSocket().__emit("disconnect", "transport close");
    emitConnectError();

    vi.advanceTimersByTime(10_000);
    // disconnect(transport close) -> attemptReconnection #1; the trailing
    // connect_error must be absorbed by the reconnectTimer guard.
    expect(vi.mocked(io)).toHaveBeenCalledTimes(2);
  });

  it("never gives up permanently: retries continue on a slow cadence after max attempts", () => {
    client.connect().catch(() => {});
    // Exhaust the 5 fast attempts.
    for (let i = 0; i < 5; i++) {
      emitConnectError();
      vi.advanceTimersByTime(60_000);
      emitConnectError();
    }
    const callsAfterFast = vi.mocked(io).mock.calls.length;
    expect(callsAfterFast).toBeGreaterThanOrEqual(5);

    // Attempt 6+ must keep happening on the slow cadence, not stop.
    vi.advanceTimersByTime(30_000);
    expect(vi.mocked(io).mock.calls.length).toBeGreaterThan(callsAfterFast);
    // A retry is now in flight (connect_or RECONNECTING) - never given up.
    expect(client.getStatus()).not.toBe("disconnected");
  });

  it("manual connect() supersedes a scheduled retry timer", () => {
    // First connect will reject below on connect_error - swallow expected rejection.
    client.connect().catch(() => {});
    emitConnectError();
    // A retry is now scheduled. Before it fires, the user calls connect() manually.
    vi.advanceTimersByTime(1_000);
    client.connect().catch(() => {});

    vi.advanceTimersByTime(10_000);
    // Without the supersede, the old timer would ALSO have fired -> 3 calls.
    expect(vi.mocked(io)).toHaveBeenCalledTimes(2);
  });
});
