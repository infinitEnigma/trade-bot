/** @format */

/**
 * Exchange-aware price quantization (Phase B/C).
 *
 * One shared engine utility — no scattered rounding. All math is on scaled
 * integers (bigint), never binary float modulo, so a tick like `0.05`
 * (two decimals but only even multiples) is enforced correctly.
 */

export type PriceRounding = "down" | "up" | "nearest";

interface DecimalParts {
  intValue: bigint;
  scale: number;
}

const DECIMAL_RE = /^(\d+)(?:\.(\d+))?$/;

function parseDecimalStrict(raw: string, label: string): DecimalParts {
  const trimmed = String(raw ?? "").trim();
  const match = DECIMAL_RE.exec(trimmed);
  if (!match) {
    throw new Error(
      `${label} must be a decimal string (got ${JSON.stringify(raw)})`
    );
  }
  const intPart = match[1] as string;
  const fracPart = (match[2] ?? "") as string;
  const scale = fracPart.length;
  const digits = `${intPart}${fracPart}`.replace(/^0+(?=\d)/, "");
  return { intValue: BigInt(digits === "" ? "0" : digits), scale };
}

function pow10(n: number): bigint {
  return 10n ** BigInt(n);
}

/**
 * Convert a JS number into a clean decimal string (up to 12 dp), washing
 * binary float noise (`100.0499999999` reads as `100.05`).
 */
export function numberToDecimalString(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`price must be a finite number (got ${String(value)})`);
  }
  if (Number.isInteger(value)) return String(value);
  const fixed = value.toFixed(12);
  return fixed.replace(/0+$/, "").replace(/\.$/, "");
}

function formatScaled(value: bigint, scale: number): string {
  if (scale === 0) return value.toString();
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const digits = abs.toString().padStart(scale + 1, "0");
  const intPart = digits.slice(0, digits.length - scale);
  const fracPart = digits.slice(digits.length - scale);
  return `${negative ? "-" : ""}${intPart}.${fracPart}`;
}

/**
 * Quantize a decimal price string to a multiple of `tickSize`.
 * Rounding is explicit — no default. Never falls back to 2 dp.
 * Returns canonical form at the tick's scale (tick `0.05` -> `"100.00"`).
 */
export function quantizePrice(
  price: string,
  tickSize: string,
  rounding: PriceRounding
): string {
  if (rounding !== "down" && rounding !== "up" && rounding !== "nearest") {
    throw new Error(
      `rounding must be "down" | "up" | "nearest" (got ${JSON.stringify(rounding)})`
    );
  }
  const p = parseDecimalStrict(price, "price");
  if (p.intValue <= 0n) {
    throw new Error(
      `price must be a positive decimal (got ${JSON.stringify(price)})`
    );
  }
  const t = parseDecimalStrict(tickSize, "priceTickSize");
  if (t.intValue <= 0n) {
    throw new Error(
      `priceTickSize must be a positive non-zero decimal (got ${JSON.stringify(tickSize)})`
    );
  }
  if (t.scale > 12) {
    throw new Error(
      `priceTickSize has excessive precision (got ${JSON.stringify(tickSize)})`
    );
  }
  const common = Math.max(p.scale, t.scale);
  const priceInt = p.intValue * pow10(common - p.scale);
  const tickInt = t.intValue * pow10(common - t.scale);
  const q = priceInt / tickInt;
  const r = priceInt % tickInt;
  let steps: bigint;
  if (r === 0n) steps = q;
  else if (rounding === "down") steps = q;
  else if (rounding === "up") steps = q + 1n;
  else steps = r * 2n >= tickInt ? q + 1n : q;
  if (steps <= 0n) {
    throw new Error(
      `quantized price is non-positive (price ${JSON.stringify(price)} rounding ${rounding} tick ${JSON.stringify(tickSize)})`
    );
  }
  const resultInt = (steps * tickInt) / pow10(common - t.scale);
  return formatScaled(resultInt, t.scale);
}

/** Number wrapper for grid internals (washes float noise first). */
export function quantizePriceNumber(
  price: number,
  tickSize: string,
  rounding: PriceRounding
): number {
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(
      `price must be a finite positive number (got ${String(price)})`
    );
  }
  return Number(
    quantizePrice(numberToDecimalString(price), tickSize, rounding)
  );
}

/** Integer-modulo tick check — never float `%`. */
export function isTickMultiple(
  price: string | number,
  tickSize: string
): boolean {
  const priceStr =
    typeof price === "number" ? numberToDecimalString(price) : price;
  const p = parseDecimalStrict(priceStr, "price");
  const t = parseDecimalStrict(tickSize, "priceTickSize");
  if (p.intValue <= 0n || t.intValue <= 0n) return false;
  const common = Math.max(p.scale, t.scale);
  const priceInt = p.intValue * pow10(common - p.scale);
  const tickInt = t.intValue * pow10(common - t.scale);
  if (tickInt === 0n) return false;
  return priceInt % tickInt === 0n;
}

/** Strict submission-boundary validator: returns canonical string or throws. */
export function assertTickValid(
  price: string | number,
  tickSize: string
): string {
  const priceStr =
    typeof price === "number" ? numberToDecimalString(price) : price;
  parseDecimalStrict(priceStr, "price");
  if (!isTickMultiple(priceStr, tickSize)) {
    throw new Error(
      `price ${JSON.stringify(priceStr)} is not a multiple of tick ${JSON.stringify(tickSize)}`
    );
  }
  return priceStr;
}
