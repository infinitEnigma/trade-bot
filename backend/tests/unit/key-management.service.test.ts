/** @format */

import { KeyManagementService, KeyPurpose, keyManagementService } from '../../src/infrastructure/security/key-management.service';

// Mock dependencies
jest.mock('../../src/core/logging', () => ({
    logger: {
        debug: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        info: jest.fn()
    }
}));

describe('KeyManagementService', () => {
    // Save original environment variable
    const originalMasterKey = process.env.ENCRYPTION_MASTER_KEY;
    const originalNodeEnv = process.env.NODE_ENV;
    const originalKeySalt = process.env.ENCRYPTION_KEY_SALT;

    beforeAll(() => {
        // Set test encryption key
        process.env.ENCRYPTION_MASTER_KEY = 'test-encryption-key-32-chars-long';
        process.env.ENCRYPTION_KEY_SALT = 'test-salt-value-16-chars';
    });

    afterAll(() => {
        // Restore original environment variable
        process.env.ENCRYPTION_MASTER_KEY = originalMasterKey;
        process.env.NODE_ENV = originalNodeEnv;
        process.env.ENCRYPTION_KEY_SALT = originalKeySalt;
    });

    describe('security properties', () => {
        // These tests must run first to avoid any mock issues from other tests
        it('should produce different encrypted outputs for same input', async () => {
            const keyManagement = new KeyManagementService();
            const plaintext = 'test uniqueness';
            const encrypted1 = await keyManagement.encrypt(plaintext);
            const encrypted2 = await keyManagement.encrypt(plaintext);
            expect(encrypted1).not.toBe(encrypted2);
        });

        it('should handle large input data', async () => {
            const keyManagement = new KeyManagementService();
            const largeData = 'a'.repeat(10000);
            const encrypted = await keyManagement.encrypt(largeData);
            const decrypted = await keyManagement.decrypt(encrypted);
            expect(decrypted).toBe(largeData);
        });
    });

    describe('constructor', () => {
        it('should throw error when ENCRYPTION_MASTER_KEY is not set', () => {
            delete process.env.ENCRYPTION_MASTER_KEY;
            expect(() => new KeyManagementService()).toThrow('ENCRYPTION_MASTER_KEY environment variable required');
            process.env.ENCRYPTION_MASTER_KEY = 'test-encryption-key-32-chars-long'; // Restore for other tests
        });

        it('should throw error for weak key in production', () => {
            process.env.NODE_ENV = 'production';
            process.env.ENCRYPTION_MASTER_KEY = 'weak-key';

            expect(() => new KeyManagementService()).toThrow('ENCRYPTION_MASTER_KEY must be 32+ characters in production');

            process.env.NODE_ENV = originalNodeEnv;
            process.env.ENCRYPTION_MASTER_KEY = 'test-encryption-key-32-chars-long'; // Restore for other tests
        });

        it('should create singleton instance', () => {
            expect(keyManagementService).toBeInstanceOf(KeyManagementService);
        });
    });

    describe('basic encryption/decryption', () => {
        let keyManagement: KeyManagementService;

        beforeEach(() => {
            keyManagement = new KeyManagementService();
        });

        it('should encrypt and decrypt text correctly with default purpose', async () => {
            const plaintext = 'test plaintext';
            const encrypted = await keyManagement.encrypt(plaintext);
            expect(encrypted).not.toBe(plaintext);
            expect(typeof encrypted).toBe('string');

            const decrypted = await keyManagement.decrypt(encrypted);
            expect(decrypted).toBe(plaintext);
        });

        it('should encrypt and decrypt API keys', async () => {
            const apiKey = 'test-api-key-123';
            const encrypted = await keyManagement.encryptApiKey(apiKey);
            expect(encrypted).not.toBe(apiKey);

            const decrypted = await keyManagement.decryptApiKey(encrypted);
            expect(decrypted).toBe(apiKey);
        });

        it('should encrypt and decrypt secret keys', async () => {
            const secretKey = 'test-secret-key-456';
            const encrypted = await keyManagement.encryptSecretKey(secretKey);
            expect(encrypted).not.toBe(secretKey);

            const decrypted = await keyManagement.decryptSecretKey(encrypted);
            expect(decrypted).toBe(secretKey);
        });

        it('should encrypt and decrypt user credentials', async () => {
            const credentials = 'user:password123';
            const encrypted = await keyManagement.encryptUserCredential(credentials);
            expect(encrypted).not.toBe(credentials);

            const decrypted = await keyManagement.decryptUserCredential(encrypted);
            expect(decrypted).toBe(credentials);
        });

        it('should encrypt and decrypt financial data', async () => {
            const financialData = 'balance:1000.50';
            const encrypted = await keyManagement.encryptFinancialData(financialData);
            expect(encrypted).not.toBe(financialData);

            const decrypted = await keyManagement.decryptFinancialData(encrypted);
            expect(decrypted).toBe(financialData);
        });

        it('should handle different input texts', async () => {
            const texts = [
                'short',
                'a'.repeat(1000),
                'with special chars: !@#$%^&*()_+',
                'with unicode: 你好世界 🌍'
            ];

            for (const text of texts) {
                const encrypted = await keyManagement.encrypt(text);
                const decrypted = await keyManagement.decrypt(encrypted);
                expect(decrypted).toBe(text);
            }
        });

        it('should handle different key purposes', async () => {
            const testData = 'test data for different purposes';

            // Test all key purposes
            for (const purpose of Object.values(KeyPurpose)) {
                const encrypted = await keyManagement.encrypt(testData, purpose);
                const decrypted = await keyManagement.decrypt(encrypted, purpose);
                expect(decrypted).toBe(testData);
            }
        });
    });

    describe('key management', () => {
        let keyManagement: KeyManagementService;

        beforeEach(() => {
            keyManagement = new KeyManagementService();
        });

        it('should get key status information', async () => {
            const status = await keyManagement.getKeyStatus();

            expect(status).toEqual(
                expect.objectContaining({
                    purposes: expect.arrayContaining(Object.values(KeyPurpose)),
                    keyVersions: expect.any(Object),
                    config: expect.any(Object)
                })
            );

            // Verify all purposes have versions
            Object.values(KeyPurpose).forEach(purpose => {
                expect(status.keyVersions[purpose]).toBeDefined();
            });

            // Verify config has expected properties
            expect(status.config).toEqual(
                expect.objectContaining({
                    version: expect.any(Number),
                    algorithm: expect.any(String),
                    keyLength: expect.any(Number),
                    saltLength: expect.any(Number),
                    ivLength: expect.any(Number),
                    tagLength: expect.any(Number)
                })
            );
        });

        it('should validate encryption roundtrip', async () => {
            const isValid = await keyManagement.validateEncryption();
            expect(isValid).toBe(true);
        });

        it('should validate encryption roundtrip with custom data', async () => {
            const testData = 'custom-validation-data-123';
            const isValid = await keyManagement.validateEncryption(testData);
            expect(isValid).toBe(true);
        });
    });

    describe('error handling', () => {
        it('should throw error for invalid encrypted data', async () => {
            const keyManagement = new KeyManagementService();
            await expect(keyManagement.decrypt('invalid-base64-data')).rejects.toThrow();
        });

        it('should throw error for unsupported key version', async () => {
            // Create invalid version buffer manually
            const invalidVersion = 99;
            const versionBuffer = Buffer.alloc(1);
            versionBuffer.writeUInt8(invalidVersion);
            const invalidData = Buffer.concat([
                versionBuffer,
                Buffer.alloc(16), // salt
                Buffer.alloc(16), // iv
                Buffer.alloc(16), // tag
                Buffer.alloc(16)  // encrypted data
            ]).toString('base64');

            const keyManagement = new KeyManagementService();
            await expect(keyManagement.decrypt(invalidData)).rejects.toThrow('Unsupported key version: 99');
        });

        it('should handle key derivation failure', async () => {
            // Test key derivation failure by mocking the instance method
            const keyManagement = new KeyManagementService();

            // Spy on the instance method and make it reject
            const spy = jest.spyOn(keyManagement as any, 'derivePurposeKeys').mockRejectedValue(new Error('Key derivation failed'));

            await expect(keyManagement.encrypt('test')).rejects.toThrow('Key derivation failed');

            spy.mockRestore();
        });
    });

    describe('initializeMasterKey tests', () => {
        it('should use custom ENCRYPTION_KEY_SALT when provided', () => {
            const customSalt = 'custom-test-salt-value';
            process.env.ENCRYPTION_KEY_SALT = customSalt;

            // We need to access the private property for this test
            const keyManagement = new KeyManagementService();
            // @ts-ignore - Accessing private property for testing purposes
            const masterKeySeed1 = keyManagement['masterKeySeed'];

            // Now test with a different salt
            const differentSalt = 'different-test-salt-value';
            process.env.ENCRYPTION_KEY_SALT = differentSalt;

            // Create a new instance to get a new master key seed
            const keyManagement2 = new KeyManagementService();
            // @ts-ignore - Accessing private property for testing purposes
            const masterKeySeed2 = keyManagement2['masterKeySeed'];

            // Verify that different salts produce different master key seeds
            expect(masterKeySeed1).not.toEqual(masterKeySeed2);

            // Restore original salt
            process.env.ENCRYPTION_KEY_SALT = 'test-salt-value-16-chars';
        });
    });

    describe('validateEncryption method', () => {
        let keyManagement: KeyManagementService;

        beforeEach(() => {
            keyManagement = new KeyManagementService();
        });

        it('should handle encryption validation failure', async () => {
            // Mock encrypt to throw an error
            jest.spyOn(keyManagement, 'encrypt').mockImplementationOnce(async () => {
                throw new Error('Encryption failed');
            });

            const result = await keyManagement.validateEncryption();
            expect(result).toBe(false);

            // Restore original method
            jest.spyOn(keyManagement, 'encrypt').mockRestore();
        });
    });


    describe('cleanup', () => {
        // This test exists just to ensure any remaining mocks are cleared
        it('should reset any remaining mocks', () => {
            jest.clearAllMocks();
        });
    });
});