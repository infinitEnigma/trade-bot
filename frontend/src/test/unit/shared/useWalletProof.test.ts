/** @format */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

// wagmi hooks are mocked; the hook under test only reads useConnection + the
// signMessage mutation.
const mockUseConnection = vi.fn();
const mockSignMessageAsync = vi.fn();

vi.mock("wagmi", () => ({
  useConnection: () => mockUseConnection(),
  useSignMessage: () => ({ mutateAsync: mockSignMessageAsync }),
}));

const mockListWallets = vi.fn();
const mockCreateChallenge = vi.fn();

vi.mock("../../../infrastructure/api/wallet", () => ({
  walletApi: {
    listWallets: () => mockListWallets(),
    createChallenge: (action: string) => mockCreateChallenge(action),
  },
}));

import { useWalletProof } from "../../../shared/hooks/useWalletProof";

const ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";
const OTHER = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";

/** Render the hook so its useCallback runs in a React context. */
const getProof = () =>
  renderHook(() => useWalletProof()).result.current.getWalletProof;

describe("useWalletProof (X4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseConnection.mockReturnValue({ address: ADDRESS, isConnected: true });
    mockListWallets.mockResolvedValue({
      success: true,
      data: {
        proofRequired: true,
        wallets: [
          { id: "w1", chain: "evm", address: ADDRESS, isPrimary: true },
        ],
      },
    });
    mockCreateChallenge.mockResolvedValue({
      success: true,
      data: {
        nonce: "nonce-1",
        message: "Trade Bot wallet proof …",
        expiresAt: new Date().toISOString(),
      },
    });
    mockSignMessageAsync.mockResolvedValue("0xsig");
  });

  it("returns a signed proof when connected to the linked wallet", async () => {
    const proof = await getProof()("bot:start");
    expect(mockCreateChallenge).toHaveBeenCalledWith("bot:start");
    expect(mockSignMessageAsync).toHaveBeenCalledWith({
      message: "Trade Bot wallet proof …",
    });
    expect(proof).toEqual({
      nonce: "nonce-1",
      address: ADDRESS,
      signature: "0xsig",
    });
  });

  it("returns undefined (no signing) when the backend reports proofRequired:false (D3)", async () => {
    mockListWallets.mockResolvedValue({
      success: true,
      data: { proofRequired: false, wallets: [] },
    });
    const proof = await getProof()("bot:stop");
    expect(proof).toBeUndefined();
    expect(mockSignMessageAsync).not.toHaveBeenCalled();
  });

  it("throws a connect hint when no wallet is connected", async () => {
    mockUseConnection.mockReturnValue({
      address: undefined,
      isConnected: false,
    });
    await expect(getProof()("bot:start")).rejects.toThrow(
      /Connect the wallet/i
    );
  });

  it("throws a switch hint when connected to an unlinked wallet", async () => {
    mockUseConnection.mockReturnValue({ address: OTHER, isConnected: true });
    await expect(getProof()("bot:start")).rejects.toThrow(/Switch to/i);
    expect(mockSignMessageAsync).not.toHaveBeenCalled();
  });

  it("throws a signature-required hint when the user rejects signing", async () => {
    mockSignMessageAsync.mockRejectedValue(new Error("User rejected"));
    await expect(getProof()("bot:resume")).rejects.toThrow(
      /Signature required/i
    );
  });

  it("surfaces the backend challenge error when the challenge cannot be issued", async () => {
    mockCreateChallenge.mockResolvedValue({
      success: false,
      error: "rate limited",
    });
    await expect(getProof()("bot:start")).rejects.toThrow("rate limited");
  });
});
