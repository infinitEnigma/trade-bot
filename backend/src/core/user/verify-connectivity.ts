/**
 * The single `verifyConnectivity` implementation for ExchangeAccountService (C2).
 *
 * Two call sites used to inline their own copy (ServiceFactory and the DI
 * container) and both hard-coded `{ verified: true }` for Lighter, which meant a
 * Lighter account could reach ACTIVE without its key ever being proven. One
 * shared factory removes that drift: Kodiak delegates to the existing
 * connectivity probe, Lighter to the venue-backed verifier, and an unknown venue
 * fails closed.
 *
 * @format
 */

import type { ConnectExchangeAccountRequest } from "@trade-bot/shared";

/** Port: Lighter account verification. Implemented by `LighterAccountVerifier`
 * in `infrastructure/external/exchange-accounts/lighter-verifier`; core never
 * imports that concrete class. */
export interface ILighterAccountVerifier {
  verify(credentials: {
    accountIndex: number;
    apiKeyIndex: number;
    privateKey: string;
    environment: string;
  }): Promise<{ verified: boolean; error?: string }>;
}

export interface KodiakConnectivityProbe {
  testConnectivity(input: {
    accountId: string;
    apiKey: string;
    secretKey: string;
  }): Promise<{ success: boolean; error?: string }>;
}

export interface VerifyConnectivityDeps {
  kodiakIntegrationService: KodiakConnectivityProbe;
  lighterVerifier: ILighterAccountVerifier;
}

export type VerifyConnectivity = (
  request: ConnectExchangeAccountRequest
) => Promise<{ verified: boolean; error?: string }>;

export function createVerifyConnectivity(
  deps: VerifyConnectivityDeps
): VerifyConnectivity {
  return async request => {
    if (request.exchange === "kodiak") {
      const result = await deps.kodiakIntegrationService.testConnectivity({
        accountId: request.accountId,
        apiKey: request.apiKey,
        secretKey: request.secretKey,
      });
      return result.success
        ? { verified: true }
        : { verified: false, error: result.error };
    }
    return deps.lighterVerifier.verify({
      accountIndex: request.accountIndex,
      apiKeyIndex: request.apiKeyIndex,
      privateKey: request.privateKey,
      environment: request.environment,
    });
  };
}
