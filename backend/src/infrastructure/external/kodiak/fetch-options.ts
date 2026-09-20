/**
 * Kodiak HTTP fetch plumbing shared by all public (unauthenticated) endpoints.
 *
 * Extracted from the former monolithic `kodiak-integration.service.ts` — the
 * createAbortController/createFetchOptions bodies are verbatim; the class now
 * delegates to these functions so there is a single implementation.
 */

export const KODIAK_DEFAULT_BASE_URL = "https://api.orderly.org";

export const KODIAK_USER_AGENT = "Mozilla/5.0 (compatible; TradeBot/1.0)";

export const KODIAK_REQUEST_TIMEOUT = 30000; // 30 seconds timeout for API requests

export function getKodiakBaseUrl(): string {
  return process.env.KODIAK_API_URL || KODIAK_DEFAULT_BASE_URL;
}

export function getKodiakPublicHeaders(): Record<string, string> {
  return {
    Accept: "application/json",
    "User-Agent": KODIAK_USER_AGENT,
  };
}

/**
 * Create an AbortController with timeout for request cancellation
 */
export function createAbortController(
  timeout: number = KODIAK_REQUEST_TIMEOUT
): AbortController {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  controller.signal.addEventListener("abort", () => clearTimeout(timeoutId));
  return controller;
}

/**
 * Create fetch options with proper timeout and connection management
 */
export function createFetchOptions(
  additionalOptions: RequestInit = {}
): RequestInit {
  const controller = createAbortController();

  return {
    ...additionalOptions,
    signal: controller.signal,
    // Disable keep-alive to prevent connection hanging in tests
    headers: {
      ...additionalOptions.headers,
      Connection: process.env.NODE_ENV === "test" ? "close" : "keep-alive",
    },
  };
}
