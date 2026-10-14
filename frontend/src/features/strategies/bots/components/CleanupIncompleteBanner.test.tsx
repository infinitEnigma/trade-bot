/** @format */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { marketApi } from "../../../../infrastructure/api";
import { cleanupIncompleteDetail } from "../../utils/cleanupIncomplete";
import { CleanupIncompleteBanner } from "./CleanupIncompleteBanner";

// Only the read-only re-check endpoints are touched by the banner.
vi.mock("../../../../infrastructure/api", () => ({
  marketApi: {
    getPositions: vi.fn(),
    getOpenOrders: vi.fn(),
  },
}));

/** A terminal reason exactly as the engine emits it on an incomplete stop. */
const RESIDUE_REASON =
  "emergency_stop:FULL_SHUTDOWN; cleanup_incomplete: position 2.5 BTC not flattened (still open after flatten: venue stopped absorbing slices)";

describe("cleanupIncompleteDetail (marker parse)", () => {
  it("extracts the verified residual after the marker", () => {
    expect(cleanupIncompleteDetail(RESIDUE_REASON)).toBe(
      "position 2.5 BTC not flattened (still open after flatten: venue stopped absorbing slices)"
    );
  });

  it("returns null without the marker (verified-clean stop)", () => {
    expect(cleanupIncompleteDetail("emergency_stop:FULL_SHUTDOWN")).toBeNull();
    expect(cleanupIncompleteDetail("normal_stop")).toBeNull();
    expect(cleanupIncompleteDetail(null)).toBeNull();
    expect(cleanupIncompleteDetail(undefined)).toBeNull();
    expect(cleanupIncompleteDetail("")).toBeNull();
  });

  it("falls back to an honest phrase for a bare marker", () => {
    expect(cleanupIncompleteDetail("normal_stop; cleanup_incomplete")).toBe(
      "venue cleanup could not be verified"
    );
  });
});

describe("CleanupIncompleteBanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing on a verified-clean stop", () => {
    const { container } = render(
      <CleanupIncompleteBanner forceStopReason="emergency_stop:FULL_SHUTDOWN" />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the verified residual and the re-check action on a marked stop", () => {
    render(
      <CleanupIncompleteBanner
        forceStopReason={RESIDUE_REASON}
        exchangeAccountId="acct-1"
        symbol="BTC"
      />
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(
      screen.getByText(/position 2\.5 BTC not flattened/)
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /re-check venue/i })
    ).toBeInTheDocument();
  });

  it("re-reads the venue (read-only) and shows the current state", async () => {
    vi.mocked(marketApi.getPositions).mockResolvedValue({
      data: { rows: [{ symbol: "BTC", position_qty: "0.4" }] },
    } as never);
    vi.mocked(marketApi.getOpenOrders).mockResolvedValue({
      data: [{ orderId: "o-1", symbol: "BTC" }],
    } as never);

    render(
      <CleanupIncompleteBanner
        forceStopReason={RESIDUE_REASON}
        exchangeAccountId="acct-1"
        symbol="BTC"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /re-check venue/i }));

    await waitFor(() =>
      expect(screen.getByTestId("venue-check-result")).toHaveTextContent(
        "position 0.4 BTC"
      )
    );
    expect(screen.getByTestId("venue-check-result")).toHaveTextContent(
      "1 open order"
    );
    expect(marketApi.getPositions).toHaveBeenCalledWith("acct-1");
    expect(marketApi.getOpenOrders).toHaveBeenCalledWith({
      exchangeAccountId: "acct-1",
      symbol: "BTC",
    });
  });

  it("surfaces a failed re-check without hiding the banner", async () => {
    vi.mocked(marketApi.getPositions).mockRejectedValue(
      new Error("venue down")
    );

    render(
      <CleanupIncompleteBanner forceStopReason={RESIDUE_REASON} symbol="BTC" />
    );
    fireEvent.click(screen.getByRole("button", { name: /re-check venue/i }));

    await waitFor(() =>
      expect(screen.getByTestId("venue-check-error")).toHaveTextContent(
        "venue down"
      )
    );
    // The residual fact never disappears behind its own re-check failing.
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(
      screen.getByText(/position 2\.5 BTC not flattened/)
    ).toBeInTheDocument();
  });
});
