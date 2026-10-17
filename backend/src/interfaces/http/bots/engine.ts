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
 * and trade ingestion is the TRADE_EXECUTED event path (Phase 4, landed
 * 2026-10-02: engine-ledger events → TradeLedgerService → bot_trade_fills).
 * POST /engine-status was removed for the same reason: zero callers, and
 * its stats payload was logged and discarded.
 * See docs/archived/PROJECT_REVIEW_GAP_ANALYSIS_2026-09-20_cycle.md
 * §2 claims 1 and 3, ledger L30 (the live gap analysis now tracks only
 * open work).
 */

import { Router, Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "crypto";
import type {
  ConnectExchangeAccountRequest,
  ExchangeAccount,
} from "@trade-bot/shared";
import { engineRegistryService } from "../../../core/bots/engine-registry.service";
import { httpLogger as logger } from "../../../core/logging/context-aware-logger.service";

/**
 * Persistence port (review P3): engine routes must not import the database
 * pool directly. Wired in `server/route-config.ts`; tests inject doubles
 * through the setters. Fail-fast: an unwired port must never silently serve
 * credentials or status.
 */
export interface EngineDbPort {
  selectBot(botId: string): Promise<{
    user_id: string;
    desired_state: string;
    actual_state: string;
  } | null>;
  selectIssuedMarker(
    botId: string,
    correlationId: string
  ): Promise<{ id: string }[]>;
  findBot(botId: string): Promise<{
    user_id: string;
    exchange_account_id: string | null;
  } | null>;
  insertCredentialsIssuedMarker(
    botId: string,
    correlationId: string
  ): Promise<{ rowCount: number }>;
  getBotStats(): Promise<{
    total_bots: string;
    running_bots: string;
    stopped_bots: string;
    error_bots: string;
  }>;
  ping(): Promise<void>;
}

/**
 * Account lookup port (review P3): engine routes must not import repository
 * adapters directly. Wired in `server/route-config.ts`.
 */
export interface EngineAccountPort {
  getBoundAccountSecrets(botId: string): Promise<{
    account: ExchangeAccount;
    request: ConnectExchangeAccountRequest;
  } | null>;
}

let dbImpl: EngineDbPort | undefined;
/** Route wiring (server/route-config.ts). Tests inject a double the same way. */
export function setEngineDbDeps(deps: EngineDbPort): void {
  dbImpl = deps;
}
function db(): EngineDbPort {
  if (!dbImpl) {
    throw new Error(
      "Engine DB port not wired — call setEngineDbDeps() in route-config"
    );
  }
  return dbImpl;
}

let accountImpl: EngineAccountPort | undefined;
/** Route wiring (server/route-config.ts). Tests inject a double the same way. */
export function setEngineAccountDeps(deps: EngineAccountPort): void {
  accountImpl = deps;
}
function account(): EngineAccountPort {
  if (!accountImpl) {
    throw new Error(
      "Engine account port not wired — call setEngineAccountDeps() in route-config"
    );
  }
  return accountImpl;
}

/** Test-only access to wired port implementations. */
export { db as engineDb, account as engineAccount };

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
      const { botId } = req.params as { botId: string };
      const correlationId = (req.query.correlationId as string) || "";

      if (!correlationId) {
        return res
          .status(400)
          .json({ success: false, error: "correlationId required" });
      }

      const bot = await db().selectBot(botId);
      if (!bot) {
        return res.status(404).json({ success: false, error: "Bot not found" });
      }

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
      const issuedMarker = await db().selectIssuedMarker(botId, correlationId);
      if (issuedMarker.length > 0) {
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
      const bound = await account().getBoundAccountSecrets(botId);
      if (!bound) {
        return res.status(409).json({
          success: false,
          error:
            "Bot has no verified exchange account bound. Recreate the bot with an account.",
        });
      }

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
      const marker = await db().insertCredentialsIssuedMarker(
        botId,
        correlationId
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
    const botStats = await db().getBotStats();

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

    // Live fleet only: ONLINE with a fresh heartbeat. Dead rows stay in
    // `engines[]` below for operator visibility, but never feed aggregates.
    const liveEngines = liveness.engines.filter(e => e.live === true);
    const engineStatus = {
      running: liveness.running,
      status,
      activeBots,
      totalBots: parseInt(botStats.total_bots || "0"),
      stoppedBots: parseInt(botStats.stopped_bots || "0"),
      errorBots: parseInt(botStats.error_bots || "0"),
      // F4 journal integrity (migration 025). Two distinct notions:
      //  - journalIntegrity: LIVE aggregate — worst live state across LIVE
      //    engines only (UNKNOWN > UNVERIFIED > OK). Dead OFFLINE rows keep
      //    their last signal forever (e.g. UNVERIFIED from before migration
      //    025) and must never poison the banner for the running fleet.
      //    No live engine (empty fleet or all dead) reads as UNVERIFIED —
      //    there is nothing verified to report — never as a fake OK.
      //  - journalIntegrityAlert: STICKY — a live engine with an unresolved
      //    operator action. Dead rows cannot hold the banner hostage: their
      //    alert died with the process (its bots already went UNKNOWN via
      //    the sweep), and pruning removes the row entirely.
      //  - pendingFills: summed over live engines only, for the same reason.
      journalIntegrity: liveEngines.some(e => e.journalIntegrity === "UNKNOWN")
        ? "UNKNOWN"
        : liveEngines.length > 0 &&
            liveEngines.every(e => e.journalIntegrity === "OK")
          ? "OK"
          : "UNVERIFIED",
      journalIntegrityAlert: liveEngines.some(e => e.journalIntegrityAlert),
      pendingFills: liveEngines.reduce((n, e) => n + (e.pendingFills ?? 0), 0),
      // Per-engine detail so the UI/operator can see WHICH engine needs action.
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
    const botStats = await db().getBotStats();

    // Check database connectivity
    try {
      await db().ping();
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
