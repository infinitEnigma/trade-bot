/**
 * Kodiak credentials resolution for a user.
 *
 * Extracted from the former monolithic `kodiak-integration.service.ts`
 * (body verbatim). Handles decryption fallback: current envelope →
 * versioned envelope → plain-text legacy rows.
 */

import { query } from "../../../database/pool";
import { encryptionService } from "../../security/encryption.service";
import { integrationLogger as logger } from "../../../core/logging/context-aware-logger.service";
import type { KodiakCredentials } from "./types";

/**
 * Get decrypted Kodiak credentials for a user
 */
export async function getUserCredentials(
  userId: string
): Promise<KodiakCredentials | null> {
    try {
        const result = await query<{
            account_id: string;
            api_key_encrypted: string;
            secret_key_encrypted: string;
            verified: boolean;
        }>(
            "SELECT account_id, api_key_encrypted, secret_key_encrypted, verified FROM kodiak_credentials WHERE user_id = $1 AND verified = true",
            [userId]
        );

        if (result.rows.length === 0) {
            return null;
        }

        const row = result.rows[0];

        // Try to decrypt with regular method first (for newly encrypted data)
        let apiKey: string;
        let secretKey: string;

        try {
            apiKey = encryptionService.decryptApiKey(row.api_key_encrypted);
            secretKey = encryptionService.decryptSecretKey(row.secret_key_encrypted);
        } catch (error) {
      logger.error(
        "Failed to decrypt Kodiak credentials with regular method, trying versioned",
        error as Error,
        {
                userId,
                error: error instanceof Error ? error.message : String(error),
        }
      );

            // Try versioned decryption (for older data)
            try {
        apiKey = await encryptionService.decryptWithVersion(
          row.api_key_encrypted
        );
        secretKey = await encryptionService.decryptWithVersion(
          row.secret_key_encrypted
        );
            } catch (versionError) {
        logger.error(
          "Failed to decrypt with versioned method, assuming plain text",
          versionError as Error,
          {
                    userId,
            error:
              versionError instanceof Error
                ? versionError.message
                : String(versionError),
          }
        );

                // Assume plain text (for backward compatibility)
                apiKey = row.api_key_encrypted;
                secretKey = row.secret_key_encrypted;
            }
        }

        return {
            accountId: row.account_id,
            apiKey,
            secretKey,
        };
    } catch (error) {
        logger.error("Failed to get Kodiak credentials", error as Error, {
            userId,
            error: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
}
