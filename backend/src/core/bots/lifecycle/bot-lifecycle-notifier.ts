/**
 * Bot Lifecycle Notifier - Socket.IO bridge to the frontend
 *
 * Emits `bot.stateChanged` events to the owning user's room. The internal
 * Redis Streams protocol never leaks to the browser.
 *
 * @format
 */

import { BotActualState } from "@trade-bot/shared";
import { contextLogger as logger } from "../../logging";

export type SocketServerLike = {
    to: (room: string) => { emit: (event: string, data: unknown) => void };
};

export class BotLifecycleNotifier {
    private socketServer: SocketServerLike | null = null;

    /**
     * Register the Socket.IO server so lifecycle changes reach the frontend
     * as `bot.stateChanged` events.
     */
    setSocketServer(io: SocketServerLike): void {
        this.socketServer = io;
    }

    emitStateChanged(botId: string, userId: string, from: BotActualState, to: BotActualState, correlationId: string): void {
        if (!this.socketServer) {
            logger.debug("No Socket.IO server registered - state change not broadcast", { botId });
            return;
        }
        this.socketServer.to(`user:${userId}`).emit("bot.stateChanged", {
            botId,
            from,
            to,
            correlationId,
            timestamp: Date.now(),
        });
    }
}
