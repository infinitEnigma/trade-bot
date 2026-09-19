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
    process.env.ENGINE_ID ||
    state.engineId ||
    `kodiak-engine-${crypto.randomUUID().substring(0, 8)}`;
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
