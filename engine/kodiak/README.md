# Trading Engine

**TypeScript Trading Bot Engine for Automated Strategy Execution**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](package.json)
[![Node.js](https://img.shields.io/badge/Node.js-25.x-green)](package.json)

---

## Overview

The trading engine is an independent TypeScript service that executes automated trading strategies on the Berachain network via the Kodiak exchange. It provides real-time strategy execution, risk management, and trade monitoring capabilities.

### Key Features

- **Multi-Strategy Support** - Grid, Trend Following, Arbitrage, Mean Reversion
- **Real-Time Execution** - Live order placement and market data processing
- **Risk Management** - Position limits, stop-loss, and exposure controls
- **WebSocket Integration** - Live market data feeds from Kodiak
- **Order Management** - Automated order tracking and lifecycle management
- **Performance Monitoring** - Real-time P&L tracking and bot metrics
- **Graceful Shutdown** - Safe bot termination with order cancellation

---

## Architecture

```
Trading Engine (engine/kodiak/)
├── src/
│   ├── index.ts              # Main engine entry point
│   ├── strategies/           # Trading strategy implementations
│   │   ├── grid.ts          # Grid trading strategy
│   │   └── index.ts         # Strategy factory
│   ├── services/            # Core services
│   │   ├── orderly.ts       # Kodiak/Orderly API client
│   │   └── logger.ts        # Structured logging
│   └── types/               # TypeScript definitions
│       └── strategy.ts      # Strategy interfaces
├── package.json             # Engine dependencies
└── tsconfig.json           # TypeScript configuration
```

---

## Quick Start

### Prerequisites
- Node.js ≥ 25.0.9
- Backend API running
- PostgreSQL database
- Redis cache

### Installation

```bash
cd engine/kodiak
npm install
```

### Configuration

The engine uses environment variables from the project root `.env` file:

```bash
# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=trade_bot

# Redis
REDIS_URL=redis://localhost:6379

# Trading
KODIAK_API_URL=https://api.orderly.org/v1/
KODIAK_WS_URL=wss://ws-evm.orderly.org/ws/stream/

# Authentication
ENCRYPTION_MASTER_KEY=your-32-char-key
```

### Development

```bash
# Start engine in development mode
npm run dev

# Start in production
npm run build && npm start
```

---

## Trading Strategies

### Grid Trading Strategy

**Overview**: Creates automated buy/sell grids around a central price level.

**Configuration**:
```typescript
const gridConfig = {
  symbol: "PERP_BTC_USDC",
  gridLevels: 10,           // Number of grid levels
  gridSpacing: 0.5,         // Percentage spacing between levels
  minOrderSize: 0.001,      // Minimum order size
  maxOrderSize: 0.1,        // Maximum order size
  positionLimit: 1.0,       // Maximum position size
  enableRebalancing: true   // Auto-rebalance grid
};
```

**How it works**:
1. Places buy orders below current price
2. Places sell orders above current price
3. As price moves, orders are filled creating profit opportunities
4. Automatically rebalances grid as market conditions change

### Trend Following Strategy

**Overview**: Follows market momentum with configurable parameters.

**Configuration**:
```typescript
const trendConfig = {
  symbol: "PERP_ETH_USDC",
  timeframe: "1h",          // Analysis timeframe
  fastPeriod: 12,           // Fast EMA period
  slowPeriod: 26,           // Slow EMA period
  signalPeriod: 9,          // Signal line period
  positionSize: 0.5,        // Position size as % of balance
  stopLoss: 2.0,           // Stop loss percentage
  takeProfit: 5.0          // Take profit percentage
};
```

**How it works**:
1. Calculates MACD indicator
2. Generates buy/sell signals based on MACD crossovers
3. Enters positions on signal confirmation
4. Uses trailing stops for profit protection

### Arbitrage Strategy

**Overview**: Exploits price differences across markets.

**Configuration**:
```typescript
const arbitrageConfig = {
  baseSymbol: "PERP_BTC_USDC",
  quoteSymbol: "PERP_BTC_USDT",  // Comparison pair
  minSpread: 0.1,           // Minimum spread percentage
  maxSpread: 2.0,           // Maximum spread percentage
  tradeSize: 0.01,          // Trade size
  maxSlippage: 0.05         // Maximum allowed slippage
};
```

**How it works**:
1. Monitors price differences between correlated pairs
2. Identifies arbitrage opportunities
3. Executes simultaneous buy/sell orders
4. Profits from price convergence

### Mean Reversion Strategy

**Overview**: Trades against extreme price movements expecting return to mean.

**Configuration**:
```typescript
const meanReversionConfig = {
  symbol: "PERP_BTC_USDC",
  lookbackPeriod: 20,       // Historical lookback period
  entryThreshold: 2.0,      // Standard deviation entry threshold
  exitThreshold: 0.5,       // Standard deviation exit threshold
  positionSize: 0.3,        // Position size
  maxHoldTime: 3600         // Maximum hold time (seconds)
};
```

**How it works**:
1. Calculates Bollinger Bands
2. Identifies overbought/oversold conditions
3. Enters counter-trend positions
4. Exits when price returns to mean

---

## Bot Management

### Starting a Bot

```typescript
import { BotManager } from './services/bot-manager';

// Create and start a bot
const botManager = new BotManager();
const bot = await botManager.createBot({
  strategyId: "uuid",
  userId: "uuid",
  config: gridConfig
});

await botManager.startBot(bot.id);
```

### Bot Lifecycle

1. **Initialization**: Load strategy configuration and validate parameters
2. **Connection**: Establish WebSocket connection to Kodiak market data
3. **Execution**: Begin strategy execution based on market conditions
4. **Monitoring**: Track positions, P&L, and risk metrics
5. **Termination**: Graceful shutdown with position closure

### Bot States

- `STOPPED` - Bot is not running
- `STARTING` - Bot initialization in progress
- `RUNNING` - Bot actively executing trades
- `STOPPING` - Bot shutting down gracefully
- `ERROR` - Bot encountered an error
- `FORCE_STOPPING` - Emergency shutdown

### Risk Management

**Position Limits**:
- Maximum position size per bot
- Maximum total exposure across all bots
- Daily loss limits

**Stop Loss Protection**:
- Automatic position closure on adverse price movements
- Configurable stop loss percentages
- Emergency stop functionality

---

## API Integration

### Kodiak/Orderly API Client

The engine uses a dedicated API client for Kodiak integration:

```typescript
import { OrderlyClient } from './services/orderly';

// Initialize client
const client = new OrderlyClient({
  accountId: "user-account-id",
  apiKey: decryptedApiKey,
  secretKey: decryptedSecretKey
});

// Place order
const order = await client.placeOrder({
  symbol: "PERP_BTC_USDC",
  side: "BUY",
  quantity: "0.01",
  price: "45000"
});

// Monitor position
const position = await client.getPosition("PERP_BTC_USDC");
```

### Market Data Streams

Real-time market data via WebSocket:

```typescript
import { MarketDataStream } from './services/market-stream';

// Subscribe to market data
const stream = new MarketDataStream();
stream.subscribe('PERP_BTC_USDC', (data) => {
  console.log('Price:', data.price, 'Volume:', data.volume);
});
```

---

## Performance & Monitoring

### Metrics Tracking

**Per-Bot Metrics**:
- Total trades executed
- Win/loss ratio
- Total P&L
- Running time
- Error count

**System Metrics**:
- CPU usage
- Memory consumption
- WebSocket connection health
- API rate limit usage

### Logging

Structured logging with Winston:

```typescript
import logger from './services/logger';

// Different log levels
logger.info('Bot started', { botId, strategy: 'grid' });
logger.warn('High volatility detected', { symbol, volatility: 0.15 });
logger.error('Order placement failed', { error: error.message, orderId });
```

### Health Checks

Bot health monitoring:
- WebSocket connection status
- API connectivity
- Database connectivity
- Memory usage limits

---

## Development

### Adding New Strategies

1. **Create Strategy Class**:
```typescript
import { BaseStrategy, StrategyConfig } from '../types/strategy';

export class NewStrategy extends BaseStrategy {
  constructor(config: StrategyConfig) {
    super(config);
  }

  async execute(): Promise<void> {
    // Strategy logic here
  }

  async validateConfig(): Promise<boolean> {
    // Configuration validation
    return true;
  }
}
```

2. **Register Strategy**:
```typescript
// In strategies/index.ts
import { NewStrategy } from './new-strategy';

export function createStrategy(type: string, config: StrategyConfig) {
  switch (type) {
    case 'NEW_STRATEGY':
      return new NewStrategy(config);
    // ... other strategies
  }
}
```

3. **Add Type Definitions**:
```typescript
// In types/strategy.ts
export interface NewStrategyConfig extends BaseStrategyConfig {
  customParameter: number;
  anotherSetting: string;
}
```

### Testing Strategies

```typescript
import { createStrategy } from './strategies';

describe('NewStrategy', () => {
  it('should execute trades correctly', async () => {
    const strategy = createStrategy('NEW_STRATEGY', config);
    await strategy.execute();
    // Assertions
  });
});
```

---

## Deployment

### Production Setup

1. **Build the engine**:
```bash
npm run build
```

2. **Configure environment**:
```bash
NODE_ENV=production
LOG_LEVEL=info
```

3. **Start with process manager**:
```bash
# Using PM2
pm2 start dist/index.js --name "trade-engine"

# Or directly
npm start
```

### Docker Deployment

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist/ ./
CMD ["node", "index.js"]
```

### Monitoring

**Process Monitoring**:
- PM2 process management
- Automatic restarts on failure
- Log rotation
- Resource usage monitoring

**Trading Monitoring**:
- Real-time P&L tracking
- Position limit alerts
- Error rate monitoring
- Performance analytics

---

## Configuration

### Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `DB_HOST` | PostgreSQL host | ✅ | localhost |
| `DB_PORT` | PostgreSQL port | ✅ | 5432 |
| `DB_NAME` | Database name | ✅ | trade_bot |
| `DB_USER` | Database user | ✅ | postgres |
| `DB_PASSWORD` | Database password | ✅ | - |
| `REDIS_URL` | Redis connection URL | ✅ | redis://localhost:6379 |
| `KODIAK_API_URL` | Kodiak API URL | ✅ | https://api.orderly.org/v1/ |
| `KODIAK_WS_URL` | Kodiak WebSocket URL | ✅ | wss://ws-evm.orderly.org/ws/stream/ |
| `ENCRYPTION_MASTER_KEY` | API key encryption key | ✅ | - |
| `NODE_ENV` | Environment | ❌ | development |
| `LOG_LEVEL` | Logging level | ❌ | info |

### Strategy Configuration

All strategies support common configuration options:

```typescript
interface BaseStrategyConfig {
  symbol: string;              // Trading pair
  positionLimit: number;       // Max position size
  stopLoss?: number;          // Stop loss percentage
  takeProfit?: number;        // Take profit percentage
  enabled: boolean;           // Strategy enabled/disabled
  maxSlippage: number;        // Max allowed slippage
}
```

---

## Troubleshooting

### Common Issues

**WebSocket Connection Failed**
```bash
# Check Kodiak WebSocket URL
curl -I https://api.orderly.org/v1/public/ticker

# Verify network connectivity
ping api.orderly.org
```

**Database Connection Issues**
```bash
# Test database connection
psql -h localhost -U postgres -d trade_bot -c "SELECT 1"

# Check connection pool
npm run db:metrics
```

**Order Placement Errors**
- Verify API credentials are decrypted correctly
- Check account balance and permissions
- Review order parameters (symbol, quantity, price)

**High Memory Usage**
- Monitor bot instances
- Check for memory leaks in strategy logic
- Implement proper cleanup in strategy shutdown

### Debug Mode

Enable detailed logging:
```bash
LOG_LEVEL=debug npm run dev
```

### Emergency Stop

Force stop all bots:
```bash
# Via API
curl -X POST https://your-api.com/api/bot/emergency-stop

# Or database
UPDATE bot_instances SET status = 'FORCE_STOPPING' WHERE status = 'RUNNING';
```

---

## Performance Optimization

### Execution Optimization

- **Event-Driven Architecture**: React to market events instantly
- **Connection Pooling**: Efficient database connections
- **Caching**: Redis caching for market data
- **Async Processing**: Non-blocking order execution

### Risk Controls

- **Position Sizing**: Configurable position limits
- **Exposure Management**: Total portfolio exposure controls
- **Circuit Breakers**: Automatic shutdown on extreme conditions
- **Rate Limiting**: Respect exchange API limits

---

## Contributing

1. Follow TypeScript strict typing guidelines
2. Implement comprehensive error handling
3. Add unit tests for new strategies
4. Document strategy parameters and behavior
5. Include performance benchmarks
6. Test with paper trading before live deployment

### Code Standards

- **TypeScript**: Strict mode enabled, full type coverage
- **Error Handling**: Try/catch with proper logging
- **Async/Await**: Consistent async patterns
- **Testing**: Unit tests for all strategies
- **Documentation**: Inline comments and README updates
- **Performance**: Efficient algorithms and data structures

---

## Roadmap

### Q1 2026
- [ ] Trend Following strategy implementation
- [ ] Advanced risk management features
- [ ] Backtesting framework integration
- [ ] Multi-timeframe analysis support

### Q2 2026
- [ ] Arbitrage strategy implementation
- [ ] Portfolio optimization algorithms
- [ ] Machine learning integration
- [ ] Advanced order types support

### Q3 2026
- [ ] Cross-exchange arbitrage
- [ ] Social trading features
- [ ] Advanced analytics dashboard
- [ ] Mobile trading app support

---

**Engine Status**: ✅ Production Ready | **TypeScript Version**: 5.x | **Supported Strategies**: Grid Trading
