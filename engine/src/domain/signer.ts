/** @format */

/**
 * Transaction-signer domain contract (workstream B2).
 *
 * Some venues (Lighter) have no TypeScript signing SDK, so order
 * create/cancel transactions are signed by the stateless
 * `sidecar/lighter-signer` service. This interface is the engine's
 * venue-agnostic view of that capability: credentials travel per request
 * (never stored by the sidecar), and failures are typed so callers can map
 * them onto the reconciliation vocabulary — unreachable sidecar ⇒
 * `UNREACHABLE` (freeze the slot), rejected transaction ⇒ `CommandError`
 * (business outcome).
 *
 * Guardrail (EXCHANGE_INTEGRATION_PLAN.md §0): this module names no venue.
 * The Lighter specifics (endpoint paths, snake_case bodies) live in
 * `infrastructure/signer/lighter-sidecar.ts` only.
 */

/** Per-request signing credentials. Held in memory only, never logged. */
export interface SignerCredentials {
  accountIndex: number;
  apiKeyIndex: number;
  privateKey: string;
  /** Venue environment the credentials are valid for. */
  env: "testnet" | "mainnet";
}

/** Order to sign and submit through the sidecar. */
export interface SignOrderRequest {
  marketIndex: number;
  clientOrderIndex: number;
  /** Scaled integer using the market's size decimals (sidecar does no math). */
  baseAmount: number;
  /** Scaled integer using the market's price decimals. */
  price: number;
  isAsk: boolean;
  /** 0 LIMIT, 1 MARKET. */
  orderType?: number;
  /** Lighter SDK: 0 IOC, 1 GTT, 2 post-only. Resting orders must use GTT. */
  timeInForce?: number;
  reduceOnly?: boolean;
  triggerPrice?: number;
  /** -1 = sidecar default (28d/GTT). */
  orderExpiry?: number;
}

/** Cancellation to sign and submit through the sidecar. */
export interface SignCancelRequest {
  marketIndex: number;
  /** The order's client order index (the identifier cancel takes). */
  orderIndex: number;
}

/**
 * Base signer failure: the sidecar was reached but refused or failed the
 * operation (bad credentials, rejected transaction, misconfiguration).
 * A business outcome — the caller must NOT retry blindly.
 */
export class SignerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignerError";
  }
}

/**
 * The sidecar could not be asked at all (connection refused, timeout, 5xx).
 * The transaction outcome is unknown — the caller must treat the slot as
 * `UNREACHABLE` (freeze, never recreate) rather than as absent.
 */
export class SignerUnreachableError extends SignerError {
  constructor(message: string) {
    super(message);
    this.name = "SignerUnreachableError";
  }
}

/**
 * Venue-agnostic transaction signer. Implementations are thin HTTP clients
 * over a signing sidecar; all venue specifics stay in infrastructure.
 */
export interface TransactionSigner {
  /**
   * Sign and submit a create-order transaction.
   *
   * @throws SignerUnreachableError when the sidecar could not be asked.
   * @throws SignerError when the sidecar refused or failed the operation.
   */
  createOrder(
    credentials: SignerCredentials,
    request: SignOrderRequest
  ): Promise<{ txHash: string; clientOrderIndex: number }>;

  /**
   * Sign and submit a cancel-order transaction.
   *
   * @throws SignerUnreachableError when the sidecar could not be asked.
   * @throws SignerError when the sidecar refused or failed the operation.
   */
  cancelOrder(
    credentials: SignerCredentials,
    request: SignCancelRequest
  ): Promise<{ txHash: string; orderIndex: number }>;

  /**
   * Mint a short-lived auth token for venue REST reads.
   *
   * @throws SignerUnreachableError when the sidecar could not be asked.
   * @throws SignerError when the sidecar refused or failed the operation.
   */
  authToken(
    credentials: SignerCredentials,
    deadlineSeconds?: number
  ): Promise<string>;

  /** Health probe. Never throws — `false` means unreachable. */
  isReachable(): Promise<boolean>;
}
