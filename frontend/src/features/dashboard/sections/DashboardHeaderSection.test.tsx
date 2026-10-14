/** @format */

/**
 * DashboardHeaderSection alert CTA + useNeedsAttentionCount (Stage 4).
 * VERIFIED + count > 0 → "Resolve alert" into /strategies; every other
 * combination keeps the tier's primary CTA. The count hook never fires the
 * bot query — cache-only read of the single-owner ["bot-instances"] key.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";

import { DashboardHeaderSection } from "./DashboardHeaderSection";
import { useNeedsAttentionCount } from "../hooks/useNeedsAttentionCount";
import { resolveDashboardAccess } from "../utils/dashboardAccess";
import { BOT_INSTANCES_QUERY_KEY } from "../../bots/hooks";
import { UserLevel } from "../../../shared/types";
import { useAuthStore } from "../../auth/hooks/useAuth";

const mockGetBotInstances = vi.fn();
vi.mock("../../../infrastructure/api", () => ({
  tradingApi: {
    getBotInstances: (...args: unknown[]) => mockGetBotInstances(...args),
  },
}));

const setUser = (user: unknown) => {
  useAuthStore.setState({
    user: user as never,
    isAuthenticated: user !== null,
    isLoading: false,
  });
};

let queryClient: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <MemoryRouter>
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  </MemoryRouter>
);

const botRow = (overrides: object = {}) => ({
  id: "b1",
  status: "STOPPED",
  total_trades: 0,
  total_pnl: 0,
  last_updated: "2026-10-13T10:00:00.000Z",
  config: { type: "GRID", config: { symbol: "PERP_ETH_USDC" } },
  runs: [],
  ...overrides,
});

describe("DashboardHeaderSection alert CTA (Stage 4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setUser({
      id: "u1",
      email: "v@example.com",
      username: "vee",
      userLevel: UserLevel.VERIFIED,
    });
  });

  it("VERIFIED + 0 → normal Open Strategies CTA", () => {
    render(
      <MemoryRouter>
        <DashboardHeaderSection
          access={resolveDashboardAccess({
            userLevel: UserLevel.VERIFIED,
          })}
          needsAttentionCount={0}
        />
      </MemoryRouter>
    );

    expect(screen.getByText("Open Strategies")).toBeInTheDocument();
    expect(screen.queryByText(/Resolve alert/)).not.toBeInTheDocument();
  });

  it("VERIFIED + count > 0 → Resolve alert linking into /strategies", () => {
    render(
      <MemoryRouter>
        <DashboardHeaderSection
          access={resolveDashboardAccess({
            userLevel: UserLevel.VERIFIED,
          })}
          needsAttentionCount={2}
        />
      </MemoryRouter>
    );

    const cta = screen.getByText(/Resolve alert/);
    expect(cta.getAttribute("href")).toBe("/strategies");
    expect(cta.textContent).toContain("(2)");
    expect(screen.queryByText("Open Strategies")).not.toBeInTheDocument();
  });

  it("count is ignored below VERIFIED (BASIC keeps its wallet CTA)", () => {
    render(
      <MemoryRouter>
        <DashboardHeaderSection
          access={resolveDashboardAccess({ userLevel: UserLevel.BASIC })}
          needsAttentionCount={3}
        />
      </MemoryRouter>
    );

    expect(screen.getByText("Connect Wallet")).toBeInTheDocument();
    expect(screen.queryByText(/Resolve alert/)).not.toBeInTheDocument();
  });
});

describe("useNeedsAttentionCount (Stage 4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  it("counts needsUserAction + UNKNOWN + ERROR rows from the shared cache", () => {
    queryClient.setQueryData(
      [BOT_INSTANCES_QUERY_KEY],
      [
        botRow({ id: "a", status: "RUNNING" }),
        botRow({
          id: "b",
          status: "ERROR",
          needsUserAction: true,
          needsUserActionReason: "engine_lost",
        }),
        botRow({ id: "c", status: "UNKNOWN" }),
      ]
    );

    const { result } = renderHook(() => useNeedsAttentionCount(true), {
      wrapper,
    });
    expect(result.current).toBe(2);
  });

  it("returns 0 when disabled and never fires the bot query", () => {
    queryClient.setQueryData(
      [BOT_INSTANCES_QUERY_KEY],
      [botRow({ id: "b", status: "UNKNOWN" })]
    );

    const { result } = renderHook(() => useNeedsAttentionCount(false), {
      wrapper,
    });
    expect(result.current).toBe(0);
    expect(mockGetBotInstances).not.toHaveBeenCalled();
  });

  it("returns 0 when the cache is empty (nothing fetched yet)", () => {
    const { result } = renderHook(() => useNeedsAttentionCount(true), {
      wrapper,
    });
    expect(result.current).toBe(0);
    expect(mockGetBotInstances).not.toHaveBeenCalled();
  });
});
