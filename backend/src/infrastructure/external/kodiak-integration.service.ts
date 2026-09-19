/**
 * Kodiak Integration Service — facade
 *
 * Handles Kodiak API integration including authentication, request/response
 * handling, caching, and API utilities. Provides centralized Kodiak exchange
 * operations.
 *
 * DECOMPOSITION (this file is a backward-compatible facade):
 * - ./kodiak/types.ts                — all wire types (re-exported below)
 * - ./kodiak/fetch-options.ts        — abort/timeout/connection fetch plumbing
 * - ./kodiak/public-fetch.ts         — shared cache → fetch → extract → cache
 *                                      pipeline for public endpoints
 * - ./kodiak/credentials-provider.ts — credential resolution/decryption
 * - ./kodiak/private-data.ts         — authenticated user-data methods
 * - ./kodiak/market-data.ts          — public market-data methods
 *
 * Method bags are mounted onto this class's prototype so instance-level
 * patching in tests (`(service as any).makeKodiakRequest = jest.fn()`)
 * keeps working, and `this.*` cross-calls resolve to facade members.
 */

/* eslint-disable @typescript-eslint/no-unsafe-declaration-merging -- intentional mixin: method bags are mounted onto the prototype below and merged into the instance type */

import { kodiakCache } from "./kodiak-cache";
import { externalTrafficObserver } from "./external-traffic-observer";
import { integrationLogger as logger } from "../../core/logging/context-aware-logger.service";

import {
  createAbortController,
  createFetchOptions,
} from "./kodiak/fetch-options";
import { getUserCredentials } from "./kodiak/credentials-provider";
import { privateDataMethods } from "./kodiak/private-data";
import { marketDataMethods } from "./kodiak/market-data";
import type { KodiakCredentials } from "./kodiak/types";

// Backward-compatible type re-exports (all consumers import from here today)
export type {
  KodiakCredentials,
  KodiakApiResponse,
  KodiakPosition,
  KodiakTrade,
  KodiakBalance,
  KodiakAccountInfo,
  KodiakApiAccountInfoResponse,
  KodiakPublicAccountInfo,
  KodiakHolding,
  KodiakHoldingsResponse,
  KodiakMarketTicker,
  KodiakOrderbook,
  KodiakTradingViewConfig,
  KodiakTradingViewSymbols,
  KodiakTradingViewHistory,
} from "./kodiak/types";

/**
 * Kodiak Integration Service
 */
export class KodiakIntegrationService {
  public readonly CACHE_TTL = 300; // ⬆️ 5 minutes for volatile data (was 5 seconds)
  public readonly CACHE_TTL_MEDIUM = 600; // ⬆️ 10 minutes for semi-volatile data (was 30 seconds)

  // Module-level caching for crypto libraries to prevent memory leaks
  private cryptoModule: typeof import("crypto") | null = null;
  private bs58Module: typeof import("bs58") | null = null;
  private ed25519Module: typeof import("@noble/ed25519") | null = null;

  /**
   * Get crypto modules with caching to prevent memory leaks
   */
  private async getCryptoModules(): Promise<{
    cryptoModule: typeof import("crypto");
    bs58Module: typeof import("bs58");
    ed25519Module: typeof import("@noble/ed25519");
  }> {
    if (!this.cryptoModule) {
      this.cryptoModule = await import("crypto");
      this.bs58Module = await import("bs58");
      this.ed25519Module = await import("@noble/ed25519");
    }
    return {
      cryptoModule: this.cryptoModule!,
      bs58Module: this.bs58Module!,
      ed25519Module: this.ed25519Module!,
    };
  }

  /**
   * Create an AbortController with timeout for request cancellation
   * (delegates to the shared implementation in ./kodiak/fetch-options)
   */
  private createAbortController(timeout: number = 30000): AbortController {
    return createAbortController(timeout);
  }

  /**
   * Create fetch options with proper timeout and connection management
   * (delegates to the shared implementation in ./kodiak/fetch-options)
   */
  createFetchOptions(additionalOptions: RequestInit = {}): RequestInit {
    return createFetchOptions(additionalOptions);
  }

  /**
   * Get decrypted Kodiak credentials for a user
   * (delegates to ./kodiak/credentials-provider)
   */
  async getUserCredentials(userId: string): Promise<KodiakCredentials | null> {
    return getUserCredentials(userId);
  }

  /**
   * Make authenticated Kodiak API request
   */
  async makeKodiakRequest<T>(
    method: string,
    path: string,
    credentials: KodiakCredentials,
    body?: unknown
  ): Promise<T> {
    try {
      const signaturePath = path.startsWith("/v1/") ? path : `/v1${path}`;
      const timestamp = Date.now();
      const bodyStr = body ? JSON.stringify(body) : "";
      const message = `${timestamp}${method.toUpperCase()}${signaturePath}${bodyStr}`;

      // Generate signature
      const signature = await this.generateKodiakSignature(
        message,
        credentials.secretKey
      );

      const baseUrl = process.env.KODIAK_API_URL || "https://api.orderly.org";

      const headers: Record<string, string> = {
        "Content-Type":
          method === "GET"
            ? "application/x-www-form-urlencoded"
            : "application/json",
        "orderly-account-id": credentials.accountId,
        "orderly-key": credentials.apiKey,
        "orderly-signature": signature,
        "orderly-timestamp": timestamp.toString(),
      };

      logger.debug("Making Kodiak API request", {
        method,
        path: signaturePath,
        accountId: credentials.accountId,
      });

      const requestOptions: RequestInit = {
        method: method.toUpperCase(),
        headers,
      };

      if (method.toUpperCase() !== "GET" && bodyStr) {
        requestOptions.body = bodyStr;
      }

      const response = await fetch(
        `${baseUrl}${signaturePath}`,
        requestOptions
      );
      externalTrafficObserver.recordKodiakRequest(
        signaturePath,
        credentials.accountId
      );

      logger.debug("Kodiak API response received", {
        status: response.status,
        statusText: response.statusText,
      });

      if (!response.ok) {
        const errorText = await response.text();
        externalTrafficObserver.recordKodiakError(
          signaturePath,
          response.status
        );
        logger.warn("Kodiak API error response", {
          status: response.status,
          statusText: response.statusText,
          error: errorText,
        });
        throw new Error(
          `Kodiak API error: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      const responseData = await response.json();
      return responseData as T;
    } catch (error) {
      logger.error("Kodiak API request failed", error as Error, {
        method,
        path,
        accountId: credentials.accountId,
      });
      throw error;
    }
  }

  /**
   * Generate Kodiak API signature using Ed25519
   */
  private async generateKodiakSignature(
    message: string,
    secretKey: string
  ): Promise<string> {
    try {
      // Get cached crypto modules to prevent memory leaks
      const { cryptoModule, bs58Module, ed25519Module } =
        await this.getCryptoModules();

      const sha512Hash = (message: Uint8Array) => {
        const hash = cryptoModule.createHash("sha512");
        hash.update(message);
        return new Uint8Array(hash.digest());
      };

      // Set hash function - using type assertions for third-party library
      const ed25519Lib = ed25519Module as unknown as {
        hashes?: { sha512?: (message: Uint8Array) => Uint8Array };
        etc?: { sha512Sync?: (message: Uint8Array) => Uint8Array };
        utils?: { sha512Sync?: (message: Uint8Array) => Uint8Array };
        sign?: (
          message: Uint8Array,
          privateKey: Uint8Array
        ) => Uint8Array | Promise<Uint8Array>;
      };

      if (ed25519Lib.hashes) {
        ed25519Lib.hashes.sha512 = sha512Hash;
      } else if (
        ed25519Lib.etc &&
        typeof ed25519Lib.etc?.sha512Sync !== "undefined"
      ) {
        ed25519Lib.etc.sha512Sync = sha512Hash;
      } else if (ed25519Lib.utils) {
        ed25519Lib.utils.sha512Sync = sha512Hash;
      }

      // Normalize the secret key before decoding. Orderly exports the
      // ed25519 secret in several accepted formats:
      //   - "ed25519:<base58>" (the canonical export format)
      //   - "0x<hex>"          (raw hex, e.g. MetaMask-style export)
      //   - plain base58       (legacy)
      const normalizedKey = secretKey.trim().replace(/^ed25519:/i, "");
      let privateKey: Uint8Array;
      if (/^0x[0-9a-fA-F]+$/.test(normalizedKey)) {
        privateKey = new Uint8Array(Buffer.from(normalizedKey.slice(2), "hex"));
      } else {
        privateKey = bs58Module.default.decode(normalizedKey);
      }
      const messageBytes = new TextEncoder().encode(message);
      const signature =
        (await ed25519Lib.sign?.(messageBytes, privateKey)) ||
        Promise.resolve(new Uint8Array());
      const signatureResult = await (signature instanceof Promise
        ? signature
        : Promise.resolve(signature));

      return Buffer.from(signatureResult).toString("base64url");
    } catch (error) {
      logger.error("Failed to generate Kodiak signature", error as Error);
      throw error;
    }
  }

  /**
   * Test Kodiak API connectivity
   */
  async testConnectivity(
    credentials: KodiakCredentials
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // If this call succeeds without throwing, credentials are valid
      await this.makeKodiakRequest("GET", "/client/info", credentials);

      logger.info("Kodiak API connectivity test successful", {
        accountId: credentials.accountId,
      });
      return { success: true };
    } catch (error) {
      logger.error("Kodiak API connectivity test error", error as Error, {
        accountId: credentials.accountId,
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : "Connection failed",
      };
    }
  }

  /**
   * Clear cached data for a user (useful after trades or updates)
   */
  async invalidateUserCache(userId: string): Promise<void> {
    try {
      // Clear all cache entries for this user
      const clearedEntries = kodiakCache.clearUserCache(userId);

      logger.info("Kodiak cache invalidated for user", {
        userId,
        entriesCleared: clearedEntries,
      });
    } catch (error) {
      logger.error("Failed to invalidate Kodiak cache", error as Error, {
        userId,
      });
    }
  }
}

// Mount the decomposed method bags onto the prototype (declaration merging
// gives the class its full public surface).
type KodiakPrivateDataMethods = typeof privateDataMethods;
type KodiakMarketDataMethods = typeof marketDataMethods;
export interface KodiakIntegrationService
  extends KodiakPrivateDataMethods, KodiakMarketDataMethods {}
Object.assign(
  KodiakIntegrationService.prototype,
  privateDataMethods,
  marketDataMethods
);

// Export singleton instance
export const kodiakIntegrationService = new KodiakIntegrationService();
