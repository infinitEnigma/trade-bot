/** @format */

import { Socket } from "socket.io";
import { WebSocketClient, IAuthService, ILogger } from "../../../interfaces/websocket";
import { WebSocketError, WebSocketErrorCode } from "./types";

/**
 * WebSocket Authentication Middleware
 * Handles JWT authentication and user verification for WebSocket connections
 */
export class WebSocketAuthMiddleware {
    constructor(
        private authService: IAuthService,
        private logger: ILogger
    ) { }

    /**
     * Authenticate a WebSocket connection
     * @param socket - Socket.IO socket instance
     * @returns Promise<WebSocketClient> - Authenticated client information
     * @throws WebSocketError - If authentication fails
     */
    async authenticate(socket: Socket): Promise<WebSocketClient> {
        const correlationId = this.generateCorrelationId();
        const ipAddress = socket.handshake.address;

        try {
            this.logger.debug("Starting WebSocket authentication", {
                socketId: socket.id,
                ipAddress,
                correlationId,
            });

            // Extract token from handshake
            const token = this.extractToken(socket);
            if (!token) {
                throw new WebSocketError(
                    "Authentication required",
                    WebSocketErrorCode.AUTHENTICATION_FAILED,
                    401,
                    { socketId: socket.id, correlationId }
                );
            }

            // Validate JWT token
            const decoded = await this.authService.validateToken(token);
            if (!decoded) {
                throw new WebSocketError(
                    "Invalid token",
                    WebSocketErrorCode.INVALID_TOKEN,
                    401,
                    { socketId: socket.id, correlationId }
                );
            }

            // Verify user exists and is active
            const user = await this.authService.getUserById(decoded.userId);
            if (!user) {
                throw new WebSocketError(
                    "User not found",
                    WebSocketErrorCode.USER_NOT_FOUND,
                    401,
                    { socketId: socket.id, userId: decoded.userId, correlationId }
                );
            }

            // Require VERIFIED level for WebSocket access
            if (user.userLevel !== "VERIFIED") {
                throw new WebSocketError(
                    "Real-time data requires VERIFIED account",
                    WebSocketErrorCode.INSUFFICIENT_PERMISSIONS,
                    403,
                    {
                        socketId: socket.id,
                        userId: decoded.userId,
                        userLevel: user.userLevel,
                        requiredLevel: "VERIFIED",
                        correlationId,
                    }
                );
            }

            const client: WebSocketClient = {
                userId: decoded.userId,
                userLevel: user.userLevel,
                socketId: socket.id,
                subscriptions: new Set(),
                connectedAt: new Date(),
                lastActivity: new Date(),
                ipAddress,
            };

            this.logger.info("WebSocket authentication successful", {
                socketId: socket.id,
                userId: client.userId,
                userLevel: client.userLevel,
                correlationId,
                ipAddress,
            });

            return client;

        } catch (error) {
            // Re-throw WebSocketErrors as-is
            if (error instanceof WebSocketError) {
                throw error;
            }

            // Wrap unexpected errors
            const errorObj = error instanceof Error ? error : new Error(String(error));
            this.logger.error("WebSocket authentication failed - auth", {
                socketId: socket.id,
                ipAddress,
                correlationId,
                error: errorObj,
            });

            throw new WebSocketError(
                "Authentication failed",
                WebSocketErrorCode.INTERNAL_ERROR,
                500,
                { socketId: socket.id, correlationId, originalError: error instanceof Error ? error.message : String(error) }
            );
        }
    }

    /**
     * Extract JWT token from socket handshake
     * @param socket - Socket.IO socket instance
     * @returns string | null - JWT token or null if not found
     */
    private extractToken(socket: Socket): string | null {
        // Try auth.token first (recommended)
        if (socket.handshake.auth?.token) {
            return socket.handshake.auth.token;
        }

        // Fallback to Authorization header
        const authHeader = socket.handshake.headers?.authorization;
        if (authHeader && authHeader.startsWith("Bearer ")) {
            return authHeader.substring(7);
        }

        // NEW: Extract token from cookies (since we use httpOnly cookies for auth)
        const cookies = socket.handshake.headers?.cookie;
        if (cookies) {
            // Look for accessToken cookie
            const cookieMatch = cookies.match(/accessToken=([^;]+)/);
            if (cookieMatch && cookieMatch[1]) {
                return cookieMatch[1];
            }
        }

        return null;
    }

    /**
     * Generate correlation ID for authentication events
     */
    private generateCorrelationId(): string {
        return `ws_auth_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
}
