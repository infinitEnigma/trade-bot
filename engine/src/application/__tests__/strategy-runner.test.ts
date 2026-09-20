import { StrategyRunner } from "../strategy-runner";

describe("StrategyRunner", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("runs the tick handler on the configured interval", async () => {
    jest.useFakeTimers();

    const handler = jest.fn(() => Promise.resolve());
    const runner = new StrategyRunner("bot-1", 100, handler, {});
    runner.start();

    await jest.advanceTimersByTimeAsync(100);
    expect(handler).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(300);
    expect(handler).toHaveBeenCalledTimes(4);

    runner.stop();
  });

  it("never executes a tick while a previous tick is still running (single-flight)", async () => {
    jest.useFakeTimers();

    let running = 0;
    let maxRunning = 0;
    let ticks = 0;
    const releases: Array<() => void> = [];

    const slowHandler = (): Promise<void> => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      ticks += 1;
      return new Promise<void>(resolve => {
        releases.push(() => {
          running -= 1;
          resolve();
        });
      });
    };

    const onSkip = jest.fn();
    const runner = new StrategyRunner("bot-1", 100, slowHandler, { onSkip });
    runner.start();

    // Fire the first tick at t=100; it becomes long-running.
    await jest.advanceTimersByTimeAsync(100);
    expect(ticks).toBe(1);
    expect(runner.isTickRunning).toBe(true);

    // While the first tick is still in flight, a lot of wall-clock time
    // passes. The runner never arms a timer during a tick, so no second
    // tick can start and the tick can NEVER run concurrently with itself.
    await jest.advanceTimersByTimeAsync(1000);
    expect(ticks).toBe(1); // only the original tick ran
    expect(maxRunning).toBe(1); // never more than one concurrent tick
    expect(runner.isTickRunning).toBe(true);
    expect(onSkip).not.toHaveBeenCalled(); // structural single-flight: nothing to skip

    const release = releases.shift();
    expect(release).toBeDefined();
    release?.();
    await jest.advanceTimersByTimeAsync(0);

    // A fresh tick is now scheduled again (non-overlapping).
    await jest.advanceTimersByTimeAsync(100);
    expect(ticks).toBe(2);
    expect(maxRunning).toBe(1);

    const releaseSecond = releases.shift();
    expect(releaseSecond).toBeDefined();
    releaseSecond?.(); // let the second tick settle
    await jest.advanceTimersByTimeAsync(0);
    runner.stop();
  });

  it("surfaces tick errors through the onError callback without breaking the loop", async () => {
    jest.useFakeTimers();

    const onError = jest.fn();
    let calls = 0;
    const handler = jest.fn(() => {
      calls += 1;
      if (calls === 1) return Promise.reject(new Error("boom"));
      return Promise.resolve();
    });
    const runner = new StrategyRunner("bot-1", 100, handler, { onError });
    runner.start();

    await jest.advanceTimersByTimeAsync(100);
    expect(onError).toHaveBeenCalledWith(expect.any(Error), "bot-1");

    await jest.advanceTimersByTimeAsync(100);
    expect(handler).toHaveBeenCalledTimes(2);

    runner.stop();
  });
});
