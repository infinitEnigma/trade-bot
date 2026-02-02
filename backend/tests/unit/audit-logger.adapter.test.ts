/** @format */

import { AuditLoggerAdapter } from '../../src/infrastructure/adapters/audit/audit-logger.adapter';
import { query } from '../../src/database/pool';
import { logger } from '../../src/core/logging';

// Mock dependencies
jest.mock('../../src/database/pool', () => ({
    query: jest.fn().mockResolvedValue({})
}));

jest.mock('../../src/core/logging', () => ({
    logger: {
        debug: jest.fn(),
        error: jest.fn()
    }
}));

describe('AuditLoggerAdapter', () => {
    let auditLogger: AuditLoggerAdapter;

    beforeEach(() => {
        auditLogger = new AuditLoggerAdapter();
        jest.clearAllMocks();
    });

    describe('logEvent', () => {
        it('should log an audit event to the database', async () => {
            const mockEvent = {
                userId: 'test-user-123',
                action: 'USER_LOGIN',
                details: {
                    ipAddress: '192.168.1.1',
                    userAgent: 'Mozilla/5.0'
                }
            };

            await auditLogger.logEvent(mockEvent);

            expect(query).toHaveBeenCalledWith(
                'INSERT INTO audit_logs (user_id, action, details) VALUES ($1, $2, $3)',
                [
                    mockEvent.userId,
                    mockEvent.action,
                    JSON.stringify(mockEvent.details)
                ]
            );

            expect(logger.debug).toHaveBeenCalledWith('Audit event logged', expect.any(Object));
        });

        it('should handle errors when logging events without throwing', async () => {
            const mockEvent = {
                userId: 'test-user-123',
                action: 'USER_LOGIN',
                details: {
                    ipAddress: '192.168.1.1',
                    userAgent: 'Mozilla/5.0'
                }
            };

            const mockError = new Error('Database connection failed');
            (query as jest.Mock).mockRejectedValue(mockError);

            await auditLogger.logEvent(mockEvent);

            expect(logger.error).toHaveBeenCalledWith(
                'Failed to log audit event',
                expect.objectContaining({
                    userId: mockEvent.userId,
                    action: mockEvent.action,
                    error: mockError.message
                })
            );
        });
    });

    describe('logEvents', () => {
        it('should log multiple events in a batch', async () => {
            const mockEvents = [
                {
                    userId: 'test-user-123',
                    action: 'USER_LOGIN',
                    details: { ipAddress: '192.168.1.1', userAgent: 'Mozilla/5.0' }
                },
                {
                    userId: 'test-user-456',
                    action: 'USER_LOGOUT',
                    details: { sessionDuration: 3600 }
                }
            ];

            // Explicitly mock query to resolve successfully
            (query as jest.Mock).mockResolvedValue({});

            await auditLogger.logEvents(mockEvents);

            expect(query).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO audit_logs (user_id, action, details) VALUES'),
                expect.arrayContaining([
                    mockEvents[0].userId,
                    mockEvents[0].action,
                    JSON.stringify(mockEvents[0].details),
                    mockEvents[1].userId,
                    mockEvents[1].action,
                    JSON.stringify(mockEvents[1].details)
                ])
            );


            expect(logger.debug).toHaveBeenCalledWith('Batch audit events logged', {
                count: mockEvents.length
            });
        });

        it('should do nothing when logging an empty batch', async () => {
            await auditLogger.logEvents([]);

            expect(query).not.toHaveBeenCalled();
            expect(logger.debug).not.toHaveBeenCalled();
            expect(logger.error).not.toHaveBeenCalled();
        });

        it('should handle errors when logging batch events without throwing', async () => {
            const mockEvents = [
                {
                    userId: 'test-user-123',
                    action: 'USER_LOGIN',
                    details: { ipAddress: '192.168.1.1' }
                }
            ];

            const mockError = new Error('Transaction failed');
            (query as jest.Mock).mockRejectedValue(mockError);

            await auditLogger.logEvents(mockEvents);

            expect(logger.error).toHaveBeenCalledWith(
                'Failed to log batch audit events',
                expect.objectContaining({
                    count: mockEvents.length,
                    error: mockError.message
                })
            );
        });
    });

    describe('getUserAuditEvents', () => {
        it('should retrieve audit events for a user', async () => {
            const mockUserId = 'test-user-123';
            const mockEvents = [
                {
                    action: 'USER_LOGIN',
                    details: JSON.stringify({ ipAddress: '192.168.1.1' }),
                    created_at: new Date('2023-01-01')
                },
                {
                    action: 'USER_LOGOUT',
                    details: JSON.stringify({ sessionDuration: 3600 }),
                    created_at: new Date('2023-01-02')
                }
            ];

            (query as jest.Mock).mockResolvedValue({
                rows: mockEvents
            });

            const events = await auditLogger.getUserAuditEvents(mockUserId);

            expect(query).toHaveBeenCalledWith(
                'SELECT action, details, created_at FROM audit_logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
                [mockUserId, 100]
            );

            expect(events).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        userId: mockUserId,
                        action: 'USER_LOGIN',
                        details: expect.objectContaining({ ipAddress: '192.168.1.1' })
                    }),
                    expect.objectContaining({
                        userId: mockUserId,
                        action: 'USER_LOGOUT',
                        details: expect.objectContaining({ sessionDuration: 3600 })
                    })
                ])
            );
        });

        it('should handle custom limit when retrieving user audit events', async () => {
            const mockUserId = 'test-user-123';
            const customLimit = 50;

            (query as jest.Mock).mockResolvedValue({ rows: [] });

            await auditLogger.getUserAuditEvents(mockUserId, customLimit);

            expect(query).toHaveBeenCalledWith(
                expect.anything(),
                [mockUserId, customLimit]
            );
        });

        it('should return empty array when database query fails', async () => {
            const mockUserId = 'test-user-123';
            (query as jest.Mock).mockRejectedValue(new Error('Database error'));

            const events = await auditLogger.getUserAuditEvents(mockUserId);

            expect(events).toEqual([]);
            expect(logger.error).toHaveBeenCalledWith(
                'Failed to get user audit events',
                expect.objectContaining({
                    userId: mockUserId,
                    error: 'Database error'
                })
            );
        });

        it('should handle invalid JSON in details when retrieving user events', async () => {
            const mockUserId = 'test-user-123';
            const mockEvents = [
                {
                    action: 'USER_LOGIN',
                    details: 'invalid-json',
                    created_at: new Date('2023-01-01')
                }
            ];

            (query as jest.Mock).mockResolvedValue({
                rows: mockEvents
            });

            const events = await auditLogger.getUserAuditEvents(mockUserId);

            expect(events[0].details).toEqual({ raw: 'invalid-json' });
        });
    });

    describe('getAuditEventsByAction', () => {
        it('should retrieve audit events by action type', async () => {
            const mockAction = 'USER_LOGIN';
            const mockEvents = [
                {
                    user_id: 'test-user-123',
                    details: JSON.stringify({ ipAddress: '192.168.1.1' }),
                    created_at: new Date('2023-01-01')
                },
                {
                    user_id: 'test-user-456',
                    details: JSON.stringify({ ipAddress: '10.0.0.1' }),
                    created_at: new Date('2023-01-02')
                }
            ];

            (query as jest.Mock).mockResolvedValue({
                rows: mockEvents
            });

            const events = await auditLogger.getAuditEventsByAction(mockAction);

            expect(query).toHaveBeenCalledWith(
                'SELECT user_id, details, created_at FROM audit_logs WHERE action = $1 ORDER BY created_at DESC LIMIT $2',
                [mockAction, 100]
            );

            expect(events).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        userId: 'test-user-123',
                        action: mockAction,
                        details: expect.objectContaining({ ipAddress: '192.168.1.1' })
                    }),
                    expect.objectContaining({
                        userId: 'test-user-456',
                        action: mockAction,
                        details: expect.objectContaining({ ipAddress: '10.0.0.1' })
                    })
                ])
            );
        });

        it('should handle custom limit when retrieving events by action', async () => {
            const mockAction = 'USER_LOGIN';
            const customLimit = 25;

            (query as jest.Mock).mockResolvedValue({ rows: [] });

            await auditLogger.getAuditEventsByAction(mockAction, customLimit);

            expect(query).toHaveBeenCalledWith(
                expect.anything(),
                [mockAction, customLimit]
            );
        });

        it('should return empty array when database query fails', async () => {
            const mockAction = 'USER_LOGIN';
            (query as jest.Mock).mockRejectedValue(new Error('Database connection failed'));

            const events = await auditLogger.getAuditEventsByAction(mockAction);

            expect(events).toEqual([]);
            expect(logger.error).toHaveBeenCalledWith(
                'Failed to get audit events by action',
                expect.objectContaining({
                    action: mockAction,
                    error: 'Database connection failed'
                })
            );
        });

        it('should handle invalid JSON in details when retrieving events by action', async () => {
            const mockAction = 'USER_LOGIN';
            const mockEvents = [
                {
                    user_id: 'test-user-123',
                    details: 'invalid-json-string',
                    created_at: new Date('2023-01-01')
                }
            ];

            (query as jest.Mock).mockResolvedValue({
                rows: mockEvents
            });

            const events = await auditLogger.getAuditEventsByAction(mockAction);

            expect(events[0].details).toEqual({ raw: 'invalid-json-string' });
        });
    });
});