import { ClientOrderIdGenerator } from "../client-order-id";

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
  });
});
