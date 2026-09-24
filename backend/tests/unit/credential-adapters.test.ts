/** @format */

/**
 * Venue credential adapters (C2).
 *
 * Kodiak rules are asserted verbatim (they were inherited from the retired
 * `kodiak-connection.service.ts`, so behaviour must not drift). Lighter rules
 * live-verified on testnet: the signer sidecar rejects `account_index < 1` and
 * `api_key_index > 254`, and the native signer requires a 40-byte (80 hex char)
 * private key — "invalid private key length. expected: 40 got: 32" for the
 * 32-byte form.
 */

import {
  getCredentialAdapter,
  isValidLighterPrivateKey,
  kodiakCredentialAdapter,
  LIGHTER_MAX_API_KEY_INDEX,
  lighterCredentialAdapter,
} from "../../src/infrastructure/external/exchange-accounts/credential-adapters";

const KODIAK = {
  exchange: "kodiak" as const,
  environment: "testnet" as const,
  accountId: "myname12345",
  apiKey: "ed25519:abcdef",
  secretKey: "s".repeat(30),
};

const LIGHTER = {
  exchange: "lighter" as const,
  environment: "testnet" as const,
  accountIndex: 404,
  apiKeyIndex: 4,
  privateKey: "a".repeat(80),
};

describe("kodiakCredentialAdapter", () => {
  it("accepts a well-formed request and keeps the account id as the ref", () => {
    expect(kodiakCredentialAdapter.validate(KODIAK)).toEqual({ valid: true });
    expect(kodiakCredentialAdapter.accountRef(KODIAK)).toBe("myname12345");
    expect(kodiakCredentialAdapter.toPlaintext(KODIAK)).toEqual({
      exchange: "kodiak",
      accountId: "myname12345",
      apiKey: "ed25519:abcdef",
      secretKey: KODIAK.secretKey,
    });
  });

  it("keeps the legacy length/prefix rules", () => {
    expect(
      kodiakCredentialAdapter.validate({ ...KODIAK, accountId: "short" }).error
    ).toBe("Invalid account ID format");
    expect(
      kodiakCredentialAdapter.validate({ ...KODIAK, apiKey: "abcdef" }).error
    ).toBe("Invalid API key format");
    expect(
      kodiakCredentialAdapter.validate({ ...KODIAK, secretKey: "tiny" }).error
    ).toBe("Invalid secret key format");
  });

  it("rejects another venue's request shape", () => {
    expect(kodiakCredentialAdapter.validate(LIGHTER)).toEqual({
      valid: false,
      error: "Not a kodiak request",
    });
  });
});

describe("lighterCredentialAdapter", () => {
  it("accepts indices and an 80-hex key, with or without 0x", () => {
    expect(lighterCredentialAdapter.validate(LIGHTER)).toEqual({ valid: true });
    expect(
      lighterCredentialAdapter.validate({ ...LIGHTER, privateKey: `0x${"b".repeat(80)}` })
    ).toEqual({ valid: true });
    expect(isValidLighterPrivateKey("a".repeat(80))).toBe(true);
    expect(isValidLighterPrivateKey(`0x${"A".repeat(80)}`)).toBe(true);
  });

  it("uses the account index as the ref", () => {
    expect(lighterCredentialAdapter.accountRef(LIGHTER)).toBe("404");
    expect(lighterCredentialAdapter.toPlaintext(LIGHTER)).toEqual({
      exchange: "lighter",
      accountIndex: 404,
      apiKeyIndex: 4,
      privateKey: LIGHTER.privateKey,
    });
  });

  it("rejects the indices the sidecar's contract rejects", () => {
    expect(
      lighterCredentialAdapter.validate({ ...LIGHTER, accountIndex: 0 }).error
    ).toBe("Invalid account index");
    expect(
      lighterCredentialAdapter.validate({ ...LIGHTER, accountIndex: 1.5 }).error
    ).toBe("Invalid account index");
    expect(
      lighterCredentialAdapter.validate({ ...LIGHTER, apiKeyIndex: -1 }).error
    ).toBe("Invalid API key index");
    expect(
      lighterCredentialAdapter.validate({
        ...LIGHTER,
        apiKeyIndex: LIGHTER_MAX_API_KEY_INDEX + 1,
      }).error
    ).toBe("Invalid API key index");
  });

  it("rejects a key that is not 40 bytes, explaining the rule", () => {
    const result = lighterCredentialAdapter.validate({
      ...LIGHTER,
      privateKey: "a".repeat(64),
    });
    expect(result.valid).toBe(false);
    expect(result.error).toBe(
      "Invalid private key: expected 80 hex characters (40 bytes)"
    );
    expect(
      lighterCredentialAdapter.validate({ ...LIGHTER, privateKey: "zz".repeat(40) })
        .valid
    ).toBe(false);
  });

  it("rejects another venue's request shape", () => {
    expect(lighterCredentialAdapter.validate(KODIAK)).toEqual({
      valid: false,
      error: "Not a lighter request",
    });
  });
});

describe("getCredentialAdapter", () => {
  it("resolves both venues and nothing else", () => {
    expect(getCredentialAdapter("kodiak")).toBe(kodiakCredentialAdapter);
    expect(getCredentialAdapter("lighter")).toBe(lighterCredentialAdapter);
    expect(getCredentialAdapter("binance")).toBeNull();
  });
});
