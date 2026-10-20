/**
 * Lifecycle persistence PORT — the contract BotLifecycleService, the command
 * dispatcher, the event processor, the reconciler, and StrategyService's
 * guarded update all depend on.
 *
 * The PostgreSQL implementation lives in
 * `infrastructure/adapters/repositories/bot-lifecycle-repository.adapter.ts`;
 * core never imports it (dependency inversion — external review P1,
 * 2026-10-15). Wiring happens at startup (index.ts
 * `setLifecycleRepository`, beside `setSessionCapProvider`), fail-fast when
 * unwired so a missing adapter can never no-op a lifecycle write.
 *
 * @format
 */

import type { BotActualState } from "@trade-bot/shared";
import {
  BotRow,
  LifecycleEventInput,
  LifecycleEventRow,
  PersistTransitionInput,
  StrategyRunRow,
  TrackedCommandRow,
} from "./types";

/**
 * Opaque transaction handle. The infrastructure adapter casts this to the
 * concrete `pg` PoolClient; core only ever passes it back into port methods,
 * so no `pg` type leaks inward.
 */
declare const LifecycleTxBrand: unique symbol;
export interface LifecycleTx {
  readonly [LifecycleTxBrand]: true;
}

/**
 * F1 notional admission: thrown by the cap-guarded attach when residual
 * capacity is exceeded — `existingExposure + pendingSum + incoming`
 * (recalculated under the session row lock) exceeds the cap. Carries the
 * breakdown so the service can build a 409 ops can act on; the enclosing
 * transaction has already rolled back, so no run row is written.
 *
 * Domain error (lives in core): the adapter throws it, the service catches it
 * and maps it to HTTP 409.
 */
export class RunNotionalCapExceededError extends Error {
  constructor(
    public readonly existingExposure: number,
    public readonly pendingSum: number,
    public readonly incoming: number,
    public readonly cap: number
  ) {
    super(
      `Session cap exceeded: venue exposure $${existingExposure} + pending runs $${pendingSum} + new $${incoming} = $${
        existingExposure + pendingSum + incoming
      } exceeds the account cap $${cap} (balance × leverage).`
    );
    this.name = "RunNotionalCapExceededError";
  }
}

/** Strategy venue + symbol + config snapshot (admission / guarded edit). */
export interface StrategyVenueRow {
  exchange: string | null;
  environment: string | null;
  symbol: string;
  config: Record<string, unknown>;
}

/** Edit-blocker answer for venue/symbol changes (026). */
export interface EditBlockers {
  blocked: boolean;
  reason: string;
}

export interface ResidualAbandonContext { id:string; user_id:string; exchange_account_id:string|null; actual_state:string; force_stop_reason:string|null; residual_abandoned_at:string|null; run_symbols:string[]; }

export interface ILifecycleRepository {
  // --- session reads / CAS writes ---
  findBot(botId: string): Promise<BotRow | null>;
  persistTransition(
    botId: string,
    input: PersistTransitionInput,
    expectedActualState?: BotActualState
  ): Promise<boolean>;
  /** Atomically lock the bound account and persist STOPPED plus its cleanup marker. */
  persistStopTx(botId: string, input: PersistTransitionInput, expectedActualState: BotActualState, forceStopReason?: string): Promise<boolean>;
  updateStatus(botId: string, status: string): Promise<void>;
  recordForceStopReason(botId: string, reason: string): Promise<void>;
  insertBotInstance(
    strategyId: string,
    userId: string,
    exchangeAccountId: string
  ): Promise<string>;

  // --- audit trail ---
  recordLifecycleEvent(
    botId: string,
    input: LifecycleEventInput
  ): Promise<void>;
  recordLifecycleEventTx(
    tx: LifecycleTx,
    botId: string,
    input: LifecycleEventInput
  ): Promise<void>;
  findLatestLifecycleEvent(botId: string): Promise<LifecycleEventRow | null>;
  // --- command tracking ---
  recordPendingCommand(
    botId: string,
    correlationId: string,
    commandType: string
  ): Promise<void>;
  resolveCommand(
    correlationId: string,
    state: "ACCEPTED" | "FAILED",
    errorCode?: string,
    errorMessage?: string
  ): Promise<void>;
  findTrackedCommand(
    correlationId: string
  ): Promise<{ bot_id: string; state: string } | null>;
  findExpiredPendingCommands(): Promise<TrackedCommandRow[]>;
  claimTimedOutCommand(correlationId: string): Promise<boolean>;

  // --- supervision sweeps ---
  findRunningBotsForEngine(engineId: string): Promise<BotRow[]>;
  findBotsByIds(botIds: string[]): Promise<BotRow[]>;
  findDesiredStoppedButActiveBots(): Promise<BotRow[]>;
  findStuckTransitionalBots(graceSeconds: number): Promise<BotRow[]>;
  findDesiredRunningUnconfirmedBots(): Promise<BotRow[]>;
  countRecentStopReissues(botId: string): Promise<number>;

  // --- strategy / venue admission reads ---
  findStrategyConfig(strategyId: string): Promise<Record<string, unknown>>;
  findStrategyVenue(strategyId: string): Promise<StrategyVenueRow>;
  strategyExistsForUser(strategyId: string, userId: string): Promise<boolean>;
  findActiveBotForStrategy(strategyId: string): Promise<{ id: string } | null>;
  // --- transactional composition (create / attach / guarded edit) ---
  inTransaction<T>(fn: (tx: LifecycleTx) => Promise<T>): Promise<T>;
  lockStrategyRow(
    tx: LifecycleTx,
    strategyId: string
  ): Promise<StrategyVenueRow | null>;
  /**
   * Lock the exchange_accounts row (FOR UPDATE) inside the caller's tx.
   *
   * The account is the cap grain, so every path that admits a run must
   * serialize here BEFORE it reads the live-session guard or the pending
   * sum. Lock order everywhere: strategies → exchange_accounts →
   * bot_instances (the session row). Re-issuing this lock later in the
   * same tx (e.g. attachRunWithCapGuardTx) is an idempotent no-op.
   */
  lockAccountRowTx(tx: LifecycleTx, exchangeAccountId: string): Promise<void>;
  findLiveRunForStrategyTx(
    tx: LifecycleTx,
    strategyId: string
  ): Promise<StrategyRunRow | null>;
  findLiveSessionForAccountTx(
    tx: LifecycleTx,
    exchangeAccountId: string
  ): Promise<{ id: string } | null>;
  /** Must be called after lockAccountRowTx; detects unresolved venue exposure. */
  findUnresolvedExposureTx(tx: LifecycleTx, exchangeAccountId: string): Promise<{ id: string } | null>;
  findResidualAbandonContextTx(tx: LifecycleTx, botId: string, userId: string): Promise<ResidualAbandonContext | null>;
  completeResidualAbandonTx(tx: LifecycleTx, botId: string, userId: string, input: { reason:string; quantity:string; symbol:string; operator:string; forceStopReason:string }): Promise<void>;
  findEditBlockersTx(
    tx: LifecycleTx,
    strategyId: string
  ): Promise<EditBlockers>;
  insertBotInstanceTx(
    tx: LifecycleTx,
    userId: string,
    exchangeAccountId: string
  ): Promise<string>;

  /**
   * THE single run-insert path (Arch-3): cap-guarded attach with
   * ACCOUNT-level serialization (F1). Both createAndStart (boot run) and
   * attachStrategyRun funnel here — the unguarded attach twins
   * (attachRun/attachRunTx/attachRunWithCapGuard) are removed so no path
   * can insert a run outside the locking protocol.
   *
   * Locks the exchange_accounts row (FOR UPDATE) so concurrent admits on
   * different sessions bound to the same account serialize here, then
   * recalculates the pending run sum SCOPED TO THE ACCOUNT (all bots on the
   * account, not just this bot) before enforcing
   * `existingExposure + pendingSum + notionalAmount <= cap`.
   *
   * `cap` and `existingExposure` are resolved by the caller OUTSIDE this
   * transaction (venue balance + positions must not hold a DB lock across
   * network I/O); only the pending sum is re-read authoritatively under the
   * lock. Live RUNNING runs are excluded — their filled notional is already
   * inside `existingExposure`.
   */
  attachRunWithCapGuardTx(
    tx: LifecycleTx,
    botId: string,
    strategyId: string,
    config: Record<string, unknown>,
    notionalAmount: number,
    cap: number,
    existingExposure: number,
    exchangeAccountId: string
  ): Promise<string>;

  // --- runs ---
  getRunsForBot(botId: string): Promise<StrategyRunRow[]>;
  findRun(runId: string): Promise<StrategyRunRow | null>;
  findLiveRunForStrategy(strategyId: string): Promise<StrategyRunRow | null>;
  findLiveSessionForAccount(
    exchangeAccountId: string
  ): Promise<{ id: string } | null>;
  setRunState(
    runId: string,
    to: string,
    expectedFrom?: string,
    errorCode?: string | null
  ): Promise<boolean>;
  /**
   * Σ notional over the ACCOUNT's pending runs (STOPPED + STARTING) — the
   * grain the cap invariant is stated at. Session-grain sums (the pre-Arch-3
   * `sumPendingRunNotional(botId)`) drop the pending runs of every OTHER
   * session on the account and are therefore not admission-safe.
   */
  sumPendingRunNotionalForAccount(exchangeAccountId: string): Promise<number>;
  detachRun(runId: string): Promise<boolean>;
}
