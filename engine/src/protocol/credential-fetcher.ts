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
import { logger } from "../utils/logger";
import { FetchCredentialsResult } from "../domain/bot-runtime";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3000";
const BOT_ENGINE_API_KEY = process.env.BOT_ENGINE_API_KEY || "";

/**
 * Fetch Kodiak credentials for a bot from the backend.
 * Uses the correlationId for request tracing.
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

    const { accountId, accessKey, secretKey } = response.data.data;

  logger.info("Credentials fetched for bot", { botId, accountId });

    return { accountId, accessKey, secretKey };
}
