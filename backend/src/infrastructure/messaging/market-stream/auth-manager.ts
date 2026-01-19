/** @format */

import WebSocket from "ws";
import logger from "../../services/logger";
import { query } from "../../database/pool";

/**
 * Handles WebSocket authentication with external services
 * Currently supports Orderly Network authentication
 */
export class AuthManager {
  /**
   * Authenticate a WebSocket connection with Orderly Network
   * Uses Ed25519 signature for secure authentication
   */
  async authenticate(ws: WebSocket, accountId: string): Promise<void> {
    try {
      // Get API credentials from database
      const credsResult = await query(
        "SELECT api_key_encrypted, secret_key_encrypted FROM kodiak_credentials WHERE account_id = $1",
        [accountId]
      );

      if (credsResult.rows.length === 0) {
        throw new Error("No credentials found for WebSocket authentication");
      }

      const { encryptionService } =
        await import("../../services/encryption.js");
      const apiKey = encryptionService.decryptApiKey(
        credsResult.rows[0].api_key_encrypted
      );
      const secretKey = encryptionService.decryptSecretKey(
        credsResult.rows[0].secret_key_encrypted
      );

      // Create authentication message
      const timestamp = Date.now();
      const message = `${timestamp}GET/ws/auth${accountId}`;

      // Sign the message using Ed25519
      const bs58 = await import("bs58");
      const ed25519 = await import("@noble/ed25519");

      const privateKey = bs58.default.decode(secretKey);
      const messageBytes = new TextEncoder().encode(message);
      const signature = await ed25519.sign(messageBytes, privateKey);
      const signatureB64 = Buffer.from(signature).toString("base64url");

      // Send authentication message
      const authMessage = JSON.stringify({
        event: "auth",
        id: `auth_${Date.now()}`,
        params: {
          accountId,
          apiKey,
          signature: signatureB64,
          timestamp,
        },
      });

      ws.send(authMessage);
      logger.info("WebSocket authentication message sent", { accountId });
    } catch (error) {
      logger.error("Failed to send WebSocket authentication", {
        error: (error as Error).message,
        accountId,
      });
      throw error;
    }
  }

  /**
   * Validate authentication response from the service
   */
  validateAuthResponse(message: any): boolean {
    try {
      // Check if this is an authentication response
      if (message.event === "auth" || message.method === "AUTH") {
        const isSuccess = message.success || message.code === 0;

        if (isSuccess) {
          logger.info("WebSocket authentication successful");
          return true;
        } else {
          logger.error("WebSocket authentication failed", { message });
          return false;
        }
      }

      // Not an auth response
      return true;
    } catch (error) {
      logger.error("Error validating auth response", {
        error: (error as Error).message,
      });
      return false;
    }
  }

  /**
   * Check if credentials exist for an account
   */
  async hasCredentials(accountId: string): Promise<boolean> {
    try {
      const result = await query(
        "SELECT COUNT(*) as count FROM kodiak_credentials WHERE account_id = $1 AND verified = true",
        [accountId]
      );

      const count = parseInt(result.rows[0].count);
      return count > 0;
    } catch (error) {
      logger.error("Error checking credentials", {
        error: (error as Error).message,
        accountId,
      });
      return false;
    }
  }

  /**
   * Get account ID for authentication
   * This is a simplified version - in production, this might be more complex
   */
  async getAccountId(): Promise<string | null> {
    try {
      const result = await query(
        "SELECT account_id FROM kodiak_credentials LIMIT 1"
      );

      if (result.rows.length === 0) {
        logger.warn("No Kodiak credentials found for WebSocket authentication");
        return null;
      }

      return result.rows[0].account_id;
    } catch (error) {
      logger.error("Error getting account ID", {
        error: (error as Error).message,
      });
      return null;
    }
  }
}
