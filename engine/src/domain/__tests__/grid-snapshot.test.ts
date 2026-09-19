import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import {
  loadGridSnapshot,
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
});