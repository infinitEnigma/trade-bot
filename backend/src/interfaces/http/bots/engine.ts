/**
 * Bot Engine Routes
 *
 * Out-of-band HTTP surface between the bot engine and the backend API,
 * gated by botEngineAuth (x-bot-engine-key): lifecycle credential issue
 * (GET /credentials/:botId) and the status/health probes. GET /status
 * reads engine liveness from the engine_registry (ENGINE_HEARTBEAT →
 * last_seen_at) — the same authority that gates command routing — instead
 * of inferring it from bot rows.
 *
 * The legacy writer routes - POST /heartbeat, /report-trade, /bot-error
 * and /bot-recovery - were removed: a repo-wide search found zero engine
 * callers. Liveness flows via ENGINE_HEARTBEAT events (engine-registry),
 * and trade ingestion is planned through the TRADE_EXECUTED event path
 * (Phase 4), not HTTP. POST /engine-status was removed for the same
 * reason: zero callers, and its stats payload was logged and discarded.
 * See docs/archived/PROJECT_REVIEW_GAP_ANALYSIS_2026-09-20_cycle.md
 * §2 claims 1 and 3, ledger L30 (the live gap analysis now tracks only
 * open work).
 */

import { Router, Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "crypto";
import { query } from "../../../database/pool";
// Bot services have been removed - using direct database operations instead
import { engineRegistryService } from "../../../core/bots/engine-registry.service";
import {
  exchangeAccountRepositoryAdapter,
  getBotBoundAccountSecrets,
} from "../../../infrastructure/adapters/repositories/exchange-account-repository.adapter";
import { encryptionService } from "../../../infrastructure/security/encryption.service";
import { httpLogger as logger } from "../../../core/logging/context-aware-logger.service";

/**
 * Engine health status interface
 */
interface EngineHealth {
  status: string;
  timestamp: number;
  uptime: number;
  memory: NodeJS.MemoryUsage;
  version: string;
  database?: string;
  botStats?: {
    total_bots: number;
    running_bots: number;
    error_bots: number;
  };
}

const router = Router();

/**
 * Bot Engine API Key Authentication Middleware
 * Protects bot engine routes from unauthorized access
 */
const botEngineAuth = (req: Request, res: Response, next: NextFunction) => {
  const apiKey = req.headers["x-bot-engine-key"] as string;

  if (!apiKey) {
    logger.warn("Bot engine route accessed without API key", {
      path: req.path,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
    return res.status(401).json({
      success: false,
      error: "API key required for bot engine access",
    });
  }

  const expectedKey = process.env.BOT_ENGINE_API_KEY;
  if (!expectedKey) {
    logger.error("BOT_ENGINE_API_KEY not configured");
    return res.status(500).json({
      success: false,
      error: "Server configuration error",
    });
  }

  // Constant-time comparison to prevent timing attacks on the API key
  const expected = Buffer.from(expectedKey, "utf8");
  const provided = Buffer.from(apiKey, "utf8");
  const isValid =
    expected.length === provided.length && timingSafeEqual(expected, provided);

  if (!isValid) {
    logger.warn("Invalid bot engine API key provided", {
      path: req.path,
      ip: req.ip,
      keyLength: apiKey.length,
    });
    return res.status(401).json({
      success: false,
      error: "Invalid API key",
    });
  }

  // API key is valid
  logger.debug("Bot engine API key validated", {
    path: req.path,
  });

  next();
};

// GET /api/bot/engine/credentials/:botId?correlationId=... (called by engine)
//
// Out-of-band credential delivery for the lifecycle protocol: after the
// engine accepts a BOT_START command it fetches the bot's BOUND venue
// account credentials here (C3a) - no secrets ever travel through Redis
// Streams.
//
// Guards:
// - bot engine API key (botEngineAuth middleware)
// - bot must exist with desired_state = RUNNING
// - bot must be bound to an ACTIVE exchange account
//   (legacy unbound rows get 409: recreate the bot with an account)
// - credentials are issued at most once per (botId, correlationId):
//   marker SELECT (fast path) + partial unique index with ON CONFLICT
//   (race guard, migration 015_credentials_issued_unique.sql).
router.get(
  "/credentials/:botId",
  botEngineAuth,
  async (req: Request, res: Response) => {
    try {
      const { botId } = req.params;
      const correlationId = (req.query.correlationId as string) || "";

      if (!correlationId) {
        return res
          .status(400)
          .json({ success: false, error: "correlationId required" });
      }

      const botResult = await query<{
        user_id: string;
        desired_state: string;
        actual_state: string;
      }>(
        "SELECT user_id, desired_state, actual_state FROM bot_instances WHERE id = $1",
        [botId]
      );
      if (botResult.rows.length === 0) {
        return res.status(404).json({ success: false, error: "Bot not found" });
      }

      const bot = botResult.rows[0];
      if (
        bot.desired_state !== "RUNNING" ||
        !["STARTING", "RUNNING"].includes(bot.actual_state)
      ) {
        return res
          .status(409)
          .json({ success: false, error: "Bot is not in a startable state" });
      }

      // Issue at most once per (botId, correlationId). This SELECT is only
      // the fast path — check-then-insert alone lets two concurrent fetches
      // both pass it; the INSERT below is arbitrated by the partial unique
      // index from migration 015.
      const issuedMarker = await query(
        "SELECT id FROM bot_lifecycle_events WHERE bot_id = $1 AND event_type = 'CREDENTIALS_ISSUED' AND correlation_id = $2",
        [botId, correlationId]
      );
      if (issuedMarker.rows.length > 0) {
        return res.status(409).json({
          success: false,
          error: "Credentials already issued for this correlation",
        });
      }

      // C3a: resolve the bot's BOUND account, not the user's first kodiak
      // row. Secrets are decrypted in-memory, never persisted or logged.
      // The exchange-agnostic envelope (shared EngineCredentials) is what
      // the engine's credential fetcher validates and its client factory
      // dispatches on — the engine needs no edits for this swap.
      const bound = await getBotBoundAccountSecrets(botId as string, {
        findBot: async id => {
          const row = await query<{
            user_id: string;
            exchange_account_id: string | null;
          }>(
            "SELECT user_id, exchange_account_id FROM bot_instances WHERE id = $1",
            [id]
          );
          return row.rows[0] ?? null;
        },
        getAccountWithSecret: (userId, accountId) =>
          exchangeAccountRepositoryAdapter.getAccountWithSecret(
            userId,
            accountId
          ),
        decryptEnvelope: ciphertext =>
          encryptionService.decryptWithVersion(ciphertext),
        decryptFieldBlob: async blob => {
          try {
            return encryptionService.decryptApiKey(blob);
          } catch {
            // Not an api-key blob — try the other legacy helper.
          }
          try {
            return encryptionService.decryptSecretKey(blob);
          } catch {
            // Not a secret-key blob either — try the versioned path.
          }
          return encryptionService.decryptWithVersion(blob);
        },
      });

      // Legacy (pre-C3a) bots have no binding: fail loudly so the operator
      // recreates the bot with an account instead of trading the wrong one.
      if (!bound) {
        return res.status(409).json({
          success: false,
          error:
            "Bot has no verified exchange account bound. Recreate the bot with an account.",
        });
      }

      const envelope =
        bound.request.exchange === "kodiak"
          ? {
              exchange: "kodiak" as const,
              environment: bound.account.environment,
              accountRef: bound.account.accountRef,
              credentials: {
                accountId: bound.request.accountId,
                accessKey: bound.request.apiKey,
                secretKey: bound.request.secretKey,
              },
            }
          : {
              exchange: "lighter" as const,
              environment: bound.account.environment,
              accountRef: bound.account.accountRef,
              credentials: {
                accountIndex: bound.request.accountIndex,
                apiKeyIndex: bound.request.apiKeyIndex,
                privateKey: bound.request.privateKey,
              },
            };

      // The partial unique index (migration 015) arbitrates concurrent
      // fetches: if a competing request already inserted this marker,
      // DO NOTHING yields rowCount 0 and the envelope must not go out twice.
      const marker = await query(
        `INSERT INTO bot_lifecycle_events (bot_id, event_type, correlation_id, metadata)
             VALUES ($1, 'CREDENTIALS_ISSUED', $2, '{}')
             ON CONFLICT (bot_id, correlation_id)
             WHERE event_type = 'CREDENTIALS_ISSUED'
             DO NOTHING
             RETURNING id`,
        [botId, correlationId]
      );
      if (marker.rowCount === 0) {
        return res.status(409).json({
          success: false,
          error: "Credentials already issued for this correlation",
        });
      }

      logger.info("Engine credentials issued", {
        botId,
        correlationId,
        exchange: envelope.exchange,
        environment: envelope.environment,
      });

      res.json({ success: true, data: envelope });
    } catch (error) {
      const err = error as Error;
      logger.error("Engine credential fetch error", err, {
        botId: req.params?.botId,
      });
      res
        .status(500)
        .json({ success: false, error: "Failed to issue credentials" });
    }
  }
);

// GET /api/bot/engine/status (for frontend to check engine status)
// Note: Since this router is mounted at /engine, the path is just /status
router.get("/status", async (req: Request, res: Response) => {
  try {
    // Bot activity below is informational — it does NOT decide liveness.
    const botStatsResult = await query(`
            SELECT
                COUNT(*) as total_bots,
                COUNT(CASE WHEN status = 'RUNNING' THEN 1 END) as running_bots,
                COUNT(CASE WHEN status = 'STOPPED' THEN 1 END) as stopped_bots,
                COUNT(CASE WHEN status = 'ERROR' THEN 1 END) as error_bots
            FROM bot_instances
        `);
    const botStats = botStatsResult.rows[0] as {
      total_bots: string;
      running_bots: string;
      stopped_bots: string;
      error_bots: string;
    };

    const activeBots = parseInt(botStats.running_bots || "0");

    // Engine liveness comes from the engine_registry (ENGINE_HEARTBEAT →
    // last_seen_at), the same authority that gates command routing. The old
    // heuristic — running = COUNT(running bot rows) > 0 — was wrong in both
    // directions: an idle engine read as "not running" (the Strategies page
    // then told users to start an already-running engine), and a crashed
    // engine whose rows still said RUNNING read as running until the sweep
    // flipped them.
    const liveness = await engineRegistryService.getEngineLiveness();

    let status = "offline";
    if (liveness.running) {
      status = activeBots > 0 ? "running" : "idle";
    }

    const engineStatus = {
      running: liveness.running,
      status,
      activeBots,
      totalBots: parseInt(botStats.total_bots || "0"),
      stoppedBots: parseInt(botStats.stopped_bots || "0"),
      errorBots: parseInt(botStats.error_bots || "0"),
      engines: liveness.engines,
      lastUpdate: Date.now(),
    };

    logger.debug("Engine status requested", {
      status: engineStatus.status,
      activeBots: engineStatus.activeBots,
    });

    res.json({
      success: true,
      data: engineStatus,
    });
  } catch (error) {
    const err = error as Error;
    logger.error("Engine status check error", err);

    res.status(500).json({
      success: false,
      error: "Failed to get engine status",
    });
  }
});

// GET /api/bot/engine/health (health check endpoint for engine)
// Note: Since this router is mounted at /engine, the path is just /health
router.get("/health", async (req: Request, res: Response) => {
  try {
    // Get basic system health
    const health: EngineHealth = {
      status: "healthy",
      timestamp: Date.now(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      version: process.version,
    };

    // Get basic bot statistics from database
    const botStatsResult = await query(`
            SELECT
                COUNT(*) as total_bots,
                COUNT(CASE WHEN status = 'RUNNING' THEN 1 END) as running_bots,
                COUNT(CASE WHEN status = 'ERROR' THEN 1 END) as error_bots
            FROM bot_instances
        `);
    const botStats = botStatsResult.rows[0];

    // Check database connectivity
    try {
      await query("SELECT 1");
      health.database = "connected";
    } catch (_error) {
      health.database = "disconnected";
      health.status = "degraded";
    }

    res.json({
      success: true,
      data: {
        ...health,
        botStats,
      },
    });
  } catch (error) {
    const err = error as Error;
    logger.error("Engine health check error", err);

    res.status(500).json({
      success: false,
      status: "unhealthy",
      error: err.message,
      timestamp: Date.now(),
    });
  }
});

export { router as botEngineRoutes };
