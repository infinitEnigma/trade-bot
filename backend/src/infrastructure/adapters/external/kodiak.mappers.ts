import { Balance, Position, Trade, AccountInfo, OrderStatus, OrderSide } from '@trade-bot/shared';
import {
    KodiakBalance,
    KodiakPosition,
    KodiakTrade,
    KodiakAccountInfo,
} from '../../external/kodiak-integration.service';
import { logger } from '../../../core/logging';

/**
 * Convert Kodiak balance format to domain Balance
 */
export function mapKodiakBalanceToDomain(kodiakBalance: KodiakAccountInfo): Balance {
    try {
        // Extract USD balance (assuming USD is the base currency)
        const usdBalance = kodiakBalance.balances?.find((b: KodiakBalance) => b.asset === 'USDC' || b.asset === 'USD');
        const totalBalance = usdBalance ? parseFloat(usdBalance.free || '0') : 0;

        // For simplicity, assume all balance is available (locked amounts would need separate tracking)
        return Balance.fromTotal(totalBalance, 'USD');
    } catch (_error) {
        logger.warn('Failed to convert Kodiak balance to domain format, using zero balance');
        return Balance.zero('USD');
    }
}

/**
 * Convert Kodiak position format to domain Position
 */
export function mapKodiakPositionToDomain(kodiakPosition: KodiakPosition): Position | null {
    try {
        const symbol = kodiakPosition.symbol;
        const side = kodiakPosition.positionAmt && parseFloat(kodiakPosition.positionAmt) > 0 ? 'LONG' : 'SHORT';
        const quantity = Math.abs(parseFloat(kodiakPosition.positionAmt || '0'));
        const entryPrice = parseFloat(kodiakPosition.entryPrice || '0');
        const markPrice = parseFloat(kodiakPosition.markPrice || '0');
        // Note: leverage is not in KodiakPosition interface, using default value
        const leverage = 1;

        if (!symbol || quantity === 0 || entryPrice === 0) {
            return null; // Invalid position data
        }

        return new Position(
            symbol,
            side,
            quantity,
            entryPrice,
            markPrice,
            leverage
        );
    } catch (error) {
        logger.warn(`Failed to convert Kodiak position to domain format: ${error}`);
        return null;
    }
}

/**
 * Convert Kodiak trade format to Trade interface
 */
export function mapKodiakTradeToDomain(kodiakTrade: KodiakTrade): Trade | null {
    try {
        const id = kodiakTrade.id || kodiakTrade.orderId;
        const userId = 'unknown'; // User ID not available in trade data
        const orderId = kodiakTrade.orderId || id;
        const symbol = kodiakTrade.symbol;
        const side = kodiakTrade.side === 'BUY' ? 'BUY' : 'SELL';
        const quantity = parseFloat(kodiakTrade.qty || '0');
        const price = parseFloat(kodiakTrade.price || '0');
        const fee = parseFloat(kodiakTrade.commission || '0');
        const executedAt = new Date(kodiakTrade.time || Date.now());

        if (!id || !symbol || quantity === 0 || price === 0) {
            return null; // Invalid trade data
        }

        // Return plain object matching Trade interface, not domain class
        return {
            id,
            userId,
            orderId,
            symbol,
            side: side as OrderSide, // Cast to enum type
            quantity,
            price,
            fee,
            pnl: undefined, // PnL not available in basic trade data
            status: OrderStatus.FILLED, // Use enum value
            executedAt
        };
    } catch (error) {
        logger.warn(`Failed to convert Kodiak trade to domain format: ${error}`);
        return null;
    }
}

/**
 * Convert Kodiak account info to domain AccountInfo
 */
export function mapKodiakAccountInfoToDomain(kodiakAccountInfo: KodiakAccountInfo): AccountInfo {
    try {
        return {
            totalBalance: kodiakAccountInfo.totalBalance || '0',
            totalPnl24H: kodiakAccountInfo.totalPnl24H || '0',
            totalPnl30D: kodiakAccountInfo.totalPnl30D || '0',
            totalPnlAll: kodiakAccountInfo.totalPnlAll || '0',
            accountType: kodiakAccountInfo.accountType || 'UNKNOWN',
            balances: kodiakAccountInfo.balances || []
        };
    } catch (_error) {
        logger.warn('Failed to convert Kodiak account info to domain format');
        return {
            totalBalance: '0',
            totalPnl24H: '0',
            totalPnl30D: '0',
            totalPnlAll: '0',
            accountType: 'UNKNOWN',
            balances: []
        };
    }
}