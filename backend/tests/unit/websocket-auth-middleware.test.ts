/** @format */

import { WebSocketAuthMiddleware } from '../../src/infrastructure/messaging/websocket/auth';
import { WebSocketError, WebSocketErrorCode } from '../../src/infrastructure/messaging/websocket/types';

describe('WebSocketAuthMiddleware', () => {
    let authMiddleware: WebSocketAuthMiddleware;
    let mockAuthService: any;
    let mockLogger: any;
    let mockSocket: any;

    beforeEach(() => {
        // Create mock dependencies
        mockAuthService = {
            validateToken: jest.fn(),
            getUserById: jest.fn()
        };

        mockLogger = {
            info: jest.fn(),
            error: jest.fn(),
            debug: jest.fn(),
            warn: jest.fn(),
            child: jest.fn()
        };

        // Create mock socket
        mockSocket = {
            id: 'test-socket-id',
            handshake: {
                address: '192.168.1.1',
                auth: {},
                headers: {}
            }
        };

        authMiddleware = new WebSocketAuthMiddleware(mockAuthService, mockLogger);
    });

    describe('instance creation', () => {
        it('should create an instance of WebSocketAuthMiddleware', () => {
            expect(authMiddleware).toBeInstanceOf(WebSocketAuthMiddleware);
        });
    });

    describe('authenticate', () => {
        it('should authenticate successfully with valid token and VERIFIED user', async () => {
            // Arrange
            const mockToken = 'valid-jwt-token';
            const mockUserId = 'test-user-id';
            mockSocket.handshake.auth.token = mockToken;

            mockAuthService.validateToken.mockResolvedValue({ userId: mockUserId });
            mockAuthService.getUserById.mockResolvedValue({
                userId: mockUserId,
                userLevel: 'VERIFIED'
            });

            // Act
            const result = await authMiddleware.authenticate(mockSocket);

            // Assert
            expect(mockAuthService.validateToken).toHaveBeenCalledWith(mockToken);
            expect(mockAuthService.getUserById).toHaveBeenCalledWith(mockUserId);
            expect(mockLogger.debug).toHaveBeenCalled();
            expect(mockLogger.info).toHaveBeenCalled();
            expect(result).toEqual(expect.objectContaining({
                userId: mockUserId,
                userLevel: 'VERIFIED',
                socketId: mockSocket.id,
                subscriptions: expect.any(Set),
                connectedAt: expect.any(Date),
                lastActivity: expect.any(Date),
                ipAddress: mockSocket.handshake.address
            }));
        });

        it('should throw error when no token is provided', async () => {
            // Arrange
            mockSocket.handshake.auth.token = undefined;
            mockSocket.handshake.headers.authorization = undefined;

            // Act & Assert
            await expect(authMiddleware.authenticate(mockSocket))
                .rejects.toThrow(WebSocketError);

            await expect(authMiddleware.authenticate(mockSocket))
                .rejects.toMatchObject({
                    message: 'Authentication required',
                    code: WebSocketErrorCode.AUTHENTICATION_FAILED,
                    statusCode: 401
                });
        });

        it('should throw error when token is invalid', async () => {
            // Arrange
            const mockToken = 'invalid-jwt-token';
            mockSocket.handshake.auth.token = mockToken;

            mockAuthService.validateToken.mockResolvedValue(null);

            // Act & Assert
            await expect(authMiddleware.authenticate(mockSocket))
                .rejects.toThrow(WebSocketError);

            await expect(authMiddleware.authenticate(mockSocket))
                .rejects.toMatchObject({
                    message: 'Invalid token',
                    code: WebSocketErrorCode.INVALID_TOKEN,
                    statusCode: 401
                });
        });

        it('should throw error when user is not found', async () => {
            // Arrange
            const mockToken = 'valid-jwt-token';
            const mockUserId = 'non-existent-user';
            mockSocket.handshake.auth.token = mockToken;

            mockAuthService.validateToken.mockResolvedValue({ userId: mockUserId });
            mockAuthService.getUserById.mockResolvedValue(null);

            // Act & Assert
            await expect(authMiddleware.authenticate(mockSocket))
                .rejects.toThrow(WebSocketError);

            await expect(authMiddleware.authenticate(mockSocket))
                .rejects.toMatchObject({
                    message: 'User not found',
                    code: WebSocketErrorCode.USER_NOT_FOUND,
                    statusCode: 401
                });
        });

        it('should throw error when user has insufficient permissions (BASIC level)', async () => {
            // Arrange
            const mockToken = 'valid-jwt-token';
            const mockUserId = 'test-user-id';
            mockSocket.handshake.auth.token = mockToken;

            mockAuthService.validateToken.mockResolvedValue({ userId: mockUserId });
            mockAuthService.getUserById.mockResolvedValue({
                userId: mockUserId,
                userLevel: 'BASIC'
            });

            // Act & Assert
            await expect(authMiddleware.authenticate(mockSocket))
                .rejects.toThrow(WebSocketError);

            await expect(authMiddleware.authenticate(mockSocket))
                .rejects.toMatchObject({
                    message: 'Real-time data requires VERIFIED account',
                    code: WebSocketErrorCode.INSUFFICIENT_PERMISSIONS,
                    statusCode: 403
                });
        });

        it('should throw internal error when auth service throws unexpected error', async () => {
            // Arrange
            const mockToken = 'valid-jwt-token';
            const mockUserId = 'test-user-id';
            const testError = new Error('Unexpected server error');
            mockSocket.handshake.auth.token = mockToken;

            mockAuthService.validateToken.mockRejectedValue(testError);

            // Act & Assert
            await expect(authMiddleware.authenticate(mockSocket))
                .rejects.toThrow(WebSocketError);

            await expect(authMiddleware.authenticate(mockSocket))
                .rejects.toMatchObject({
                    message: 'Authentication failed',
                    code: WebSocketErrorCode.INTERNAL_ERROR,
                    statusCode: 500
                });

            expect(mockLogger.error).toHaveBeenCalled();
        });

        it('should extract token from Authorization header when auth.token is not provided', async () => {
            // Arrange
            const mockToken = 'valid-jwt-token';
            const mockUserId = 'test-user-id';
            mockSocket.handshake.auth.token = undefined;
            mockSocket.handshake.headers.authorization = `Bearer ${mockToken}`;

            mockAuthService.validateToken.mockResolvedValue({ userId: mockUserId });
            mockAuthService.getUserById.mockResolvedValue({
                userId: mockUserId,
                userLevel: 'VERIFIED'
            });

            // Act
            const result = await authMiddleware.authenticate(mockSocket);

            // Assert
            expect(mockAuthService.validateToken).toHaveBeenCalledWith(mockToken);
            expect(result).toEqual(expect.objectContaining({
                userId: mockUserId,
                userLevel: 'VERIFIED'
            }));
        });
    });
});