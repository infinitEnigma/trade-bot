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

  // The row as the shared ["bot-instances"] cache holds it after the L19 fix:
  // `id` is the bot id, `strategy_id` the strategy it belongs to.
  const botRow: BotInstance = {
    id: "bot-1",
    strategy_id: "strategy-1",
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
      expect(tradingApi.stopBot).toHaveBeenCalledWith("bot-1")
    );
    expect(tradingApi.stopBot).not.toHaveBeenCalledWith("strategy-1");
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
      expect(tradingApi.stopBot).toHaveBeenCalledWith("bot-1")
    );

    fireEvent.click(screen.getByText("Emergency Stop"));
    await waitFor(() =>
      expect(tradingApi.emergencyStop).toHaveBeenCalledWith("bot-1")
    );

    expect(tradingApi.stopBot).not.toHaveBeenCalledWith("strategy-1");
    expect(tradingApi.emergencyStop).not.toHaveBeenCalledWith("strategy-1");
  });
});
