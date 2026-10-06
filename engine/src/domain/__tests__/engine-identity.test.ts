/** @format */

/**
 * Engine identity loader — exchange-agnostic rebrand (migration
 * 020_rename_engine_identity.sql). A persisted `kodiak-engine-<suffix>` must
 * migrate in place to `trading-engine-<suffix>` (same suffix, DB rows renamed
 * in lockstep) and restart the epoch, because the swapped prefix is a new
 * identity for the (engineId, epoch) staleness guard.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

describe("loadOrCreateEngineIdentity (020 prefix migration)", () => {
  let stateDir: string;
  let stateFile: string;

  beforeEach(() => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "engine-identity-"));
    stateFile = path.join(stateDir, ".engine-state.json");
    process.env.ENGINE_STATE_FILE = stateFile;
    delete process.env.ENGINE_ID;
    jest.resetModules();
  });

  afterEach(() => {
    delete process.env.ENGINE_STATE_FILE;
    delete process.env.ENGINE_ID;
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const load = (): any => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("../engine-identity").loadOrCreateEngineIdentity();
  };

  it("migrates a persisted kodiak-engine id in place and resets the epoch", () => {
    fs.writeFileSync(
      stateFile,
      JSON.stringify({ engineId: "kodiak-engine-ae3a82ee", epoch: 58 })
    );

    const identity = load();

    expect(identity.engineId).toBe("trading-engine-ae3a82ee");
    // Old epoch dropped with the old prefix: the renamed identity restarts at
    // 1, which the 020 migration's `epoch = 0` registry rows accept.
    expect(identity.epoch).toBe(1);
    // The rewritten state file must persist the migrated id, or the next
    // restart would migrate again from scratch and reset the epoch again.
    const saved = JSON.parse(fs.readFileSync(stateFile, "utf-8"));
    expect(saved).toEqual({ engineId: "trading-engine-ae3a82ee", epoch: 1 });
  });

  it("keeps an already-migrated id and increments its epoch", () => {
    fs.writeFileSync(
      stateFile,
      JSON.stringify({ engineId: "trading-engine-abc12345", epoch: 4 })
    );

    const identity = load();

    expect(identity.engineId).toBe("trading-engine-abc12345");
    expect(identity.epoch).toBe(5);
  });

  it("migrates a legacy ENGINE_ID env override too", () => {
    process.env.ENGINE_ID = "kodiak-engine-fromenv";

    const identity = load();

    expect(identity.engineId).toBe("trading-engine-fromenv");
  });

  it("mints a trading-engine id when no state file exists", () => {
    const identity = load();

    expect(identity.engineId).toMatch(/^trading-engine-[0-9a-f]{8}$/);
    expect(identity.epoch).toBe(1);
  });
});
