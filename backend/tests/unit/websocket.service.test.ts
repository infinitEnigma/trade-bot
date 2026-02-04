/** @format */

import { WebSocketService } from '../../src/infrastructure/messaging/websocket.service';
import { IMarketStreamService, IAuthService, ILogger, Server } from '../../src/interfaces/websocket';

// Mock dependencies
jest.mock('../../src/infrastructure/messaging/websocket/auth');
jest.mock('../../src/infrastructure/messaging/websocket/handlers');
jest.mock('../../src/infrastructure/security/rate-limiter/websocket-rate-limiter.adapter');

describe('WebSocketService', () => {
    let webSocketService: WebSocketService;
    let mockMarketStreamService: jest.Mocked<IMarketStreamService>;
    let mockAuthService: jest.Mocked<IAuthService>;
    let mockLogger: jest.Mocked<ILogger>;
    let mockServer: Partial<Server>;

    beforeEach(() => {
        // Create mock dependencies
        mockMarketStreamService = {
            setSocketServer: jest.fn(),
        } as unknown as jest.Mocked<IMarketStreamService>;

        mockAuthService = {
            // Add mock methods as needed
        } as unknown as jest.Mocked<IAuthService>;

        mockLogger = {
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            debug: jest.fn(),
        } as unknown as jest.Mocked<ILogger>;

        // Create mock server
        mockServer = {
            use: jest.fn(),
            on: jest.fn(),
            disconnectSockets: jest.fn(),
            sockets: {
                sockets: {
                    get: jest.fn(),
                },
            },
        } as any;

        // Create WebSocketService instance
        webSocketService = new WebSocketService(
            mockMarketStreamService,
            mockAuthService,
            mockLogger
        );
    });

    describe('initialization', () => {
        it('should create an instance of WebSocketService', () => {
            expect(webSocketService).toBeInstanceOf(WebSocketService);
        });

        it('should initialize the WebSocket service with server', () => {
            webSocketService.initialize(mockServer as Server);
            expect(mockLogger.info).toHaveBeenCalled();
        });

        it('should throw an error if initialized twice', () => {
            webSocketService.initialize(mockServer as Server);
            expect(() => webSocketService.initialize(mockServer as Server)).toThrow(
                'WebSocket service already initialized'
            );
        });
    });

    describe('metrics and statistics', () => {
        it('should get initial metrics', () => {
            const metrics = webSocketService.getMetrics();
            expect(metrics.activeConnections).toBe(0);
            expect(metrics.messagesPerSecond).toBe(0);
            expect(metrics.errorRate).toBe(0);
            expect(metrics.topSubscriptions).toEqual([]);
            expect(metrics.healthScore).toBeGreaterThan(0);
            expect(metrics.memoryUsage).toBe(0);
            expect(metrics.averageResponseTime).toBe(0);
        });

        it('should calculate health score correctly', () => {
            const metrics = webSocketService.getMetrics();
            expect(metrics.healthScore).toBeGreaterThanOrEqual(0);
            expect(metrics.healthScore).toBeLessThanOrEqual(100);
        });

        it('should get connection information', () => {
            const connections = webSocketService.getConnections();
            expect(connections).toEqual([]);
        });

        it('should get comprehensive stats', () => {
            const stats = webSocketService.getStats();
            expect(stats.metrics).toEqual(expect.any(Object));
            expect(stats.connections).toEqual([]);
            expect(['healthy', 'warning', 'critical']).toContain(stats.serviceHealth.status);
            expect(stats.serviceHealth.uptime).toBeGreaterThanOrEqual(0);
            expect(stats.serviceHealth.memoryUsage).toBe(0);
        });
    });

    describe('client management', () => {
        it('should handle client disconnection attempt', () => {
            const mockSocketId = 'test-socket-id';
            const mockSocket = {
                disconnect: jest.fn(),
            };

            (mockServer.sockets!.sockets.get as jest.Mock).mockReturnValue(mockSocket);

            webSocketService.initialize(mockServer as Server);
            webSocketService.disconnectClient(mockSocketId);

            expect(mockSocket.disconnect).toHaveBeenCalledWith(true);
            expect(mockLogger.info).toHaveBeenCalled();
        });

        it('should log warning for non-existent socket disconnection', () => {
            const mockSocketId = 'non-existent-socket-id';
            (mockServer.sockets!.sockets.get as jest.Mock).mockReturnValue(undefined);

            webSocketService.initialize(mockServer as Server);
            webSocketService.disconnectClient(mockSocketId);

            expect(mockLogger.warn).toHaveBeenCalled();
        });
    });

    describe('test cleanup', () => {
        it('should clean up resources for tests', () => {
            webSocketService.initialize(mockServer as Server);
            webSocketService.cleanupForTests();

            expect(mockServer.disconnectSockets).toHaveBeenCalledWith(true);
            expect(mockLogger.info).toHaveBeenCalled();

            const metrics = webSocketService.getMetrics();
            expect(metrics.activeConnections).toBe(0);
        });
    });

    describe('connection handling', () => {
        it('should setup authentication middleware', () => {
            webSocketService.initialize(mockServer as Server);
            expect(mockServer.use).toHaveBeenCalled();
        });

        it('should setup connection handlers', () => {
            webSocketService.initialize(mockServer as Server);
            expect(mockServer.on).toHaveBeenCalledWith('connection', expect.any(Function));
        });

        it('should setup error handling', () => {
            webSocketService.initialize(mockServer as Server);
            expect(mockServer.on).toHaveBeenCalledWith('connection_error', expect.any(Function));
        });
    });

    describe('health calculation', () => {
        it('should calculate health score with active connections', () => {
            // Override clients map to simulate active connections
            (webSocketService as any).clients = new Map([
                ['socket1', { subscriptions: new Set(['topic1']) }],
                ['socket2', { subscriptions: new Set(['topic1', 'topic2']) }],
                ['socket3', { subscriptions: new Set(['topic3']) }],
            ]);

            const metrics = webSocketService.getMetrics();
            expect(metrics.activeConnections).toBe(3);
            expect(metrics.topSubscriptions).toEqual(expect.arrayContaining([
                expect.objectContaining({ topic: 'topic1', count: 2 }),
                expect.objectContaining({ topic: 'topic2', count: 1 }),
                expect.objectContaining({ topic: 'topic3', count: 1 }),
            ]));
        });

        it('should track response times and metrics', () => {
            const responseTimes = [100, 200, 300, 400, 500];
            (webSocketService as any).metrics.responseTimes = responseTimes;
            (webSocketService as any).metrics.messagesProcessed = responseTimes.length;

            const metrics = webSocketService.getMetrics();
            expect(metrics.averageResponseTime).toEqual(300);
        });
    });
});