/**
 * Unit tests for the bot lifecycle protocol:
 * - shared state machine (transitions, guards, envelope)
 * - BotLifecycleService start/stop/event handling with mocked persistence
 *
 * @format
 */

import {
    assertTransition,
    canTransition,
    InvalidStateTransitionError,
    isBotActualState,
    isBotDesiredState,
    isBotEvent,
    isProtocolMessage,
    createBotCommand,
    createBotEvent,
} from '@trade-bot/shared';
import { BotLifecycleService } from '../../src/core/bots/bot-lifecycle.service';
import { EngineProtocolService } from '../../src/core/bots/engine-protocol.service';

jest.mock('../../src/database/pool', () => ({
    query: jest.fn(),
}));
jest.mock('../../src/core/logging', () => ({
    contextLogger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    },
}));

import { query } from '../../src/database/pool';

const mockQuery = query as jest.Mock;

// ===========================================
// SHARED STATE MACHINE
// ===========================================

describe('bot lifecycle state machine (shared)', () => {
    it('allows the happy-path lifecycle', () => {
        expect(canTransition('STOPPED', 'STARTING')).toBe(true);
        expect(canTransition('STARTING', 'RUNNING')).toBe(true);
        expect(canTransition('RUNNING', 'STOPPING')).toBe(true);
        expect(canTransition('STOPPING', 'STOPPED')).toBe(true);
    });

    it('allows failure transitions to ERROR', () => {
        expect(canTransition('STARTING', 'ERROR')).toBe(true);
        expect(canTransition('RUNNING', 'ERROR')).toBe(true);
        expect(canTransition('STOPPING', 'ERROR')).toBe(true);
    });

    it('rejects impossible transitions', () => {
        expect(canTransition('STOPPED', 'RUNNING')).toBe(false);
        expect(canTransition('RUNNING', 'STARTING')).toBe(false);
        expect(canTransition('STOPPING', 'RUNNING')).toBe(false);
        expect(canTransition('ERROR', 'RUNNING')).toBe(false);
    });

    it('treats self-transitions as no-ops', () => {
        expect(canTransition('RUNNING', 'RUNNING')).toBe(true);
        expect(canTransition('STOPPED', 'STOPPED')).toBe(true);
    });

    it('throws InvalidStateTransitionError for illegal transitions', () => {
        expect(() => assertTransition('STOPPED', 'RUNNING')).toThrow(InvalidStateTransitionError);
        expect(() => assertTransition('STOPPING', 'RUNNING')).toThrow(InvalidStateTransitionError);
    });

    it('returns the target state for legal transitions', () => {
        expect(assertTransition('STOPPED', 'STARTING')).toBe('STARTING');
    });

    it('validates state type guards', () => {
        expect(isBotActualState('RUNNING')).toBe(true);
        expect(isBotActualState('running')).toBe(false);
        expect(isBotDesiredState('STOPPED')).toBe(true);
        expect(isBotDesiredState('STARTING')).toBe(false);
    });

    it('creates protocol envelopes with unique ids', () => {
        const a = createBotCommand('BOT_START', { botId: 'b1', userId: 'u1', strategyId: 's1', configVersion: 1, config: {} });
        const b = createBotCommand('BOT_START', { botId: 'b1', userId: 'u1', strategyId: 's1', configVersion: 1, config: {} });
        expect(isProtocolMessage(a)).toBe(true);
        expect(a.messageId).not.toBe(b.messageId);
        expect(a.correlationId).toBeTruthy();
        expect(a.version).toBe(1);
    });

    it('creates events that reference the originating correlation', () => {
        const event = createBotEvent('STATE_CHANGED', { botId: 'b1', engineId: 'e1', from: 'STARTING', to: 'RUNNING' }, 'corr-1');
        expect(isBotEvent(event)).toBe(true);
        expect(event.correlationId).toBe('corr-1');
        expect(event.type).toBe('STATE_CHANGED');
    });
});

// ===========================================
// BOT LIFECYCLE SERVICE
// ===========================================

describe('BotLifecycleService', () => {
    let service: BotLifecycleService;
    let engineProtocol: { sendCommand: jest.Mock };

    const botRow = {
        id: 'bot-1',
        user_id: 'user-1',
        strategy_id: 'strat-1',
        status: 'STOPPED',
        desired_state: 'STOPPED',
        actual_state: 'STOPPED',
    };

    beforeEach(() => {
        jest.clearAllMocks();
        engineProtocol = { sendCommand: jest.fn().mockResolvedValue({ success: true, messageId: 'm1', correlationId: 'c1' }) };
        service = new BotLifecycleService(engineProtocol as unknown as EngineProtocolService);
    });

    describe('start', () => {
        it('transitions STOPPED -> STARTING, sets desired RUNNING and sends the command', async () => {
            mockQuery.mockImplementation((sql: string) => {
                if (String(sql).startsWith('SELECT id, user_id')) {
                    return Promise.resolve({ rows: [botRow] });
                }
                return Promise.resolve({ rows: [] });
            });

            const result = await service.start('bot-1', 'user-1');

            expect(result).toMatchObject({ botId: 'bot-1', desiredState: 'RUNNING', actualState: 'STARTING', correlationId: 'c1' });
            expect(engineProtocol.sendCommand).toHaveBeenCalledWith(
                'BOT_START',
                expect.objectContaining({ botId: 'bot-1', userId: 'user-1', strategyId: 'strat-1' })
            );
        });

        it('is idempotent for an already STARTING/RUNNING bot', async () => {
            mockQuery.mockResolvedValue({
                rows: [{ ...botRow, desired_state: 'RUNNING', actual_state: 'RUNNING' }],
            });

            const result = await service.start('bot-1', 'user-1');

            expect(result.actualState).toBe('RUNNING');
            expect(engineProtocol.sendCommand).not.toHaveBeenCalled();
        });

        it('rejects illegal transitions (e.g. STOPPING -> STARTING)', async () => {
            mockQuery.mockResolvedValue({
                rows: [{ ...botRow, desired_state: 'STOPPED', actual_state: 'STOPPING' }],
            });

            await expect(service.start('bot-1', 'user-1')).rejects.toThrow(InvalidStateTransitionError);
            expect(engineProtocol.sendCommand).not.toHaveBeenCalled();
        });

        it('rolls back to STOPPED when the command cannot be delivered', async () => {
            mockQuery.mockImplementation((sql: string) => {
                if (String(sql).startsWith('SELECT id, user_id')) {
                    return Promise.resolve({ rows: [botRow] });
                }
                return Promise.resolve({ rows: [] });
            });
            engineProtocol.sendCommand.mockResolvedValue({ success: false, error: 'redis down' });

            await expect(service.start('bot-1', 'user-1')).rejects.toThrow('Failed to deliver start command');

            const updates = mockQuery.mock.calls.filter(call => String(call[0]).includes('UPDATE bot_instances'));
            const lastUpdate = updates[updates.length - 1];
            expect(lastUpdate[1][1]).toBe('STOPPED'); // desired_state
            expect(lastUpdate[1][2]).toBe('STOPPED'); // actual_state
        });

        it('rejects a bot owned by another user', async () => {
            mockQuery.mockResolvedValue({ rows: [{ ...botRow, user_id: 'someone-else' }] });

            await expect(service.start('bot-1', 'user-1')).rejects.toThrow('Bot not found');
        });
    });

    describe('stop', () => {
        it('transitions RUNNING -> STOPPING and sends BOT_STOP', async () => {
            mockQuery.mockImplementation((sql: string) => {
                if (String(sql).startsWith('SELECT id, user_id')) {
                    return Promise.resolve({ rows: [{ ...botRow, desired_state: 'RUNNING', actual_state: 'RUNNING' }] });
                }
                return Promise.resolve({ rows: [] });
            });

            const result = await service.stop('bot-1', 'user-1');

            expect(result).toMatchObject({ desiredState: 'STOPPED', actualState: 'STOPPING' });
            expect(engineProtocol.sendCommand).toHaveBeenCalledWith('BOT_STOP', { botId: 'bot-1' });
        });

        it('is idempotent for an already STOPPED bot', async () => {
            mockQuery.mockResolvedValue({ rows: [botRow] });

            const result = await service.stop('bot-1', 'user-1');

            expect(result.actualState).toBe('STOPPED');
            expect(engineProtocol.sendCommand).not.toHaveBeenCalled();
        });
    });

    describe('handleEngineEvent', () => {
        it('processes STATE_CHANGED to RUNNING and persists the transition', async () => {
            const event = createBotEvent('STATE_CHANGED', { botId: 'bot-1', engineId: 'engine-1', from: 'STARTING', to: 'RUNNING' }, 'corr-1');

            mockQuery.mockImplementation((sql: string) => {
                if (String(sql).startsWith('SELECT id, user_id')) {
                    return Promise.resolve({ rows: [{ ...botRow, desired_state: 'RUNNING', actual_state: 'STARTING' }] });
                }
                return Promise.resolve({ rows: [] });
            });

            await service.handleEngineEvent(event);

            const updates = mockQuery.mock.calls.filter(call => String(call[0]).includes('UPDATE bot_instances'));
            expect(updates).toHaveLength(1);
            expect(updates[0][1][2]).toBe('RUNNING');
        });

        it('ignores illegal engine-reported transitions without throwing', async () => {
            const event = createBotEvent('STATE_CHANGED', { botId: 'bot-1', engineId: 'engine-1', from: 'STARTING', to: 'RUNNING' }, 'corr-1');

            mockQuery.mockImplementation((sql: string) => {
                if (String(sql).startsWith('SELECT id, user_id')) {
                    return Promise.resolve({ rows: [{ ...botRow, actual_state: 'STOPPED' }] });
                }
                return Promise.resolve({ rows: [] });
            });

            await expect(service.handleEngineEvent(event)).resolves.toBeUndefined();
            expect(mockQuery.mock.calls.filter(call => String(call[0]).includes('UPDATE bot_instances'))).toHaveLength(0);
        });

        it('transitions the bot to ERROR on COMMAND_FAILED', async () => {
            const event = createBotEvent('COMMAND_FAILED', { botId: 'bot-1', commandType: 'BOT_START', engineId: 'engine-1', errorCode: 'BOT_START_FAILED', message: 'boom' }, 'corr-1');

            mockQuery.mockImplementation((sql: string) => {
                if (String(sql).startsWith('SELECT id, user_id')) {
                    return Promise.resolve({ rows: [{ ...botRow, desired_state: 'RUNNING', actual_state: 'STARTING' }] });
                }
                return Promise.resolve({ rows: [] });
            });

            await service.handleEngineEvent(event);

            const updates = mockQuery.mock.calls.filter(call => String(call[0]).includes('UPDATE bot_instances'));
            expect(updates[0][1][2]).toBe('ERROR');
        });

        it('is a no-op for duplicate STATE_CHANGED events', async () => {
            const event = createBotEvent('STATE_CHANGED', { botId: 'bot-1', engineId: 'engine-1', from: 'STARTING', to: 'RUNNING' }, 'corr-1');

            mockQuery.mockImplementation((sql: string) => {
                if (String(sql).startsWith('SELECT id, user_id')) {
                    return Promise.resolve({ rows: [{ ...botRow, desired_state: 'RUNNING', actual_state: 'RUNNING' }] });
                }
                return Promise.resolve({ rows: [] });
            });

            await service.handleEngineEvent(event);

            expect(mockQuery.mock.calls.filter(call => String(call[0]).includes('UPDATE bot_instances'))).toHaveLength(0);
        });
    });
});
