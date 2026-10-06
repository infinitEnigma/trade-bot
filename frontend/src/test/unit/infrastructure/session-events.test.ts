/** @format */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { MockInstance } from "vitest";

describe("session-events (L14: exactly one auth:session-expired)", () => {
  let dispatchSpy: MockInstance;

  beforeEach(() => {
    vi.resetModules();
    dispatchSpy = vi
      .spyOn(window, "dispatchEvent")
      .mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const load = async () =>
    await import("../../../infrastructure/api/session-events");

  it("dispatches a single auth:session-expired event", async () => {
    const { dispatchSessionExpired } = await load();

    dispatchSessionExpired();

    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    const event = dispatchSpy.mock.calls[0][0] as CustomEvent;
    expect(event.type).toBe("auth:session-expired");
  });

  it("HTTP mark is consumed exactly once", async () => {
    const { markSessionExpiredByHttp, consumeHttpSessionExpiredMark } =
      await load();

    markSessionExpiredByHttp();

    // First consumer (the WS client) sees the mark and skips its dispatch…
    expect(consumeHttpSessionExpiredMark()).toBe(true);
    // …and never sees it again — a later episode is free to notify.
    expect(consumeHttpSessionExpiredMark()).toBe(false);
  });

  it("unmarked WS failures dispatch normally", async () => {
    const { consumeHttpSessionExpiredMark, dispatchSessionExpired } =
      await load();

    expect(consumeHttpSessionExpiredMark()).toBe(false);
    dispatchSessionExpired();

    expect(dispatchSpy).toHaveBeenCalledTimes(1);
  });

  it("stale HTTP mark is discarded on episode reset (consume clears it)", async () => {
    const {
      markSessionExpiredByHttp,
      consumeHttpSessionExpiredMark,
      dispatchSessionExpired,
    } = await load();

    // Interceptor marked, but the WS episode ends before observing it
    markSessionExpiredByHttp();
    expect(consumeHttpSessionExpiredMark()).toBe(true); // resetAuthEpisode discards it

    // A later, distinct WS failure dispatches its own event…
    expect(consumeHttpSessionExpiredMark()).toBe(false);
    dispatchSessionExpired();
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
  });
});
