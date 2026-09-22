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
import { CommandError } from "../application/command-error";

/**
 * Construct the exchange client for a validated credential envelope.
 *
 * The environment mapping is a deliberate stop-gap until C3 delivers a real
 * account reference (plan §1): kodiak → the Orderly REST base URL the client
 * already derives from `NODE_ENV`; lighter → the sidecar URL, once workstream
 * B adds the adapter.
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
    case "lighter":
      // Workstream B lands the LighterClient; the envelope shape is ready.
      throw new CommandError(
        false,
        "UNSUPPORTED_EXCHANGE: lighter client not implemented yet (workstream B)"
      );
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
