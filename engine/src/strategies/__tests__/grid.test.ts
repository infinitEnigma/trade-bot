import { GridTradingStrategy } from '../grid';
import { OrderlyClient } from '../../exchanges/kodiak/client';
import { GridStrategyConfig } from '../../types/strategy';

const CONFIG: GridStrategyConfig = {
    symbol: 'PERP_BTC_USDC',
    gridSize: 2,
    orderQuantity: 1,
    gridRangePercent: 5,
};

type MockOrderly = {
    getTicker: jest.Mock;
    getOrder: jest.Mock;
    createOrder: jest.Mock;
    cancelOrder: jest.Mock;
    findOrderByClientOrderId: jest.Mock;
};

function makeOrderly(): MockOrderly {
    return {
        getTicker: jest.fn().mockResolvedValue({ symbol: CONFIG.symbol, price: 1 }),
        getOrder: jest.fn().mockResolvedValue({ orderId: 'O', status: 'OPEN' }),
        createOrder: jest.fn().mockResolvedValue({ orderId: 'O1', status: 'OPEN' }),
        cancelOrder: jest.fn().mockResolvedValue({ status: 'CANCELLED' }),
        findOrderByClientOrderId: jest.fn().mockResolvedValue(null),
    };
}

async function runOneTickAndCaptureClientOrderId(orderly: MockOrderly, botId = 'bot-1'): Promise<string> {
    const strategy = new GridTradingStrategy(botId, CONFIG, orderly as unknown as OrderlyClient);
    await strategy.initialize(100);
    await strategy.start();
    await strategy.tick();
    return orderly.createOrder.mock.calls[0][0].clientOrderId as string;
}

describe('GridTradingStrategy order idempotency', () => {
    it('produces a stable clientOrderId for the same bot/level/side across restarts', async () => {
        // Two independent strategy instances (simulating an engine restart that
        // reconstructs the grid) must derive the SAME clientOrderId from the
        // same logical botId so the exchange can reject a duplicate open order.
        const a = makeOrderly();
        const b = makeOrderly();

        const idA = await runOneTickAndCaptureClientOrderId(a);
        const idB = await runOneTickAndCaptureClientOrderId(b);

        expect(idA).toBe(idB);
        expect(idA).toContain('bot-1:');
        expect(idA).toContain(':0:BUY');
    });

    it('derives a different clientOrderId for a different botId', async () => {
        const a = makeOrderly();
        const b = makeOrderly();

        const idA = await runOneTickAndCaptureClientOrderId(a, 'bot-1');
        const idB = await runOneTickAndCaptureClientOrderId(b, 'bot-2');

        expect(idA).not.toBe(idB);
    });

    it('adopts an existing order via get-before-create instead of submitting again', async () => {
        const orderly = makeOrderly();
        // An open order with the same clientOrderId already exists (a previous
        // submission lost its response): adopt it, do NOT create a duplicate.
        orderly.findOrderByClientOrderId.mockResolvedValue({ orderId: 'existing-1', status: 'OPEN' });

        const strategy = new GridTradingStrategy('bot-1', CONFIG, orderly as unknown as OrderlyClient);
        await strategy.initialize(100);
        await strategy.start();
        await strategy.tick();

        expect(orderly.findOrderByClientOrderId).toHaveBeenCalledWith(CONFIG.symbol, 'bot-1:0:BUY');
        expect(orderly.createOrder).not.toHaveBeenCalled();
    });

    it('reconciles via findOrderByClientOrderId after a create-order error (lost response)', async () => {
        const orderly = makeOrderly();
        // Single-level grid + mid-range price => exactly one buy slot qualifies,
        // so the create-order/reconcile path is exercised without cross-level noise.
        const config: GridStrategyConfig = { ...CONFIG, gridSize: 1 };
        orderly.getTicker.mockResolvedValue({ symbol: CONFIG.symbol, price: 100 });

        // get-before-create finds nothing, then create throws (lost response),
        // then the reconcile lookup finds the already-live order.
        orderly.findOrderByClientOrderId
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ orderId: 'recovered-7', status: 'OPEN' });
        orderly.createOrder.mockRejectedValue(new Error('network lost'));

        const strategy = new GridTradingStrategy('bot-1', config, orderly as unknown as OrderlyClient);
        await strategy.initialize(100);
        await strategy.start();
        await strategy.tick();

        expect(orderly.createOrder).toHaveBeenCalledTimes(1);
        expect(orderly.findOrderByClientOrderId).toHaveBeenCalledTimes(2);
    });
});