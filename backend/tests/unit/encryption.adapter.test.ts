/** @format */

import { EncryptionAdapter } from '../../src/infrastructure/adapters/encryption/encryption.adapter';
import { encryptionService } from '../../src/infrastructure/security/encryption.service';
import { integrationLogger } from '../../src/core/logging';

// Mock dependencies
jest.mock('../../src/infrastructure/security/encryption.service', () => ({
    encryptionService: {
        encryptApiKey: jest.fn(),
        decryptApiKey: jest.fn(),
        encryptSecretKey: jest.fn(),
        decryptSecretKey: jest.fn(),
        encryptWithVersion: jest.fn(),
        decryptWithVersion: jest.fn(),
        isKeyRotationNeeded: jest.fn(),
        rotateEncryptionKeys: jest.fn(),
    }
}));

jest.mock('../../src/core/logging', () => ({
    integrationLogger: {
        startOperation: jest.fn().mockReturnValue({
            success: jest.fn()
        }),
        error: jest.fn(),
        warn: jest.fn()
    }
}));

describe('EncryptionAdapter', () => {
    let encryptionAdapter: EncryptionAdapter;

    beforeEach(() => {
        encryptionAdapter = new EncryptionAdapter();
        jest.clearAllMocks();
    });

    describe('encryptApiKey', () => {
        it('should encrypt API key using encryption service', () => {
            const apiKey = 'test-api-key';
            const encryptedApiKey = 'encrypted-api-key';

            (encryptionService.encryptApiKey as jest.Mock).mockReturnValue(encryptedApiKey);

            const result = encryptionAdapter.encryptApiKey(apiKey);

            expect(encryptionService.encryptApiKey).toHaveBeenCalledWith(apiKey);
            expect(integrationLogger.startOperation).toHaveBeenCalledWith('encryptApiKey', {
                apiKeyLength: apiKey.length
            });
            expect(result).toEqual(encryptedApiKey);
        });

        it('should throw error when encrypting empty API key', () => {
            expect(() => encryptionAdapter.encryptApiKey('')).toThrow('API key cannot be empty');
            expect(encryptionService.encryptApiKey).not.toHaveBeenCalled();
        });

        it('should handle encryption service errors', () => {
            const apiKey = 'test-api-key';
            const error = new Error('Encryption failed');

            (encryptionService.encryptApiKey as jest.Mock).mockImplementation(() => {
                throw error;
            });

            expect(() => encryptionAdapter.encryptApiKey(apiKey)).toThrow(`API key encryption failed: ${error.message}`);
            expect(integrationLogger.error).toHaveBeenCalledWith(
                'API key encryption failed',
                error,
                expect.any(Object)
            );
        });
    });

    describe('decryptApiKey', () => {
        it('should decrypt API key using encryption service', () => {
            const encryptedApiKey = 'encrypted-api-key';
            const apiKey = 'test-api-key';

            (encryptionService.decryptApiKey as jest.Mock).mockReturnValue(apiKey);

            const result = encryptionAdapter.decryptApiKey(encryptedApiKey);

            expect(encryptionService.decryptApiKey).toHaveBeenCalledWith(encryptedApiKey);
            expect(integrationLogger.startOperation).toHaveBeenCalledWith('decryptApiKey', {
                encryptedLength: encryptedApiKey.length
            });
            expect(result).toEqual(apiKey);
        });

        it('should throw error when decrypting empty API key', () => {
            expect(() => encryptionAdapter.decryptApiKey('')).toThrow('Encrypted API key cannot be empty');
            expect(encryptionService.decryptApiKey).not.toHaveBeenCalled();
        });

        it('should handle decryption service errors', () => {
            const encryptedApiKey = 'encrypted-api-key';
            const error = new Error('Decryption failed');

            (encryptionService.decryptApiKey as jest.Mock).mockImplementation(() => {
                throw error;
            });

            expect(() => encryptionAdapter.decryptApiKey(encryptedApiKey)).toThrow(`API key decryption failed: ${error.message}`);
            expect(integrationLogger.error).toHaveBeenCalledWith(
                'API key decryption failed',
                error,
                expect.any(Object)
            );
        });
    });

    describe('encryptSecretKey', () => {
        it('should encrypt secret key using encryption service', () => {
            const secretKey = 'test-secret-key';
            const encryptedSecretKey = 'encrypted-secret-key';

            (encryptionService.encryptSecretKey as jest.Mock).mockReturnValue(encryptedSecretKey);

            const result = encryptionAdapter.encryptSecretKey(secretKey);

            expect(encryptionService.encryptSecretKey).toHaveBeenCalledWith(secretKey);
            expect(integrationLogger.startOperation).toHaveBeenCalledWith('encryptSecretKey', {
                secretKeyLength: secretKey.length
            });
            expect(result).toEqual(encryptedSecretKey);
        });

        it('should throw error when encrypting empty secret key', () => {
            expect(() => encryptionAdapter.encryptSecretKey('')).toThrow('Secret key cannot be empty');
            expect(encryptionService.encryptSecretKey).not.toHaveBeenCalled();
        });

        it('should handle encryption service errors', () => {
            const secretKey = 'test-secret-key';
            const error = new Error('Encryption failed');

            (encryptionService.encryptSecretKey as jest.Mock).mockImplementation(() => {
                throw error;
            });

            expect(() => encryptionAdapter.encryptSecretKey(secretKey)).toThrow(`Secret key encryption failed: ${error.message}`);
            expect(integrationLogger.error).toHaveBeenCalledWith(
                'Secret key encryption failed',
                error,
                expect.any(Object)
            );
        });
    });

    describe('decryptSecretKey', () => {
        it('should decrypt secret key using encryption service', () => {
            const encryptedSecretKey = 'encrypted-secret-key';
            const secretKey = 'test-secret-key';

            (encryptionService.decryptSecretKey as jest.Mock).mockReturnValue(secretKey);

            const result = encryptionAdapter.decryptSecretKey(encryptedSecretKey);

            expect(encryptionService.decryptSecretKey).toHaveBeenCalledWith(encryptedSecretKey);
            expect(integrationLogger.startOperation).toHaveBeenCalledWith('decryptSecretKey', {
                encryptedLength: encryptedSecretKey.length
            });
            expect(result).toEqual(secretKey);
        });

        it('should throw error when decrypting empty secret key', () => {
            expect(() => encryptionAdapter.decryptSecretKey('')).toThrow('Encrypted secret key cannot be empty');
            expect(encryptionService.decryptSecretKey).not.toHaveBeenCalled();
        });

        it('should handle decryption service errors', () => {
            const encryptedSecretKey = 'encrypted-secret-key';
            const error = new Error('Decryption failed');

            (encryptionService.decryptSecretKey as jest.Mock).mockImplementation(() => {
                throw error;
            });

            expect(() => encryptionAdapter.decryptSecretKey(encryptedSecretKey)).toThrow(`Secret key decryption failed: ${error.message}`);
            expect(integrationLogger.error).toHaveBeenCalledWith(
                'Secret key decryption failed',
                error,
                expect.any(Object)
            );
        });
    });

    describe('encryptWithVersion', () => {
        it('should encrypt data with version using encryption service', async () => {
            const plaintext = 'test-data';
            const encryptedData = 'encrypted-data';
            const version = 2;

            (encryptionService.encryptWithVersion as jest.Mock).mockResolvedValue(encryptedData);

            const result = await encryptionAdapter.encryptWithVersion(plaintext, version);

            expect(encryptionService.encryptWithVersion).toHaveBeenCalledWith(plaintext, version);
            expect(integrationLogger.startOperation).toHaveBeenCalledWith('encryptWithVersion', {
                plaintextLength: plaintext.length,
                version
            });
            expect(result).toEqual(encryptedData);
        });

        it('should use current version when version not provided', async () => {
            const plaintext = 'test-data';
            const encryptedData = 'encrypted-data';

            (encryptionService.encryptWithVersion as jest.Mock).mockResolvedValue(encryptedData);

            await encryptionAdapter.encryptWithVersion(plaintext);

            expect(encryptionService.encryptWithVersion).toHaveBeenCalledWith(plaintext, undefined);
            expect(integrationLogger.startOperation).toHaveBeenCalledWith('encryptWithVersion', expect.objectContaining({
                version: 'current'
            }));
        });

        it('should throw error when encrypting empty plaintext', async () => {
            await expect(encryptionAdapter.encryptWithVersion('')).rejects.toThrow('Plaintext cannot be empty');
            expect(encryptionService.encryptWithVersion).not.toHaveBeenCalled();
        });

        it('should handle encryption service errors', async () => {
            const plaintext = 'test-data';
            const error = new Error('Encryption failed');

            (encryptionService.encryptWithVersion as jest.Mock).mockRejectedValue(error);

            await expect(encryptionAdapter.encryptWithVersion(plaintext)).rejects.toThrow(`Versioned encryption failed: ${error.message}`);
            expect(integrationLogger.error).toHaveBeenCalledWith(
                'Versioned encryption failed',
                error,
                expect.any(Object)
            );
        });
    });

    describe('decryptWithVersion', () => {
        it('should decrypt data with version using encryption service', async () => {
            const encryptedData = 'encrypted-data';
            const plaintext = 'test-data';

            (encryptionService.decryptWithVersion as jest.Mock).mockResolvedValue(plaintext);

            const result = await encryptionAdapter.decryptWithVersion(encryptedData);

            expect(encryptionService.decryptWithVersion).toHaveBeenCalledWith(encryptedData);
            expect(integrationLogger.startOperation).toHaveBeenCalledWith('decryptWithVersion', {
                encryptedLength: encryptedData.length
            });
            expect(result).toEqual(plaintext);
        });

        it('should throw error when decrypting empty data', async () => {
            await expect(encryptionAdapter.decryptWithVersion('')).rejects.toThrow('Encrypted data cannot be empty');
            expect(encryptionService.decryptWithVersion).not.toHaveBeenCalled();
        });

        it('should handle decryption service errors', async () => {
            const encryptedData = 'encrypted-data';
            const error = new Error('Decryption failed');

            (encryptionService.decryptWithVersion as jest.Mock).mockRejectedValue(error);

            await expect(encryptionAdapter.decryptWithVersion(encryptedData)).rejects.toThrow(`Versioned decryption failed: ${error.message}`);
            expect(integrationLogger.error).toHaveBeenCalledWith(
                'Versioned decryption failed',
                error,
                expect.any(Object)
            );
        });
    });

    describe('isKeyRotationNeeded', () => {
        it('should check if key rotation is needed', async () => {
            const rotationNeeded = true;

            (encryptionService.isKeyRotationNeeded as jest.Mock).mockResolvedValue(rotationNeeded);

            const result = await encryptionAdapter.isKeyRotationNeeded();

            expect(encryptionService.isKeyRotationNeeded).toHaveBeenCalled();
            expect(integrationLogger.startOperation).toHaveBeenCalledWith('isKeyRotationNeeded');
            expect(result).toEqual(rotationNeeded);
        });

        it('should return false and log warning when check fails', async () => {
            const error = new Error('Key rotation check failed');

            (encryptionService.isKeyRotationNeeded as jest.Mock).mockRejectedValue(error);

            const result = await encryptionAdapter.isKeyRotationNeeded();

            expect(result).toBe(false);
            expect(integrationLogger.warn).toHaveBeenCalled();
        });
    });

    describe('rotateEncryptionKeys', () => {
        it('should rotate encryption keys', async () => {
            (encryptionService.rotateEncryptionKeys as jest.Mock).mockResolvedValue(undefined);

            await encryptionAdapter.rotateEncryptionKeys();

            expect(encryptionService.rotateEncryptionKeys).toHaveBeenCalled();
            expect(integrationLogger.startOperation).toHaveBeenCalledWith('rotateEncryptionKeys');
        });

        it('should handle key rotation errors', async () => {
            const error = new Error('Key rotation failed');

            (encryptionService.rotateEncryptionKeys as jest.Mock).mockRejectedValue(error);

            await expect(encryptionAdapter.rotateEncryptionKeys()).rejects.toThrow(`Key rotation failed: ${error.message}`);
            expect(integrationLogger.error).toHaveBeenCalledWith(
                'Key rotation failed',
                error
            );
        });
    });

    describe('getEncryptionInfo', () => {
        it('should return encryption information', () => {
            const info = encryptionAdapter.getEncryptionInfo();

            expect(info).toEqual({
                algorithm: 'AES-256-GCM',
                keySize: 256,
                supportsKeyRotation: true,
                currentVersion: 2
            });
        });
    });
});