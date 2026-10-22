/** @format */

/**
 * Grid admission — the backend's AUTHORITATIVE decision on whether a prepared
 * grid may trade.
 *
 * The engine prepares a grid and reports its estimate (`ESTIMATE_READY`). That
 * report is EVIDENCE, not truth: this service recomputes the exposure from the
 * PERSISTED strategy configuration and the backend's OWN validated venue
 * price, cross-checks the engine's numbers against that recomputation, and
 * refuses anything that does not reconcile.
 *
 * The checks, in order (each fails closed):
 *
 *  1. PROVENANCE  — the estimate must belong to this run and this
 *     preparation. An estimate for another run, or a superseded preparation
 *     version, is discarded (never applied to a newer preparation).
 *  2. CONSISTENCY — the engine's symbol, gridSize and orderQuantity must
 *     match the persisted configuration. A mismatch is a configuration drift
 *     or a protocol defect: rejected, never "corrected".
 *  3. PRICE      — the backend reads its own price for the fully-resolved
 *     instrument (venue + environment + symbol) and validates its freshness.
 *     A missing, stale, mismatched or unavailable price fails the admission;
 *     the engine's price is never used as a fallback.
 *  4. RECOMPUTE  — the exposure is recomputed from the persisted config and
 *     the backend's price using the SHARED calculator, then compared with the
 *     engine's reported figures within a tolerance. A material discrepancy is
 *     rejected, not silently replaced.
 *  5. PER-ORDER  — every eligible BUY level's own notional must satisfy the
 *     configured per-symbol cap.
 *
 * The figure this service returns is the one the caller must pass into the
 * F1 admission transaction as `notionalAmount` — it is computed from the
 * BACKEND's price, so it is the exposure the account is actually about to
 * carry.
 */

import {
  agreesWithin,
  computeGridExposure,
  type GridExposureConfig,
} from "@trade-bot/shared";
import type { IMarketPriceReader } from "./market-price-reader.port";
import type { ISymbolNotionalPolicy } from "./symbol-notional-policy.port";

/** The engine's report for one prepared run. */
export interface GridEstimateReport {
  botId: string;
  runId: string;
  preparationVersion: number;
  symbol: string;
  gridSize: number;
  orderQuantity: number;
  priceUsed: number;
  estimatedRestingNotional: number;
  perOrderNotional: number;
}

/** What the admission service needs to know about the run being admitted. */
export interface GridAdmissionRequest {
  botId: string;
  runId: string;
  preparationVersion: number;
  /** The persisted strategy config — the source of truth for the geometry. */
  config: GridExposureConfig;
  /** The symbol the strategy persists. */
  symbol: string;
  venue: "kodiak" | "lighter";
  environment: "testnet" | "mainnet";
}

/** The admission outcome. */
export interface GridAdmissionResult {
  /** The exposure the account is about to carry, in USD. */
  authorizedNotional: number;
  /** The backend's validated price. */
  price: number;
  /** The instrument the price was read for. */
  resolvedInstrument: string;
  /** The number of BUY levels that will rest. */
  buyLevelCount: number;
  /** The largest single order's notional among those levels. */
  maxOrderNotional: number;
}

/** Tunables — every one of them a POLICY value, deliberately explicit. */
export interface GridAdmissionPolicy {
  /**
   * How old a quote may be, in ms. A price older than this fails the
   * admission (an old price is an unknown capacity).
   */
  maxPriceAgeMs: number;
  /**
   * How far the engine's price may differ from the backend's, as a RELATIVE
   * fraction. The two are sampled at different instants, so they need not be
   * identical — but a material difference means one of them is wrong.
   */
  priceRelativeTolerance: number;
  /**
   * How far the engine's reported exposure may differ from the backend's
   * recomputation, as a RELATIVE fraction. The engine's grid is
   * tick-quantized and the recomputation is not, so a small difference is
   * expected and bounded.
   */
  estimateRelativeTolerance: number;
}

export class GridAdmissionRejectedError extends Error {
  constructor(
    public readonly reason: string,
    message: string
  ) {
    super(message);
    this.name = "GridAdmissionRejectedError";
  }
}

export interface GridAdmissionDependencies {
  priceReader: IMarketPriceReader;
  notionalPolicy: ISymbolNotionalPolicy;
  policy: GridAdmissionPolicy;
}

/**
 * The quote's age in ms — from the venue's own timestamp when it provides
 * one, else from the moment the reader performed the read.
 */
function quoteAgeMs(
  sourceTimestampMs: number | null,
  readAtMs: number
): number {
  const basis = sourceTimestampMs ?? readAtMs;
  return Math.max(0, readAtMs - basis);
}

export class GridAdmissionService {
  constructor(private deps: GridAdmissionDependencies) {}

  /**
   * Validate a prepared grid and compute the exposure it may be admitted for.
   *
   * THROWS `GridAdmissionRejectedError` for every failure — the caller must
   * never authorize execution on a rejected admission.
   */
  async admit(
    request: GridAdmissionRequest,
    estimate: GridEstimateReport
  ): Promise<GridAdmissionResult> {
    // 1. PROVENANCE — the estimate must be for this run and this
    //    preparation.
    if (estimate.botId !== request.botId) {
      throw new GridAdmissionRejectedError(
        "ESTIMATE_BOT_MISMATCH",
        `Estimate belongs to bot ${estimate.botId}, not ${request.botId}`
      );
    }
    if (estimate.runId !== request.runId) {
      throw new GridAdmissionRejectedError(
        "ESTIMATE_RUN_MISMATCH",
        `Estimate belongs to run ${estimate.runId}, not ${request.runId}`
      );
    }
    if (estimate.preparationVersion !== request.preparationVersion) {
      throw new GridAdmissionRejectedError(
        "ESTIMATE_SUPERSEDED",
        `Estimate is for preparation ${estimate.preparationVersion}, but the current preparation is ${request.preparationVersion}`
      );
    }

    // 2. CONSISTENCY — the engine's view of the config must match the
    //    persisted one.
    if (estimate.symbol !== request.symbol) {
      throw new GridAdmissionRejectedError(
        "ESTIMATE_SYMBOL_MISMATCH",
        `Estimate is for symbol ${estimate.symbol}, but the strategy persists ${request.symbol}`
      );
    }
    if (estimate.gridSize !== request.config.gridSize) {
      throw new GridAdmissionRejectedError(
        "ESTIMATE_GRID_SIZE_MISMATCH",
        `Estimate used gridSize ${estimate.gridSize}, but the strategy persists ${request.config.gridSize}`
      );
    }
    if (estimate.orderQuantity !== request.config.orderQuantity) {
      throw new GridAdmissionRejectedError(
        "ESTIMATE_ORDER_QUANTITY_MISMATCH",
        `Estimate used orderQuantity ${estimate.orderQuantity}, but the strategy persists ${request.config.orderQuantity}`
      );
    }

    // 3. PRICE — the backend's own, fresh, correctly-scoped quote.
    const quote = await this.readValidatedPrice(request);

    // The engine's price must reconcile with the backend's (they are sampled
    // at different instants, so a tolerance applies).
    if (
      !agreesWithin(
        estimate.priceUsed,
        quote.price,
        this.deps.policy.priceRelativeTolerance
      )
    ) {
      throw new GridAdmissionRejectedError(
        "ESTIMATE_PRICE_MISMATCH",
        `Engine priced the grid at ${estimate.priceUsed} but the venue now quotes ${quote.price} (tolerance ${this.deps.policy.priceRelativeTolerance})`
      );
    }

    // 4. RECOMPUTE — the authoritative exposure, from the persisted config
    //    and the BACKEND's price.
    const exposure = computeGridExposure(
      quote.price,
      quote.price,
      request.config
    );

    if (
      !agreesWithin(
        estimate.estimatedRestingNotional,
        exposure.estimatedRestingNotional,
        this.deps.policy.estimateRelativeTolerance
      )
    ) {
      throw new GridAdmissionRejectedError(
        "ESTIMATE_EXPOSURE_MISMATCH",
        `Engine estimated ${exposure.estimatedRestingNotional} of resting exposure but the backend computed ${exposure.estimatedRestingNotional} (tolerance ${this.deps.policy.estimateRelativeTolerance})`
      );
    }

    // 5. PER-ORDER — every eligible level's OWN notional against the cap.
    for (const level of exposure.buyLevels) {
      const verdict = this.deps.notionalPolicy.evaluateOrder(
        request.symbol,
        level.orderNotional
      );
      if (!verdict.allowed) {
        throw new GridAdmissionRejectedError(
          "ORDER_NOTIONAL_CAP_EXCEEDED",
          `Order at level ${level.index} (${level.price}) is $${level.orderNotional.toFixed(2)}, over the ${request.symbol} per-order cap of $${String(verdict.limit)}`
        );
      }
    }

    return {
      authorizedNotional: exposure.estimatedRestingNotional,
      price: quote.price,
      resolvedInstrument: quote.resolvedInstrument,
      buyLevelCount: exposure.buyLevels.length,
      maxOrderNotional: exposure.maxOrderNotional,
    };
  }

  /**
   * Read the backend's authoritative price and prove its freshness.
   *
   * A read that cannot be established, or a quote that is too old, fails the
   * admission — the engine's reported price is NEVER used as a fallback.
   */
  private async readValidatedPrice(request: GridAdmissionRequest): Promise<{
    price: number;
    resolvedInstrument: string;
  }> {
    let quote;
    try {
      quote = await this.deps.priceReader.readPrice({
        venue: request.venue,
        environment: request.environment,
        symbol: request.symbol,
      });
    } catch (error) {
      throw new GridAdmissionRejectedError(
        "PRICE_UNAVAILABLE",
        `Could not read a ${request.venue}/${request.environment} price for ${request.symbol}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    const ageMs = quoteAgeMs(quote.sourceTimestampMs, quote.readAtMs);
    if (ageMs > this.deps.policy.maxPriceAgeMs) {
      throw new GridAdmissionRejectedError(
        "PRICE_STALE",
        `The ${request.venue} price for ${request.symbol} is ${ageMs}ms old (budget ${this.deps.policy.maxPriceAgeMs}ms) — refusing to admit against a stale price`
      );
    }

    return {
      price: quote.price,
      resolvedInstrument: quote.resolvedInstrument,
    };
  }
}
