/** @format */

/**
 * The shared `verifyConnectivity` factory (C2).
 *
 * Regression guard for the drift this replaced: ServiceFactory and the DI
 * container each had their own copy that hard-coded `{verified: true}` for
 * Lighter, so a Lighter account could go ACTIVE with an unproven key.
 */

import { createVerifyConnectivity } from "../../src/core/user/verify-connectivity";

const KODIAK_REQUEST = {
  exchange: "kodiak" as const,
  environment: "testnet" as const,
  accountId: "myname12345",
  apiKey: "ed25519:abcdef",
  secretKey: "s".repeat(30),
};

const LIGHTER_REQUEST = {
  exchange: "lighter" as const,
  environment: "testnet" as const,
  accountIndex: 404,
  apiKeyIndex: 4,
  privateKey: `0x${"ab".repeat(40)}`,
};

describe("createVerifyConnectivity", () => {
  const kodiakIntegrationService = { testConnectivity: jest.fn() };
  const lighterVerifier = { verify: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const factory = () =>
    createVerifyConnectivity({ kodiakIntegrationService, lighterVerifier });

  it("delegates kodiak to the connectivity probe", async () => {
    kodiakIntegrationService.testConnectivity.mockResolvedValue({
      success: true,
    });

    await expect(factory()(KODIAK_REQUEST)).resolves.toEqual({
      verified: true,
    });
    expect(kodiakIntegrationService.testConnectivity).toHaveBeenCalledWith({
      accountId: KODIAK_REQUEST.accountId,
      apiKey: KODIAK_REQUEST.apiKey,
      secretKey: KODIAK_REQUEST.secretKey,
    });
    expect(lighterVerifier.verify).not.toHaveBeenCalled();
  });

  it("propagates the kodiak probe's failure reason", async () => {
    kodiakIntegrationService.testConnectivity.mockResolvedValue({
      success: false,
      error: "Invalid API credentials",
    });

    await expect(factory()(KODIAK_REQUEST)).resolves.toEqual({
      verified: false,
      error: "Invalid API credentials",
    });
  });

  it("delegates lighter to the venue-backed verifier", async () => {
    lighterVerifier.verify.mockResolvedValue({ verified: true });

    await expect(factory()(LIGHTER_REQUEST)).resolves.toEqual({
      verified: true,
    });
    expect(lighterVerifier.verify).toHaveBeenCalledWith({
      accountIndex: 404,
      apiKeyIndex: 4,
      privateKey: LIGHTER_REQUEST.privateKey,
      environment: "testnet",
    });
    expect(kodiakIntegrationService.testConnectivity).not.toHaveBeenCalled();
  });

  it("never passes a lighter account whose key was not proven", async () => {
    lighterVerifier.verify.mockResolvedValue({
      verified: false,
      error: "Lighter signer sidecar unreachable at http://127.0.0.1:8790",
    });

    const result = await factory()(LIGHTER_REQUEST);

    expect(result.verified).toBe(false);
    expect(result.error).toContain("sidecar unreachable");
  });
});
