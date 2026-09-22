/**
 * Credential Fetcher
 *
 * Fetches Kodiak credentials from the backend API.
 * Credentials are never sent through Redis Streams - they are
 * fetched out-of-band after COMMAND_ACCEPTED.
 *
 * @format
 */

import axios from "axios";
import { isEngineCredentials } from "@trade-bot/shared";
import { logger } from "../utils/logger";
import { FetchCredentialsResult } from "../domain/bot-runtime";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3000";
const BOT_ENGINE_API_KEY = process.env.BOT_ENGINE_API_KEY || "";

/**
 * Fetch the credential envelope for a bot from the backend.
 * Uses the correlationId for request tracing.
 *
 * The envelope is validated against the shared EngineCredentials contract
 * before it is returned, so a malformed payload fails here — never inside
 * exchange code or mid-initialization.
 */
export async function fetchCredentials(
  botId: string,
  correlationId: string
): Promise<FetchCredentialsResult> {
  const response = await axios.get(
    `${BACKEND_URL}/api/bot/engine/credentials/${botId}`,
    {
      headers: {
        "x-correlation-id": correlationId,
        "x-bot-engine-key": BOT_ENGINE_API_KEY,
      },
      timeout: 10000,
    }
  );

  const envelope: unknown = response.data?.data;
  if (!isEngineCredentials(envelope)) {
    throw new Error(
      "Backend returned a malformed credential envelope (expected EngineCredentials)"
    );
  }

  logger.info("Credentials fetched for bot", {
    botId,
    accountRef: envelope.accountRef,
    exchange: envelope.exchange,
    environment: envelope.environment,
  });

  return envelope;
}
