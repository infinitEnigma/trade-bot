import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore } from "../../../auth/hooks/useAuth";
import { UserLevel } from "../../../../shared/types";
import { BotControls } from "./BotControls";

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
  OperationToasts: {
    botStartSuccess: vi.fn(),
    botStartFailed: vi.fn(),
    botStopSuccess: vi.fn(),
    botStopFailed: vi.fn(),
    emergencyStopSuccess: vi.fn(),
    emergencyStopFailed: vi.fn(),
    qualificationSuccess: vi.fn(),
    qualificationFailed: vi.fn(),
  },
}));

vi.mock("../../../bots/hooks/useBotLifecycle", () => ({
  BOT_INSTANCES_QUERY_KEY: ["bot-instances"],
  useBotState: () => ({
    actualState: "UNKNOWN",
    isTransitional: false,
    isConnectionLost: false,
  }),
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
  const setUser = (user: unknown) => {
    useAuthStore.setState({
      user: user as never,
      isAuthenticated: user !== null,
      isLoading: false,
    });
  };

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
