/**
 * Shared axios client for Lighter **public** venue reads (X3).
 *
 * Extracted from `portfolio.ts` so the market directory, the trades reader and
 * the new candles reader (`market-data.ts`) share one client pool instead of a
 * circular import. No auth: every call through this client is public market
 * data. Bound tight — dashboard/chart traffic must never hang a request.
 *
 * @format
 */

import axios, { AxiosInstance } from "axios";

/** Live reads are dashboard traffic; keep the venue bound tight. */
export const VENUE_TIMEOUT_MS = 10000;

const venueClients = new Map<string, AxiosInstance>();

export function venueClient(baseUrl: string): AxiosInstance {
  const url = baseUrl.trim().replace(/\/+$/, "");
  let client = venueClients.get(url);
  if (!client) {
    client = axios.create({
      baseURL: url,
      timeout: VENUE_TIMEOUT_MS,
      headers: { "Content-Type": "application/json" },
    });
    venueClients.set(url, client);
  }
  return client;
}
