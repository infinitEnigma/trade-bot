/**
 * Unit tests for the EngineRegistryService (engine liveness + epoch authority)
 *
 * @format
 */

import {
    createBotEvent,
} from '@trade-bot/shared';

jest.mock('../../src/database/pool', () => ({
    query: jest.fn(),
}));
jest.mock('../../src/core/logging/context-aware-logger.service', () => ({
    redisLogger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    },
}));
jest.mock('../../src/core/bots/bot-lifecycle.service', () => ({
    botLifecycleService: {
        markBotsUnknownForEngine: jest.fn().mockResolvedValue(2),
        reconcileHeartbeatInventory: jest.fn().mockResolvedValue({ unlisted: 0, drift: 0 }),
    },
}));

import { query } from '../../src/database/pool';
import { botLifecycleService } from '../../src/core/bots/bot-lifecycle.service';
import { EngineRegistryService } from '../../src/core/bots/engine-registry.service';

const mockQuery = query as jest.Mock;
const ok = () => ({ rows: [], rowCount: 1 });

describe('EngineRegistryService', () => {
    let service: EngineRegistryService;

    beforeEach(() => {
        jest.clearAllMocks();
        service = new EngineRegistryService();
    });

    describe('handleEngineEvent', () => {
        it('registers an engine from an ENGINE_REGISTER event', async () => {
            mockQuery.mockReturnValue(ok());
            const event = createBotEvent(
                'ENGINE_REGISTER',
                { engineId: 'engine-1', epoch: 3, version: 'kodiak@1.0.0', startedAt: new Date().toISOString() },
                'corr-1'
            );

            const handled = await service.handleEngineEvent(event);

            expect(handled).toBe(true);
            const insert = mockQuery.mock.calls.find(call => String(call[0]).includes('INSERT INTO engine_registry'));
            expect(insert).toBeDefined();
            expect(insert![1][0]).toBe('engine-1');
            expect(insert![1][1]).toBe(3);
        });

        it('processes an ENGINE_HEARTBEAT event', async () => {
            mockQuery.mockReturnValue(ok());
            const event = createBotEvent(
                'ENGINE_HEARTBEAT',
                { engineId: 'engine-1', epoch: 3, activeBotIds: ['b1'], version: 'kodiak@1.0.0' },
                'corr-2'
            );

            const handled = await service.handleEngineEvent(event);

            expect(handled).toBe(true);
            const update = mockQuery.mock.calls.find(call => String(call[0]).includes('UPDATE engine_registry'));
            expect(update).toBeDefined();
        });

        it('returns false for non-engine-lifecycle events', async () => {
            const event = createBotEvent('STATE_CHANGED', { botId: 'b1', engineId: 'e1', engineEpoch: 1, from: 'STARTING', to: 'RUNNING' }, 'c1');
            expect(await service.handleEngineEvent(event)).toBe(false);
        });
    });

    describe('heartbeat epoch guards', () => {
        it('rejects heartbeats from a stale epoch (rowCount 0)', async () => {
            mockQuery.mockReturnValue({ rows: [], rowCount: 0 });
            const event = createBotEvent(
                'ENGINE_HEARTBEAT',
                { engineId: 'engine-1', epoch: 2, activeBotIds: [], version: 'kodiak@1.0.0' },
                'corr-3'
            );

            await service.handleEngineEvent(event);

            const update = mockQuery.mock.calls.find(call => String(call[0]).includes('UPDATE engine_registry'));
            expect(update).toBeDefined();
            // The guard clause: WHERE engine_id = $1 AND epoch <= $2
            expect(String(update![0])).toContain('epoch <= $2');
        });
    });

    describe('isEngineAuthoritative (fail closed)', () => {
        it('rejects an engine whose epoch is superseded', async () => {
            mockQuery.mockReturnValue({ rows: [{ engine_id: 'engine-1', epoch: 5, status: 'ONLINE' }], rowCount: 1 });
            expect(await service.isEngineAuthoritative('engine-1', 4)).toBe(false);
        });

        it('accepts an engine with a current epoch', async () => {
            mockQuery.mockReturnValue({ rows: [{ engine_id: 'engine-1', epoch: 5, status: 'ONLINE' }], rowCount: 1 });
            expect(await service.isEngineAuthoritative('engine-1', 5)).toBe(true);
        });

        it('rejects an OFFLINE engine', async () => {
            mockQuery.mockReturnValue({ rows: [{ engine_id: 'engine-1', epoch: 5, status: 'OFFLINE' }], rowCount: 1 });
            expect(await service.isEngineAuthoritative('engine-1')).toBe(false);
        });

        it('rejects an unregistered engine (fail closed)', async () => {
            mockQuery.mockReturnValue({ rows: [], rowCount: 0 });
            expect(await service.isEngineAuthoritative('unknown-engine', 1)).toBe(false);
        });

        it('throws on DB failure so the event stays unacked for redelivery', async () => {
            mockQuery.mockRejectedValue(new Error('db down'));
            await expect(service.isEngineAuthoritative('engine-1', 5)).rejects.toThrow('db down');
        });
    });

    describe('stale registration guard', () => {
        it('ignores a registration whose epoch is superseded (no resurrection)', async () => {
            // Guarded ON CONFLICT UPDATE matches 0 rows for a stale epoch.
            mockQuery.mockReturnValue({ rows: [], rowCount: 0 });
            const event = createBotEvent(
                'ENGINE_REGISTER',
                { engineId: 'engine-1', epoch: 4, version: 'kodiak@1.0.0', startedAt: new Date().toISOString() },
                'corr-stale'
            );

            await service.handleEngineEvent(event);

            const upsert = mockQuery.mock.calls.find(call => String(call[0]).includes('INSERT INTO engine_registry'));
            expect(upsert).toBeDefined();
            // The epoch guard clause keeps stale registers from refreshing the row.
            expect(String(upsert![0])).toContain('WHERE EXCLUDED.epoch >= engine_registry.epoch');
        });
    });

    describe('heartbeat inventory reconciliation', () => {
        it('reconciles activeBotIds on a successful heartbeat', async () => {
            mockQuery.mockImplementation((sql: string) => {
                if (String(sql).includes('UPDATE engine_registry')) {
                    return Promise.resolve({ rows: [], rowCount: 1 });
                }
                return ok();
            });
            const event = createBotEvent(
                'ENGINE_HEARTBEAT',
                { engineId: 'engine-1', epoch: 3, activeBotIds: ['b1'], version: 'kodiak@1.0.0' },
                'corr-4'
            );

            await service.handleEngineEvent(event);

            expect(botLifecycleService.reconcileHeartbeatInventory).toHaveBeenCalledWith('engine-1', ['b1']);
        });

        it('does not reconcile heartbeats from a stale epoch', async () => {
            mockQuery.mockReturnValue({ rows: [], rowCount: 0 });
            const event = createBotEvent(
                'ENGINE_HEARTBEAT',
                { engineId: 'engine-1', epoch: 2, activeBotIds: ['b1'], version: 'kodiak@1.0.0' },
                'corr-5'
            );

            await service.handleEngineEvent(event);

            expect(botLifecycleService.reconcileHeartbeatInventory).not.toHaveBeenCalled();
        });
    });

    describe('sweepOfflineEngines', () => {
        it('marks expired engines OFFLINE and marks their RUNNING bots UNKNOWN', async () => {
            mockQuery.mockImplementation((sql: string) => {
                if (String(sql).includes('FROM engine_registry') && String(sql).startsWith('SELECT')) {
                    return Promise.resolve({
                        rows: [{ engine_id: 'engine-1', epoch: 3, status: 'ONLINE', version: null, last_seen_at: new Date() }],
                    });
                }
                return Promise.resolve({ rows: [], rowCount: 1 });
            });

            const marked = await service.sweepOfflineEngines();

            expect(marked).toBe(1);
            expect(botLifecycleService.markBotsUnknownForEngine).toHaveBeenCalledWith('engine-1');
        });

        it('does not double-mark an engine whose claim loses the race', async () => {
            mockQuery.mockImplementation((sql: string) => {
                if (String(sql).includes('FROM engine_registry') && String(sql).startsWith('SELECT')) {
                    return Promise.resolve({
                        rows: [{ engine_id: 'engine-1', epoch: 3, status: 'ONLINE', version: null, last_seen_at: new Date() }],
                    });
                }
                // The OFFLINE claim loses the race.
                return Promise.resolve({ rows: [], rowCount: 0 });
            });

            const marked = await service.sweepOfflineEngines();

            expect(marked).toBe(0);
            expect(botLifecycleService.markBotsUnknownForEngine).not.toHaveBeenCalled();
        });
    });
});
