/**
 * Strategy Runner
 *
 * Owns the non-overlapping, loaed strategy tick loop for a running bot.
 *
 * Guarantees a single-flight execution model: a slow `tick()` never runs
 * concurrently with the next scheduled tick. If a tick is still in flight when
 * the interval fires, the interval is re-armed (the tick is skipped) rather
 * than queued, so two exchanges calls can never overlap.
 *
 * This replaces the inline `setInterval`/`setTimeout` scheduler that formerly
 * lived inside `BotManager.doStartBot`, extracting it so the single-flight
 * invariant can be unit-tested in isolation.
 *
 * @format
 */

export interface StrategyRunnerOptions {
  onError?: (error: unknown, botId: string) => void;
  onSkip?: (botId: string) => void;
}

export class StrategyRunner {
  private tickRunning = false;
  private disposed = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private botId: string,
    private intervalMs: number,
    private tickHandler: () => Promise<void>,
    private options: StrategyRunnerOptions
  ) {}

  /** Start the periodic loop. Safe to call once; subsequent calls are no-ops. */
  start(): void {
    if (this.disposed) return;
    this.schedule();
  }

  /** Stop the loop and clear any pending timer. */
  stop(): void {
    this.disposed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** True while a tick is currently in flight. */
  get isTickRunning(): boolean {
    return this.tickRunning;
  }

  private schedule(): void {
    if (this.disposed) return;
    this.timer = setTimeout(() => void this.runTick(), this.intervalMs);
  }

  private async runTick(): Promise<void> {
    if (this.disposed) return;

    // Single-flight guard: never overlap the previous (still running) tick.
    if (this.tickRunning) {
      this.options.onSkip?.(this.botId);
      this.schedule();
      return;
    }

    this.tickRunning = true;
    try {
      await this.tickHandler();
    } catch (error) {
      this.options.onError?.(error, this.botId);
    } finally {
      this.tickRunning = false;
    }

    // Continue the loop. If stop() was called during the tick, disposed is
    // now true and schedule() no-ops.
    this.schedule();
  }
}
