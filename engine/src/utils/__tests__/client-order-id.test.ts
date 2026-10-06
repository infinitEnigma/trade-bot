import {
  ClientOrderIdGenerator,
  CLIENT_ORDER_ID_MAX_GENERATION,
} from "../client-order-id";

const UUID = "8f14e45f-ceea-467f-abf5-ee02d76df6b2"; // 36-char bot id

describe("ClientOrderIdGenerator", () => {
  const gen = (botId: string) => new ClientOrderIdGenerator(botId);

  it("produces the same id for the same bot/level/side (restart-stable)", () => {
    expect(gen(UUID).generate(0, "BUY")).toBe(gen(UUID).generate(0, "BUY"));
    expect(gen("short-bot").generate(3, "SELL")).toBe(
      gen("short-bot").generate(3, "SELL")
    );
  });

  it("produces different ids for different bots / levels / sides", () => {
    const a = gen(UUID);
    expect(a.generate(0, "BUY")).not.toBe(a.generate(1, "BUY"));
    expect(a.generate(0, "BUY")).not.toBe(a.generate(0, "SELL"));

    const b = gen("8f14e45f-ceea-467f-abf5-ee02d76df6b3");
    expect(a.generate(0, "BUY")).not.toBe(b.generate(0, "BUY"));
  });

  it("always satisfies the exchange's client_order_id contract", () => {
    const generator = gen(UUID);
    for (let level = 0; level < 40; level++) {
      for (const side of ["BUY", "SELL"] as const) {
        const id = generator.generate(level, side);
        expect(id.length).toBeLessThanOrEqual(36);
        expect(id).toMatch(/^[A-Za-z0-9][A-Za-z0-9-]*$/); // no ':', hyphen not first
        expect(id).not.toContain(":");
      }
    }
  });

  it("keeps the documented format: botKey-level-side", () => {
    // "bot-1" is 5 chars — short enough to be used verbatim (hyphens stripped).
    expect(new ClientOrderIdGenerator("bot-1").generate(0, "BUY")).toBe(
      "bot1-00-B"
    );
    // A UUID is longer than the bot-key budget, so it hashes down to the
    // 30-char bot-key segment.
    expect(gen(UUID).generate(0, "BUY")).toMatch(/^[0-9a-f]{30}-00-B$/);
  });

  it("rejects invalid construction inputs", () => {
    expect(() => new ClientOrderIdGenerator("")).toThrow(/botId/);
    expect(() => gen(UUID).generate(-1, "BUY")).toThrow(/levelIndex/);
    expect(() => gen(UUID).generate(1.5, "BUY")).toThrow(/levelIndex/);
    expect(() => gen(UUID).generate(0, "BUY", -1)).toThrow(/generation/);
    expect(() => gen(UUID).generate(0, "BUY", 1.5)).toThrow(/generation/);
    expect(() =>
      gen(UUID).generate(0, "BUY", CLIENT_ORDER_ID_MAX_GENERATION + 1)
    ).toThrow(/generation/);
  });

  describe("slot generations (G1)", () => {
    it("renders generation 0 byte-identical to the legacy format", () => {
      // Ids already live on an exchange must keep resolving after an upgrade.
      expect(gen(UUID).generate(5, "SELL", 0)).toBe(
        gen(UUID).generate(5, "SELL")
      );
      expect(gen(UUID).generate(5, "SELL", 0)).toMatch(/^[0-9a-f]{30}-05-S$/);
      expect(new ClientOrderIdGenerator("bot-1").generate(0, "BUY", 0)).toBe(
        "bot1-00-B"
      );
    });

    it("derives a fresh distinct id per generation (fresh venue index)", () => {
      const g = gen(UUID);
      const seen = new Set<string>();
      for (let generation = 0; generation <= 40; generation++) {
        seen.add(g.generate(7, "BUY", generation));
      }
      expect(seen.size).toBe(41);
      expect(g.generate(7, "BUY", 1)).not.toBe(g.generate(7, "BUY", 0));
      // Deterministic across restarts (lost-response adoption depends on it).
      expect(gen(UUID).generate(7, "BUY", 1)).toBe(g.generate(7, "BUY", 1));
      // One side's generation never disturbs the other side's id.
      expect(g.generate(7, "SELL", 0)).not.toBe(g.generate(7, "BUY", 1));
    });

    it("keeps every generation inside the 36-char exchange contract", () => {
      const generator = gen(UUID);
      const generations = [
        0,
        1,
        35,
        36,
        1295,
        1296,
        46655,
        CLIENT_ORDER_ID_MAX_GENERATION,
      ];
      for (const generation of generations) {
        for (const side of ["BUY", "SELL"] as const) {
          const id = generator.generate(1295, side, generation);
          expect(id.length).toBeLessThanOrEqual(36);
          expect(id).toMatch(/^[A-Za-z0-9][A-Za-z0-9-]*$/);
          expect(id).not.toContain(":");
        }
      }
      expect(() =>
        generator.generate(0, "BUY", CLIENT_ORDER_ID_MAX_GENERATION)
      ).not.toThrow();
    });
  });

  // D3 sessions: per-run namespace.
  describe("run namespace (D3)", () => {
    const runGen = (botId: string, runId: string) =>
      new ClientOrderIdGenerator(botId, runId);

    it("keeps legacy ids byte-identical without a run", () => {
      expect(runGen("bot-1", "").generate(0, "BUY")).toBe("bot1-00-B");
      expect(gen(UUID).generate(0, "BUY")).toBe(
        new ClientOrderIdGenerator(UUID).generate(0, "BUY")
      );
    });

    it("isolates two runs in one session", () => {
      const a = runGen(UUID, "run-a").generate(0, "BUY");
      const b = runGen(UUID, "run-b").generate(0, "BUY");
      expect(a).not.toBe(b);
      // Restart-stable within the run.
      expect(runGen(UUID, "run-a").generate(0, "BUY")).toBe(a);
    });

    it("keeps run ids inside the 36-char exchange contract", () => {
      const generator = runGen(UUID, "run-1");
      for (let level = 0; level < 40; level++) {
        for (const side of ["BUY", "SELL"] as const) {
          const id = generator.generate(level, side);
          expect(id.length).toBeLessThanOrEqual(36);
          expect(id).toMatch(/^[A-Za-z0-9][A-Za-z0-9-]*$/);
        }
      }
    });
  });
});
