/** @format */

/**
 * venue-owner (X4) — public-endpoint owner resolution.
 *
 * axios is mocked per case: the module must return a normalized address for a
 * well-formed payload and `null` for malformed, HTTP-error and network
 * failures (fail-closed — the caller never binds on a guess).
 */

import axios from "axios";
import {
  normalizeEvmAddress,
  resolveKodiakOwner,
  resolveLighterOwner,
  resolveVenueOwner,
} from "../../src/infrastructure/external/exchange-accounts/venue-owner";

jest.mock("axios");

const mockGet = axios.get as jest.Mock;

const KODIAK_OWNER = "0x933e111111111111111111111111111111111111";
const LIGHTER_OWNER = "0x2222222222222222222222222222222222222222";

beforeEach(() => {
  jest.clearAllMocks();
});

describe("normalizeEvmAddress", () => {
  it("lowercases a valid 0x address", () => {
    expect(normalizeEvmAddress("0xAbCd")).toBeNull();
    expect(normalizeEvmAddress("0x" + "A".repeat(40))).toBe("0x" + "a".repeat(40));
  });
  it("returns null for non-strings, wrong length and non-0x", () => {
    expect(normalizeEvmAddress(undefined)).toBeNull();
    expect(normalizeEvmAddress(42)).toBeNull();
    expect(normalizeEvmAddress("0x1234")).toBeNull();
    expect(normalizeEvmAddress("not-0x-prefixed-" + "1".repeat(40))).toBeNull();
  });
});

describe("resolveKodiakOwner", () => {
  it("reads data.address and normalizes it", async () => {
    mockGet.mockResolvedValue({
      data: { data: { address: "0x933E111111111111111111111111111111111111" } },
    });
    const owner = await resolveKodiakOwner({ exchange: "kodiak", environment: "mainnet", accountId: "acct-1" });
    expect(owner).toBe(KODIAK_OWNER.toLowerCase());
  });

  it("falls back to a top-level address", async () => {
    mockGet.mockResolvedValue({ data: { address: KODIAK_OWNER } });
    const owner = await resolveKodiakOwner({ exchange: "kodiak", environment: "mainnet", accountId: "acct-1" });
    expect(owner).toBe(KODIAK_OWNER.toLowerCase());
  });

  it("returns null on a malformed payload", async () => {
    mockGet.mockResolvedValue({ data: { data: { address: 12345 } } });
    expect(await resolveKodiakOwner({ exchange: "kodiak", environment: "mainnet", accountId: "a" })).toBeNull();
  });

  it("returns null on an HTTP error (fail-closed)", async () => {
    const err = Object.assign(new Error("Not Found"), { isAxiosError: true, response: { status: 404 } });
    mockGet.mockRejectedValue(err);
    expect(await resolveKodiakOwner({ exchange: "kodiak", environment: "mainnet", accountId: "a" })).toBeNull();
  });

  it("returns null when accountId is absent", async () => {
    expect(await resolveKodiakOwner({ exchange: "kodiak", environment: "mainnet" })).toBeNull();
    expect(mockGet).not.toHaveBeenCalled();
  });
});

describe("resolveLighterOwner", () => {
  it("reads accounts[0].l1_address", async () => {
    mockGet.mockResolvedValue({ data: { accounts: [{ l1_address: LIGHTER_OWNER }] } });
    const owner = await resolveLighterOwner({ exchange: "lighter", environment: "testnet", accountIndex: 42 });
    expect(owner).toBe(LIGHTER_OWNER.toLowerCase());
  });

  it("returns null when the accounts array is empty", async () => {
    mockGet.mockResolvedValue({ data: { accounts: [] } });
    expect(await resolveLighterOwner({ exchange: "lighter", environment: "testnet", accountIndex: 42 })).toBeNull();
  });

  it("returns null on a malformed account row", async () => {
    mockGet.mockResolvedValue({ data: { accounts: [{ l1_address: null }] } });
    expect(await resolveLighterOwner({ exchange: "lighter", environment: "testnet", accountIndex: 42 })).toBeNull();
  });

  it("returns null on a network error (fail-closed)", async () => {
    mockGet.mockRejectedValue(new Error("ECONNREFUSED"));
    expect(await resolveLighterOwner({ exchange: "lighter", environment: "testnet", accountIndex: 42 })).toBeNull();
  });

  it("returns null when accountIndex is absent", async () => {
    expect(await resolveLighterOwner({ exchange: "lighter", environment: "testnet" })).toBeNull();
    expect(mockGet).not.toHaveBeenCalled();
  });
});

describe("resolveVenueOwner (dispatch)", () => {
  it("dispatches kodiak", async () => {
    mockGet.mockResolvedValue({ data: { data: { address: KODIAK_OWNER } } });
    expect(await resolveVenueOwner({ exchange: "kodiak", environment: "mainnet", accountId: "a" })).toBe(KODIAK_OWNER.toLowerCase());
  });
  it("dispatches lighter", async () => {
    mockGet.mockResolvedValue({ data: { accounts: [{ l1_address: LIGHTER_OWNER }] } });
    expect(await resolveVenueOwner({ exchange: "lighter", environment: "testnet", accountIndex: 1 })).toBe(LIGHTER_OWNER.toLowerCase());
  });
});
