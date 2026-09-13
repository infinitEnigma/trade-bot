/** @format */

import { LifecycleReconciliationService } from '../../src/core/bots/lifecycle-reconciliation.service';
import { botLifecycleService } from '../../src/core/bots/bot-lifecycle.service';
import { query } from '../../src/database/pool';
import { contextLogger as logger } from '../../src/core/logging';

jest.mock('../../src/database/pool', () => ({
    query: jest.fn(),
}));

jest.mock('../../src/core/bots/bot-lifecycle.service', () => ({
    botLifecycleService: {
        reissueStopForReconciliation: jest.fn(),
        reconcileStuckTransitionToUnknown: jest.fn(),
        recordReconcileNeedsUserAction: jest.fn(),
    },
}));

jest.mock('../../src/core/logging', () => {
    const mockLogger = {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        http: jest.fn(),
        child: jest.fn(),
    };
    return { contextLogger: mockLogger };
});

const mockedQuery = query as jest.Mock;
const mockedLifecycle = botLifecycleService as jest.Mocked<typeof botLifecycleService>;

const driftBot = { id: 'bot-1', user_id: 'user-1', strategy_id: 'strat-1', status: 'RUNNING', desired_state: 'STOPPED', actual_state: 'RUNNING', engine_id: 'engine-1' };
const stuckBot = { id: 'bot-2', user_id: 'user-2', strategy_id: 'strat-2', status: 'STARTING', desired_state: 'RUNNING', actual_state: 'STARTING', engine_id: 'engine-1' };
const unconfirmedBot = { id: 'bot-3', user_id: 'user-3', strategy_id: 'strat-3', status: 'ERROR', desired_state: 'RUNNING', actual_state: 'ERROR', engine_id: null };

/** Configure query to route by SELECT shape used by the reconciler. */
function mockQueryRouting(opts: {
    drift: unknown[];
    stuck: unknown[];
    unconfirmed: unknown[];
    reissueCount?: string;
}) {
    mockedQuery.mockImplementation((sql: string, params?: unknown[]) => {
        const text = String(sql);
        if (text.includes("desired_state = 'STOPPED'") && text.includes("actual_state IN ('STARTING', 'RUNNING', 'STOPPING')")) {
            return Promise.resolve({ rows: opts.drift });
        }
        if (text.includes("actual_state IN ('STARTING', 'STOPPING')") && text.includes('NOT EXISTS')) {
            return Promise.resolve({ rows: opts.stuck });
        }
        if (text.includes("desired_state = 'RUNNING'") && text.includes("actual_state IN ('ERROR', 'UNKNOWN')")) {
            return Promise.resolve({ rows: opts.unconfirmed });
        }
        if (text.includes("RECONCILE_STOP_REISSUED")) {
            return Promise.resolve({ rows: [{ count: opts.reissueCount ?? '0' }] });
        }
        return Promise.resolve({ rows: [] });
    });
}

describe('LifecycleReconciliationService', () => {
    let service: LifecycleReconciliationService;

    beforeEach(() => {
        jest.clearAllMocks();
        service = new LifecycleReconciliationService();
    });

    it('reissues BOT_STOP for desired-stopped drift within budget', async () => {
        mockQueryRouting({ drift: [driftBot], stuck: [], unconfirmed: [], reissueCount: '0' });
        mockedLifecycle.reissueStopForReconciliation.mockResolvedValue({
            botId: driftBot.id,
            desiredState: 'STOPPED',
            actualState: 'RUNNING',
        });

        const result = await service.runOnce();

        expect(result.stopReissued).toBe(1);
        expect(result.failures).toBe(0);
        expect(mockedLifecycle.reissueStopForReconciliation).toHaveBeenCalledWith(driftBot.id, 'desired-stopped-drift');
    });

    it('defers stop reissue when the hourly budget is exhausted', async () => {
        mockQueryRouting({ drift: [driftBot], stuck: [], unconfirmed: [], reissueCount: '3' });

        const result = await service.runOnce();

        expect(result.stopReissued).toBe(0);
        expect(mockedLifecycle.reissueStopForReconciliation).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledWith(
            'Reconcile stop-reissue budget exhausted, deferring',
            expect.objectContaining({ botId: driftBot.id })
        );
    });

    it('marks stuck transitional bots UNKNOWN and records audit-only markers', async () => {
        mockQueryRouting({ drift: [], stuck: [stuckBot], unconfirmed: [unconfirmedBot] });
        mockedLifecycle.reconcileStuckTransitionToUnknown.mockResolvedValue(true);
        mockedLifecycle.recordReconcileNeedsUserAction.mockResolvedValue(undefined);

        const result = await service.runOnce();

        expect(result.markedUnknown).toBe(1);
        expect(result.needsUserAction).toBe(1);
        expect(mockedLifecycle.reconcileStuckTransitionToUnknown).toHaveBeenCalledWith(stuckBot.id, 'stuck-beyond-grace');
        expect(mockedLifecycle.recordReconcileNeedsUserAction).toHaveBeenCalledWith(unconfirmedBot.id, 'desired-running-unconfirmed');
    });

    it('counts failures but keeps sweeping the remaining bots', async () => {
        mockQueryRouting({ drift: [driftBot], stuck: [stuckBot], unconfirmed: [] });
        mockedLifecycle.reissueStopForReconciliation.mockRejectedValue(new Error('redis down'));
        mockedLifecycle.reconcileStuckTransitionToUnknown.mockResolvedValue(true);

        const result = await service.runOnce();

        expect(result.stopReissued).toBe(0);
        expect(result.failures).toBe(1);
        expect(result.markedUnknown).toBe(1);
        expect(logger.error).toHaveBeenCalled();
    });

    it('serializes overlapping sweeps', async () => {
        mockQueryRouting({ drift: [], stuck: [], unconfirmed: [] });
        // First call sets running=true, releases at finally; second call must return cached/empty.
        const first = service.runOnce();
        const second = await service.runOnce();
        await first;
        expect(second).toEqual({ stopReissued: 0, markedUnknown: 0, needsUserAction: 0, failures: 0 });
    });
});
