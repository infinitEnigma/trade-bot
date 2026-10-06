/**
 * Engine Identity Management
 *
 * Handles persistent engine identity that survives restarts.
 * Each engine has a unique ID and an epoch that increments on every start.
 * The backend uses (engineId, epoch) to reject stale events from old processes.
 *
 * @format
 */

import * as fs from "fs";
import * as path from "path";
import { logger } from "../utils/logger";
import { EngineIdentity } from "./bot-runtime";

const ENGINE_STATE_FILE =
  process.env.ENGINE_STATE_FILE ||
  path.join(process.cwd(), ".engine-state.json");

/**
 * Exchange-agnostic rebrand: ids minted before the rename carried the
 * `kodiak-engine-` prefix. The persisted id (state file or ENGINE_ID env) is
 * migrated in place — same suffix, new prefix — so logs, `engine_registry`
 * and `bot_instances.engine_id` stay in lockstep with migration
 * `020_rename_engine_identity.sql`, which renames the DB rows and resets
 * their epoch (the swapped prefix is a new identity for the staleness guard,
 * and the loader below restarts the epoch at 1 to match).
 */
const LEGACY_ENGINE_ID_PREFIX = "kodiak-engine-";
const CURRENT_ENGINE_ID_PREFIX = "trading-engine-";

const migrateEngineId = (engineId: string | undefined): string | undefined =>
  engineId && engineId.startsWith(LEGACY_ENGINE_ID_PREFIX)
    ? CURRENT_ENGINE_ID_PREFIX + engineId.slice(LEGACY_ENGINE_ID_PREFIX.length)
    : engineId;

/**
 * Load existing engine identity or create a new one.
 * The engineId persists across restarts (from env or state file).
 * The epoch increments on every start.
 */
export function loadOrCreateEngineIdentity(): EngineIdentity {
  let state: { engineId?: string; epoch?: number } = {};
  try {
    state = JSON.parse(fs.readFileSync(ENGINE_STATE_FILE, "utf-8"));
  } catch {
    // First run or unreadable state file - create fresh identity
  }

  const engineId =
    migrateEngineId(process.env.ENGINE_ID) ||
    migrateEngineId(state.engineId) ||
    `${CURRENT_ENGINE_ID_PREFIX}${crypto.randomUUID().substring(0, 8)}`;
  const epoch = (state.engineId === engineId ? (state.epoch ?? 0) : 0) + 1;

  try {
    fs.writeFileSync(
      ENGINE_STATE_FILE,
      JSON.stringify({ engineId, epoch }, null, 2)
    );
  } catch (error) {
    const message = `Could not persist engine identity to ${ENGINE_STATE_FILE}: ${error instanceof Error ? error.message : String(error)}`;
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        `FATAL: ${message} - engine identity must be persistable in production`
      );
    }
    logger.error(
      "Engine identity could not be persisted - epoch will reset on restart",
      {
        file: ENGINE_STATE_FILE,
        error: message,
      }
    );
  }

  return { engineId, epoch };
}
