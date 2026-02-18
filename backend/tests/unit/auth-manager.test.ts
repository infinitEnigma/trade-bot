/** @format */

import { AuthManager } from '../../src/infrastructure/messaging/market-stream/auth-manager';
import { marketStreamLogger } from '../../src/core/logging/context-aware-logger.service';

// Mock dependencies
jest.mock('../../src/core/logging/context-aware-logger.service', () => ({
    marketStreamLogger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    }
}));
jest.mock('../../src/database/pool');
jest.mock('../../src/infrastructure/security/encryption.service');

// Mock third-party modules
jest.mock('bs58', () => ({
    decode: jest.fn()
}));

jest.mock('@noble/ed25519', () => ({
    sign: jest.fn()
}));

// Mock the dynamic import for encryption service
jest.mock('../../src/infrastructure/security/encryption.service', () => ({
    encryptionService: {
        decryptApiKey: jest.fn(),
        decryptSecretKey: jest.fn()
    }
}));

describe('AuthManager', () => {
    let authManager: AuthManager;
    const mockAccountId = 'test-account-id';
    const mockApiKey = 'test-api-key';
    const mockSecretKey = 'test-secret-key';

    beforeEach(() => {
        authManager = new AuthManager();
    });

    describe('instance creation', () => {
        it('should create an instance of AuthManager', () => {
            expect(authManager).toBeInstanceOf(AuthManager);
        });
    });

    describe('hasCredentials', () => {
        it('should return true when credentials exist and are verified', async () => {
            const mockQuery = require('../../src/database/pool').query;
            mockQuery.mockResolvedValue({
                rows: [{ count: '1' }]
            });

            const result = await authManager.hasCredentials(mockAccountId);
            expect(result).toBe(true);
            expect(mockQuery).toHaveBeenCalledWith(
                expect.stringContaining('SELECT COUNT(*)'),
                [mockAccountId]
            );
        });

        it('should return false when no credentials exist', async () => {
            const mockQuery = require('../../src/database/pool').query;
            mockQuery.mockResolvedValue({
                rows: [{ count: '0' }]
            });

            const result = await authManager.hasCredentials(mockAccountId);
            expect(result).toBe(false);
        });

        it('should return false when query fails', async () => {
            const mockQuery = require('../../src/database/pool').query;
            const testError = new Error('Database connection failed');
            mockQuery.mockRejectedValue(testError);

            const result = await authManager.hasCredentials(mockAccountId);
            expect(result).toBe(false);
        });
    });

    describe('getAccountId', () => {
        it('should return account ID when credentials exist', async () => {
            const mockQuery = require('../../src/database/pool').query;
            mockQuery.mockResolvedValue({
                rows: [{ account_id: mockAccountId }]
            });

            const result = await authManager.getAccountId();
            expect(result).toBe(mockAccountId);
            expect(mockQuery).toHaveBeenCalledWith(
                expect.stringContaining('SELECT account_id')
            );
        });

        it('should return null when no credentials exist', async () => {
            const mockQuery = require('../../src/database/pool').query;
            mockQuery.mockResolvedValue({
                rows: []
            });

            const result = await authManager.getAccountId();
            expect(result).toBeNull();
        });

        it('should return null when query fails', async () => {
            const mockQuery = require('../../src/database/pool').query;
            const testError = new Error('Database query failed');
            mockQuery.mockRejectedValue(testError);

            const result = await authManager.getAccountId();
            expect(result).toBeNull();
        });
    });

    describe('validateAuthResponse', () => {
        it('should return true for successful auth response with event', () => {
            const successMessage = {
                event: 'auth',
                success: true
            };

            const result = authManager.validateAuthResponse(successMessage as any);
            expect(result).toBe(true);
        });

        it('should return true for successful auth response with method', () => {
            const successMessage = {
                method: 'AUTH',
                code: 0
            };

            const result = authManager.validateAuthResponse(successMessage as any);
            expect(result).toBe(true);
        });

        it('should return false for failed auth response with event', () => {
            const failureMessage = {
                event: 'auth',
                success: false,
                error: 'Invalid credentials'
            };

            const result = authManager.validateAuthResponse(failureMessage as any);
            expect(result).toBe(false);
        });

        it('should return false for failed auth response with method', () => {
            const failureMessage = {
                method: 'AUTH',
                code: 1001,
                error: 'Authentication failed'
            };

            const result = authManager.validateAuthResponse(failureMessage as any);
            expect(result).toBe(false);
        });

        it('should return true for non-auth messages', () => {
            const nonAuthMessage = {
                event: 'market_data',
                data: { symbol: 'BTC/USDT', price: 50000 }
            };

            const result = authManager.validateAuthResponse(nonAuthMessage as any);
            expect(result).toBe(true);
        });

        it('should return false when validation throws an error', () => {
            const invalidMessage = {
                event: 'auth',
                success: null
            };

            const result = authManager.validateAuthResponse(invalidMessage as any);
            expect(result).toBe(false);
        });

        it('should handle errors in validateAuthResponse method', () => {
            // Create an object that will throw when properties are accessed
            const errorMessage = new Proxy({}, {
                get: () => {
                    throw new Error('Property access error');
                }
            });

            const result = authManager.validateAuthResponse(errorMessage as any);
            expect(result).toBe(false);
            expect(marketStreamLogger.error).toHaveBeenCalled();
        });
    });

    describe('authenticate', () => {
        it('should throw error when no credentials found', async () => {
            const mockQuery = require('../../src/database/pool').query;
            mockQuery.mockResolvedValue({
                rows: []
            });

            const mockWs = { send: jest.fn() } as any;

            await expect(authManager.authenticate(mockWs, mockAccountId))
                .rejects.toThrow('No credentials found for WebSocket authentication');
        });

        it('should authenticate successfully with valid credentials', async () => {
            const mockQuery = require('../../src/database/pool').query;
            mockQuery.mockResolvedValue({
                rows: [
                    {
                        api_key_encrypted: 'encrypted-api-key',
                        secret_key_encrypted: 'encrypted-secret-key'
                    }
                ]
            });

            const mockEncryptionService = require('../../src/infrastructure/security/encryption.service').encryptionService;
            mockEncryptionService.decryptApiKey.mockReturnValue(mockApiKey);
            mockEncryptionService.decryptSecretKey.mockReturnValue(mockSecretKey);

            // Use require instead of dynamic import for mocks
            const mockBs58 = require('bs58');
            mockBs58.decode.mockReturnValue(Buffer.from('test-private-key'));

            const mockEd25519 = require('@noble/ed25519');
            mockEd25519.sign.mockResolvedValue(Buffer.from('test-signature'));

            const mockWs = { send: jest.fn() } as any;

            await authManager.authenticate(mockWs, mockAccountId);

            expect(mockEncryptionService.decryptApiKey).toHaveBeenCalled();
            expect(mockEncryptionService.decryptSecretKey).toHaveBeenCalled();
            expect(mockBs58.decode).toHaveBeenCalled();
            expect(mockEd25519.sign).toHaveBeenCalled();
            expect(mockWs.send).toHaveBeenCalled();

            const sentMessage = JSON.parse(mockWs.send.mock.calls[0][0]);
            console.log('sentMessage:', sentMessage);
            expect(sentMessage.event).toBe('auth');
            expect(sentMessage.params.orderly_account_id).toBe(mockAccountId);
            expect(sentMessage.params.orderly_key).toBe(mockApiKey);
            expect(sentMessage.params.orderly_signature).toBeDefined();
            expect(sentMessage.params.orderly_timestamp).toBeGreaterThan(0);
        });
    });
});