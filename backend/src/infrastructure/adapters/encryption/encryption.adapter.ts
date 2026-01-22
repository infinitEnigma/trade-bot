/**
 * Encryption Service Adapter - Clean Architecture Implementation
 *
 * Adapter that implements IEncryptionService interface using the existing encryption service.
 * This adapter provides a clean abstraction layer for encryption operations,
 * enabling dependency injection and testability for pure business logic.
 *
 * @format
 */

import { IEncryptionService } from '../../../../../shared';
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

            return encryptionService.encryptApiKey(apiKey);
        } catch (error) {
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

            return encryptionService.decryptApiKey(encryptedApiKey);
        } catch (error) {
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

            return encryptionService.encryptSecretKey(secretKey);
        } catch (error) {
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

            return encryptionService.decryptSecretKey(encryptedSecretKey);
        } catch (error) {
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

            return await encryptionService.decryptWithVersion(encryptedData);
        } catch (error) {
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

            return await encryptionService.encryptWithVersion(plaintext, version);
        } catch (error) {
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
            return await encryptionService.isKeyRotationNeeded();
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.warn(`Key rotation check failed: ${errorMessage}`);
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
            await encryptionService.rotateEncryptionKeys();
        } catch (error) {
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