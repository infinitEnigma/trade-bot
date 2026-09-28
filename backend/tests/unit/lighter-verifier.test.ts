/** @format */

/**
 * LighterAccountVerifier (C2/B3) — live credential verification.
 *
 * The behavior asserted here was established against the real testnet venue:
 * `POST /v1/verify-credentials` returns `{ok:true}` for the registered key, a
 * venue reason naming the two PUBLIC keys for a wrong key, and an
 * "no api key returned for index N" reason for an unregistered index. A wrong
 * key is a failure, so a sidecar problem must never yield `verified: true`.
 */

import type { AxiosInstance } from "axios";
import {
  LIGHTER_TESTNET_URL,
  LighterAccountVerifier,
  lighterVerifierConfigFromEnv,
} from "../../src/infrastructure/external/exchange-accounts/lighter-verifier";

const CREDENTIALS = {
  accountIndex: 404,
  apiKeyIndex: 4,
  privateKey: `0x${"ab".repeat(40)}`,
  environment: "testnet",
};

function mockClients() {
  const venue = { get: jest.fn() } as unknown as AxiosInstance & {
    get: jest.Mock;
  };
  const sidecar = { post: jest.fn() } as unknown as AxiosInstance & {
    post: jest.Mock;
  };
  return { venue, sidecar };
}

function axiosError(status: number, data?: unknown) {
  return {
    isAxiosError: true,
    response: { status, data },
    message: `Request failed with status code ${status}`,
  };
}

describe("LighterAccountVerifier", () => {
  it("verifies when the account exists and the venue accepts the key", async () => {
    const { venue, sidecar } = mockClients();
    venue.get.mockResolvedValue({
      data: { accounts: [{ account_index: 404 }] },
    });
    sidecar.post.mockResolvedValue({ data: { ok: true } });
    const verifier = new LighterAccountVerifier(
      { sidecarUrl: "http://127.0.0.1:8790" },
      { clients: { venue, sidecar } }
    );

    const result = await verifier.verify(CREDENTIALS);

    expect(result).toEqual({ verified: true });
    expect(venue.get).toHaveBeenCalledWith("/api/v1/account", {
      params: { by: "index", value: "404" },
    });
    expect(sidecar.post).toHaveBeenCalledWith("/v1/verify-credentials", {
      account_index: 404,
      api_key_index: 4,
      private_key: CREDENTIALS.privateKey,
      env: "testnet",
    });
  });

  it("reports a missing account and never asks the sidecar", async () => {
    const { venue, sidecar } = mockClients();
    venue.get.mockResolvedValue({ data: { accounts: [] } });
    const verifier = new LighterAccountVerifier(
      { sidecarUrl: "http://127.0.0.1:8790" },
      { clients: { venue, sidecar } }
    );

    const result = await verifier.verify(CREDENTIALS);

    expect(result.verified).toBe(false);
    expect(result.error).toBe("Lighter account 404 was not found on testnet");
    expect(sidecar.post).not.toHaveBeenCalled();
  });

  it("treats a 4xx account lookup as not found", async () => {
    const { venue, sidecar } = mockClients();
    venue.get.mockRejectedValue(
      axiosError(400, { code: 29404, message: "not found" })
    );
    const verifier = new LighterAccountVerifier(
      {},
      { clients: { venue, sidecar } }
    );

    const result = await verifier.verify(CREDENTIALS);

    expect(result.error).toBe("Lighter account 404 was not found on testnet");
  });

  it("treats a venue network failure as unreachable", async () => {
    const { venue, sidecar } = mockClients();
    venue.get.mockRejectedValue(new Error("ECONNREFUSED"));
    const verifier = new LighterAccountVerifier(
      {},
      { clients: { venue, sidecar } }
    );

    const result = await verifier.verify(CREDENTIALS);

    expect(result.verified).toBe(false);
    expect(result.error).toBe(
      `Lighter venue unreachable (${LIGHTER_TESTNET_URL})`
    );
  });

  it("fails closed with the venue reason when the key does not match", async () => {
    const { venue, sidecar } = mockClients();
    venue.get.mockResolvedValue({ data: { accounts: [{}] } });
    sidecar.post.mockResolvedValue({
      data: {
        ok: false,
        error:
          "private key does not match the one on Lighter. ownPubKey: 5e91 response: 6a20 on api key 4",
      },
    });
    const verifier = new LighterAccountVerifier(
      { sidecarUrl: "http://127.0.0.1:8790" },
      { clients: { venue, sidecar } }
    );

    const result = await verifier.verify(CREDENTIALS);

    expect(result.verified).toBe(false);
    expect(result.error).toContain(
      "Lighter rejected the API key for account 404"
    );
    expect(result.error).toContain("does not match the one on Lighter");
  });

  it("fails closed when the sidecar is unreachable", async () => {
    const { venue, sidecar } = mockClients();
    venue.get.mockResolvedValue({ data: { accounts: [{}] } });
    sidecar.post.mockRejectedValue(new Error("ECONNREFUSED"));
    const verifier = new LighterAccountVerifier(
      { sidecarUrl: "http://127.0.0.1:8790" },
      { clients: { venue, sidecar } }
    );

    const result = await verifier.verify(CREDENTIALS);

    expect(result).toEqual({
      verified: false,
      error: "Lighter signer sidecar unreachable at http://127.0.0.1:8790",
    });
  });

  it("surfaces a sidecar 5xx detail", async () => {
    const { venue, sidecar } = mockClients();
    venue.get.mockResolvedValue({ data: { accounts: [{}] } });
    sidecar.post.mockRejectedValue(
      axiosError(502, { detail: "signer error: invalid private key length" })
    );
    const verifier = new LighterAccountVerifier(
      { sidecarUrl: "http://127.0.0.1:8790" },
      { clients: { venue, sidecar } }
    );

    const result = await verifier.verify(CREDENTIALS);

    expect(result.error).toBe(
      "Lighter signer sidecar error: signer error: invalid private key length"
    );
  });

  it("fails closed when no sidecar is configured", async () => {
    const verifier = new LighterAccountVerifier({});

    const result = await verifier.verify(CREDENTIALS);

    expect(result.verified).toBe(false);
    expect(result.error).toContain("LIGHTER_SIDECAR_URL");
  });

  it("reads its configuration from the process environment", () => {
    expect(
      lighterVerifierConfigFromEnv({
        LIGHTER_SIDECAR_URL: "http://127.0.0.1:8790 ",
        SIDECAR_AUTH_TOKEN: "secret",
        LIGHTER_BASE_URL: "https://example.test",
      } as NodeJS.ProcessEnv)
    ).toEqual({
      sidecarUrl: "http://127.0.0.1:8790",
      sidecarAuthToken: "secret",
      baseUrl: "https://example.test",
    });
    expect(lighterVerifierConfigFromEnv({} as NodeJS.ProcessEnv)).toEqual({});
  });

  it("bounds the venue reason it echoes back and never leaks the key", async () => {
    const { venue, sidecar } = mockClients();
    venue.get.mockResolvedValue({ data: { accounts: [{}] } });
    sidecar.post.mockResolvedValue({
      data: { ok: false, error: "x".repeat(1000) },
    });
    const verifier = new LighterAccountVerifier(
      { sidecarUrl: "http://127.0.0.1:8790" },
      { clients: { venue, sidecar } }
    );

    const result = await verifier.verify(CREDENTIALS);

    expect(result.error?.length).toBeLessThanOrEqual(360);
    expect(result.error).not.toContain(CREDENTIALS.privateKey);
  });

  describe("L5 venue-aware logging", () => {
    const mockLogger = () => ({ info: jest.fn(), warn: jest.fn() });
    const logged = (logger: ReturnType<typeof mockLogger>) =>
      JSON.stringify([...logger.info.mock.calls, ...logger.warn.mock.calls]);

    it("narrates both live steps with the venue, environment and timings", async () => {
      const { venue, sidecar } = mockClients();
      venue.get.mockResolvedValue({ data: { accounts: [{}] } });
      sidecar.post.mockResolvedValue({ data: { ok: true } });
      const logger = mockLogger();
      const verifier = new LighterAccountVerifier(
        { sidecarUrl: "http://127.0.0.1:8790" },
        { clients: { venue, sidecar }, logger }
      );

      await verifier.verify(CREDENTIALS);

      expect(logger.info).toHaveBeenCalledWith(
        "Lighter credentials verified",
        expect.objectContaining({
          exchange: "lighter",
          environment: "testnet",
          accountIndex: 404,
          apiKeyIndex: 4,
          accountLookupMs: expect.any(Number),
          keyOwnershipMs: expect.any(Number),
          durationMs: expect.any(Number),
        })
      );
      expect(logger.warn).not.toHaveBeenCalled();
      expect(logged(logger)).not.toContain(CREDENTIALS.privateKey);
    });

    it("names the venue and the failing step when the key is rejected", async () => {
      const { venue, sidecar } = mockClients();
      venue.get.mockResolvedValue({ data: { accounts: [{}] } });
      sidecar.post.mockResolvedValue({
        data: { ok: false, error: "private key does not match" },
      });
      const logger = mockLogger();
      const verifier = new LighterAccountVerifier(
        { sidecarUrl: "http://127.0.0.1:8790" },
        { clients: { venue, sidecar }, logger }
      );

      const result = await verifier.verify(CREDENTIALS);

      expect(result.verified).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(
        "Lighter verification failed - key ownership",
        expect.objectContaining({
          exchange: "lighter",
          environment: "testnet",
          step: "key-ownership",
          durationMs: expect.any(Number),
          reason: expect.stringContaining("private key does not match"),
        })
      );
      expect(logger.info).not.toHaveBeenCalled();
    });

    it("names the failing step when the account index does not exist", async () => {
      const { venue, sidecar } = mockClients();
      venue.get.mockResolvedValue({ data: { accounts: [] } });
      const logger = mockLogger();
      const verifier = new LighterAccountVerifier(
        { sidecarUrl: "http://127.0.0.1:8790" },
        { clients: { venue, sidecar }, logger }
      );

      const result = await verifier.verify(CREDENTIALS);

      expect(result.verified).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(
        "Lighter verification failed - account lookup",
        expect.objectContaining({
          exchange: "lighter",
          step: "account-lookup",
          reason: "Lighter account 404 was not found on testnet",
        })
      );
      expect(sidecar.post).not.toHaveBeenCalled();
    });

    it("warns when the fail-closed path is taken because no sidecar is configured", async () => {
      const logger = mockLogger();
      const verifier = new LighterAccountVerifier({}, { logger });

      const result = await verifier.verify(CREDENTIALS);

      expect(result.verified).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("signer sidecar is not configured"),
        expect.objectContaining({
          exchange: "lighter",
          environment: "testnet",
          accountIndex: 404,
        })
      );
      expect(logged(logger)).not.toContain(CREDENTIALS.privateKey);
    });
  });
});
