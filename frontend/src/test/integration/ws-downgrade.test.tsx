/** @format */

/**
 * VERIFIED -> REGISTERED downgrade (§3 #6): the initializer's VERIFIED-only
 * gate tears down WS + subscriptions on downgrade, with no reconnect loop.
 *
 * The host replicates `ConditionalWebSocketInitializer`'s exact branch
 * structure (same deps, same cleanup contract) with a controllable auth
 * level — no router needed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useEffect } from "react";

const socketInstances: Array<{
  connected: boolean;
  __emit: (event: string, ...args: unknown[]) => void;
}> = [];

type FakeEntry = {
  connected: boolean;
  __emit: (event: string, ...args: unknown[]) => void;
};

vi.mock("socket.io-client", () => ({
  io: vi.fn(() => {
    const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
    const anyH: Array<(event: string, ...args: unknown[]) => void> = [];
    const socket = {
      connected: false,
      connect: vi.fn(),
      disconnect: vi.fn(),
      emit: vi.fn(),
      on: vi.fn((event: string, fn: (...args: unknown[]) => void) => {
        (handlers[event] ??= []).push(fn);
      }),
      onAny: vi.fn((fn: (event: string, ...args: unknown[]) => void) => {
        anyH.push(fn);
      }),
      __emit: (event: string, ...args: unknown[]) => {
        anyH.forEach(fn => fn(event, ...args));
        handlers[event]?.forEach(fn => fn(...args));
      },
    };
    socketInstances.push(socket as unknown as FakeEntry);
    return socket;
  }),
}));

vi.mock("../../infrastructure/config", () => ({
  getWebSocketUrl: () => "ws://test",
}));

vi.mock("../../infrastructure/api/session-refresh", () => ({
  refreshSessionOnce: vi.fn(async () => false),
}));

import { io } from "socket.io-client";
import { websocketClient } from "../../infrastructure/websocket/client";
import { websocketSubscriptionManager } from "../../infrastructure/websocket/websocket-manager";

function useInitializerHostTracked(
  level: string | undefined,
  isAuthed: boolean
) {
  useEffect(() => {
    if (isAuthed && level === "VERIFIED") {
      const run = async () => {
        try {
          await websocketClient.connect();
        } catch {
          /* guarded in prod */
        }
      };
      run();
      return () => {
        websocketSubscriptionManager.cleanup();
        websocketClient.cleanup();
      };
    } else if (!isAuthed || level !== "VERIFIED") {
      websocketSubscriptionManager.cleanup();
      websocketClient.cleanup();
    }
    return undefined;
  }, [isAuthed, level]);
}

describe("VERIFIED -> REGISTERED downgrade (§3 #6)", () => {
  beforeEach(() => {
    socketInstances.length = 0;
    vi.mocked(io).mockClear();
    websocketClient.cleanup();
  });

  it("connects VERIFIED; downgrade tears down with no reconnect", async () => {
    const mgrCleanup = vi.spyOn(websocketSubscriptionManager, "cleanup");
    const clientCleanup = vi.spyOn(websocketClient, "cleanup");
    try {
      const host = renderHook(
        ({ level, isAuthed }) => {
          useInitializerHostTracked(level, isAuthed);
        },
        { initialProps: { level: "VERIFIED", isAuthed: true } }
      );

      await act(async () => {});
      const fake = socketInstances[socketInstances.length - 1];
      expect(fake).toBeDefined();
      fake.connected = true;
      fake.__emit("connect");
      await waitFor(() =>
        expect(websocketClient.getStatus()).toBe("connected")
      );

      mgrCleanup.mockClear();
      clientCleanup.mockClear();

      host.rerender({ level: "REGISTERED", isAuthed: true });
      await waitFor(() => expect(clientCleanup).toHaveBeenCalled());
      expect(websocketClient.getStatus()).toBe("disconnected");
      expect(websocketClient.getSocket()).toBeNull();

      // No reconnect loop: no new socket, no retry timer re-arm visible as
      // a fresh connect attempt.
      const socketsAfter = socketInstances.length;
      await act(async () => {});
      expect(socketInstances.length).toBe(socketsAfter);
      expect(websocketClient.getStatus()).toBe("disconnected");

      host.unmount();
    } finally {
      mgrCleanup.mockRestore();
      clientCleanup.mockRestore();
    }
  });
});
