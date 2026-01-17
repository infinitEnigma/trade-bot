/** @format */

import { io, Socket } from 'socket.io-client';
import { GridTradingStrategy } from './strategies/grid';
import { OrderlyClient, createOrderlyClient } from './services/orderly';
import { logger } from './utils/logger';

// Environment variables
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';

// Bot instance management
interface BotInstance {
  botId: string;
  strategyId: string;
  strategy: GridTradingStrategy;
  intervalId: NodeJS.Timeout;
  userId: string;
  orderlyClient: OrderlyClient; // Each bot has its own client with user credentials
}

class TradingEngine {
  private socket: Socket;
  private bots: Map<string, BotInstance> = new Map();

  constructor() {
    // Connect to backend WebSocket
    this.socket = io(BACKEND_URL, {
      transports: ['websocket', 'polling'],
    });

    this.setupSocketListeners();
  }

  private setupSocketListeners(): void {
    this.socket.on('connect', () => {
      logger.info('Engine connected to backend WebSocket');
    });

    this.socket.on('disconnect', () => {
      logger.warn('Engine disconnected from backend WebSocket');
    });

    // Handle bot start events
    this.socket.on('bot:start', async (data: any) => {
      await this.handleBotStart(data);
    });

    // Handle bot stop events
    this.socket.on('bot:stop', async (data: any) => {
      await this.handleBotStop(data);
    });

    // Handle emergency stop events
    this.socket.on('bot:emergency-stop', async (data: any) => {
      await this.handleEmergencyStop(data);
    });

    this.socket.on('connect_error', (error) => {
      logger.error('WebSocket connection error', { error: error.message });
    });
  }

  private async handleBotStart(data: any): Promise<void> {
    const { botId, strategyId, strategy, kodiakCredentials } = data;

    try {
      logger.info('Starting bot', { botId, strategyId, strategyType: strategy.type });

      // Check if bot already exists
      if (this.bots.has(botId)) {
        logger.warn('Bot already exists, skipping start', { botId });
        return;
      }

      // Validate that we have Kodiak credentials
      if (!kodiakCredentials || !kodiakCredentials.accountId || !kodiakCredentials.accessKey || !kodiakCredentials.secretKey) {
        logger.error('Missing Kodiak credentials for bot', { botId });
        return;
      }

      // Validate strategy type
      if (strategy.type !== 'GRID') {
        logger.error('Unsupported strategy type', { strategyType: strategy.type });
        return;
      }

      // Create Orderly client for this specific user/bot
      const orderlyClient = createOrderlyClient(
        kodiakCredentials.accountId,
        kodiakCredentials.accessKey,
        kodiakCredentials.secretKey,
        process.env.NODE_ENV !== 'production' // Use testnet for development
      );

      // Get current market price for initialization
      const symbol = strategy.config.symbol;
      const ticker = await orderlyClient.getTicker(symbol);
      const currentPrice = Number(ticker.mark_price || ticker.price);

      if (!currentPrice) {
        logger.error('Could not get current price', { symbol });
        return;
      }

      // Create strategy instance
      const gridConfig = {
        symbol: strategy.config.symbol,
        gridSize: strategy.config.gridSize || 10,
        gridRangePercent: strategy.config.gridRange || 5,
        orderQuantity: strategy.config.orderQuantity || 1,
      };

      const gridStrategy = new GridTradingStrategy(gridConfig, orderlyClient);

      // Initialize strategy
      await gridStrategy.initialize(currentPrice);

      // Start strategy
      await gridStrategy.start();

      // Set up trading loop (tick every 5 seconds)
      const intervalId = setInterval(async () => {
        try {
          await gridStrategy.tick();

          // Send heartbeat to backend
          this.sendHeartbeat(botId, 'RUNNING');

        } catch (error) {
          logger.error('Strategy tick error', {
            error: error instanceof Error ? error.message : String(error),
            botId
          });
        }
      }, 5000);

      // Store bot instance
      const botInstance: BotInstance = {
        botId,
        strategyId,
        strategy: gridStrategy,
        intervalId,
        userId: data.userId || 'unknown',
        orderlyClient,
      };

      this.bots.set(botId, botInstance);

      // Send initial heartbeat
      this.sendHeartbeat(botId, 'RUNNING');

      logger.info('Bot started successfully', { botId, symbol, currentPrice });

    } catch (error) {
      logger.error('Failed to start bot', {
        error: error instanceof Error ? error.message : String(error),
        botId,
        strategyId
      });

      // Send error heartbeat
      this.sendHeartbeat(botId, 'ERROR');
    }
  }

  private async handleBotStop(data: any): Promise<void> {
    const { botId } = data;

    try {
      logger.info('Stopping bot', { botId });

      const botInstance = this.bots.get(botId);
      if (!botInstance) {
        logger.warn('Bot not found for stop', { botId });
        return;
      }

      // Stop strategy
      await botInstance.strategy.stop();

      // Clear trading interval
      clearInterval(botInstance.intervalId);

      // Remove from bots map
      this.bots.delete(botId);

      // Send final heartbeat
      this.sendHeartbeat(botId, 'STOPPED');

      logger.info('Bot stopped successfully', { botId });

    } catch (error) {
      logger.error('Failed to stop bot', {
        error: error instanceof Error ? error.message : String(error),
        botId
      });
    }
  }

  private async handleEmergencyStop(data: any): Promise<void> {
    const { botId, action } = data;

    try {
      logger.warn('Emergency stop initiated', { botId, action });

      const botInstance = this.bots.get(botId);
      if (!botInstance) {
        logger.warn('Bot not found for emergency stop', { botId });
        return;
      }

      if (action === 'CANCEL_ALL_ORDERS') {
        // Strategy stop() method already cancels all orders
        await botInstance.strategy.stop();
      }

      // Clear trading interval
      clearInterval(botInstance.intervalId);

      // Remove from bots map
      this.bots.delete(botId);

      // Send emergency stop heartbeat
      this.sendHeartbeat(botId, 'STOPPED');

      logger.warn('Emergency stop completed', { botId });

    } catch (error) {
      logger.error('Emergency stop failed', {
        error: error instanceof Error ? error.message : String(error),
        botId
      });
    }
  }

  private sendHeartbeat(botId: string, status: string): void {
    try {
      // Calculate bot statistics
      const botInstance = this.bots.get(botId);
      let position = 0;
      let exposure = 0;

      if (botInstance) {
        const status = botInstance.strategy.getStatus();
        position = status.totalTrades;
        exposure = status.totalPnl;
      }

      // Send heartbeat via HTTP to backend
      fetch(`${BACKEND_URL}/api/bot/heartbeat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          bot_id: botId,
          status,
          position,
          exposure,
          timestamp: Date.now(),
        }),
      }).catch(error => {
        logger.error('Heartbeat send failed', { error: error.message, botId });
      });

    } catch (error) {
      logger.error('Heartbeat preparation failed', {
        error: error instanceof Error ? error.message : String(error),
        botId
      });
    }
  }

  private setupHeartbeat(): void {
    // Send periodic heartbeats for all running bots
    setInterval(() => {
      for (const [botId, botInstance] of this.bots) {
        this.sendHeartbeat(botId, 'RUNNING');
      }
    }, 30000); // Every 30 seconds
  }

  public getBotStatus(botId: string): any {
    const botInstance = this.bots.get(botId);
    if (!botInstance) return null;

    return botInstance.strategy.getStatus();
  }

  public getAllBotStatuses(): any[] {
    return Array.from(this.bots.values()).map(botInstance => {
      const status = botInstance.strategy.getStatus();
      return {
        botId: botInstance.botId,
        strategyId: botInstance.strategyId,
        status: status.status,
        currentPrice: status.currentPrice,
        totalTrades: status.totalTrades,
        totalPnl: status.totalPnl,
        updatedAt: status.updatedAt,
      };
    });
  }

  public async shutdown(): Promise<void> {
    logger.info('Shutting down trading engine...');

    // Stop all bots
    for (const [botId, botInstance] of this.bots) {
      try {
        await botInstance.strategy.stop();
        clearInterval(botInstance.intervalId);
        this.sendHeartbeat(botId, 'STOPPED');
      } catch (error) {
        logger.error('Error stopping bot during shutdown', {
          error: error instanceof Error ? error.message : String(error),
          botId
        });
      }
    }

    this.bots.clear();
    this.socket.disconnect();

    logger.info('Trading engine shutdown complete');
  }
}

// Graceful shutdown handling
process.on('SIGINT', async () => {
  logger.info('Received SIGINT, initiating graceful shutdown...');
  await engine.shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, initiating graceful shutdown...');
  await engine.shutdown();
  process.exit(0);
});

// Create and start the trading engine
const engine = new TradingEngine();

logger.info('Trading Engine started', {
  backendUrl: BACKEND_URL,
});

// Keep process alive
process.stdin.resume();
