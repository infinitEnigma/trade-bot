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
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt,
  scryptSync as cryptoScryptSync,
} from "crypto";
import { promisify } from "util";
import { securityLogger as logger } from "../../core/logging/context-aware-logger.service";
import { query } from "../../database/pool";

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
 *   return await makeApiCall(creds.get('apiKey'), creds.get('secretKey'));
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
  async use<T>(
    callback: (creds: { [key: string]: string }) => Promise<T>
  ): Promise<T> {
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
      throw new Error(
        "SecureCredentials: Credentials have been destroyed and cannot be accessed"
      );
    }
  }

  /**
   * Securely wipe a string by overwriting with random data
   * Prevents forensic recovery of sensitive data from memory
   */
  private wipeString(str: string): string {
    if (!str) return "";

    // Overwrite with random bytes of same length
    const randomData = randomBytes(str.length)
      .toString("hex")
      .substring(0, str.length);
    return randomData;
  }
}

/**
 * Decrypt user exchange-account credentials (internal helper).
 *
 * C2: reads the first ACTIVE venue row from `exchange_accounts`.
 * Handles current single-envelope rows (versioned decrypt → JSON) and
 * backfilled `kodiak-legacy` wrappers (JSON with per-field ciphertext
 * blobs — see migration 012 header). The engine credential-issue path
 * (C3 swaps only the account lookup) uses this.
 */
async function decryptUserCredentials(
  userId: string,
  queryFunction: typeof query = query
): Promise<{ [key: string]: string }> {
  try {
    const { exchangeAccountRepositoryAdapter } =
      await import("../adapters/repositories/exchange-account-repository.adapter");
    const accounts = await exchangeAccountRepositoryAdapter.listAccounts(
      userId,
      queryFunction
    );
    const active = accounts.find(
      a => a.exchange === "kodiak" && a.status === "ACTIVE"
    );
    if (!active) {
      throw new Error("No verified exchange account found");
    }
    const stored = await exchangeAccountRepositoryAdapter.getAccountWithSecret(
      userId,
      active.id,
      queryFunction
    );
    if (!stored) {
      throw new Error("No verified exchange account found");
    }

    const encryptionService = new EncryptionService(queryFunction);

    // Current single-envelope rows: versioned decrypt → plaintext JSON.
    try {
      const plaintext = await encryptionService.decryptWithVersion(
        stored.credentialsEncrypted
      );
      const parsed = JSON.parse(plaintext) as {
        kind?: string;
        accountId?: string;
        apiKey?: string;
        secretKey?: string;
      };
      if (
        (parsed.kind === "kodiak" || parsed.kind === undefined) &&
        typeof parsed.apiKey === "string" &&
        typeof parsed.secretKey === "string"
      ) {
        return {
          accountId: parsed.accountId ?? active.accountRef,
          apiKey: parsed.apiKey,
          secretKey: parsed.secretKey,
        };
      }
    } catch {
      // Fall through to the legacy wrapper path.
    }

    // Backfilled wrapper: JSON with per-field ciphertext blobs.
    const wrapper = JSON.parse(stored.credentialsEncrypted) as {
      kind: string;
      accountId: string;
      apiKeyCipher: string;
      secretKeyCipher: string;
    };
    if (wrapper.kind !== "kodiak-legacy") {
      throw new Error("Unrecognized credential envelope");
    }
    const apiKey = await decryptEnvelopeField(
      encryptionService,
      wrapper.apiKeyCipher
    );
    const secretKey = await decryptEnvelopeField(
      encryptionService,
      wrapper.secretKeyCipher
    );
    return { accountId: wrapper.accountId, apiKey, secretKey };
  } catch (error) {
    logger.error("Failed to decrypt user credentials", error as Error, {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function decryptEnvelopeField(
  encryptionService: EncryptionService,
  blob: string
): Promise<string> {
  try {
    return encryptionService.decryptApiKey(blob);
  } catch {
    // try the secret-key path, then versioned
  }
  try {
    return encryptionService.decryptSecretKey(blob);
  } catch {
    return encryptionService.decryptWithVersion(blob);
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
  callback: (creds: SecureCredentials) => Promise<T>,
  queryFunction: typeof query = query
): Promise<T> {
  // Decrypt user credentials
  const credentials = await decryptUserCredentials(userId, queryFunction);
  const secureCreds = SecureCredentials.create(credentials);

  try {
    return await callback(secureCreds);
  } finally {
    secureCreds.destroy(); // Guaranteed cleanup
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

interface _EncryptionMetadata {
  version: number;
  salt: Buffer;
  iv: Buffer;
  tag: Buffer;
  encryptedData: Buffer;
}

function _getKey(password: string, salt: Buffer): Buffer {
  return _scryptSync(password, salt, 32) as Buffer;
}

function _scryptSync(
  password: string,
  salt: string | Buffer,
  length: number
): Buffer | string {
  return cryptoScryptSync(password, salt, length);
}

export class EncryptionService {
  private masterKey: string;
  private queryFn: typeof query;
  // Current version used to encrypt NEW data. Advanced by rotateEncryptionKeys().
  private currentKeyVersion: number = CURRENT_KEY_VERSION;
  // In-memory cache of rotated key material loaded from the encryption_keys table
  private versionedKeyCache: Map<number, string> = new Map();

  constructor(queryFunction: typeof query = query) {
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
    this.queryFn = queryFunction;
  }

  encrypt(plaintext: string): string {
    const salt = randomBytes(SALT_LENGTH);
    const key = _scryptSync(this.masterKey, salt, 32) as Buffer;
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

    const key = _scryptSync(this.masterKey, salt, 32) as Buffer;
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
  async encryptWithVersion(
    plaintext: string,
    version?: number
  ): Promise<string> {
    const v = version ?? this.currentKeyVersion;
    const key = await this.getVersionedKey(v);
    const salt = randomBytes(SALT_LENGTH);
    const derivedKey = (await scryptAsync(key, salt, 32)) as Buffer;
    const iv = randomBytes(IV_LENGTH);

    const cipher = createCipheriv(ALGORITHM, derivedKey, iv);
    let encrypted = cipher.update(plaintext, "utf8", "hex");
    encrypted += cipher.final("hex");
    const tag = cipher.getAuthTag();

    // Format: version(1) + salt(32) + iv(16) + tag(16) + encrypted_data
    const versionBuffer = Buffer.alloc(1);
    versionBuffer.writeUInt8(v);

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
    const derivedKey = (await scryptAsync(key, salt, 32)) as Buffer;

    const decipher = createDecipheriv(ALGORITHM, derivedKey, iv);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(encrypted.toString("hex"), "hex", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  }

  /**
   * Get the appropriate encryption key for a given version
   *
   * Version mapping:
   * - 1: original master key (legacy envelope format)
   * - 2: legacy "rotated" version - historically aliased to the master key,
   *      kept for backward compatibility with data encrypted before rotation
   *      was implemented
   * - >= 3: real rotated keys, wrapped under the master key and stored in the
   *      encryption_keys table (encrypted_key column, version-1 envelope)
   */
  private async getVersionedKey(version: number): Promise<string> {
    if (version === 1 || version === 2) {
      // Versions 1 and 2 map to the master key (v2 is a legacy alias)
      return this.masterKey;
    }

    const cached = this.versionedKeyCache.get(version);
    if (cached) {
      return cached;
    }

    const result = await this.queryFn<{ encrypted_key: string }>(
      "SELECT encrypted_key FROM encryption_keys WHERE version = $1",
      [version]
    );

    if (result.rows.length === 0) {
      throw new Error(`No encryption key found for version ${version}`);
    }

    // The stored key is wrapped under the master key (version-1 envelope)
    const key = await this.decryptWithVersion(result.rows[0].encrypted_key);
    this.versionedKeyCache.set(version, key);
    return key;
  }

  /**
   * Check if key rotation is needed (quarterly rotation)
   */
  async isKeyRotationNeeded(): Promise<boolean> {
    try {
      const result = await this.queryFn<{
        created_at: Date;
      }>(
        "SELECT created_at FROM encryption_keys ORDER BY version DESC LIMIT 1"
      );

      if (result.rows.length === 0) {
        // No keys in database, rotation needed
        return true;
      }

      const lastRotation = new Date(result.rows[0].created_at);
      const now = new Date();
      const monthsSinceRotation =
        (now.getTime() - lastRotation.getTime()) / (1000 * 60 * 60 * 24 * 30);

      return monthsSinceRotation >= KEY_ROTATION_INTERVAL_MONTHS;
    } catch (error) {
      logger.error("Failed to check key rotation status", error as Error, {
        error: (error as Error).message,
      });
      return false;
    }
  }

  /**
   * Perform key rotation
   *
   * Business Logic:
   * 1. Determine the next key version from the database (highest stored version + 1)
   * 2. Generate new key material and store it wrapped under the master key
   *    (version-1 envelope) in the encryption_keys table
   * 3. Make the new version current for this instance so new data uses it
   * 4. Re-encrypt all existing exchange-account envelopes under the new version
   *
   * C2: rotation targets the single versioned JSON envelope column and
   * skips backfilled legacy wrappers (plaintext JSON whose fields are
   * untouched per-field blobs) — verify/connect graduates those instead.
   *
   * @returns the new key version
   */
  async rotateEncryptionKeys(): Promise<void> {
    try {
      logger.info("Starting encryption key rotation");

      // Determine next version from the highest stored version
      const maxResult = await this.queryFn<{ max_version: number | null }>(
        "SELECT MAX(version) AS max_version FROM encryption_keys"
      );
      const highestStored = maxResult?.rows?.[0]?.max_version ?? 0;
      const previousVersion = Math.max(highestStored, CURRENT_KEY_VERSION);
      const newVersion = previousVersion + 1;

      // Generate new key material and store it wrapped under the master key
      // (version-1 envelope) so it can be recovered by getVersionedKey()
      const newKey = randomBytes(32).toString("hex");
      const encryptedNewKey = await this.encryptWithVersion(newKey, 1);

      await this.queryFn(
        "INSERT INTO encryption_keys (version, encrypted_key, created_at) VALUES ($1, $2, NOW())",
        [newVersion, encryptedNewKey]
      );

      // Make the new version current for this instance
      this.currentKeyVersion = newVersion;
      this.versionedKeyCache.set(newVersion, newKey);

      logger.info("New encryption key stored", {
        newVersion,
        previousVersion,
      });

      // Re-encrypt existing exchange-account envelopes under the new version
      const accounts = await this.queryFn<{
        id: string;
        credentials_encrypted: string;
        encryption_version: number | null;
      }>(
        "SELECT id, credentials_encrypted, encryption_version FROM exchange_accounts WHERE encryption_version IS NULL OR encryption_version < $1",
        [newVersion]
      );

      const rows = accounts?.rows ?? [];
      logger.info("Re-encrypting exchange accounts under new key version", {
        count: rows.length,
        newVersion,
      });

      for (const account of rows) {
        try {
          const envelope = account.credentials_encrypted;
          // Skip backfilled legacy wrappers (plaintext JSON with inner
          // per-field blobs) — verify/connect graduates them separately.
          if (this.isLegacyCredentialWrapper(envelope)) {
            logger.debug("Skipping legacy wrapper during rotation", {
              credentialId: account.id,
            });
            continue;
          }
          const plaintext = await this.decryptWithVersion(envelope);
          const reEncrypted = await this.encryptWithVersion(
            plaintext,
            newVersion
          );

          await this.queryFn(
            "UPDATE exchange_accounts SET credentials_encrypted = $1, encryption_version = $2 WHERE id = $3",
            [reEncrypted, newVersion, account.id]
          );

          logger.debug("Re-encrypted credential during rotation", {
            credentialId: account.id,
          });
        } catch (error) {
          // One credential failing must not abort the whole rotation;
          // it stays on the old version and is still decryptable
          logger.error(
            "Failed to re-encrypt credential during rotation",
            error as Error,
            {
              credentialId: account.id,
              error: (error as Error).message,
            }
          );
        }
      }

      logger.info("Encryption key rotation completed", {
        newVersion,
        previousVersion,
      });
    } catch (error) {
      logger.error("Encryption key rotation failed", error as Error, {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Migrate existing exchange-account envelopes to versioned encryption.
   *
   * C2: targets `exchange_accounts`. Legacy wrappers are skipped here and
   * graduated lazily by verify/connect.
   */
  async migrateToVersionedEncryption(): Promise<void> {
    try {
      logger.info("Starting migration to versioned encryption");

      // Get all exchange-account envelopes that need migration
      const accounts = await this.queryFn<{
        id: string;
        credentials_encrypted: string;
        encryption_version: number | null;
      }>(
        "SELECT id, credentials_encrypted, encryption_version FROM exchange_accounts WHERE encryption_version IS NULL OR encryption_version < $1",
        [CURRENT_KEY_VERSION]
      );

      logger.info("Found credentials needing migration", {
        count: accounts.rows.length,
      });

      for (const account of accounts.rows) {
        try {
          if (this.isLegacyCredentialWrapper(account.credentials_encrypted)) {
            logger.debug("Skipping legacy wrapper during migration", {
              credentialId: account.id,
            });
            continue;
          }
          const plaintext = await this.decryptWithVersion(
            account.credentials_encrypted
          );

          // Re-encrypt with new versioned method
          const reEncrypted = await this.encryptWithVersion(plaintext);

          // Update database
          await this.queryFn(
            "UPDATE exchange_accounts SET credentials_encrypted = $1, encryption_version = $2 WHERE id = $3",
            [reEncrypted, CURRENT_KEY_VERSION, account.id]
          );

          logger.debug("Migrated credential encryption", {
            credentialId: account.id,
          });
        } catch (error) {
          logger.error("Failed to migrate credential", error as Error, {
            credentialId: account.id,
            error: (error as Error).message,
          });
        }
      }

      logger.info("Versioned encryption migration completed");
    } catch (error) {
      logger.error("Versioned encryption migration failed", error as Error, {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Backfilled legacy wrappers are plaintext JSON with untouched per-field
   * blobs — never re-encrypt them as an opaque envelope.
   */
  private isLegacyCredentialWrapper(envelope: string): boolean {
    try {
      const parsed = JSON.parse(envelope) as { kind?: unknown };
      return parsed.kind === "kodiak-legacy";
    } catch {
      return false;
    }
  }
}

export const encryptionService = new EncryptionService();
