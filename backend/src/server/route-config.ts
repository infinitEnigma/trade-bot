/** @format */

import { Express } from "express";
import { Server } from "socket.io";
import { ContextAwareLogger } from "../core/logging";
// L3: static relative imports (no barrel alias, no dynamic import) so route
// registration is synchronous and resolvable identically in Jest, tsc and
// compiled dist/ ("src/interfaces" never resolves at runtime — tsc does not
// rewrite baseUrl paths).
import { authRoutes } from "../interfaces/http/auth";
import {
  userRoutes,
  walletsRoutes,
  exchangeAccountRoutes,
} from "../interfaces/http/users";
import {
  marketRoutes,
  strategyRoutes,
  createTradesRoutes,
} from "../interfaces/http/trading";
import { GetTradesUseCase } from "../core/trades/get-trades.use-case";
import { tradeRepositoryAdapter } from "../infrastructure/adapters/repositories/trade-repository.adapter";
import { strategyRepositoryAdapter } from "../infrastructure/adapters/repositories/strategy-repository.adapter";
import {
  exchangeAccountRepositoryAdapter,
  getBotBoundAccountSecrets,
} from "../infrastructure/adapters/repositories/exchange-account-repository.adapter";
import { walletRepositoryAdapter } from "../infrastructure/adapters/repositories/wallet-repository.adapter";
import { encryptionService } from "../infrastructure/security/encryption.service";
// Review P3 Phase 2: route modules take their persistence through injected
// ports (module-level setter + fail-fast accessor). This file is the HTTP
// composition root — it imports adapters legitimately (it is NOT under
// `interfaces/http/**`), and the wiring below runs inside register(), i.e.
// before listen(), so no request can observe an unwired port.
import { setCredentialGateDeps } from "../interfaces/http/trading/market-cache";
import { setPortfolioScopeDeps } from "../interfaces/http/trading/market-portfolio.routes";
import { setBalanceWalletLookup } from "../interfaces/http/wallet/balance";
import { setHealthDb } from "../interfaces/http/system/health";
import {
  setEngineDbDeps,
  setEngineAccountDeps,
} from "../interfaces/http/bots/engine";
import {
  setManagementDbDeps,
  setManagementAccountDeps,
} from "../interfaces/http/bots/management";
import { setAuthUserDeps } from "../interfaces/http/auth";
import { databaseHealth } from "../database/health-probe";
import { query } from "../database/pool";
import { botRoutes } from "../interfaces/http/bots";
import { walletRoutes, walletBalanceRoutes } from "../interfaces/http/wallet";
import { securityRoutes } from "../interfaces/http/system/security";
import { healthRoutes } from "../interfaces/http/system/health";

/**
 * ===========================================
 * 🛤️ ROUTE REGISTRATION SERVICE
 * ===========================================
 *
 * Centralized route mounting and API endpoint registration.
 * Organizes all HTTP routes by functional domain for clarity.
 *
 * RESPONSIBILITIES:
 * - HTTP route mounting by domain (auth, user, market, etc.)
 * - Route organization and grouping
 * - API endpoint registration
 * - Health check endpoints
 * - Socket.IO server attachment to routes
 *
 * ORGANIZATION:
 * - 🔐 Authentication & Authorization routes
 * - 👤 User Management routes
 * - 📊 Market Data & Trading routes
 * - 🤖 Bot Management routes
 * - 💰 Wallet & Balance routes
 * - 🛡️ Security & Monitoring routes
 * - 🏥 Health Check routes
 *
 * @format
 */

export interface RouteConfigOptions {
  /** Whether to enable API routes */
  enableApiRoutes?: boolean;

  /** Whether to enable health check routes */
  enableHealthRoutes?: boolean;

  /** Socket.IO server instance for route access */
  io?: Server;
}

/**
 * Express 5 keeps the router on the public `router` property (Express 4
 * used the private `_router`). The route introspection helpers below need
 * it, so they reach it through this structural view instead of `any`.
 */
interface ExpressRouterLayer {
  name?: string;
  handle?: { name?: string };
  regexp?: RegExp;
  route?: { path: string; methods: Record<string, unknown> };
}

interface ExpressWithRouter {
  router?: { stack?: ExpressRouterLayer[] };
}

/**
 * Route Configuration Service
 * Handles all HTTP route registration and mounting
 */
export class RouteConfig {
  private static readonly DEFAULT_OPTIONS = {
    enableApiRoutes: true,
    enableHealthRoutes: true,
    io: undefined,
  } as const;

  private static routeLogger = new ContextAwareLogger("route-config");

  /**
   * Register all routes with the Express application.
   *
   * Synchronous (L3): every app.use runs inline in a fixed domain order so
   * the full stack is built before listen() — there is no window where a
   * fast client hits a partially-built app.
   */
  static register(app: Express, options: RouteConfigOptions = {}): void {
    const config = { ...this.DEFAULT_OPTIONS, ...options };

    // Review P3 Phase 2: wire the injected route ports before any router
    // mounts (synchronous, so still before listen()).
    this.wireRouteDeps();

    // Make io available to routes
    if (config.io) {
      app.set("io", config.io);
    }

    const operationTimer = this.routeLogger.startOperation(
      "route-registration",
      {
        apiRoutesEnabled: config.enableApiRoutes,
        healthRoutesEnabled: config.enableHealthRoutes,
        socketIoAttached: !!config.io,
      }
    );

    try {
      if (config.enableApiRoutes) {
        this.registerApiRoutes(app);
      }

      if (config.enableHealthRoutes) {
        this.registerHealthRoutes(app);
      }

      operationTimer.success({
        routeCount: this.getRegisteredRoutes(app).length,
      });

      this.routeLogger.info("Route registration completed successfully", {
        apiRoutesEnabled: config.enableApiRoutes,
        healthRoutesEnabled: config.enableHealthRoutes,
        socketIoAttached: !!config.io,
      });
    } catch (error) {
      operationTimer.failure(error as Error);
      this.routeLogger.error("Route registration failed", error as Error, {
        apiRoutesEnabled: config.enableApiRoutes,
        healthRoutesEnabled: config.enableHealthRoutes,
        socketIoAttached: !!config.io,
      });
      throw error;
    }
  }

  /**
   * Wire the injected route ports (review P3 Phase 2). The setters are
   * module-level on purpose: consumer route helpers keep stable signatures,
   * so market.ts / ws-url / kline-history needed no changes.
   */
  private static wireRouteDeps(): void {
    setCredentialGateDeps({
      listAccounts: userId =>
        exchangeAccountRepositoryAdapter.listAccounts(userId),
    });
    setPortfolioScopeDeps({
      getAccountWithSecret: (userId, accountId) =>
        exchangeAccountRepositoryAdapter.getAccountWithSecret(
          userId,
          accountId
        ),
    });
    setBalanceWalletLookup({
      getOwnedWallet: (userId, walletId) =>
        walletRepositoryAdapter.getOwnedWallet(userId, walletId),
      listWallets: userId => walletRepositoryAdapter.listWallets(userId),
    });
    setHealthDb(databaseHealth);
    setEngineDbDeps({
      selectBot: async botId => {
        const result = await query<{
          user_id: string;
          desired_state: string;
          actual_state: string;
        }>(
          "SELECT user_id, desired_state, actual_state FROM bot_instances WHERE id = $1",
          [botId]
        );
        return result.rows[0] ?? null;
      },
      selectIssuedMarker: async (botId, correlationId) => {
        const result = await query<{ id: string }>(
          "SELECT id FROM bot_lifecycle_events WHERE bot_id = $1 AND event_type = 'CREDENTIALS_ISSUED' AND correlation_id = $2",
          [botId, correlationId]
        );
        return result.rows;
      },
      findBot: async botId => {
        const result = await query<{
          user_id: string;
          exchange_account_id: string | null;
        }>(
          "SELECT user_id, exchange_account_id FROM bot_instances WHERE id = $1",
          [botId]
        );
        return result.rows[0] ?? null;
      },
      insertCredentialsIssuedMarker: async (botId, correlationId) => {
        const result = await query(
          `INSERT INTO bot_lifecycle_events (bot_id, event_type, correlation_id, metadata)
               VALUES ($1, 'CREDENTIALS_ISSUED', $2, '{}')
               ON CONFLICT (bot_id, correlation_id)
               WHERE event_type = 'CREDENTIALS_ISSUED'
               DO NOTHING
               RETURNING id`,
          [botId, correlationId]
        );
        return { rowCount: result.rowCount ?? 0 };
      },
      getBotStats: async () => {
        const result = await query<{
          total_bots: string;
          running_bots: string;
          stopped_bots: string;
          error_bots: string;
        }>(
          `SELECT
              COUNT(*) as total_bots,
              COUNT(CASE WHEN status = 'RUNNING' THEN 1 END) as running_bots,
              COUNT(CASE WHEN status = 'STOPPED' THEN 1 END) as stopped_bots,
              COUNT(CASE WHEN status = 'ERROR' THEN 1 END) as error_bots
           FROM bot_instances`
        );
        return result.rows[0];
      },
      ping: async () => {
        await query("SELECT 1");
      },
    });
    setEngineAccountDeps({
      getBoundAccountSecrets: botId =>
        getBotBoundAccountSecrets(botId, {
          findBot: async id => {
            const result = await query<{
              user_id: string;
              exchange_account_id: string | null;
            }>(
              "SELECT user_id, exchange_account_id FROM bot_instances WHERE id = $1",
              [id]
            );
            return result.rows[0] ?? null;
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
        }),
    });
    setManagementDbDeps({
      auditCredentialAccess: async (userId, action, details) => {
        await query(
          "INSERT INTO audit_logs (user_id, action, details) VALUES ($1, $2, $3)",
          [userId, action, JSON.stringify(details)]
        );
      },
      selectBot: async (botId, userId) => {
        const result = await query<{ id: string; status: string }>(
          "SELECT id, status FROM bot_instances WHERE id = $1 AND user_id = $2",
          [botId, userId]
        );
        return result.rows[0] ?? null;
      },
    });
    setManagementAccountDeps({
      getAccountWithSecret: (userId, accountId) =>
        exchangeAccountRepositoryAdapter.getAccountWithSecret(
          userId,
          accountId
        ),
    });
    setAuthUserDeps({
      getUserById: async userId => {
        const result = await query<{
          id: string;
          username: string;
          email: string;
          user_level: string;
          created_at: Date;
          updated_at: Date;
        }>(
          "SELECT id, username, email, user_level, created_at, updated_at FROM users WHERE id = $1",
          [userId]
        );
        return result.rows[0] ?? null;
      },
      getUserRoles: async userId => {
        const result = await query<{ role: string }>(
          "SELECT role FROM user_roles WHERE user_id = $1",
          [userId]
        );
        return result.rows.map(row => row.role);
      },
    });
  }

  /**
   * Register all API routes by functional domain
   */
  private static registerApiRoutes(app: Express): void {
    const apiRoutesTimer = this.routeLogger.startOperation(
      "api-routes-registration"
    );

    try {
      // 🔐 Authentication & Authorization
      this.registerAuthRoutes(app);

      // 👤 User Management
      this.registerUserRoutes(app);

      // 📊 Market Data & Trading
      this.registerMarketRoutes(app);

      // 🤖 Bot Management & Engine
      this.registerBotRoutes(app);

      // 💰 Wallet & Balance
      this.registerWalletRoutes(app);

      // 🛡️ Security & Monitoring
      this.registerSecurityRoutes(app);

      apiRoutesTimer.success({
        registeredRoutes: [
          "auth",
          "user",
          "market",
          "strategies",
          "bot",
          "wallet",
          "balance",
          "security",
        ],
      });

      this.routeLogger.debug("API routes registered by domain", {
        operation: "api-routes-registration",
        status: "completed",
      });
    } catch (error) {
      apiRoutesTimer.failure(error as Error);
      this.routeLogger.error("Failed to register API routes", error as Error, {
        operation: "api-routes-registration",
        status: "failed",
      });
      throw error;
    }
  }

  /**
   * Register authentication routes
   */
  private static registerAuthRoutes(app: Express): void {
    const authTimer = this.routeLogger.startOperation(
      "auth-routes-registration"
    );
    try {
      app.use("/api/auth", authRoutes);
      authTimer.success();
      this.routeLogger.debug("Authentication routes registered", {
        route: "/api/auth",
        component: "authentication",
      });
    } catch (error) {
      authTimer.failure(error as Error);
      this.routeLogger.error(
        "Failed to register authentication routes",
        error as Error,
        {
          route: "/api/auth",
          component: "authentication",
        }
      );
      throw error;
    }
  }

  /**
   * Register user management routes
   *
   * C2 mounts the new canonical routers alongside the legacy /api/user
   * tree: GET/POST /api/wallets/* and GET/POST/DELETE /api/accounts/*.
   */
  private static registerUserRoutes(app: Express): void {
    const userTimer = this.routeLogger.startOperation(
      "user-routes-registration"
    );
    try {
      app.use("/api/user", userRoutes);
      app.use("/api/wallets", walletsRoutes);
      app.use("/api/accounts", exchangeAccountRoutes);
      userTimer.success();
      this.routeLogger.debug("User management routes registered", {
        routes: ["/api/user", "/api/wallets", "/api/accounts"],
        component: "user-management",
      });
    } catch (error) {
      userTimer.failure(error as Error);
      this.routeLogger.error(
        "Failed to register user management routes",
        error as Error,
        {
          routes: ["/api/user", "/api/wallets", "/api/accounts"],
          component: "user-management",
        }
      );
      throw error;
    }
  }

  /**
   * Register market data and trading routes
   */
  private static registerMarketRoutes(app: Express): void {
    const marketTimer = this.routeLogger.startOperation(
      "market-routes-registration"
    );
    try {
      app.use("/api/market", marketRoutes);
      app.use("/api/strategies", strategyRoutes);
      // Batch-1 trades read model: the local ledger rows (strategy + account
      // attributed), distinct from the venue proxy at /api/market/trades.
      // HTTP composition root (review P1): the route receives the use case,
      // which owns ownership validation + the repository fan-out.
      app.use(
        "/api/trades",
        createTradesRoutes(
          new GetTradesUseCase({
            trades: tradeRepositoryAdapter,
            checkers: {
              strategyExistsForUser: (strategyId, userId) =>
                strategyRepositoryAdapter.strategyExistsForUser(
                  strategyId,
                  userId
                ),
              // Same ownership answer as the former route (the adapter never
              // decrypts; a foreign id is indistinguishable from a missing one).
              accountExistsForUser: async (userId, accountId) =>
                (await exchangeAccountRepositoryAdapter.getAccountWithSecret(
                  userId,
                  accountId
                )) !== null,
            },
          })
        )
      );
      marketTimer.success();
      this.routeLogger.debug("Market and trading routes registered", {
        routes: ["/api/market", "/api/strategies", "/api/trades"],
        component: "market-trading",
      });
    } catch (error) {
      marketTimer.failure(error as Error);
      this.routeLogger.error(
        "Failed to register market and trading routes",
        error as Error,
        {
          routes: ["/api/market", "/api/strategies", "/api/trades"],
          component: "market-trading",
        }
      );
      throw error;
    }
  }

  /**
   * Register bot management routes
   */
  private static registerBotRoutes(app: Express): void {
    const botTimer = this.routeLogger.startOperation("bot-routes-registration");
    try {
      app.use("/api/bot", botRoutes);
      botTimer.success();
      this.routeLogger.debug("Bot management routes registered", {
        route: "/api/bot",
        component: "bot-management",
      });
    } catch (error) {
      botTimer.failure(error as Error);
      this.routeLogger.error(
        "Failed to register bot management routes",
        error as Error,
        {
          route: "/api/bot",
          component: "bot-management",
        }
      );
      throw error;
    }
  }

  /**
   * Register wallet and balance routes
   */
  private static registerWalletRoutes(app: Express): void {
    const walletTimer = this.routeLogger.startOperation(
      "wallet-routes-registration"
    );
    try {
      app.use("/api/wallet", walletRoutes);
      app.use("/api/balance", walletBalanceRoutes);
      walletTimer.success();
      this.routeLogger.debug("Wallet and balance routes registered", {
        routes: ["/api/wallet", "/api/balance"],
        component: "wallet-balance",
      });
    } catch (error) {
      walletTimer.failure(error as Error);
      this.routeLogger.error(
        "Failed to register wallet and balance routes",
        error as Error,
        {
          routes: ["/api/wallet", "/api/balance"],
          component: "wallet-balance",
        }
      );
      throw error;
    }
  }

  /**
   * Register security and monitoring routes
   */
  private static registerSecurityRoutes(app: Express): void {
    const securityTimer = this.routeLogger.startOperation(
      "security-routes-registration"
    );
    try {
      app.use("/api/security", securityRoutes);
      securityTimer.success();
      this.routeLogger.debug("Security routes registered", {
        route: "/api/security",
        component: "security-monitoring",
      });
    } catch (error) {
      securityTimer.failure(error as Error);
      this.routeLogger.error(
        "Failed to register security routes",
        error as Error,
        {
          route: "/api/security",
          component: "security-monitoring",
        }
      );
      throw error;
    }
  }

  /**
   * Register health check routes
   */
  private static registerHealthRoutes(app: Express): void {
    const healthTimer = this.routeLogger.startOperation(
      "health-routes-registration"
    );
    try {
      // Health check (must be last to catch all routes)
      app.use("/api", healthRoutes);

      healthTimer.success();
      this.routeLogger.debug("Health check routes registered", {
        route: "/api",
        component: "health-check",
      });
    } catch (error) {
      healthTimer.failure(error as Error);
      this.routeLogger.error(
        "Failed to register health check routes",
        error as Error,
        {
          route: "/api",
          component: "health-check",
        }
      );
      throw error;
    }
  }

  /**
   * Get all registered route paths for debugging/monitoring
   */
  static getRegisteredRoutes(app: Express): string[] {
    const routes: string[] = [];

    // Force Express to initialize the router if it hasn't been already
    // This is necessary for testing purposes
    const appWithRouter = app as ExpressWithRouter;
    if (!appWithRouter.router) {
      app.use((req, res, next) => next());
    }

    // Walk through the Express app's router stack
    const stack = appWithRouter.router?.stack;
    if (stack) {
      for (const layer of stack) {
        if (layer.route) {
          const methods = Object.keys(layer.route.methods)
            .join(", ")
            .toUpperCase();
          routes.push(`${methods} ${layer.route.path}`);
        } else if (
          (layer.name === "router" || layer.handle?.name === "router") &&
          layer.regexp
        ) {
          // Mounted router
          const mountPath = layer.regexp
            .toString()
            .replace(/^\/\^/, "")
            .replace(/\/\(\?:\(\[\^\/\]\+\)\)\?\)\?\$\/i/, "")
            .replace(/\\/g, "");
          routes.push(`MOUNT ${mountPath}`);
        }
      }
    }

    return routes;
  }

  /**
   * Validate that all expected routes are registered
   */
  static validateRouteRegistration(app: Express): {
    isValid: boolean;
    missingRoutes: string[];
  } {
    const registeredRoutes = this.getRegisteredRoutes(app);
    const expectedRoutes = [
      "MOUNT /api/auth",
      "MOUNT /api/user",
      "MOUNT /api/market",
      "MOUNT /api/strategies",
      "MOUNT /api/bot",
      "MOUNT /api/wallet",
      "MOUNT /api/balance",
      "MOUNT /api/security",
      "MOUNT /api", // Health routes
    ];

    const missingRoutes = expectedRoutes.filter(
      expected =>
        !registeredRoutes.some(registered => registered.includes(expected))
    );

    return {
      isValid: missingRoutes.length === 0,
      missingRoutes,
    };
  }
}
