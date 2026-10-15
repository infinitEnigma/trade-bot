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

vi.mock("../../../infrastructure/api/market", () => ({
  marketApi: { getVenueSymbols: vi.fn() },
}));

vi.mock("../../../infrastructure/api/accounts", () => ({
  accountsApi: { listAccounts: vi.fn() },
}));

vi.mock("../../auth", () => ({
  useAuth: () => ({ user: { id: "u1" } }),
}));

import { marketApi } from "../../../infrastructure/api/market";
import { accountsApi } from "../../../infrastructure/api/accounts";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const KODIAK = { exchange: "kodiak", environment: "mainnet" } as const;
const LIGHTER = { exchange: "lighter", environment: "testnet" } as const;

const mockVenues = () => {
  vi.mocked(accountsApi.listAccounts).mockResolvedValue({
    success: true,
    data: {
      accounts: [
        {
          id: "a1",
          status: "ACTIVE",
          exchange: "kodiak",
          environment: "mainnet",
        },
        {
          id: "a2",
          status: "ACTIVE",
          exchange: "lighter",
          environment: "testnet",
        },
      ],
    },
  } as never);
  vi.mocked(marketApi.getVenueSymbols).mockImplementation(
    async (params: { exchange: string; environment: string }) => {
      if (params.exchange === "kodiak") {
        return {
          success: true,
          data: {
            exchange: "kodiak",
            environment: "mainnet",
            available: true,
            symbols: ["PERP_BTC_USDC", "PERP_ETH_USDC"],
          },
        } as never;
      }
      return {
        success: true,
        data: {
          exchange: "lighter",
          environment: "testnet",
          available: true,
          symbols: ["BTC", "ETH"],
        },
      } as never;
    }
  );
};

const renderForm = (ui: React.ReactElement) => {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  );
};

const fillValidGridForm = () => {
  fireEvent.change(screen.getByPlaceholderText("My Grid Strategy"), {
    target: { value: "My Grid" },
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

const waitForOptions = async () => {
  const select = (await screen.findByLabelText(
    /trading symbol/i
  )) as HTMLSelectElement;
  // Wait until the catalogs populate AND the controlled select has a real
  // value (the setValue effect runs in the same flush as that render) —
  // otherwise submit fires while symbol is still "".
  await waitFor(() => {
    expect(select.querySelectorAll("option").length).toBeGreaterThan(1);
    expect(select.value).not.toBe("");
  });
  // The internal state sync (exchange/environment/symbol set from the picked
  // venue) runs asynchronously after selectedOption is set. The submit would be
  // blocked while `symbol` is still "" — wait for the pre-filled symbol to
  // land before attempting submit.
  await waitFor(() => {
    const symInput = screen.getByLabelText(
      /trading symbol/i
    ) as HTMLSelectElement;
    // The select shows the chosen venue+symbol pair.
    expect(symInput.value).toBeTruthy();
    // Wait for the required-symbol validation error to clear, proving the
    // form now holds a populated symbol value.
    expect(
      screen.queryByText(/trading symbol is required/i)
    ).not.toBeInTheDocument();
  });
  return select;
};

describe("GridStrategyForm field policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVenues();
  });

  it("renders the grid engine surface — stop-loss present, no leverage/thresholds/type", async () => {
    renderForm(<GridStrategyForm onClose={() => {}} onSuccess={() => {}} />);

    expect(screen.getByLabelText(/strategy name/i)).toBeDefined();
    expect(await screen.findByLabelText(/trading symbol/i)).toBeDefined();
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

  it("lists venue-catalog symbols grouped by venue (026, no hardcoded list)", async () => {
    renderForm(<GridStrategyForm onClose={() => {}} onSuccess={() => {}} />);

    const select = await waitForOptions();
    const options = Array.from(select.querySelectorAll("option")).map(
      o => o.textContent ?? ""
    );
    expect(options).toContain("BTC");
    expect(options).toContain("ETH");
    const groups = Array.from(select.querySelectorAll("optgroup")).map(
      g => g.getAttribute("label") ?? ""
    );
    expect(groups).toContain("Kodiak mainnet");
    expect(groups).toContain("Lighter testnet");
  });
});

describe("GridStrategyForm submissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVenues();
  });

  it("creates with type: GRID, top-level venue, and grid-only config keys", async () => {
    vi.mocked(tradingApi.createStrategy).mockResolvedValue({
      success: true,
      data: { id: "s1", name: "My Grid" },
    } as never);
    const onSuccess = vi.fn();

    renderForm(<GridStrategyForm onClose={() => {}} onSuccess={onSuccess} />);
    await waitForOptions();
    fillValidGridForm();
    // TEMP DEBUG
    fireEvent.submit(
      screen.getByRole("button", { name: /create strategy/i }).closest("form")!
    );
    await new Promise(r => setTimeout(r, 300));
    // eslint disable-next-line no-console
    console.error("BODY SNIPPET:", document.body.innerHTML.slice(0, 4000));

    await waitFor(() =>
      expect(tradingApi.createStrategy).toHaveBeenCalledWith({
        name: "My Grid",
        type: StrategyType.GRID,
        ...KODIAK,
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
    expect(payload.config).not.toHaveProperty("exchange");
    expect(payload.config).not.toHaveProperty("environment");
    expect(onSuccess).toHaveBeenCalled();
  });

  it("includes stopLoss in the payload only when the user sets one", async () => {
    vi.mocked(tradingApi.createStrategy).mockResolvedValue({
      success: true,
      data: { id: "s2", name: "My Grid" },
    } as never);
    const onSuccess = vi.fn();

    renderForm(<GridStrategyForm onClose={() => {}} onSuccess={onSuccess} />);
    await waitForOptions();
    fillValidGridForm();
    fireEvent.change(screen.getByLabelText(/stop loss/i), {
      target: { value: "7.5" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create strategy/i }));

    await waitFor(() =>
      expect(tradingApi.createStrategy).toHaveBeenCalledWith({
        name: "My Grid",
        type: StrategyType.GRID,
        ...KODIAK,
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
    await waitForOptions();
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
      true,
      "kodiak",
      "mainnet"
    );

    renderForm(
      <GridStrategyForm
        strategy={strategy}
        onClose={() => {}}
        onSuccess={() => {}}
      />
    );
    await waitForOptions();

    fireEvent.click(screen.getByRole("button", { name: /update strategy/i }));
    await waitFor(() =>
      expect(tradingApi.updateStrategy).toHaveBeenCalledWith("s1", {
        name: "Existing",
        type: StrategyType.GRID,
        ...KODIAK,
        config: {
          symbol: "PERP_ETH_USDC",
          gridSize: 20,
          gridRange: 8,
          orderQuantity: 2,
        },
      })
    );
  });

  it("publishes the live grid geometry with venue for the chart preview (F5)", async () => {
    const onPreviewChange = vi.fn();
    renderForm(
      <GridStrategyForm
        onClose={() => {}}
        onSuccess={() => {}}
        onPreviewChange={onPreviewChange}
      />
    );
    await waitForOptions();

    // Create mode defaults to the first catalog option and publishes venue +
    // geometry, so the chart has a band to draw from the start.
    await waitFor(() =>
      expect(onPreviewChange).toHaveBeenLastCalledWith({
        symbol: "PERP_BTC_USDC",
        ...KODIAK,
        gridSize: 10,
        gridRange: 5,
      })
    );

    // A geometry edit republishes while the operator types — that is what
    // makes the preview live rather than a snapshot at submit.
    fireEvent.change(screen.getByLabelText(/grid size/i), {
      target: { value: "20" },
    });
    expect(onPreviewChange).toHaveBeenLastCalledWith({
      symbol: "PERP_BTC_USDC",
      ...KODIAK,
      gridSize: 20,
      gridRange: 5,
    });

    fireEvent.change(screen.getByLabelText(/grid range/i), {
      target: { value: "12" },
    });
    expect(onPreviewChange).toHaveBeenLastCalledWith({
      symbol: "PERP_BTC_USDC",
      ...KODIAK,
      gridSize: 20,
      gridRange: 12,
    });
  });

  it("publishes the loaded row's geometry with venue in edit mode (F5)", async () => {
    const onPreviewChange = vi.fn();
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
      true,
      "kodiak",
      "mainnet"
    );

    renderForm(
      <GridStrategyForm
        strategy={strategy}
        onClose={() => {}}
        onSuccess={() => {}}
        onPreviewChange={onPreviewChange}
      />
    );

    await waitFor(() =>
      expect(onPreviewChange).toHaveBeenLastCalledWith({
        symbol: "PERP_ETH_USDC",
        ...KODIAK,
        gridSize: 20,
        gridRange: 8,
      })
    );
  });

  it("uses the Lighter venue when the operator picks a Lighter symbol (026)", async () => {
    const onPreviewChange = vi.fn();
    renderForm(
      <GridStrategyForm
        onClose={() => {}}
        onSuccess={() => {}}
        onPreviewChange={onPreviewChange}
      />
    );
    await waitForOptions();

    fireEvent.change(screen.getByLabelText(/trading symbol/i), {
      target: { value: "lighter|testnet|ETH" },
    });

    await waitFor(() =>
      expect(onPreviewChange).toHaveBeenLastCalledWith({
        symbol: "ETH",
        ...LIGHTER,
        gridSize: 10,
        gridRange: 5,
      })
    );
  });
});
