/**
 * Grid Snapshot Types
 *
 * On-disk representation of a grid strategy's slot state, so an engine restart
 * does not rebuild the grid from scratch (which would forget fills and re-place
 * levels whose orders already live on the exchange).
 *
 * @format
 */

/** A single grid level's persisted slot state. */
export interface GridSnapshotLevel {
    price: number;
    buyOrderId?: string;
    sellOrderId?: string;
    filled: boolean;
}

/** Persisted snapshot for one bot's grid. */
export interface GridSnapshot {
    /** Format version - reject/ignore unknown versions on load. */
    version: 1;
    botId: string;
    symbol: string;
    gridSize: number;
    gridRangePercent: number;
    /**
     * Price the grid was built around. Restoring at this baseline keeps level
     * prices stable so saved order IDs map back onto the right levels.
     */
    baselinePrice: number;
    levels: GridSnapshotLevel[];
    savedAt: string;
}

export const GRID_SNAPSHOT_VERSION = 1;
