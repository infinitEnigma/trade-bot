/** @format */

/**
 * 401 mid-mutation (§3 #8): stop rejected 401/-1002 leaves no zombie state.
 * Cache keeps RUNNING, one session-expired per episode, episode resets.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../../infrastructure/api", () => ({
  tradingApi: { getBotInstances: vi.fn(), stopBot: vi.fn() },
}));

import { tradingApi } from "../../infrastructure/api";
import {
  consumeHttpSessionExpiredMark,
  dispatchSessionExpired,
} from "../../infrastructure/api/session-events";
import {
  useBotLifecycle,
  BOT_INSTANCES_QUERY_KEY,
} from "../../features/bots/hooks/useBotLifecycle";

const API_ROW = {
  id: "bot-1",
  strategy_id: "strategy-1",
  status: "RUNNING",
  total_trades: 4,
  total_pnl: 12.5,
  last_updated: "2026-09-29T12:00:00.000Z",
  config: null,
};

let queryClient: QueryClient;

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

function useStopBot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (botId: string) => tradingApi.stopBot(botId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [BOT_INSTANCES_QUERY_KEY] });
    },
  });
}

describe("401 mid-mutation (§3 #8)", () => {
  beforeEach(() => {
    consumeHttpSessionExpiredMark();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.mocked(tradingApi.getBotInstances).mockResolvedValue({
      success: true,
      data: [API_ROW],
    });
  });

  it("rejected stop: no zombie, one event, episode resets", async () => {
    let expiredCount = 0;
    const onExpired = () => {
      expiredCount++;
    };
    window.addEventListener("auth:session-expired", onExpired);
    try {
      const life = renderHook(() => useBotLifecycle("bot-1"), { wrapper });
      const stop = renderHook(() => useStopBot(), { wrapper });
      await waitFor(() => expect(life.result.current.bot?.id).toBe("bot-1"));

      const err = new Error("Unauthorized") as Error & {
        response?: { status: number; data?: { code: number } };
      };
      err.response = { status: 401, data: { code: -1002 } };
      vi.mocked(tradingApi.stopBot).mockRejectedValue(err);

      await act(async () => {
        await expect(stop.result.current.mutateAsync("bot-1")).rejects.toThrow(
          "Unauthorized"
        );
        dispatchSessionExpired();
      });

      expect(expiredCount).toBe(1);
      // mutateAsync rejected (surfaced to the caller); the error is recorded
      // on the mutation result once React Query flushes the state update.
      await waitFor(() => expect(stop.result.current.isError).toBe(true));
      expect(
        queryClient.getQueryData<{ status: string }[]>([
          BOT_INSTANCES_QUERY_KEY,
        ])?.[0]?.status
      ).toBe("RUNNING");
      expect(vi.mocked(tradingApi.getBotInstances).mock.calls.length).toBe(1);

      window.dispatchEvent(new CustomEvent("auth:session-expired"));
      expect(expiredCount).toBe(2);

      life.unmount();
      stop.unmount();
    } finally {
      window.removeEventListener("auth:session-expired", onExpired);
      consumeHttpSessionExpiredMark();
    }
  });
});
