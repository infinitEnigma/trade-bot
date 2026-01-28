/**
 * Encryption Service Adapter - Clean Architecture Implementation
 *
 * Adapter that implements IEncryptionService interface using the existing encryption service.
 * This adapter provides a clean abstraction layer for encryption operations,
 * enabling dependency injection and testability for pure business logic.
 *
 * @format
 */

import { integrationLogger } from '../../../core/logging';
/*import {
    ErrorInfo,
    createErrorInfo,
    createEnhancedErrorInfo
} from '../../../core/logging';*/
import { IEncryptionService } from '../../../shared/src';
import { encryptionService } from '../../../infrastructure/security/encryption.service';

/**
 * Encryption Service Adapter
 *
 * Implements the IEncryptionService interface using the existing enterprise-grade
 * encryption service with AES-256-GCM and versioned keys.
 */
export class EncryptionAdapter implements IEncryptionService {

    /**
     * Encrypt API key using AES-256-GCM with versioned keys
     *
     * @param apiKey - Plain text API key to encrypt
     * @returns string - Base64 encoded encrypted data
     */
    encryptApiKey(apiKey: string): string {
        try {
            if (!apiKey || apiKey.length === 0) {
                throw new Error('API key cannot be empty');
            }

            // Start operation timing
            const timer = integrationLogger.startOperation("encryptApiKey", { apiKeyLength: apiKey.length });

            const result = encryptionService.encryptApiKey(apiKey);
            timer.success();
            return result;
        } catch (error) {
            integrationLogger.error("API key encryption failed", error instanceof Error ? error : undefined, {
                apiKeyLength: apiKey.length,
            });
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`API key encryption failed: ${errorMessage}`);
        }
    }

    /**
     * Decrypt API key from encrypted data
     *
     * @param encryptedApiKey - Base64 encoded encrypted API key
     * @returns string - Decrypted plain text API key
     */
    decryptApiKey(encryptedApiKey: string): string {
        try {
            if (!encryptedApiKey || encryptedApiKey.length === 0) {
                throw new Error('Encrypted API key cannot be empty');
            }

            // Start operation timing
            const timer = integrationLogger.startOperation("decryptApiKey", { encryptedLength: encryptedApiKey.length });

            const result = encryptionService.decryptApiKey(encryptedApiKey);
            timer.success();
            return result;
        } catch (error) {
            integrationLogger.error("API key decryption failed", error instanceof Error ? error : undefined, {
                encryptedLength: encryptedApiKey.length,
            });
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`API key decryption failed: ${errorMessage}`);
        }
    }

    /**
     * Encrypt secret key using AES-256-GCM with versioned keys
     *
     * @param secretKey - Plain text secret key to encrypt
     * @returns string - Base64 encoded encrypted data
     */
    encryptSecretKey(secretKey: string): string {
        try {
            if (!secretKey || secretKey.length === 0) {
                throw new Error('Secret key cannot be empty');
            }

            // Start operation timing
            const timer = integrationLogger.startOperation("encryptSecretKey", { secretKeyLength: secretKey.length });

            const result = encryptionService.encryptSecretKey(secretKey);
            timer.success();
            return result;
        } catch (error) {
            integrationLogger.error("Secret key encryption failed", error instanceof Error ? error : undefined, {
                secretKeyLength: secretKey.length,
            });
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Secret key encryption failed: ${errorMessage}`);
        }
    }

    /**
     * Decrypt secret key from encrypted data
     *
     * @param encryptedSecretKey - Base64 encoded encrypted secret key
     * @returns string - Decrypted plain text secret key
     */
    decryptSecretKey(encryptedSecretKey: string): string {
        try {
            if (!encryptedSecretKey || encryptedSecretKey.length === 0) {
                throw new Error('Encrypted secret key cannot be empty');
            }

            // Start operation timing
            const timer = integrationLogger.startOperation("decryptSecretKey", { encryptedLength: encryptedSecretKey.length });

            const result = encryptionService.decryptSecretKey(encryptedSecretKey);
            timer.success();
            return result;
        } catch (error) {
            integrationLogger.error("Secret key decryption failed", error instanceof Error ? error : undefined, {
                encryptedLength: encryptedSecretKey.length,
            });
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Secret key decryption failed: ${errorMessage}`);
        }
    }

    /**
     * Decrypt data with version-aware key selection for backward compatibility
     *
     * @param encryptedData - Base64 encoded encrypted data with version info
     * @returns Promise<string> - Decrypted plain text data
     */
    async decryptWithVersion(encryptedData: string): Promise<string> {
        try {
            if (!encryptedData || encryptedData.length === 0) {
                throw new Error('Encrypted data cannot be empty');
            }

            // Start operation timing
            const timer = integrationLogger.startOperation("decryptWithVersion", { encryptedLength: encryptedData.length });

            const result = await encryptionService.decryptWithVersion(encryptedData);
            timer.success();
            return result;
        } catch (error) {
            integrationLogger.error("Versioned decryption failed", error instanceof Error ? error : undefined, {
                encryptedLength: encryptedData.length,
            });
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Versioned decryption failed: ${errorMessage}`);
        }
    }

    /**
     * Encrypt data with version information for key rotation support
     *
     * @param plaintext - Plain text data to encrypt
     * @param version - Encryption version (optional, defaults to current)
     * @returns Promise<string> - Base64 encoded encrypted data with version
     */
    async encryptWithVersion(plaintext: string, version?: number): Promise<string> {
        try {
            if (!plaintext || plaintext.length === 0) {
                throw new Error('Plaintext cannot be empty');
            }

            // Start operation timing
            const timer = integrationLogger.startOperation("encryptWithVersion", {
                plaintextLength: plaintext.length,
                version: version ?? 'current'
            });

            const result = await encryptionService.encryptWithVersion(plaintext, version);
            timer.success();
            return result;
        } catch (error) {
            integrationLogger.error("Versioned encryption failed", error instanceof Error ? error : undefined, {
                plaintextLength: plaintext.length,
                version: version ?? 'current',
            });
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Versioned encryption failed: ${errorMessage}`);
        }
    }

    /**
     * Check if encryption key rotation is needed
     *
     * @returns Promise<boolean> - True if key rotation is recommended
     */
    async isKeyRotationNeeded(): Promise<boolean> {
        try {
            // Start operation timing
            const timer = integrationLogger.startOperation("isKeyRotationNeeded");

            const result = await encryptionService.isKeyRotationNeeded();
            timer.success();
            return result;
        } catch (error) {
            integrationLogger.warn("Key rotation check failed", {
                error: error instanceof Error ? error.message : String(error),
            });
            return false; // Fail safe - don't force rotation on errors
        }
    }

    /**
     * Perform encryption key rotation
     *
     * @returns Promise<void>
     */
    async rotateEncryptionKeys(): Promise<void> {
        try {
            // Start operation timing
            const timer = integrationLogger.startOperation("rotateEncryptionKeys");

            await encryptionService.rotateEncryptionKeys();
            timer.success();
        } catch (error) {
            integrationLogger.error("Key rotation failed", error instanceof Error ? error : undefined);
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Key rotation failed: ${errorMessage}`);
        }
    }

    /**
     * Get encryption algorithm information
     *
     * @returns object - Encryption algorithm details
     */
    getEncryptionInfo(): {
        algorithm: string;
        keySize: number;
        supportsKeyRotation: boolean;
        currentVersion: number;
    } {
        return {
            algorithm: 'AES-256-GCM',
            keySize: 256,
            supportsKeyRotation: true,
            currentVersion: 2 // From the service implementation
        };
    }
}

// Export singleton instance
export const encryptionAdapter = new EncryptionAdapter();