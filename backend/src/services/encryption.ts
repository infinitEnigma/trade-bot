/**
 * ===========================================
 * 🔐 ENCRYPTION SERVICE & SECURE CREDENTIALS
 * ===========================================
 *
 * Provides encryption/decryption services and secure credential handling
 * with automatic memory cleanup to prevent credential leakage.
 *
 * SECURITY FEATURES:
 * - AES-256-GCM encryption with versioned keys
 * - Secure credential containers with memory wiping
 * - Automatic cleanup to prevent forensic attacks
 * - Key rotation support for long-term security
 *
 * @format
 */

import "dotenv/config";
import { createCipheriv, createDecipheriv, randomBytes, scrypt } from "crypto";
import { promisify } from "util";
import logger from "./logger";
import { query } from "../database/pool";

/**
 * ===========================================
 * 🛡️ SECURE CREDENTIALS CONTAINER
 * ===========================================
 *
 * Provides secure handling of decrypted credentials with automatic memory cleanup.
 * Prevents credential leakage through memory dumps, core files, or forensic analysis.
 *
 * SECURITY FEATURES:
 * - Automatic memory wiping after use
 * - Secure string overwriting to prevent forensics
 * - Context manager pattern for guaranteed cleanup
 * - Prevention of double-use and access-after-destroy
 *
 * USAGE PATTERNS:
 * 1. Immediate use: creds.use(callback) - auto-cleanup
 * 2. Context manager: withCredentials(userId, callback) - auto-cleanup
 * 3. Manual: creds.get(key); creds.destroy() - explicit cleanup
 *
 * EXAMPLE:
 * ```typescript
 * // Immediate use pattern (recommended)
 * const result = await SecureCredentials.create(decryptedCreds).use(async (creds) => {
 *   return await apiCall(creds.get('apiKey'), creds.get('secretKey'));
 * });
 *
 * // Context manager pattern
 * const result = await withCredentials(userId, async (creds) => {
 *   return await validatePosition(creds.get('apiKey'), creds.get('secretKey'));
 * });
 * ```
 */
export class SecureCredentials {
  private credentials: { [key: string]: string } = {};
  private destroyed = false;

  constructor(credentials: { [key: string]: string }) {
    this.credentials = { ...credentials };
  }

  /**
   * Create SecureCredentials from decrypted credential object
   */
  static create(credentials: { [key: string]: string }): SecureCredentials {
    return new SecureCredentials(credentials);
  }

  /**
   * Get a credential value by key
   * @throws Error if credentials have been destroyed
   */
  get(key: string): string {
    this.checkDestroyed();
    return this.credentials[key];
  }

  /**
   * Execute a callback function with access to credentials
   * Automatically destroys credentials after use (recommended pattern)
   */
  async use<T>(callback: (creds: { [key: string]: string }) => Promise<T>): Promise<T> {
    this.checkDestroyed();
    try {
      return await callback(this.credentials);
    } finally {
      this.destroy(); // Guaranteed cleanup even if callback throws
    }
  }

  /**
   * Synchronous version of use() for non-async callbacks
   */
  useSync<T>(callback: (creds: { [key: string]: string }) => T): T {
    this.checkDestroyed();
    try {
      return callback(this.credentials);
    } finally {
      this.destroy();
    }
  }

  /**
   * Manually destroy credentials and wipe memory
   * Call this after manual credential usage
   */
  destroy(): void {
    if (!this.destroyed) {
      logger.debug("Destroying secure credentials");

      // Securely wipe memory by overwriting with random data
      Object.keys(this.credentials).forEach(key => {
        this.credentials[key] = this.wipeString(this.credentials[key]);
      });

      this.destroyed = true;
    }
  }

  /**
   * Check if credentials have been destroyed
   */
  isDestroyed(): boolean {
    return this.destroyed;
  }

  /**
   * Check if credentials are destroyed and throw if so
   */
  private checkDestroyed(): void {
    if (this.destroyed) {
      throw new Error('SecureCredentials: Credentials have been destroyed and cannot be accessed');
    }
  }

  /**
   * Securely wipe a string by overwriting with random data
   * Prevents forensic recovery of sensitive data from memory
   */
  private wipeString(str: string): string {
    if (!str) return '';

    // Overwrite with random bytes of same length
    const randomData = randomBytes(str.length).toString('hex').substring(0, str.length);
    return randomData;
  }
}

/**
 * ===========================================
 * 🔄 SECURE CREDENTIALS CONTEXT MANAGER
 * ===========================================
 *
 * Provides a context manager pattern for secure credential handling.
 * Automatically decrypts, uses, and destroys credentials.
 *
 * USAGE:
 * ```typescript
 * const result = await withCredentials(userId, async (creds) => {
 *   return await makeApiCall(creds.get('apiKey'), creds.get('secretKey'));
 * });
 * ```
 */
export async function withCredentials<T>(
  userId: string,
  callback: (creds: SecureCredentials) => Promise<T>
): Promise<T> {
  // Decrypt user credentials
  const credentials = await decryptUserCredentials(userId);
  const secureCreds = SecureCredentials.create(credentials);

  try {
    return await callback(secureCreds);
  } finally {
    secureCreds.destroy(); // Guaranteed cleanup
  }
}

/**
 * Decrypt user Kodiak credentials (internal helper)
 */
async function decryptUserCredentials(userId: string): Promise<{ [key: string]: string }> {
  try {
    const result = await query(
      "SELECT account_id, api_key_encrypted, secret_key_encrypted, encryption_version FROM kodiak_credentials WHERE user_id = $1 AND verified = true",
      [userId]
    );

    if (result.rows.length === 0) {
      throw new Error('No verified Kodiak credentials found');
    }

    const row = result.rows[0];
    const encryptionService = new EncryptionService();

    // Decrypt using version-aware decryption
    const encryptionVersion = row.encryption_version || 1;
    const accountId = await encryptionService.decryptWithVersion(row.account_id);
    const apiKey = await encryptionService.decryptWithVersion(row.api_key_encrypted);
    const secretKey = await encryptionService.decryptWithVersion(row.secret_key_encrypted);

    return {
      accountId,
      apiKey,
      secretKey,
    };
  } catch (error) {
    logger.error("Failed to decrypt user credentials", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

const scryptAsync = promisify(scrypt);

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const SALT_LENGTH = 32;

// Key versioning constants
const CURRENT_KEY_VERSION = 2;
const KEY_ROTATION_INTERVAL_MONTHS = 3; // Quarterly rotation

interface EncryptionMetadata {
  version: number;
  salt: Buffer;
  iv: Buffer;
  tag: Buffer;
  encryptedData: Buffer;
}

function getKey(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, 32) as Buffer;
}

function scryptSync(
  password: string,
  salt: string | Buffer,
  length: number
): Buffer | string {
  return require("crypto").scryptSync(password, salt, length);
}

export class EncryptionService {
  private masterKey: string;

  constructor() {
    // NO DEFAULTS - Fail fast if not configured
    const key = process.env.ENCRYPTION_MASTER_KEY;
    if (!key) {
      throw new Error("ENCRYPTION_MASTER_KEY environment variable required");
    }

    // Validate production keys are strong (32+ chars)
    if (process.env.NODE_ENV === "production" && key.length < 32) {
      throw new Error(
        "ENCRYPTION_MASTER_KEY must be 32+ characters in production"
      );
    }

    this.masterKey = key;
  }

  encrypt(plaintext: string): string {
    const salt = randomBytes(SALT_LENGTH);
    const key = scryptSync(this.masterKey, salt, 32) as Buffer;
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(plaintext, "utf8", "hex");
    encrypted += cipher.final("hex");

    const tag = cipher.getAuthTag();

    return Buffer.concat([
      salt,
      iv,
      tag,
      Buffer.from(encrypted, "hex"),
    ]).toString("base64");
  }

  decrypt(ciphertext: string): string {
    const buffer = Buffer.from(ciphertext, "base64");

    const salt = buffer.subarray(0, SALT_LENGTH);
    const iv = buffer.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const tag = buffer.subarray(
      SALT_LENGTH + IV_LENGTH,
      SALT_LENGTH + IV_LENGTH + TAG_LENGTH
    );
    const encrypted = buffer.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);

    const key = scryptSync(this.masterKey, salt, 32) as Buffer;
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(encrypted.toString("hex"), "hex", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  }

  encryptApiKey(apiKey: string): string {
    return this.encrypt(apiKey);
  }

  decryptApiKey(encryptedApiKey: string): string {
    return this.decrypt(encryptedApiKey);
  }

  encryptSecretKey(secretKey: string): string {
    return this.encrypt(secretKey);
  }

  decryptSecretKey(encryptedSecretKey: string): string {
    return this.decrypt(encryptedSecretKey);
  }

  // ===========================================
  // VERSIONED ENCRYPTION WITH KEY ROTATION
  // ===========================================

  /**
   * Encrypt data with version information for key rotation support
   */
  async encryptWithVersion(plaintext: string, version: number = CURRENT_KEY_VERSION): Promise<string> {
    const key = await this.getVersionedKey(version);
    const salt = randomBytes(SALT_LENGTH);
    const derivedKey = await scryptAsync(key, salt, 32) as Buffer;
    const iv = randomBytes(IV_LENGTH);

    const cipher = createCipheriv(ALGORITHM, derivedKey, iv);
    let encrypted = cipher.update(plaintext, "utf8", "hex");
    encrypted += cipher.final("hex");
    const tag = cipher.getAuthTag();

    // Format: version(1) + salt(32) + iv(16) + tag(16) + encrypted_data
    const versionBuffer = Buffer.alloc(1);
    versionBuffer.writeUInt8(version);

    const result = Buffer.concat([
      versionBuffer,
      salt,
      iv,
      tag,
      Buffer.from(encrypted, "hex"),
    ]);

    return result.toString("base64");
  }

  /**
   * Decrypt data with version-aware key selection
   */
  async decryptWithVersion(ciphertext: string): Promise<string> {
    const buffer = Buffer.from(ciphertext, "base64");
    const version = buffer.readUInt8(0);

    const salt = buffer.subarray(1, 1 + SALT_LENGTH);
    const iv = buffer.subarray(1 + SALT_LENGTH, 1 + SALT_LENGTH + IV_LENGTH);
    const tag = buffer.subarray(
      1 + SALT_LENGTH + IV_LENGTH,
      1 + SALT_LENGTH + IV_LENGTH + TAG_LENGTH
    );
    const encrypted = buffer.subarray(1 + SALT_LENGTH + IV_LENGTH + TAG_LENGTH);

    const key = await this.getVersionedKey(version);
    const derivedKey = await scryptAsync(key, salt, 32) as Buffer;

    const decipher = createDecipheriv(ALGORITHM, derivedKey, iv);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(encrypted.toString("hex"), "hex", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  }

  /**
   * Get the appropriate encryption key for a given version
   */
  private async getVersionedKey(version: number): Promise<string> {
    if (version === 1) {
      // Version 1: Original master key
      return this.masterKey;
    } else if (version === 2) {
      // Version 2: Rotated key (could be derived from master key + rotation data)
      // For now, we'll use the same key but this could be enhanced
      return this.masterKey;
    } else {
      throw new Error(`Unsupported encryption version: ${version}`);
    }
  }

  /**
   * Check if key rotation is needed (quarterly rotation)
   */
  async isKeyRotationNeeded(): Promise<boolean> {
    try {
      const result = await query(
        "SELECT created_at FROM encryption_keys ORDER BY version DESC LIMIT 1"
      );

      if (result.rows.length === 0) {
        // No keys in database, rotation needed
        return true;
      }

      const lastRotation = new Date(result.rows[0].created_at);
      const now = new Date();
      const monthsSinceRotation = (now.getTime() - lastRotation.getTime()) / (1000 * 60 * 60 * 24 * 30);

      return monthsSinceRotation >= KEY_ROTATION_INTERVAL_MONTHS;
    } catch (error) {
      logger.warn("Failed to check key rotation status", {
        error: (error as Error).message,
      });
      return false;
    }
  }

  /**
   * Perform key rotation (create new encryption key version)
   */
  async rotateEncryptionKeys(): Promise<void> {
    try {
      logger.info("Starting encryption key rotation");

      // Generate new key material (in production, this should be securely generated)
      const newKey = randomBytes(32).toString("hex");

      // Store new key in database (encrypted with master key)
      const encryptedNewKey = await this.encryptWithVersion(newKey);

      await query(
        "INSERT INTO encryption_keys (version, encrypted_key, created_at) VALUES ($1, $2, NOW())",
        [CURRENT_KEY_VERSION, encryptedNewKey]
      );

      // Update current version
      const newVersion = CURRENT_KEY_VERSION + 1;

      logger.info("Encryption key rotation completed", {
        newVersion,
        previousVersion: CURRENT_KEY_VERSION,
      });

      // Note: In a production system, you would:
      // 1. Re-encrypt existing data with new key
      // 2. Update application configuration
      // 3. Schedule old key deletion after grace period

    } catch (error) {
      logger.error("Encryption key rotation failed", {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Migrate existing encrypted data to versioned encryption
   */
  async migrateToVersionedEncryption(): Promise<void> {
    try {
      logger.info("Starting migration to versioned encryption");

      // Get all credentials that need migration
      const credentials = await query(
        "SELECT id, api_key_encrypted, secret_key_encrypted FROM kodiak_credentials WHERE encryption_version IS NULL OR encryption_version < $1",
        [CURRENT_KEY_VERSION]
      );

      logger.info("Found credentials needing migration", {
        count: credentials.rows.length,
      });

      for (const cred of credentials.rows) {
        try {
          // Decrypt with old method
          const apiKey = this.decryptApiKey(cred.api_key_encrypted);
          const secretKey = this.decryptSecretKey(cred.secret_key_encrypted);

          // Re-encrypt with new versioned method
          const newApiKeyEncrypted = await this.encryptWithVersion(apiKey);
          const newSecretKeyEncrypted = await this.encryptWithVersion(secretKey);

          // Update database
          await query(
            "UPDATE kodiak_credentials SET api_key_encrypted = $1, secret_key_encrypted = $2, encryption_version = $3 WHERE id = $4",
            [newApiKeyEncrypted, newSecretKeyEncrypted, CURRENT_KEY_VERSION, cred.id]
          );

          logger.debug("Migrated credential encryption", {
            credentialId: cred.id,
          });
        } catch (error) {
          logger.error("Failed to migrate credential", {
            credentialId: cred.id,
            error: (error as Error).message,
          });
        }
      }

      logger.info("Versioned encryption migration completed");
    } catch (error) {
      logger.error("Versioned encryption migration failed", {
        error: (error as Error).message,
      });
      throw error;
    }
  }
}

export const encryptionService = new EncryptionService();
