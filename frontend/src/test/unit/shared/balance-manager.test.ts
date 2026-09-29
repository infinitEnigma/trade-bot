/** @format */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { globalBalanceManager } from "../../../shared/services/balance-manager";
import { kodiakApi } from "../../../infrastructure/api/kodiak";

/**
 * L15: the balance error channel. A failed venue read must surface as an
 * error (never $0/stale), and a later success must clear it.
 */
describe("globalBalanceManager error channel (L15)", () => {
  beforeEach(() => {
    globalBalanceManager.cleanup();
    vi.restoreAllMocks();
  });

  it("fans a thrown read failure out to error subscribers", async () => {
    vi.spyOn(kodiakApi, "getKodiakBalance").mockRejectedValue(
      new Error("Balance unavailable: signer sidecar unavailable")
    );
    const onData = vi.fn();
    const onError = vi.fn();
    globalBalanceManager.subscribe("t1", onData, onError);

    await globalBalanceManager.forceRefresh();

    expect(onData).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(
      "Balance unavailable: signer sidecar unavailable"
    );
    expect(globalBalanceManager.getLastBalanceError()).toBe(
      "Balance unavailable: signer sidecar unavailable"
    );
    expect(globalBalanceManager.getLastBalanceData()).toBeNull();
  });

  it("fans a success:false payload out and clears it on the next success", async () => {
    const get = vi.spyOn(kodiakApi, "getKodiakBalance");
    get.mockResolvedValueOnce({ success: false, error: "boom" });
    const onError = vi.fn();
    globalBalanceManager.subscribe("t2", vi.fn(), onError);

    await globalBalanceManager.forceRefresh();
    expect(onError).toHaveBeenCalledWith("boom");
    expect(globalBalanceManager.getLastBalanceError()).toBe("boom");

    get.mockResolvedValueOnce({
      success: true,
      data: {
        totalBalance: "10",
        availableBalance: "10",
        lockedBalance: "0",
        currency: "USDC",
      },
    });
    const onData = vi.fn();
    globalBalanceManager.subscribe("t3", onData, vi.fn());
    await globalBalanceManager.forceRefresh();

    expect(globalBalanceManager.getLastBalanceError()).toBeNull();
    expect(onData).toHaveBeenCalled();
  });
});
