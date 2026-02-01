import 'dotenv/config';
import { logger } from './utils/logger';
import { getRedisStreamOperations } from './infrastructure/redis/streams';
import {
  EngineCommand,
  EngineEvent,
  isStartEngineCommand,
  isStopEngineCommand,
  isStartBotCommand,
  isStopBotCommand,
  isEmergencyStopCommand,
  isUpdateStrategyConfigCommand
} from '@trade-bot/shared';
import { GridTradingStrategy } from './strategies/grid';
import { OrderlyClient, createOrderlyClient } from './services/orderly';

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
  private bots: Map<string, BotInstance> = new Map();
  private streamOperations = getRedisStreamOperations();
  private engineId = 'kodiak-engine-' + Math.random().toString(36).substr(2, 9);

  constructor() {
    logger.info('Trading Engine initialized');
  }

  /**
   * Start the engine and begin listening for commands
   */
  async start(): Promise<void> {
    try {
      logger.info('Starting Trading Engine', { engineId: this.engineId });

      // Connect to Redis
      await this.streamOperations.connect();

      // Create consumer group if it doesn't exist
      await this.streamOperations.createConsumerGroup('engine:commands', 'engine-group');

      // Start listening for commands
      this.listenForCommands();

      // Send engine started event
      await this.streamOperations.publish('engine:events', {
        type: 'ENGINE_STARTED',
        engineId: this.engineId,
        timestamp: Date.now(),
        uptime: 0
      } as EngineEvent);

      logger.info('Trading Engine started successfully', { engineId: this.engineId });

    } catch (error) {
      logger.error('Failed to start Trading Engine', {
        engineId: this.engineId,
        error: error instanceof Error ? error.message : String(error)
      });
      process.exit(1);
    }
  }

  /**
   * Listen for commands from the backend
   */
  private async listenForCommands(): Promise<void> {
    logger.info('Listening for engine commands');

    while (true) {
      try {
        const result = await this.streamOperations.read('engine:commands', {
          block: 5000, // Block for 5 seconds
          count: 10,
          consumerGroup: 'engine-group',
          consumerName: 'engine-' + this.engineId,
          autoAck: true
        });

        if (result.success && result.messages && result.messages.length > 0) {
          for (const message of result.messages) {
            await this.handleCommand(message.data);
          }
        }
      } catch (error) {
        logger.error('Error reading commands from stream', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  /**
   * Handle incoming commands
   */
  private async handleCommand(command: EngineCommand): Promise<void> {
    logger.debug('Received command', {
      engineId: this.engineId,
      commandType: command.type
    });

    try {
      if (isStartEngineCommand(command)) {
        await this.handleStartEngine(command);
      } else if (isStopEngineCommand(command)) {
        await this.handleStopEngine(command);
      } else if (isStartBotCommand(command)) {
        await this.handleStartBot(command);
      } else if (isStopBotCommand(command)) {
        await this.handleStopBot(command);
      } else if (isEmergencyStopCommand(command)) {
        await this.handleEmergencyStop(command);
      } else if (isUpdateStrategyConfigCommand(command)) {
        await this.handleUpdateStrategyConfig(command);
      } else {
        logger.warn('Unknown command type', { commandType: command.type });
      }
    } catch (error) {
      logger.error('Error handling command', {
        commandType: command.type,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Handle engine start command
   */
  private async handleStartEngine(command: any): Promise<void> {
    logger.info('Engine start command received', { engineId: this.engineId });
    // Already started
  }

  /**
   * Handle engine stop command
   */
  private async handleStopEngine(command: any): Promise<void> {
    logger.info('Engine stop command received', { engineId: this.engineId });
    await this.shutdown();
  }

  /**
   * Handle bot start command
   */
  private async handleStartBot(command: any): Promise<void> {
    const { botId, strategyId, config, credentials } = command;

    try {
      logger.info('Starting bot', {
        botId,
        strategyId,
        engineId: this.engineId
      });

      // Check if bot already exists
      if (this.bots.has(botId)) {
        logger.warn('Bot already exists, skipping start', { botId, engineId: this.engineId });
        return;
      }

      // Validate that we have credentials
      if (!credentials || !credentials.accountId || !credentials.accessKey || !credentials.secretKey) {
        logger.error('Missing credentials for bot', { botId, engineId: this.engineId });
        return;
      }

      // Create Orderly client for this specific user/bot
      const orderlyClient = createOrderlyClient(
        credentials.accountId,
        credentials.accessKey,
        credentials.secretKey,
        process.env.NODE_ENV !== 'production' // Use testnet for development
      );

      // Get current market price for initialization
      const symbol = config.symbol;
      const ticker = await orderlyClient.getTicker(symbol);
      const currentPrice = Number(ticker.mark_price || ticker.price);

      if (!currentPrice) {
        logger.error('Could not get current price', { symbol, engineId: this.engineId });
        return;
      }

      // Create strategy instance
      const gridConfig = {
        symbol: config.symbol,
        gridSize: config.gridSize || 10,
        gridRangePercent: config.gridRange || 5,
        orderQuantity: config.orderQuantity || 1
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
            botId,
            engineId: this.engineId
          });
        }
      }, 5000);

      // Store bot instance
      const botInstance: BotInstance = {
        botId,
        strategyId,
        strategy: gridStrategy,
        intervalId,
        userId: command.userId || 'unknown',
        orderlyClient
      };

      this.bots.set(botId, botInstance);

      // Send initial heartbeat
      this.sendHeartbeat(botId, 'RUNNING');

      // Send bot started event
      await this.streamOperations.publish('engine:events', {
        type: 'BOT_STARTED',
        engineId: this.engineId,
        botId,
        strategyId,
        symbol: config.symbol,
        strategyType: 'GRID',
        timestamp: Date.now()
      } as EngineEvent);

      logger.info('Bot started successfully', {
        botId,
        symbol: config.symbol,
        currentPrice,
        engineId: this.engineId
      });
    } catch (error) {
      logger.error('Failed to start bot', {
        error: error instanceof Error ? error.message : String(error),
        botId,
        strategyId,
        engineId: this.engineId
      });

      // Send error event
      await this.streamOperations.publish('engine:events', {
        type: 'ENGINE_ERROR',
        engineId: this.engineId,
        botId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        timestamp: Date.now()
      } as EngineEvent);
    }
  }

  /**
   * Handle bot stop command
   */
  private async handleStopBot(command: any): Promise<void> {
    const { botId } = command;

    try {
      logger.info('Stopping bot', { botId, engineId: this.engineId });

      const botInstance = this.bots.get(botId);
      if (!botInstance) {
        logger.warn('Bot not found for stop', { botId, engineId: this.engineId });
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

      // Send bot stopped event
      await this.streamOperations.publish('engine:events', {
        type: 'BOT_STOPPED',
        engineId: this.engineId,
        botId,
        reason: 'normal_stop',
        timestamp: Date.now()
      } as EngineEvent);

      logger.info('Bot stopped successfully', { botId, engineId: this.engineId });
    } catch (error) {
      logger.error('Failed to stop bot', {
        error: error instanceof Error ? error.message : String(error),
        botId,
        engineId: this.engineId
      });
    }
  }

  /**
   * Handle emergency stop command
   */
  private async handleEmergencyStop(command: any): Promise<void> {
    const { botId, action } = command;

    try {
      logger.warn('Emergency stop initiated', { botId, action, engineId: this.engineId });

      const botInstance = this.bots.get(botId);
      if (!botInstance) {
        logger.warn('Bot not found for emergency stop', { botId, engineId: this.engineId });
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

      // Send emergency stop event
      await this.streamOperations.publish('engine:events', {
        type: 'BOT_STOPPED',
        engineId: this.engineId,
        botId,
        reason: 'emergency_stop',
        timestamp: Date.now()
      } as EngineEvent);

      logger.warn('Emergency stop completed', { botId, engineId: this.engineId });
    } catch (error) {
      logger.error('Emergency stop failed', {
        error: error instanceof Error ? error.message : String(error),
        botId,
        engineId: this.engineId
      });
    }
  }

  /**
   * Handle strategy configuration update
   */
  private async handleUpdateStrategyConfig(command: any): Promise<void> {
    const { botId, config } = command;

    try {
      logger.info('Updating strategy configuration', { botId, engineId: this.engineId });

      const botInstance = this.bots.get(botId);
      if (!botInstance) {
        logger.warn('Bot not found for config update', { botId, engineId: this.engineId });
        return;
      }

      // For grid strategy, we might need to stop and restart with new config
      // This is simplified - in real implementation, you might update config on the fly
      await botInstance.strategy.stop();
      clearInterval(botInstance.intervalId);

      // Create new strategy instance with updated config
      const gridConfig = {
        symbol: config.symbol,
        gridSize: config.gridSize || 10,
        gridRangePercent: config.gridRange || 5,
        orderQuantity: config.orderQuantity || 1
      };

      const gridStrategy = new GridTradingStrategy(gridConfig, botInstance.orderlyClient);

      // Get current market price for initialization
      const ticker = await botInstance.orderlyClient.getTicker(config.symbol);
      const currentPrice = Number(ticker.mark_price || ticker.price);

      if (!currentPrice) {
        logger.error('Could not get current price for config update', {
          symbol: config.symbol,
          engineId: this.engineId
        });
        return;
      }

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
          logger.error('Strategy tick error after config update', {
            error: error instanceof Error ? error.message : String(error),
            botId,
            engineId: this.engineId
          });
        }
      }, 5000);

      // Update bot instance
      botInstance.strategy = gridStrategy;
      botInstance.intervalId = intervalId;

      logger.info('Strategy configuration updated', { botId, engineId: this.engineId });
    } catch (error) {
      logger.error('Failed to update strategy configuration', {
        error: error instanceof Error ? error.message : String(error),
        botId,
        engineId: this.engineId
      });
    }
  }

  /**
   * Send heartbeat to backend
   */
  private async sendHeartbeat(botId: string, status: string): Promise<void> {
    try {
      // Calculate bot statistics
      const botInstance = this.bots.get(botId);
      let position = 0;
      let exposure = 0;
      let currentPrice = 0;
      let totalTrades = 0;
      let totalPnl = 0;

      if (botInstance) {
        const strategyStatus = botInstance.strategy.getStatus();
        position = strategyStatus.totalTrades;
        exposure = strategyStatus.totalPnl;
        currentPrice = strategyStatus.currentPrice;
        totalTrades = strategyStatus.totalTrades;
        totalPnl = strategyStatus.totalPnl;
      }

      // Send heartbeat via Redis stream
      await this.streamOperations.publish('engine:events', {
        type: 'BOT_HEARTBEAT',
        engineId: this.engineId,
        botId,
        status,
        position,
        exposure,
        currentPrice,
        totalTrades,
        totalPnl,
        timestamp: Date.now()
      } as EngineEvent);
    } catch (error) {
      logger.error('Heartbeat send failed', {
        error: error instanceof Error ? error.message : String(error),
        botId,
        engineId: this.engineId
      });
    }
  }

  /**
   * Shutdown the trading engine
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down trading engine...', { engineId: this.engineId });

    // Stop all bots
    for (const [botId, botInstance] of this.bots) {
      try {
        await botInstance.strategy.stop();
        clearInterval(botInstance.intervalId);
        this.sendHeartbeat(botId, 'STOPPED');
      } catch (error) {
        logger.error('Error stopping bot during shutdown', {
          error: error instanceof Error ? error.message : String(error),
          botId,
          engineId: this.engineId
        });
      }
    }

    this.bots.clear();

    // Send engine stopped event
    await this.streamOperations.publish('engine:events', {
      type: 'ENGINE_STOPPED',
      engineId: this.engineId,
      reason: 'graceful_shutdown',
      uptime: 0, // We should track actual uptime
      timestamp: Date.now()
    } as EngineEvent);

    // Disconnect from Redis
    await this.streamOperations.disconnect();

    logger.info('Trading engine shutdown complete', { engineId: this.engineId });
  }

  /**
   * Get bot status
   */
  public getBotStatus(botId: string): any {
    const botInstance = this.bots.get(botId);
    if (!botInstance) return null;

    return botInstance.strategy.getStatus();
  }

  /**
   * Get all bot statuses
   */
  public getAllBotStatuses(): any[] {
    return Array.from(this.bots.values()).map(botInstance => {
      const status = botInstance.strategy.getStatus();
      return {
        botId: botInstance.botId,
        strategyId: botInstance.strategyId,
        status: status.status,
        currentPrice: status.currentPrice,
        totalTrades: status.totalTrades,
        totalPnl: status.totalPnl
      }
    })
  }
}