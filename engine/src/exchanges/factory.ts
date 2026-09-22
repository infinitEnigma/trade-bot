/** @format */

/**
 * Exchange client factory.
 *
 * Selects the exchange client implementation from the credential envelope
 * the backend issued (see `shared/src/types/engine-credentials.ts`). This is
 * the only place in the engine that maps an `exchange` discriminator onto a
 * concrete client — everything upstream (strategy, BotManager, reconciliation
 * layer) speaks `ExchangeClient` only (EXCHANGE_INTEGRATION_PLAN.md §0).
 */

import { EngineCredentials } from "@trade-bot/shared";
import { OrderlyClient } from "./kodiak/client";
import { LighterClient } from "./lighter/client";
import { CommandError } from "../application/command-error";
import { SignerError } from "../domain/signer";
import {
  LighterSidecarSigner,
  lighterSidecarConfigFromEnv,
} from "../infrastructure/signer/lighter-sidecar";

/** Lighter REST endpoints per environment (probe `config.py`). */
function lighterBaseUrl(environment: string): string {
  return environment === "mainnet"
    ? "https://mainnet.zklighter.elliot.ai"
    : "https://testnet.zklighter.elliot.ai";
}

/**
 * Construct the exchange client for a validated credential envelope.
 *
 * The environment mapping is a deliberate stop-gap until C3 delivers a real
 * account reference (plan §1): kodiak → the Orderly REST base URL;
 * lighter → the Lighter REST base URL plus the signing sidecar (B2/B3).
 *
 * @throws CommandError (retryable: false) when the envelope names an exchange
 *         this engine cannot serve — surfaced as COMMAND_FAILED, never retried.
 */
export function createExchangeClient(credentials: EngineCredentials) {
  switch (credentials.exchange) {
    case "kodiak":
      return new OrderlyClient({
        accountId: credentials.credentials.accountId,
        orderlyKey: credentials.credentials.accessKey,
        orderlySecret: credentials.credentials.secretKey,
        baseUrl:
          credentials.environment === "mainnet"
            ? "https://api.orderly.org"
            : "https://testnet-api.orderly.org",
      });
    case "lighter": {
      let sidecar;
      try {
        sidecar = new LighterSidecarSigner(lighterSidecarConfigFromEnv());
      } catch (error) {
        const message =
          error instanceof SignerError
            ? error.message
            : String(error instanceof Error ? error.message : error);
        throw new CommandError(
          false,
          `LIGHTER_SIDECAR_URL misconfigured: ${message}`
        );
      }
      return new LighterClient({
        baseUrl: lighterBaseUrl(credentials.environment),
        credentials: {
          accountIndex: credentials.credentials.accountIndex,
          apiKeyIndex: credentials.credentials.apiKeyIndex,
          privateKey: credentials.credentials.privateKey,
          env: credentials.environment,
        },
        signer: sidecar,
      });
    }
    default: {
      // Exhaustiveness guard: adding a union member without a factory arm
      // becomes a compile error, not a runtime surprise.
      const exhaustive: never = credentials;
      throw new CommandError(
        false,
        `UNSUPPORTED_EXCHANGE: ${JSON.stringify(exhaustive)}`
      );
    }
  }
}
