import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore } from "../../../auth/hooks/useAuth";
import { UserLevel, StrategyType } from "../../../../shared/types";
import { tradingApi } from "../../../../infrastructure/api";
import { useBotState } from "../../../bots/hooks/useBotLifecycle";
import { BotInstance } from "../../../strategies/types/strategies.types";
import { BotControls } from "./BotControls";

/** Minimal state surface the component reads (the hook itself is mocked). */
const botState = (actualState: string) =>
  ({
    actualState,
    isTransitional: false,
    isConnectionLost: false,
  }) as unknown as ReturnType<typeof useBotState>;

/** Seed the auth store the component gates on. */
const setUser = (user: unknown) => {
  useAuthStore.setState({
    user: user as never,
    isAuthenticated: user !== null,
    isLoading: false,
  });
};

// The start/stop flow calls the management API + accounts list + bot state.
// All network is mocked; these tests pin the VERIFIED gating contract:
// any VERIFIED user sees bot controls, below VERIFIED sees the upgrade gate,
// and QUALIFIED_ALPHA is never required.
vi.mock("../../../../infrastructure/api", () => ({
  tradingApi: {
    getBotInstances: vi.fn(),
    getEngineStatus: vi.fn(),
    startBot: vi.fn(),
    stopBot: vi.fn(),
    resumeBot: vi.fn(),
    emergencyStop: vi.fn(),
  },
  authApi: {
    checkQualification: vi.fn(),
  },
}));

vi.mock("../../../../infrastructure/api/accounts", () => ({
  accountsApi: {
    listAccounts: vi
      .fn()
      .mockResolvedValue({ success: true, data: { accounts: [] } }),
  },
}));

vi.mock("../../../../shared/utils/toast", () => ({
  // The helpers BotControls actually calls.
  OperationToasts: {
    botStarted: vi.fn(),
    botStopped: vi.fn(),
    botEmergencyStop: vi.fn(),
    botError: vi.fn(),
    qualificationSuccess: vi.fn(),
    qualificationFailed: vi.fn(),
  },
}));

vi.mock("../../../bots/hooks/useBotLifecycle", () => ({
  BOT_INSTANCES_QUERY_KEY: ["bot-instances"],
  useBotState: vi.fn(() => ({
    actualState: "UNKNOWN",
    isTransitional: false,
    isConnectionLost: false,
  })),
}));

// X4: the wallet-proof hook. Default returns no proof (flag off); individual
// tests override getWalletProof to assert the proof is threaded through.
const mockGetWalletProof = vi.fn().mockResolvedValue(undefined);
vi.mock("../../../../shared/hooks/useWalletProof", () => ({
  useWalletProof: () => ({ getWalletProof: mockGetWalletProof }),
}));

const renderWithClient = (ui: React.ReactElement) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  );
};

describe("BotControls access gating", () => {
  beforeEach(() => {
    setUser(null);
  });

  it("renders the start flow for a VERIFIED user without QUALIFIED_ALPHA", async () => {
    setUser({
      id: "u1",
      email: "v@example.com",
      username: "verified",
      userLevel: UserLevel.VERIFIED,
      roles: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    renderWithClient(
      <BotControls strategyId="strategy-1" onStatusChange={() => {}} />
    );

    await waitFor(() => {
      expect(screen.getByText("Start Trading Bot")).toBeInTheDocument();
    });
    expect(
      screen.queryByText("Alpha Testing Access Required")
    ).not.toBeInTheDocument();
  });

  it("gates below VERIFIED behind the verification upgrade path", async () => {
    setUser({
      id: "u2",
      email: "b@example.com",
      username: "basic",
      userLevel: UserLevel.BASIC,
      roles: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    renderWithClient(
      <BotControls strategyId="strategy-1" onStatusChange={() => {}} />
    );

    await waitFor(() => {
      expect(screen.getByText("Verification Required")).toBeInTheDocument();
    });
    expect(screen.queryByText("Start Trading Bot")).not.toBeInTheDocument();
  });
});

/**
 * L19: stop / emergency-stop must send the bot-instance id — the same value
 * `GET /api/bot/management/instances` returns in `id`. `/management/stop`
 * resolves the bot with `findBot(botId)`, so a strategy id 404s.
 */
describe("BotControls stop payload (L19)", () => {
  const verifiedUser = {
    id: "u1",
    email: "v@example.com",
    username: "verified",
    userLevel: UserLevel.VERIFIED,
    roles: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // The row as the shared ["bot-instances"] cache holds it (022 shim-drop):
  // `id` is the session id; strategy resolution uses `runs`.
  const botRow: BotInstance = {
    id: "bot-1",
    status: "RUNNING" as const,
    total_trades: 0,
    total_pnl: 0,
    last_updated: "2026-09-29T12:00:00.000Z",
    config: {
      type: StrategyType.GRID,
      config: {
        symbol: "PERP_BTC_USDC",
        leverage: 1,
        gridSize: 10,
        gridRange: 5,
        orderQuantity: 1,
      },
    },
  };

  beforeEach(() => {
    setUser(verifiedUser);
    // Default: live state unknown, which renders the "Stop Bot" control.
    vi.mocked(useBotState).mockReturnValue(botState("UNKNOWN"));
  });

  it("sends the bot id, not the strategy id, to stop", async () => {
    vi.mocked(tradingApi.stopBot).mockResolvedValue({ success: true });

    renderWithClient(
      <BotControls
        strategyId="strategy-1"
        bot={botRow}
        onStatusChange={() => {}}
      />
    );

    fireEvent.click(await screen.findByText("Stop Bot"));

    await waitFor(() =>
      expect(tradingApi.stopBot).toHaveBeenCalledWith("bot-1", undefined)
    );
    expect(tradingApi.stopBot).not.toHaveBeenCalledWith("strategy-1");
  });

  // P0 (2026-10-05): the UNKNOWN branch used to offer a button labelled
  // "Restart Bot" that called startBot — which INSERTS a new bot, giving a
  // crashed bot a second live sibling on the same venue account. It must
  // resume the SAME bot id instead.
  it("resumes the existing bot instead of starting a new one when UNKNOWN", async () => {
    vi.mocked(tradingApi.resumeBot).mockResolvedValue({ success: true });

    renderWithClient(
      <BotControls
        strategyId="strategy-1"
        bot={botRow}
        onStatusChange={() => {}}
      />
    );

    fireEvent.click(await screen.findByText("Resume Bot"));

    await waitFor(() =>
      expect(tradingApi.resumeBot).toHaveBeenCalledWith("bot-1", undefined)
    );
    expect(tradingApi.startBot).not.toHaveBeenCalled();
  });

  // P0-3: when the backend reports an unresolved needs-action marker the UI must
  // say the engine was lost and the bot was NOT auto-restarted, next to Resume.
  it("surfaces the action-required notice when the backend flags the bot", async () => {
    vi.mocked(useBotState).mockReturnValue(botState("UNKNOWN"));

    renderWithClient(
      <BotControls
        strategyId="strategy-1"
        bot={{ ...botRow, needsUserAction: true }}
        onStatusChange={() => {}}
      />
    );

    expect(
      await screen.findByText(/Action required: the trading engine was lost/i)
    ).toBeInTheDocument();
    // The recovery affordance is still offered alongside it.
    expect(screen.getByText("Resume Bot")).toBeInTheDocument();
  });

  it("does not claim action is required when the backend flags nothing", async () => {
    vi.mocked(useBotState).mockReturnValue(botState("UNKNOWN"));

    renderWithClient(
      <BotControls
        strategyId="strategy-1"
        bot={botRow}
        onStatusChange={() => {}}
      />
    );

    await screen.findByText("Resume Bot");
    expect(screen.queryByText(/Action required/i)).not.toBeInTheDocument();
  });

  it("sends the bot id to stop and emergency-stop while RUNNING", async () => {
    vi.mocked(tradingApi.stopBot).mockResolvedValue({ success: true });
    vi.mocked(tradingApi.emergencyStop).mockResolvedValue({ success: true });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(useBotState).mockReturnValue(botState("RUNNING"));

    renderWithClient(
      <BotControls
        strategyId="strategy-1"
        bot={botRow}
        onStatusChange={() => {}}
      />
    );

    fireEvent.click(await screen.findByText("Stop Trading"));
    await waitFor(() =>
      expect(tradingApi.stopBot).toHaveBeenCalledWith("bot-1", undefined)
    );

    fireEvent.click(screen.getByText("Emergency Stop"));
    await waitFor(() =>
      expect(tradingApi.emergencyStop).toHaveBeenCalledWith("bot-1")
    );

    expect(tradingApi.stopBot).not.toHaveBeenCalledWith("strategy-1");
    expect(tradingApi.emergencyStop).not.toHaveBeenCalledWith("strategy-1");
  });

  // X4: start/stop/resume sign a wallet proof and thread it into the API call;
  // emergency-stop never does.
  describe("X4 wallet-proof threading", () => {
    const proof = { nonce: "n1", address: "0xabc", signature: "0xsig" };

    beforeEach(() => {
      mockGetWalletProof.mockReset();
      mockGetWalletProof.mockResolvedValue(undefined);
    });

    it("threads the signed proof into stop", async () => {
      vi.mocked(tradingApi.stopBot).mockResolvedValue({ success: true });
      mockGetWalletProof.mockResolvedValue(proof);

      renderWithClient(
        <BotControls
          strategyId="strategy-1"
          bot={botRow}
          onStatusChange={() => {}}
        />
      );

      fireEvent.click(await screen.findByText("Stop Bot"));
      await waitFor(() =>
        expect(tradingApi.stopBot).toHaveBeenCalledWith("bot-1", proof)
      );
      expect(mockGetWalletProof).toHaveBeenCalledWith("bot:stop");
    });

    it("threads the signed proof into resume", async () => {
      vi.mocked(tradingApi.resumeBot).mockResolvedValue({ success: true });
      mockGetWalletProof.mockResolvedValue(proof);

      renderWithClient(
        <BotControls
          strategyId="strategy-1"
          bot={botRow}
          onStatusChange={() => {}}
        />
      );

      fireEvent.click(await screen.findByText("Resume Bot"));
      await waitFor(() =>
        expect(tradingApi.resumeBot).toHaveBeenCalledWith("bot-1", proof)
      );
      expect(mockGetWalletProof).toHaveBeenCalledWith("bot:resume");
    });

    it("does not call stop when the proof is refused (friendly throw)", async () => {
      mockGetWalletProof.mockRejectedValue(
        new Error("Connect the wallet linked to your account.")
      );

      renderWithClient(
        <BotControls
          strategyId="strategy-1"
          bot={botRow}
          onStatusChange={() => {}}
        />
      );

      fireEvent.click(await screen.findByText("Stop Bot"));
      await waitFor(() => expect(tradingApi.stopBot).not.toHaveBeenCalled());
    });

    it("emergency-stop never requests or sends a proof", async () => {
      vi.mocked(tradingApi.emergencyStop).mockResolvedValue({ success: true });
      vi.spyOn(window, "confirm").mockReturnValue(true);
      vi.mocked(useBotState).mockReturnValue(botState("RUNNING"));

      renderWithClient(
        <BotControls
          strategyId="strategy-1"
          bot={botRow}
          onStatusChange={() => {}}
        />
      );

      fireEvent.click(await screen.findByText("Emergency Stop"));
      await waitFor(() =>
        expect(tradingApi.emergencyStop).toHaveBeenCalledWith("bot-1")
      );
      expect(mockGetWalletProof).not.toHaveBeenCalled();
    });
  });
});
