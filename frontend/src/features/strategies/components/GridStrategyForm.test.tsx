/** @format */

/**
 * GridStrategyForm contract (product decision 2026-10-12, updated with the
 * aggregate stop-loss): the ONLY live strategy form contains exactly the
 * fields the grid engine consumes — symbol, grid geometry, order size, an
 * optional take-profit, and an OPTIONAL aggregate stop-loss (v1, Model A).
 * It still has no leverage (never per-strategy), no entry/exit thresholds
 * (trend-only), and no type picker (type is GRID). Submit payloads must carry
 * `type: GRID`; the stop-loss key appears only when the user sets one.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Strategy, StrategyType } from "../../../shared/types";
import { tradingApi } from "../../../infrastructure/api";
import { GridStrategyForm } from "./GridStrategyForm";

vi.mock("../../../infrastructure/api", () => ({
  tradingApi: {
    createStrategy: vi.fn(),
    updateStrategy: vi.fn(),
  },
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const renderForm = (ui: React.ReactElement) => {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  );
};

const fillValidGridForm = () => {
  fireEvent.change(screen.getByPlaceholderText("My Grid Strategy"), {
    target: { value: "My Grid" },
  });
  // RHF's uncontrolled select needs the change event to register the value.
  fireEvent.change(screen.getByLabelText(/trading symbol/i), {
    target: { value: "PERP_BTC_USDC" },
  });
  fireEvent.change(screen.getByLabelText(/grid size/i), {
    target: { value: "10" },
  });
  fireEvent.change(screen.getByLabelText(/grid range/i), {
    target: { value: "5" },
  });
  fireEvent.change(screen.getByLabelText(/order size/i), {
    target: { value: "1" },
  });
};

describe("GridStrategyForm field policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the grid engine surface — stop-loss present, no leverage/thresholds/type", () => {
    renderForm(<GridStrategyForm onClose={() => {}} onSuccess={() => {}} />);

    expect(screen.getByLabelText(/strategy name/i)).toBeDefined();
    expect(screen.getByLabelText(/trading symbol/i)).toBeDefined();
    expect(screen.getByLabelText(/grid size/i)).toBeDefined();
    expect(screen.getByLabelText(/grid range/i)).toBeDefined();
    expect(screen.getByLabelText(/order size/i)).toBeDefined();
    expect(screen.getByLabelText(/take profit/i)).toBeDefined();
    // Optional aggregate stop-loss (v1, Model A) is now a supported field.
    expect(screen.getByLabelText(/stop loss/i)).toBeDefined();

    const html = document.body.innerHTML;
    for (const forbidden of [
      /leverage/i,
      /entry threshold/i,
      /exit threshold/i,
      /strategy type/i,
    ]) {
      expect(html).not.toMatch(forbidden);
    }
  });

  it("labels spot vs perp in the venue-grouped symbol picker", () => {
    renderForm(<GridStrategyForm onClose={() => {}} onSuccess={() => {}} />);

    const options = Array.from(
      screen.getByLabelText(/trading symbol/i).querySelectorAll("option")
    ).map(o => o.textContent ?? "");
    // Lighter bare perp and slash-quoted spot must be distinguishable (L20).
    expect(options).toContain("ETH · perp");
    expect(options).toContain("ETH/USDC · spot");
    // Kodiak convention stays intact with its kind label.
    expect(options).toContain("BTC · perp");
  });
});

describe("GridStrategyForm submissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates with type: GRID and grid-only config keys", async () => {
    vi.mocked(tradingApi.createStrategy).mockResolvedValue({
      success: true,
      data: { id: "s1", name: "My Grid" },
    } as never);
    const onSuccess = vi.fn();

    renderForm(<GridStrategyForm onClose={() => {}} onSuccess={onSuccess} />);
    fillValidGridForm();
    fireEvent.click(screen.getByRole("button", { name: /create strategy/i }));

    await waitFor(() =>
      expect(tradingApi.createStrategy).toHaveBeenCalledWith({
        name: "My Grid",
        type: StrategyType.GRID,
        config: {
          symbol: "PERP_BTC_USDC",
          gridSize: 10,
          gridRange: 5,
          orderQuantity: 1,
        },
      })
    );
    // Trend-only keys can never sneak into the payload.
    const payload = vi.mocked(tradingApi.createStrategy).mock.calls[0][0];
    expect(payload.config).not.toHaveProperty("leverage");
    expect(payload.config).not.toHaveProperty("stopLoss");
    expect(payload.config).not.toHaveProperty("entryThreshold");
    expect(payload.config).not.toHaveProperty("exitThreshold");
    expect(onSuccess).toHaveBeenCalled();
  });

  it("includes stopLoss in the payload only when the user sets one", async () => {
    vi.mocked(tradingApi.createStrategy).mockResolvedValue({
      success: true,
      data: { id: "s2", name: "My Grid" },
    } as never);
    const onSuccess = vi.fn();

    renderForm(<GridStrategyForm onClose={() => {}} onSuccess={onSuccess} />);
    fillValidGridForm();
    fireEvent.change(screen.getByLabelText(/stop loss/i), {
      target: { value: "7.5" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create strategy/i }));

    await waitFor(() =>
      expect(tradingApi.createStrategy).toHaveBeenCalledWith({
        name: "My Grid",
        type: StrategyType.GRID,
        config: {
          symbol: "PERP_BTC_USDC",
          gridSize: 10,
          gridRange: 5,
          orderQuantity: 1,
          stopLoss: 7.5,
        },
      })
    );
    expect(onSuccess).toHaveBeenCalled();
  });

  it("rejects a gridSize below the engine floor (2)", async () => {
    renderForm(<GridStrategyForm onClose={() => {}} onSuccess={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("My Grid Strategy"), {
      target: { value: "Bad Grid" },
    });
    fireEvent.change(screen.getByLabelText(/grid size/i), {
      target: { value: "1" },
    });
    fireEvent.change(screen.getByLabelText(/order size/i), {
      target: { value: "1" },
    });
    // Submit the form directly: clicking the submit button lets jsdom's
    // NATIVE constraint validation (input min="2") swallow the submit event
    // before RHF ever runs — this pins the ZOD floor, which must reject
    // independently of the HTML attribute.
    fireEvent.submit(
      screen.getByRole("button", { name: /create strategy/i }).closest("form")!
    );

    // zod's floor message — never a submit.
    await waitFor(() =>
      expect(screen.getByText(/expected number to be >=2/i)).toBeDefined()
    );
    expect(tradingApi.createStrategy).not.toHaveBeenCalled();
  });

  it("edit mode updates the existing row as GRID", async () => {
    vi.mocked(tradingApi.updateStrategy).mockResolvedValue({
      success: true,
    } as never);
    const strategy = new Strategy(
      "s1",
      "u1",
      "Existing",
      StrategyType.GRID,
      "PERP_ETH_USDC",
      {
        symbol: "PERP_ETH_USDC",
        gridSize: 20,
        gridRange: 8,
        orderQuantity: 2,
      },
      true
    );

    renderForm(
      <GridStrategyForm
        strategy={strategy}
        onClose={() => {}}
        onSuccess={() => {}}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /update strategy/i }));
    await waitFor(() =>
      expect(tradingApi.updateStrategy).toHaveBeenCalledWith("s1", {
        name: "Existing",
        type: StrategyType.GRID,
        config: {
          symbol: "PERP_ETH_USDC",
          gridSize: 20,
          gridRange: 8,
          orderQuantity: 2,
        },
      })
    );
  });
});
