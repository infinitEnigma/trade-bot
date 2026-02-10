/** @format */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt,
  scryptSync,
  hkdf,
  CipherGCM,
  DecipherGCM,
} from "crypto";
import { promisify } from "util";
import { securityLogger as logger } from "../../core/logging/context-aware-logger.service";

const scryptAsync = promisify(scrypt);
const hkdfAsync = promisify(hkdf);

// Key management configuration
interface KeyConfig {
  version: number;
  algorithm: string;
  keyLength: number;
  saltLength: number;
  ivLength: number;
  tagLength: number;
}

// Current key configuration
const KEY_CONFIG: KeyConfig = {
  version: 1,
  algorithm: "aes-256-gcm",
  keyLength: 32,
  saltLength: 32,
  ivLength: 16,
  tagLength: 16,
};

// Key hierarchy for different data types
enum KeyPurpose {
  API_KEYS = "api_keys",
  USER_CREDENTIALS = "user_credentials",
  FINANCIAL_DATA = "financial_data",
  GENERAL_ENCRYPTION = "general_encryption",
}

export class KeyManagementService {
  private masterKeySeed!: Buffer;
  private derivedKeys: Map<KeyPurpose, Buffer> = new Map();
  private keyVersions: Map<KeyPurpose, number> = new Map();
  private initialized = false;

  // For testing purposes, allow overriding crypto functions
  private hkdf = hkdfAsync;
  private scrypt = scryptAsync;

  constructor() {
    this.initializeMasterKey();
    // Initialize keys synchronously by waiting for promise
    this.derivePurposeKeys().catch(error => {
      logger.error("Key management service initialization failed", error);
      throw error;
    });
  }

  // For testing purposes only
  setCryptoFunctions(options: { hkdf?: any; scrypt?: any }): void {
    if (options.hkdf) {
      this.hkdf = options.hkdf;
    }
    if (options.scrypt) {
      this.scrypt = options.scrypt;
    }
  }

  /**
   * Ensure keys are fully derived before any operation
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized && this.derivedKeys.size === Object.values(KeyPurpose).length) {
      return;
    }
    // If keys aren't derived yet, wait for them
    if (this.derivedKeys.size === 0) {
      await this.derivePurposeKeys();
    }
    this.initialized = true;
  }

  /**
   * Initialize master key from environment with additional derivation
   */
  private initializeMasterKey(): void {
    const envKey = process.env.ENCRYPTION_MASTER_KEY;
    if (!envKey) {
      throw new Error("ENCRYPTION_MASTER_KEY environment variable required");
    }

    if (process.env.NODE_ENV === "production" && envKey.length < 32) {
      throw new Error(
        "ENCRYPTION_MASTER_KEY must be 32+ characters in production"
      );
    }

    // Additional key derivation to protect against env key exposure
    const envSalt = process.env.ENCRYPTION_KEY_SALT;
    if (!envSalt) {
      throw new Error("ENCRYPTION_KEY_SALT environment variable required");
    }

    if (process.env.NODE_ENV === "production" && envSalt.length < 16) {
      throw new Error(
        "ENCRYPTION_KEY_SALT must be 16+ characters in production"
      );
    }

    // Use proper cryptographic key derivation instead of string concatenation
    // Create a buffer from the hex-encoded key or UTF-8 if not hex
    let masterKeyBuffer: Buffer;
    try {
      // First try to parse as hex (more secure)
      masterKeyBuffer = Buffer.from(envKey, 'hex');
    } catch {
      // Fallback to UTF-8 if not valid hex
      masterKeyBuffer = Buffer.from(envKey, 'utf8');
    }

    // Use scrypt to derive a secure key from the master key and salt
    // This provides much stronger protection than simple concatenation
    // Use synchronous scrypt for initialization
    const derived = scryptSync(masterKeyBuffer, envSalt, KEY_CONFIG.keyLength);
    this.masterKeySeed = Buffer.from(derived as unknown as ArrayBuffer);

    logger.info("Key management service initialized with derived master key");
  }

  /**
   * Derive purpose-specific keys from master key seed
   */
  private async derivePurposeKeys(): Promise<void> {
    const purposes = Object.values(KeyPurpose);

    for (const purpose of purposes) {
      try {
        // Use HKDF to derive purpose-specific keys
        // Use a secure salt for HKDF (derived from purpose to ensure uniqueness)
        const hkdfSalt = Buffer.from(purpose, "utf8");
        const derivedKey = await this.hkdf(
          "sha256",
          this.masterKeySeed,
          hkdfSalt,
          Buffer.from(`purpose:${purpose}`, "utf8"), // HKDF info parameter
          KEY_CONFIG.keyLength
        );

        this.derivedKeys.set(purpose, Buffer.from(derivedKey as ArrayBuffer));
        this.keyVersions.set(purpose, KEY_CONFIG.version);

        logger.debug(`Derived key for purpose: ${purpose}`);
      } catch (error) {
        logger.error(`Failed to derive key for purpose ${purpose}`, error as Error);
        throw error;
      }
    }
  }

  /**
   * Get encryption key for specific purpose
   */
  private async getKeyForPurpose(purpose: KeyPurpose): Promise<Buffer> {
    await this.ensureInitialized();
    const key = this.derivedKeys.get(purpose);
    if (!key) {
      throw new Error(`No key available for purpose: ${purpose}`);
    }
    return key;
  }

  /**
   * Encrypt data with purpose-specific key
   */
  async encrypt(
    data: string,
    purpose: KeyPurpose = KeyPurpose.GENERAL_ENCRYPTION
  ): Promise<string> {
    try {
      const key = await this.getKeyForPurpose(purpose);
      const salt = randomBytes(KEY_CONFIG.saltLength);
      const iv = randomBytes(KEY_CONFIG.ivLength);

      // Derive final key using scrypt with the purpose-specific key as password
      const derivedKey = (await this.scrypt(
        key,
        salt,
        KEY_CONFIG.keyLength
      )) as Buffer;

      const cipher = createCipheriv(
        KEY_CONFIG.algorithm,
        derivedKey,
        iv
      ) as CipherGCM;
      let encrypted = cipher.update(data, "utf8", "hex");
      encrypted += cipher.final("hex");

      const tag = cipher.getAuthTag();

      // Format: version(1) + salt + iv + tag + encrypted
      const versionBuffer = Buffer.alloc(1);
      versionBuffer.writeUInt8(KEY_CONFIG.version);

      const resultBuffer = Buffer.concat([
        versionBuffer,
        salt,
        iv,
        tag,
        Buffer.from(encrypted, "hex"),
      ]);

      return resultBuffer.toString("base64");
    } catch (error) {
      logger.error(`Encryption failed for purpose ${purpose}`, error as Error);
      throw error;
    }
  }

  /**
   * Decrypt data with purpose-specific key
   */
  async decrypt(
    encryptedData: string,
    purpose: KeyPurpose = KeyPurpose.GENERAL_ENCRYPTION
  ): Promise<string> {
    try {
      const buffer = Buffer.from(encryptedData, "base64");

      // Parse format: version(1) + salt + iv + tag + encrypted
      const version = buffer.readUInt8(0);
      if (version !== KEY_CONFIG.version) {
        throw new Error(`Unsupported key version: ${version}`);
      }

      const salt = buffer.subarray(1, 1 + KEY_CONFIG.saltLength);
      const iv = buffer.subarray(
        1 + KEY_CONFIG.saltLength,
        1 + KEY_CONFIG.saltLength + KEY_CONFIG.ivLength
      );
      const tag = buffer.subarray(
        1 + KEY_CONFIG.saltLength + KEY_CONFIG.ivLength,
        1 + KEY_CONFIG.saltLength + KEY_CONFIG.ivLength + KEY_CONFIG.tagLength
      );
      const encrypted = buffer.subarray(
        1 + KEY_CONFIG.saltLength + KEY_CONFIG.ivLength + KEY_CONFIG.tagLength
      );

      const key = await this.getKeyForPurpose(purpose);

      // Derive the same key used for encryption
      const derivedKey = (await this.scrypt(
        key,
        salt,
        KEY_CONFIG.keyLength
      )) as Buffer;

      const decipher = createDecipheriv(
        KEY_CONFIG.algorithm,
        derivedKey,
        iv
      ) as DecipherGCM;
      decipher.setAuthTag(tag);

      let decrypted = decipher.update(encrypted.toString("hex"), "hex", "utf8");
      decrypted += decipher.final("utf8");

      return decrypted;
    } catch (error) {
      logger.error(`Decryption failed for purpose ${purpose}`, error as Error);
      throw error;
    }
  }

  /**
   * Encrypt API keys with dedicated key
   */
  async encryptApiKey(apiKey: string): Promise<string> {
    return this.encrypt(apiKey, KeyPurpose.API_KEYS);
  }

  /**
   * Decrypt API keys with dedicated key
   */
  async decryptApiKey(encryptedApiKey: string): Promise<string> {
    return this.decrypt(encryptedApiKey, KeyPurpose.API_KEYS);
  }

  /**
   * Encrypt secret keys with dedicated key
   */
  async encryptSecretKey(secretKey: string): Promise<string> {
    return this.encrypt(secretKey, KeyPurpose.API_KEYS);
  }

  /**
   * Decrypt secret keys with dedicated key
   */
  async decryptSecretKey(encryptedSecretKey: string): Promise<string> {
    return this.decrypt(encryptedSecretKey, KeyPurpose.API_KEYS);
  }

  /**
   * Encrypt user credentials with dedicated key
   */
  async encryptUserCredential(data: string): Promise<string> {
    return this.encrypt(data, KeyPurpose.USER_CREDENTIALS);
  }

  /**
   * Decrypt user credentials with dedicated key
   */
  async decryptUserCredential(encryptedData: string): Promise<string> {
    return this.decrypt(encryptedData, KeyPurpose.USER_CREDENTIALS);
  }

  /**
   * Encrypt financial data with dedicated key
   */
  async encryptFinancialData(data: string): Promise<string> {
    return this.encrypt(data, KeyPurpose.FINANCIAL_DATA);
  }

  /**
   * Decrypt financial data with dedicated key
   */
  async decryptFinancialData(encryptedData: string): Promise<string> {
    return this.decrypt(encryptedData, KeyPurpose.FINANCIAL_DATA);
  }

  /**
   * Get key status and metrics
   */
  async getKeyStatus(): Promise<{
    purposes: string[];
    keyVersions: Record<string, number>;
    config: KeyConfig;
  }> {
    await this.ensureInitialized();
    const purposes = Array.from(this.derivedKeys.keys()).map(p => p.toString());
    const keyVersions: Record<string, number> = {};

    for (const [purpose, version] of this.keyVersions.entries()) {
      keyVersions[purpose.toString()] = version;
    }

    return {
      purposes,
      keyVersions,
      config: { ...KEY_CONFIG },
    };
  }

  /**
   * Validate encryption/decryption roundtrip
   */
  async validateEncryption(
    testData = "test-validation-data"
  ): Promise<boolean> {
    try {
      const encrypted = await this.encrypt(testData);
      const decrypted = await this.decrypt(encrypted);
      return decrypted === testData;
    } catch (error) {
      logger.error("Encryption validation failed", error as Error);
      return false;
    }
  }
}

// Export singleton instance
export const keyManagementService = new KeyManagementService();

// Export types for use in other modules
export { KeyPurpose, KeyConfig };
