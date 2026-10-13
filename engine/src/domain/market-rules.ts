/** @format */

/**
 * Market-rules contract (Phase B).
 *
 * The engine must know the price tick size for the exact exchange market
 * before submitting live orders. Tick size is a decimal string at the API
 * boundary (`"0.05"`, `"0.01"`, `"1"`) — a JS number would introduce
 * floating-point error, and decimal places are NOT the same as tick size
 * (a market may allow 2 dp but require multiples of `0.05`).
 */

import { CommandError } from "../application/command-error";

/** Price rules for one exchange market. */
export interface MarketRules {
  /** Exchange discriminator (e.g. `lighter`, `kodiak`). */
  exchange: string;
  /** Venue symbol the rules were resolved for. */
  symbol: string;
  /** Price tick size as a decimal string. Must be > 0. */
  priceTickSize: string;
}

const TICK_RE = /^(\d+)(?:\.(\d+))?$/;

/** Strict tick-shape check shared by every adapter and the grid. */
export function isValidTickSizeString(raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  const trimmed = raw.trim();
  const match = TICK_RE.exec(trimmed);
  if (!match) return false;
  const digits = `${match[1]}${match[2] ?? ""}`.replace(/^0+(?=\d)/, "");
  const normalized = digits === "" ? "0" : digits;
  if (BigInt(normalized) <= 0n) return false;
  const scale = (match[2] ?? "").length;
  return scale <= 12;
}

/** Derive a tick string from integer price decimals (`2` -> `"0.01"`). */
export function tickSizeFromDecimals(priceDecimals: number): string {
  if (
    !Number.isInteger(priceDecimals) ||
    priceDecimals < 0 ||
    priceDecimals > 12
  ) {
    throw new CommandError(
      false,
      `Invalid price decimals ${JSON.stringify(priceDecimals)} (expected integer 0-12)`
    );
  }
  if (priceDecimals === 0) return "1";
  return `0.${"0".repeat(priceDecimals - 1)}1`;
}

/** Validate adapter-supplied rules. Throws CommandError (non-retryable). */
export function validateMarketRules(rules: unknown): MarketRules {
  const entry = (rules ?? {}) as Partial<MarketRules>;
  if (typeof entry.exchange !== "string" || !entry.exchange.trim()) {
    throw new CommandError(false, "Market rules missing exchange");
  }
  if (typeof entry.symbol !== "string" || !entry.symbol.trim()) {
    throw new CommandError(false, "Market rules missing symbol");
  }
  if (!isValidTickSizeString(entry.priceTickSize)) {
    throw new CommandError(
      false,
      `Invalid priceTickSize ${JSON.stringify((entry as Record<string, unknown>).priceTickSize)} for ${entry.exchange}:${entry.symbol} (no guessed precision)`
    );
  }
  return {
    exchange: entry.exchange,
    symbol: entry.symbol,
    priceTickSize: (entry.priceTickSize as string).trim(),
  };
}

interface RulesProvider {
  getMarketRules?: (symbol: string) => Promise<MarketRules>;
}

/**
 * Resolve rules for the exact market. Fails closed: a missing method, a
 * transport failure, or an invalid tick throws CommandError and the caller
 * must refuse init / refuse placement. Never falls back to 2 dp.
 */
export async function resolveMarketRules(
  exchange: RulesProvider,
  symbol: string,
  exchangeName = "exchange"
): Promise<MarketRules> {
  if (typeof exchange.getMarketRules !== "function") {
    throw new CommandError(
      false,
      `Market rules unavailable for ${exchangeName}:${symbol} (exchange provides no tick source; refusing to guess precision)`
    );
  }
  let rules: MarketRules;
  try {
    rules = await exchange.getMarketRules(symbol);
  } catch (error) {
    if (error instanceof CommandError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new CommandError(
      false,
      `Market rules unavailable for ${exchangeName}:${symbol}: ${detail}`
    );
  }
  return validateMarketRules(rules);
}

/**
 * Stable identity of a resolved rules set, for change detection at the order
 * boundary (Phase E). Encodes every field that affects how a price is
 * quantized or validated — today the tick size, on the venue's symbol. When
 * an offset-aware price filter is later modeled (a nonzero `priceOrigin`),
 * it must be appended here so a change in the origin is detected too.
 */
export function marketRulesFingerprint(rules: MarketRules): string {
  return `${rules.exchange}:${rules.symbol}:${rules.priceTickSize}`;
}

/**
 * True when two resolved rule sets are identical for pricing purposes. A
 * strategy pins its init-time rules; the order boundary re-resolves them and
 * uses this to freeze placements when the venue's rules have changed — even
 * when the new tick still accepts the strategy's existing prices (a tick that
 * shrank from `0.01` to `0.001` leaves `100.12` valid, but the grid was built
 * under the old rules and must not silently continue).
 */
export function marketRulesMatch(a: MarketRules, b: MarketRules): boolean {
  return marketRulesFingerprint(a) === marketRulesFingerprint(b);
}
