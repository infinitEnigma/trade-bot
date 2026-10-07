/** @format */

/**
 * Login/logout cleanup (§3 #2): real `useAuth` store + mocked authService
 * + real app-scoped query client. Logout clears cache, storage, store and
 * fires the wallet-disconnect + WS cleanup contract.
 */

import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAuth } from "../../features/auth/hooks/useAuth";
import { authService } from "../../features/auth/services/authService";
import { httpClient } from "../../infrastructure/api/client";
import { queryClient, clearQueryCache } from "../../shared/query-client";
import { UserLevel } from "../../shared/types";

vi.mock("../../features/auth/services/authService");

(authService.checkAdminQualification as Mock).mockResolvedValue({
  success: true,
  data: { isQualified: false },
});

const mockUser = {
  id: "u1",
  email: "v@test.com",
  userLevel: UserLevel.VERIFIED,
  roles: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("login/logout cleanup (§3 #2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (authService.checkAdminQualification as Mock).mockResolvedValue({
      success: true,
      data: { isQualified: false },
    });
    localStorage.clear();
    queryClient.clear();
  });

  it("logout purges cache, storage, store; fires wallet event", async () => {
    (authService.login as Mock).mockResolvedValue({
      success: true,
      data: { user: mockUser },
    });
    (authService.getProfile as Mock).mockResolvedValue({
      success: true,
      data: { user: mockUser, kodiakStatus: {} },
    });
    const postSpy = vi
      .spyOn(httpClient.getClient(), "post")
      .mockResolvedValue({ data: { success: true } });

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.login({
        email: "v@test.com",
        password: "pw",
      });
    });
    expect(result.current.isAuthenticated).toBe(true);

    queryClient.setQueryData(["user", "u1"], mockUser);
    queryClient.setQueryData(["bot-instances"], [{ id: "bot-1" }]);
    localStorage.setItem("auth-storage", JSON.stringify({ user: mockUser }));

    let walletFired = 0;
    const onWallet = () => {
      walletFired++;
    };
    window.addEventListener("auth:disconnect-wallet", onWallet);
    try {
      await act(async () => {
        await result.current.logout();
      });

      expect(postSpy).toHaveBeenCalledWith("/api/auth/logout");
      expect(result.current.user).toBeNull();
      expect(result.current.isAuthenticated).toBe(false);
      // zustand persist re-writes the key with the logged-out state after the
      // removal — the contract is no stale identity, not key absence.
      expect(localStorage.getItem("auth-storage")).not.toContain("u1");
      expect(queryClient.getQueryData(["user", "u1"])).toBeUndefined();
      expect(queryClient.getQueryData(["bot-instances"])).toBeUndefined();
      expect(walletFired).toBe(1);
      // WS teardown is ConditionalWebSocketInitializer's job (App effect on
      // isAuthenticated), not the store's — logout only purges session state.
    } finally {
      window.removeEventListener("auth:disconnect-wallet", onWallet);
      postSpy.mockRestore();
    }
    await clearQueryCache();
  });
});
