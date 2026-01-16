/** @format */

import { createCipheriv, createDecipheriv, randomBytes, scrypt, hkdf } from 'crypto';
import { promisify } from 'util';
import logger from './logger';

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
  algorithm: 'aes-256-gcm',
  keyLength: 32,
  saltLength: 32,
  ivLength: 16,
  tagLength: 16,
};

// Key hierarchy for different data types
enum KeyPurpose {
  API_KEYS = 'api_keys',
  USER_CREDENTIALS = 'user_credentials',
  FINANCIAL_DATA = 'financial_data',
  GENERAL_ENCRYPTION = 'general_encryption',
}

export class KeyManagementService {
  private masterKeySeed!: Buffer;
  private derivedKeys: Map<KeyPurpose, Buffer> = new Map();
  private keyVersions: Map<KeyPurpose, number> = new Map();

  constructor() {
    this.initializeMasterKey();
    this.derivePurposeKeys();
  }

  /**
   * Initialize master key from environment with additional derivation
   */
  private initializeMasterKey(): void {
    const envKey = process.env.ENCRYPTION_MASTER_KEY;
    if (!envKey) {
      throw new Error('ENCRYPTION_MASTER_KEY environment variable required');
    }

    if (process.env.NODE_ENV === 'production' && envKey.length < 32) {
      throw new Error('ENCRYPTION_MASTER_KEY must be 32+ characters in production');
    }

    // Additional key derivation to protect against env key exposure
    const envSalt = process.env.ENCRYPTION_KEY_SALT || 'default-salt-change-in-production';
    this.masterKeySeed = Buffer.from(envKey + envSalt, 'utf8');
    logger.info('Key management service initialized with derived master key');
  }

  /**
   * Derive purpose-specific keys from master key seed
   */
  private async derivePurposeKeys(): Promise<void> {
    const purposes = Object.values(KeyPurpose);

    for (const purpose of purposes) {
      try {
        // Use HKDF to derive purpose-specific keys
        const derivedKey = await hkdfAsync(
          'sha256',
          this.masterKeySeed,
          Buffer.from(purpose, 'utf8'),
          Buffer.alloc(32), // Empty salt for HKDF
          KEY_CONFIG.keyLength
        );

        this.derivedKeys.set(purpose, Buffer.from(derivedKey as ArrayBuffer));
        this.keyVersions.set(purpose, KEY_CONFIG.version);

        logger.debug(`Derived key for purpose: ${purpose}`);
      } catch (error) {
        logger.error(`Failed to derive key for purpose ${purpose}`, { error: (error as Error).message });
        throw error;
      }
    }
  }

  /**
   * Get encryption key for specific purpose
   */
  private getKeyForPurpose(purpose: KeyPurpose): Buffer {
    const key = this.derivedKeys.get(purpose);
    if (!key) {
      throw new Error(`No key available for purpose: ${purpose}`);
    }
    return key;
  }

  /**
   * Encrypt data with purpose-specific key
   */
  async encrypt(data: string, purpose: KeyPurpose = KeyPurpose.GENERAL_ENCRYPTION): Promise<string> {
    try {
      const key = this.getKeyForPurpose(purpose);
      const salt = randomBytes(KEY_CONFIG.saltLength);
      const iv = randomBytes(KEY_CONFIG.ivLength);

      // Derive final key using scrypt with the purpose-specific key as password
      const derivedKey = await scryptAsync(key, salt, KEY_CONFIG.keyLength) as Buffer;

      const cipher = createCipheriv(KEY_CONFIG.algorithm, derivedKey, iv) as any;
      let encrypted = cipher.update(data, 'utf8', 'hex');
      encrypted += cipher.final('hex');

      const tag = cipher.getAuthTag();

      // Format: version(1) + salt + iv + tag + encrypted
      const versionBuffer = Buffer.alloc(1);
      versionBuffer.writeUInt8(KEY_CONFIG.version);

      const resultBuffer = Buffer.concat([
        versionBuffer,
        salt,
        iv,
        tag,
        Buffer.from(encrypted, 'hex'),
      ]);

      return resultBuffer.toString('base64');
    } catch (error) {
      logger.error(`Encryption failed for purpose ${purpose}`, { error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Decrypt data with purpose-specific key
   */
  async decrypt(encryptedData: string, purpose: KeyPurpose = KeyPurpose.GENERAL_ENCRYPTION): Promise<string> {
    try {
      const buffer = Buffer.from(encryptedData, 'base64');

      // Parse format: version(1) + salt + iv + tag + encrypted
      const version = buffer.readUInt8(0);
      if (version !== KEY_CONFIG.version) {
        throw new Error(`Unsupported key version: ${version}`);
      }

      const salt = buffer.subarray(1, 1 + KEY_CONFIG.saltLength);
      const iv = buffer.subarray(1 + KEY_CONFIG.saltLength, 1 + KEY_CONFIG.saltLength + KEY_CONFIG.ivLength);
      const tag = buffer.subarray(
        1 + KEY_CONFIG.saltLength + KEY_CONFIG.ivLength,
        1 + KEY_CONFIG.saltLength + KEY_CONFIG.ivLength + KEY_CONFIG.tagLength
      );
      const encrypted = buffer.subarray(1 + KEY_CONFIG.saltLength + KEY_CONFIG.ivLength + KEY_CONFIG.tagLength);

      const key = this.getKeyForPurpose(purpose);

      // Derive the same key used for encryption
      const derivedKey = await scryptAsync(key, salt, KEY_CONFIG.keyLength) as Buffer;

      const decipher = createDecipheriv(KEY_CONFIG.algorithm, derivedKey, iv) as any;
      decipher.setAuthTag(tag);

      let decrypted = decipher.update(encrypted.toString('hex'), 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      logger.error(`Decryption failed for purpose ${purpose}`, { error: (error as Error).message });
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
  getKeyStatus(): {
    purposes: string[];
    keyVersions: Record<string, number>;
    config: KeyConfig;
  } {
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
  async validateEncryption(testData = 'test-validation-data'): Promise<boolean> {
    try {
      const encrypted = await this.encrypt(testData);
      const decrypted = await this.decrypt(encrypted);
      return decrypted === testData;
    } catch (error) {
      logger.error('Encryption validation failed', { error: (error as Error).message });
      return false;
    }
  }
}

// Export singleton instance
export const keyManagementService = new KeyManagementService();

// Export types for use in other modules
export { KeyPurpose, KeyConfig };
