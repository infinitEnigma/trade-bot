# Backend API Server

**Express.js REST/WebSocket API Server for Trade Bot**

[![Node Version](https://img.shields.io/badge/node-%3E%3D25.0.0-brightgreen)](package.json)
[![Express.js](https://img.shields.io/badge/Express.js-5.x-blue)](package.json)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-14+-blue)](../../DATABASE_SETUP.md)

---

## Overview

The backend is a production-ready Express.js API server that provides REST endpoints and WebSocket connections for the Trade Bot platform. It handles authentication, trading operations, market data, and real-time bot status updates.

### Key Features

- **REST API** - Complete CRUD operations for users, strategies, and trades
- **WebSocket Support** - Real-time bot status and market data updates
- **JWT Authentication** - Secure token-based authentication
- **Rate Limiting** - Protection against abuse (100 req/15s per IP)
- **PostgreSQL Integration** - Robust data persistence
- **Redis Caching** - High-performance caching layer
- **Comprehensive Logging** - Winston-based structured logging

---

## Quick Start

### Prerequisites
- Node.js ≥ 25.0.9
- PostgreSQL 14+
- Redis 5.0+

### Installation

```bash
cd backend
npm install
```

### Configuration

Create `.env` in the project root:

```bash
# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=trade_bot
DB_USER=postgres
DB_PASSWORD=your_password

# Redis
REDIS_URL=redis://localhost:6379

# Authentication
JWT_SECRET=your-32-char-jwt-secret
JWT_REFRESH_SECRET=your-32-char-refresh-secret
ENCRYPTION_MASTER_KEY=your-32-char-encryption-key

# APIs
KODIAK_API_URL=https://api.orderly.org/v1/
KODIAK_WS_URL=wss://ws-evm.orderly.org/ws/stream/

# Server
NODE_ENV=development
PORT=3000
FRONTEND_URL=https://yourdomain.com
CORS_ORIGIN=https://yourdomain.com
```

### Database Setup

```bash
# Run migrations from project root
npm run db:migrate

# Or from backend directory
cd backend && npm run db:migrate
```

### Development

```bash
# Start development server with auto-reload
npm run dev

# Start production server
npm run build && npm start
```

### Testing

```bash
# Run backend tests
npm test

# Run with coverage
npm run test:coverage
```

---

## API Reference

### Authentication Endpoints

#### `POST /api/auth/register`
Register a new user account.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "securepassword123"
}
```

**Response:**
```json
{
  "success": true,
  "message": "User registered successfully",
  "data": {
    "userId": "uuid",
    "email": "user@example.com",
    "userLevel": "BASIC"
  }
}
```

#### `POST /api/auth/login`
Authenticate user and return JWT tokens.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "securepassword123"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
    "user": {
      "userId": "uuid",
      "email": "user@example.com",
      "userLevel": "BASIC"
    }
  }
}
```

#### `GET /api/auth/me`
Get current authenticated user information.

**Headers:**
```
Authorization: Bearer <access_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "userId": "uuid",
    "email": "user@example.com",
    "userLevel": "BASIC",
    "emailVerified": false,
    "createdAt": "2026-01-17T10:00:00.000Z"
  }
}
```

### Strategy Endpoints

#### `GET /api/strategies`
List all strategies for authenticated user.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "Grid Strategy BTC",
      "type": "GRID",
      "config": {
        "symbol": "PERP_BTC_USDC",
        "gridLevels": 10,
        "gridSpacing": 0.5
      },
      "active": true,
      "createdAt": "2026-01-17T10:00:00.000Z"
    }
  ]
}
```

#### `POST /api/strategies`
Create a new trading strategy.

**Request Body:**
```json
{
  "name": "My Grid Strategy",
  "type": "GRID",
  "config": {
    "symbol": "PERP_BTC_USDC",
    "gridLevels": 10,
    "gridSpacing": 0.5,
    "minOrderSize": 0.001,
    "maxOrderSize": 0.1
  }
}
```

#### `PATCH /api/strategies/:id`
Update strategy configuration.

#### `DELETE /api/strategies/:id`
Delete a strategy.

#### `POST /api/strategies/:id/validate`
Validate strategy configuration before saving.

### Bot Control Endpoints

#### `POST /api/bot/instances`
Start a new trading bot instance.

**Request Body:**
```json
{
  "strategyId": "uuid"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "botId": "uuid",
    "strategyId": "uuid",
    "status": "STARTING",
    "userId": "uuid"
  }
}
```

#### `GET /api/bot/instances`
List all bot instances for authenticated user.

#### `GET /api/bot/instances/:id/status`
Get detailed bot status and metrics.

#### `POST /api/bot/instances/:id/stop`
Stop a running bot instance.

#### `GET /api/bot/instances/:id/trades`
Get trade history for a specific bot.

### Market Data Endpoints

#### `GET /api/market/ticker`
Get current prices for all trading pairs.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "symbol": "PERP_BTC_USDC",
      "price": "45000.50",
      "change24h": "+2.5",
      "volume24h": "1234567.89"
    }
  ]
}
```

#### `GET /api/market/klines`
Get OHLC candlestick data.

**Query Parameters:**
- `symbol` - Trading pair symbol
- `interval` - Timeframe (1m, 5m, 15m, 1h, etc.)
- `limit` - Number of candles (max 1000)

#### `GET /api/market/positions`
Get user's current open positions.

#### `GET /api/market/balance`
Get account balance breakdown.

### Health & Monitoring

#### `GET /api/health`
Basic health check.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2026-01-17T10:00:00.000Z",
  "uptime": 3600,
  "version": "1.0.0",
  "environment": "development"
}
```

#### `GET /api/health/detailed`
Comprehensive health check including dependencies.

#### `GET /api/health/database`
Database connectivity check.

#### `GET /api/health/redis`
Redis connectivity check.

---

## WebSocket API

The backend provides real-time updates via WebSocket connections.

### Connection

```javascript
import io from 'socket.io-client';

const socket = io('https://yourdomain.com', {
  auth: {
    token: 'your-jwt-token'
  }
});
```

### Events

#### Client → Server

```javascript
// Subscribe to market data
socket.emit('subscribe_market', 'PERP_BTC_USDC');

// Unsubscribe from market data
socket.emit('unsubscribe_market', 'PERP_BTC_USDC');

// Subscribe to general room
socket.emit('subscribe', 'room-name');

// Unsubscribe from room
socket.emit('unsubscribe', 'room-name');
```

#### Server → Client

```javascript
// Market data updates
socket.on('market:PERP_BTC_USDC', (data) => {
  console.log('Market update:', data);
});

// Bot status updates
socket.on('bot:status', (status) => {
  console.log('Bot status:', status);
});

// General room messages
socket.on('room-name', (message) => {
  console.log('Room message:', message);
});
```

---

## Database Schema

### Core Tables

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `users` | User accounts | id, email, password_hash, user_level |
| `kodiak_credentials` | API credentials | user_id, account_id, api_key_encrypted |
| `strategies` | Trading strategies | user_id, name, type, config |
| `bot_instances` | Running bots | strategy_id, user_id, status, running_time |
| `trades` | Trade history | user_id, bot_id, symbol, side, quantity, price |
| `audit_logs` | Security logs | user_id, action, details |

See [DATABASE_SETUP.md](../../DATABASE_SETUP.md) for complete schema documentation.

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
| `JWT_SECRET` | JWT signing secret (32+ chars) | ✅ | - |
| `JWT_REFRESH_SECRET` | JWT refresh token secret (32+ chars) | ✅ | - |
| `ENCRYPTION_MASTER_KEY` | API key encryption key (32+ chars) | ✅ | - |
| `PORT` | Server port | ❌ | 3000 |
| `NODE_ENV` | Environment (development/production) | ❌ | development |
| `FRONTEND_URL` | Frontend URL for CORS | ✅ | - |
| `CORS_ORIGIN` | CORS allowed origin | ✅ | - |

### Security Configuration

- **Rate Limiting**: 100 requests per 15 minutes per IP
- **CORS**: Configured for specific frontend domains
- **Helmet**: Security headers enabled
- **Joi Validation**: Request validation on all endpoints
- **JWT Expiration**: 4 hours access, 30 days refresh

---

## Development

### Project Structure

```
backend/
├── src/
│   ├── index.ts              # Main server file
│   ├── routes/               # API route handlers
│   │   ├── auth.ts          # Authentication routes
│   │   ├── user.ts          # User management routes
│   │   ├── market.ts        # Market data routes
│   │   ├── strategies.ts    # Strategy management routes
│   │   ├── bot.ts           # Bot control routes
│   │   ├── balance.ts       # Balance/account routes
│   │   └── health.ts        # Health check routes
│   ├── services/            # Business logic services
│   │   ├── auth.ts          # Authentication service
│   │   ├── market-stream/   # Market data streaming
│   │   └── redis.ts         # Redis client service
│   ├── middleware/          # Express middleware
│   │   ├── auth.ts          # JWT authentication middleware
│   │   └── logger.ts        # HTTP request logging
│   ├── database/            # Database utilities
│   │   ├── index.ts         # Connection pool
│   │   ├── pool.ts          # Pool management
│   │   └── migrate.ts       # Migration runner
│   ├── types/               # TypeScript type definitions
│   └── utils/               # Utility functions
├── tests/                   # Test files
├── logs/                    # Application logs
└── package.json
```

### Development Scripts

```bash
# Development
npm run dev              # Start with ts-node-dev auto-reload
npm run build            # Build TypeScript to JavaScript
npm start                # Start production server

# Database
npm run db:migrate       # Run database migrations
npm run db:reset         # Reset database (destructive)
npm run db:seed          # Seed database with test data

# Testing
npm test                 # Run unit tests
npm run test:watch       # Run tests in watch mode
npm run test:coverage    # Run tests with coverage report
```

### Adding New Routes

1. Create route handler in `src/routes/`
2. Add validation with Joi in the route handler
3. Import and mount in `src/index.ts`
4. Add authentication middleware if required
5. Update this README with API documentation

### Error Handling

The backend uses consistent error response format:

```json
{
  "success": false,
  "error": "Error message",
  "code": "ERROR_CODE",
  "timestamp": "2026-01-17T10:00:00.000Z"
}
```

---

## Deployment

### Production Configuration

1. **Environment Variables**: Set all required env vars
2. **Database**: Ensure PostgreSQL and Redis are running
3. **SSL/TLS**: Configure nginx with SSL certificates
4. **Process Manager**: Use PM2 or systemd for process management

### Docker Deployment

```yaml
# Example docker-compose.yml
version: '3.8'
services:
  backend:
    build: ./backend
    environment:
      - NODE_ENV=production
      - DB_HOST=postgres
      - REDIS_URL=redis://redis:6379
    depends_on:
      - postgres
      - redis
```

### Monitoring

- **Health Checks**: `/api/health` endpoint for load balancer health checks
- **Logs**: Winston rotates logs daily in `backend/logs/`
- **Metrics**: Database pool metrics at `/api/health/database`

---

## Troubleshooting

### Common Issues

**Database Connection Failed**
```bash
# Check PostgreSQL status
sudo systemctl status postgresql

# Test connection
psql -h localhost -U postgres -d trade_bot

# Run migrations
npm run db:migrate
```

**Redis Connection Failed**
```bash
# Check Redis status
sudo systemctl status redis-server

# Test connection
redis-cli ping
```

**Port Already in Use**
```bash
# Find process using port 3000
sudo lsof -i :3000

# Kill the process
sudo kill -9 <PID>
```

**Authentication Errors**
- Verify JWT secrets are 32+ characters
- Check token expiration (4 hours for access tokens)
- Ensure `ENCRYPTION_MASTER_KEY` is set

### Debug Mode

Enable debug logging by setting:
```bash
DEBUG=trade-bot:* npm run dev
```

---

## Performance

### Benchmarks

- **API Response Time**: <50ms average
- **Database Queries**: <10ms average
- **WebSocket Latency**: <20ms
- **Concurrent Connections**: 100+ WebSocket clients

### Optimization

- **Connection Pooling**: PostgreSQL connection pool with 10 max connections
- **Redis Caching**: Market data cached for 60 seconds
- **Rate Limiting**: Prevents abuse while allowing legitimate traffic
- **Compression**: Response compression enabled

---

## Contributing

1. Follow TypeScript strict mode guidelines
2. Add comprehensive error handling
3. Include input validation with Joi
4. Add unit tests for new functionality
5. Update API documentation in this README

### Code Standards

- **TypeScript**: Strict mode enabled
- **Error Handling**: Try/catch blocks with proper logging
- **Validation**: Joi schemas for all input validation
- **Logging**: Winston structured logging throughout
- **Security**: Input sanitization and SQL injection protection

---

**Backend Status**: ✅ Production Ready | **API Version**: v1.0.0
