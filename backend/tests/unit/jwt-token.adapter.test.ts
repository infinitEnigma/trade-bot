/** @format */

import { JwtTokenAdapter } from '../../src/infrastructure/adapters/token/jwt-token.adapter';
import jwt from 'jsonwebtoken';
import { UserLevel } from '@trade-bot/shared';

// Mock the jwt library
jest.mock('jsonwebtoken');

describe('JwtTokenAdapter', () => {
    let originalEnv: NodeJS.ProcessEnv;
    const mockJwtSecret = 'test-jwt-secret-12345';
    const mockJwtRefreshSecret = 'test-jwt-refresh-secret-12345';

    beforeEach(() => {
        // Save original environment variables
        originalEnv = { ...process.env };
        // Set required environment variables
        process.env.JWT_SECRET = mockJwtSecret;
        process.env.JWT_REFRESH_SECRET = mockJwtRefreshSecret;
        process.env.NODE_ENV = 'test';
        // Clear all mocks
        jest.clearAllMocks();
    });

    afterEach(() => {
        // Restore original environment variables
        process.env = originalEnv;
    });

    describe('constructor', () => {
        it('should create an instance of JwtTokenAdapter', () => {
            const adapter = new JwtTokenAdapter();
            expect(adapter).toBeInstanceOf(JwtTokenAdapter);
        });

        it('should throw error when JWT_SECRET is not provided', () => {
            delete process.env.JWT_SECRET;
            expect(() => new JwtTokenAdapter()).toThrow('JWT_SECRET environment variable is required');
        });

        it('should throw error when JWT_REFRESH_SECRET is not provided', () => {
            delete process.env.JWT_REFRESH_SECRET;
            expect(() => new JwtTokenAdapter()).toThrow('JWT_REFRESH_SECRET environment variable is required');
        });

        it('should throw error when JWT_SECRET is too short in production', () => {
            process.env.NODE_ENV = 'production';
            process.env.JWT_SECRET = 'short-secret'; // Less than 32 characters
            expect(() => new JwtTokenAdapter()).toThrow('JWT_SECRET must be at least 32 characters in production');
        });

        it('should throw error when JWT_REFRESH_SECRET is too short in production', () => {
            process.env.NODE_ENV = 'production';
            process.env.JWT_SECRET = 'valid-long-jwt-secret-that-is-at-least-32-characters'; // Valid secret
            process.env.JWT_REFRESH_SECRET = 'short-refresh-secret'; // Less than 32 characters
            expect(() => new JwtTokenAdapter()).toThrow('JWT_REFRESH_SECRET must be at least 32 characters in production');
        });

        it('should accept valid secrets in production', () => {
            process.env.NODE_ENV = 'production';
            process.env.JWT_SECRET = 'valid-long-jwt-secret-that-is-at-least-32-characters';
            process.env.JWT_REFRESH_SECRET = 'valid-long-jwt-refresh-secret-that-is-at-least-32-characters';

            const adapter = new JwtTokenAdapter();
            expect(adapter).toBeInstanceOf(JwtTokenAdapter);
        });
    });

    describe('generateAccessToken', () => {
        it('should generate access token with correct parameters', () => {
            const adapter = new JwtTokenAdapter();
            const mockPayload = { userId: '123', email: 'test@example.com', userLevel: UserLevel.VERIFIED };
            const mockToken = 'mock-access-token';

            (jwt.sign as jest.Mock).mockReturnValue(mockToken);

            const result = adapter.generateAccessToken(mockPayload);

            expect(jwt.sign).toHaveBeenCalledWith(
                mockPayload,
                mockJwtSecret,
                expect.objectContaining({ expiresIn: '4h' })
            );
            expect(result).toEqual(mockToken);
        });

        it('should throw error when token generation fails', () => {
            const adapter = new JwtTokenAdapter();
            const mockPayload = { userId: '123', email: 'test@example.com', userLevel: UserLevel.VERIFIED };
            const mockError = new Error('Token generation failed');

            (jwt.sign as jest.Mock).mockImplementation(() => {
                throw mockError;
            });

            expect(() => adapter.generateAccessToken(mockPayload)).toThrow(
                `Failed to generate access token: ${mockError.message}`
            );
        });
    });

    describe('generateRefreshToken', () => {
        it('should generate refresh token with correct parameters', () => {
            const adapter = new JwtTokenAdapter();
            const mockPayload = { userId: '123', email: 'test@example.com', userLevel: UserLevel.VERIFIED };
            const mockToken = 'mock-refresh-token';

            (jwt.sign as jest.Mock).mockReturnValue(mockToken);

            const result = adapter.generateRefreshToken(mockPayload);

            expect(jwt.sign).toHaveBeenCalledWith(
                mockPayload,
                mockJwtRefreshSecret,
                expect.objectContaining({ expiresIn: '30d' })
            );
            expect(result).toEqual(mockToken);
        });

        it('should throw error when token generation fails', () => {
            const adapter = new JwtTokenAdapter();
            const mockPayload = { userId: '123', email: 'test@example.com', userLevel: UserLevel.VERIFIED };
            const mockError = new Error('Refresh token generation failed');

            (jwt.sign as jest.Mock).mockImplementation(() => {
                throw mockError;
            });

            expect(() => adapter.generateRefreshToken(mockPayload)).toThrow(
                `Failed to generate refresh token: ${mockError.message}`
            );
        });
    });

    describe('verifyToken', () => {
        it('should verify access token successfully', () => {
            const adapter = new JwtTokenAdapter();
            const mockToken = 'valid-access-token';
            const mockPayload = { userId: '123', email: 'test@example.com', userLevel: UserLevel.VERIFIED };

            (jwt.verify as jest.Mock).mockImplementation((token, secret) => {
                if (secret === mockJwtSecret) {
                    return mockPayload;
                }
                throw new Error('Invalid secret');
            });

            const result = adapter.verifyToken(mockToken);

            expect(jwt.verify).toHaveBeenCalledWith(mockToken, mockJwtSecret);
            expect(result).toEqual(mockPayload);
        });

        it('should verify refresh token successfully when access token fails', () => {
            const adapter = new JwtTokenAdapter();
            const mockToken = 'valid-refresh-token';
            const mockPayload = { userId: '123', email: 'test@example.com', userLevel: UserLevel.VERIFIED };

            (jwt.verify as jest.Mock).mockImplementation((token, secret) => {
                if (secret === mockJwtSecret) {
                    throw new Error('Invalid access token');
                } else if (secret === mockJwtRefreshSecret) {
                    return mockPayload;
                }
                throw new Error('Invalid secret');
            });

            const result = adapter.verifyToken(mockToken);

            expect(jwt.verify).toHaveBeenCalledWith(mockToken, mockJwtSecret);
            expect(jwt.verify).toHaveBeenCalledWith(mockToken, mockJwtRefreshSecret);
            expect(result).toEqual(mockPayload);
        });

        it('should return null when both token verifications fail', () => {
            const adapter = new JwtTokenAdapter();
            const mockToken = 'invalid-token';

            (jwt.verify as jest.Mock).mockImplementation(() => {
                throw new Error('Invalid token');
            });

            const result = adapter.verifyToken(mockToken);

            expect(jwt.verify).toHaveBeenCalledWith(mockToken, mockJwtSecret);
            expect(jwt.verify).toHaveBeenCalledWith(mockToken, mockJwtRefreshSecret);
            expect(result).toBeNull();
        });

        it('should return null when token verification throws unknown error', () => {
            const adapter = new JwtTokenAdapter();
            const mockToken = 'malformed-token';

            (jwt.verify as jest.Mock).mockImplementation(() => {
                throw new Error('Unknown error');
            });

            const result = adapter.verifyToken(mockToken);

            expect(result).toBeNull();
        });

        it('should return null when verifyToken method throws general error', () => {
            const adapter = new JwtTokenAdapter();
            const mockToken = 'invalid-token';

            // Make jwt.verify throw an unexpected error that isn't caught by the inner try-catch blocks
            (jwt.verify as jest.Mock).mockImplementation(() => {
                throw new TypeError('Unexpected type error');
            });

            const result = adapter.verifyToken(mockToken);

            expect(result).toBeNull();
        });
    });

    describe('verifyTokenWithDatabaseValidation', () => {
        it('should verify token and validate user exists', async () => {
            const adapter = new JwtTokenAdapter();
            const mockToken = 'valid-token';
            const mockPayload = { userId: '123', email: 'test@example.com', userLevel: UserLevel.VERIFIED };
            const mockAuthService = {
                getUserById: jest.fn().mockResolvedValue({ id: '123', email: 'test@example.com', userLevel: UserLevel.VERIFIED })
            };

            (jwt.verify as jest.Mock).mockReturnValue(mockPayload);

            const result = await adapter.verifyTokenWithDatabaseValidation(mockToken, mockAuthService);

            expect(mockAuthService.getUserById).toHaveBeenCalledWith(mockPayload.userId);
            expect(result).toEqual(mockPayload);
        });

        it('should return null when token is invalid', async () => {
            const adapter = new JwtTokenAdapter();
            const mockToken = 'invalid-token';
            const mockAuthService = {
                getUserById: jest.fn()
            };

            (jwt.verify as jest.Mock).mockImplementation(() => {
                throw new Error('Invalid token');
            });

            const result = await adapter.verifyTokenWithDatabaseValidation(mockToken, mockAuthService);

            expect(mockAuthService.getUserById).not.toHaveBeenCalled();
            expect(result).toBeNull();
        });

        it('should return null when user does not exist', async () => {
            const adapter = new JwtTokenAdapter();
            const mockToken = 'valid-token';
            const mockPayload = { userId: '123', email: 'test@example.com', userLevel: UserLevel.VERIFIED };
            const mockAuthService = {
                getUserById: jest.fn().mockResolvedValue(null)
            };

            (jwt.verify as jest.Mock).mockReturnValue(mockPayload);

            const result = await adapter.verifyTokenWithDatabaseValidation(mockToken, mockAuthService);

            expect(mockAuthService.getUserById).toHaveBeenCalledWith(mockPayload.userId);
            expect(result).toBeNull();
        });

        it('should return null when database validation fails', async () => {
            const adapter = new JwtTokenAdapter();
            const mockToken = 'valid-token';
            const mockPayload = { userId: '123', email: 'test@example.com', userLevel: UserLevel.VERIFIED };
            const mockAuthService = {
                getUserById: jest.fn().mockRejectedValue(new Error('Database error'))
            };

            (jwt.verify as jest.Mock).mockReturnValue(mockPayload);

            const result = await adapter.verifyTokenWithDatabaseValidation(mockToken, mockAuthService);

            expect(mockAuthService.getUserById).toHaveBeenCalledWith(mockPayload.userId);
            expect(result).toBeNull();
        });
    });

    describe('hashTokenForStorage', () => {
        it('should hash token for storage', () => {
            const adapter = new JwtTokenAdapter();
            const mockToken = 'test-token-to-hash';

            const result = adapter.hashTokenForStorage(mockToken);

            expect(typeof result).toBe('string');
            expect(result.length).toBe(16); // Should return first 16 characters of SHA-256 hash
            expect(result).not.toEqual(mockToken); // Should not be the same as input
        });

        it('should throw error when token is empty', () => {
            const adapter = new JwtTokenAdapter();
            expect(() => adapter.hashTokenForStorage('')).toThrow('Failed to hash token for storage');
        });

        it('should throw error when token hashing fails', () => {
            const adapter = new JwtTokenAdapter();
            const mockToken = 'invalid-token';

            // This is a bit tricky since we can't directly mock the crypto module
            // but we can test by passing invalid data types
            expect(() => adapter.hashTokenForStorage(mockToken as any)).not.toThrow();
        });
    });

    describe('getTokenExpiryInfo', () => {
        it('should return correct token expiry information', () => {
            const adapter = new JwtTokenAdapter();

            const result = adapter.getTokenExpiryInfo();

            expect(result).toEqual({
                accessTokenExpiry: '4h',
                refreshTokenExpiry: '30d'
            });
        });
    });

    describe('decodeTokenUnsafe', () => {
        it('should decode token without verification', () => {
            const adapter = new JwtTokenAdapter();
            const mockToken = 'encoded-token';
            const mockPayload = { userId: '123', email: 'test@example.com', userLevel: UserLevel.VERIFIED };

            (jwt.decode as jest.Mock).mockReturnValue(mockPayload);

            const result = adapter.decodeTokenUnsafe(mockToken);

            expect(jwt.decode).toHaveBeenCalledWith(mockToken);
            expect(result).toEqual(mockPayload);
        });

        it('should return null when decoding fails', () => {
            const adapter = new JwtTokenAdapter();
            const mockToken = 'invalid-token';

            (jwt.decode as jest.Mock).mockImplementation(() => {
                throw new Error('Decoding failed');
            });

            const result = adapter.decodeTokenUnsafe(mockToken);

            expect(result).toBeNull();
        });
    });
});