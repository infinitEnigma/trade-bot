import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import {
  loadGridSnapshot,
  loadGridSnapshotResult,
  saveGridSnapshot,
  getSnapshotDir,
} from "../../infrastructure/state/grid-state";
import { GridSnapshot } from "../grid-snapshot";

let tmpDir: string;

/** Point GRID_SNAPSHOT_DIR at a fresh temp dir for each test. */
function useTempDir(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "grid-snap-"));
  process.env.GRID_SNAPSHOT_DIR = tmpDir;
  return tmpDir;
}

function validSnapshot(botId = "bot-1"): GridSnapshot {
  return {
    version: 1,
    botId,
    symbol: "PERP_BTC_USDC",
    gridSize: 4,
    gridRangePercent: 5,
    baselinePrice: 100,
    levels: [
      { price: 95, filled: false, buyOrderId: "b1" },
      { price: 100, filled: true },
      { price: 105, filled: false, sellOrderId: "s1" },
    ],
    savedAt: new Date().toISOString(),
  };
}

describe("grid-snapshot state persistence", () => {
  afterEach(() => {
    delete process.env.GRID_SNAPSHOT_DIR;
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns null when no snapshot exists", () => {
    useTempDir();
    expect(loadGridSnapshot("bot-1")).toBeNull();
  });

  it("resolves the configured snapshot directory", () => {
    expect(getSnapshotDir()).toContain(".grid-snapshots");
    useTempDir();
    expect(getSnapshotDir()).toBe(tmpDir);
  });

  it("round-trips a snapshot through save then load", async () => {
    useTempDir();
    const snapshot = validSnapshot();
    await saveGridSnapshot(snapshot);

    const loaded = loadGridSnapshot("bot-1");
    expect(loaded).not.toBeNull();
    expect(loaded?.botId).toBe("bot-1");
    expect(loaded?.baselinePrice).toBe(100);
    expect(loaded?.levels).toHaveLength(3);
    expect(loaded?.levels[0].buyOrderId).toBe("b1");
    expect(loaded?.levels[1].filled).toBe(true);
  });

  it("rejects a snapshot whose version is unknown", async () => {
    useTempDir();
    const file = path.join(tmpDir, "bot-1.json");
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({ ...validSnapshot(), version: 999 }),
      "utf-8"
    );
    expect(loadGridSnapshot("bot-1")).toBeNull();
  });

  it("rejects a snapshot whose botId does not match the requested botId", async () => {
    useTempDir();
    const file = path.join(tmpDir, "bot-1.json");
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(validSnapshot("other-bot")), "utf-8");
    expect(loadGridSnapshot("bot-1")).toBeNull();
  });

  it("rejects a malformed / partial snapshot", async () => {
    useTempDir();
    const file = path.join(tmpDir, "bot-1.json");
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({ version: 1, botId: "bot-1" }),
      "utf-8"
    );
    expect(loadGridSnapshot("bot-1")).toBeNull();
  });

  it("does not throw when the directory cannot be created (logs instead)", async () => {
    // Point at a path nested under a file to force mkdir failure.
    const file = path.join(useTempDir(), "notadir.json");
    fs.writeFileSync(file, "x", "utf-8");
    process.env.GRID_SNAPSHOT_DIR = file;

    await expect(saveGridSnapshot(validSnapshot())).resolves.toBeUndefined();
  });

  describe("durability (Phase 3)", () => {
    it("reports MISSING (not CORRUPT) when no snapshot exists", () => {
      useTempDir();
      expect(loadGridSnapshotResult("bot-1")).toEqual({ status: "MISSING" });
    });

    it("writes a checksum and leaves no temp file behind", async () => {
      useTempDir();
      await saveGridSnapshot(validSnapshot());

      const onDisk = JSON.parse(
        fs.readFileSync(path.join(tmpDir, "bot-1.json"), "utf-8")
      );
      expect(typeof onDisk.checksum).toBe("string");
      expect(onDisk.checksum).toHaveLength(64);

      const leftovers = fs.readdirSync(tmpDir).filter(f => f.endsWith(".tmp"));
      expect(leftovers).toEqual([]);
      // A clean round-trip still validates.
      expect(loadGridSnapshotResult("bot-1").status).toBe("OK");
    });

    it("recovers the previous version when the current file is corrupt", async () => {
      useTempDir();
      const first = { ...validSnapshot(), baselinePrice: 100 };
      const second = { ...validSnapshot(), baselinePrice: 200 };
      await saveGridSnapshot(first);
      await saveGridSnapshot(second);

      // Corrupt the live file; the previous version (baseline 100) survives.
      fs.writeFileSync(
        path.join(tmpDir, "bot-1.json"),
        "{half-written",
        "utf-8"
      );

      const result = loadGridSnapshotResult("bot-1");
      expect(result.status).toBe("OK");
      if (result.status === "OK") {
        expect(result.snapshot.baselinePrice).toBe(100);
      }
    });

    it("reports CORRUPT when both the current and previous files are corrupt", async () => {
      useTempDir();
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "bot-1.json"), "not json", "utf-8");
      fs.writeFileSync(
        path.join(tmpDir, "bot-1.json.prev"),
        "also bad",
        "utf-8"
      );
      expect(loadGridSnapshotResult("bot-1").status).toBe("CORRUPT");
    });

    it("rejects a checksum mismatch", async () => {
      useTempDir();
      await saveGridSnapshot(validSnapshot());
      const file = path.join(tmpDir, "bot-1.json");
      const tampered = JSON.parse(fs.readFileSync(file, "utf-8"));
      // Change the payload but keep the original checksum.
      tampered.baselinePrice = 999;
      fs.writeFileSync(file, JSON.stringify(tampered), "utf-8");
      expect(loadGridSnapshotResult("bot-1").status).toBe("CORRUPT");
    });

    it("rejects a snapshot with an invalid level entry", () => {
      useTempDir();
      fs.mkdirSync(tmpDir, { recursive: true });
      const bad = {
        ...validSnapshot(),
        levels: [{ price: "not-a-number", filled: false }],
      };
      fs.writeFileSync(
        path.join(tmpDir, "bot-1.json"),
        JSON.stringify(bad),
        "utf-8"
      );
      expect(loadGridSnapshotResult("bot-1").status).toBe("CORRUPT");
    });
  });

  // D3 sessions: per-run layout + legacy migration-on-read.
  describe("sessions (D3)", () => {
    it("round-trips a run snapshot through the per-run path", async () => {
      useTempDir();
      await saveGridSnapshot({ ...validSnapshot(), runId: "run-1" });

      expect(
        fs.existsSync(path.join(tmpDir, "bot-1", "run-1.json"))
      ).toBe(true);
      const loaded = loadGridSnapshot("bot-1", "run-1");
      expect(loaded?.runId).toBe("run-1");
      expect(loaded?.baselinePrice).toBe(100);
    });

    it("keeps two runs' snapshots independent", async () => {
      useTempDir();
      await saveGridSnapshot({
        ...validSnapshot(),
        runId: "run-1",
        baselinePrice: 100,
      });
      await saveGridSnapshot({
        ...validSnapshot(),
        runId: "run-2",
        baselinePrice: 200,
      });

      expect(loadGridSnapshot("bot-1", "run-1")?.baselinePrice).toBe(100);
      expect(loadGridSnapshot("bot-1", "run-2")?.baselinePrice).toBe(200);
    });

    it("migrates a legacy flat snapshot on read (migration-on-read)", async () => {
      useTempDir();
      await saveGridSnapshot(validSnapshot());

      const result = loadGridSnapshotResult("bot-1", "run-1");
      expect(result.status).toBe("OK");
      if (result.status === "OK") {
        expect(result.migratedFromLegacy).toBe(true);
        expect(result.snapshot.baselinePrice).toBe(100);
      }
    });

    it("reports MISSING for a run with no snapshot anywhere", () => {
      useTempDir();
      expect(loadGridSnapshotResult("bot-1", "run-9")).toEqual({
        status: "MISSING",
      });
    });
  });
});
