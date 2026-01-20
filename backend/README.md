# Trade Bot Backend - Enterprise Domain-Driven Architecture

**Production-Grade Express.js API Server with Clean Architecture & Domain-Driven Design**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](tsconfig.json)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D25.0.0-brightgreen)](package.json)
[![Express.js](https://img.shields.io/badge/Express.js-5.x-lightgrey)](package.json)

---

## 🏗️ Architecture Overview

This backend implements **enterprise-grade domain-driven design** with **clean architecture principles**, featuring **6 architectural layers** organized around **5 core business domains**.

### 🎯 Key Architectural Principles

- **🏛️ Clean Architecture** - Infrastructure, domain, interface, shared, workers layers
- **🎯 Domain-Driven Design** - Business logic organized by domain boundaries
- **🔄 Dependency Inversion** - High-level modules don't depend on low-level modules
- **📦 Single Responsibility** - Each module has one reason to change
- **🔌 Plugin Architecture** - Easy to extend and maintain

---

## 🏗️ Architecture Layers

### 🔄 Interfaces Layer (`src/interfaces/`)

**Purpose:** External communication adapters and protocol handlers.

```
interfaces/
├── http/           # REST API routes (12+ endpoints)
├── middleware/     # Request processing pipeline
└── websocket/      # Real-time communication handlers
```

**Responsibilities:**
- HTTP request/response handling
- WebSocket connection management
- Request validation and sanitization
- Response formatting and serialization
- CORS and security headers

**Key Files:**
- `http/auth.ts` - Authentication endpoints
- `http/bot-management.ts` - Trading bot operations
- `middleware/context.ts` - Request context management

### ⚙️ Core Layer (`src/core/`)

**Purpose:** Business domain logic and application rules.

```
core/
├── auth/           # 🔐 Authentication & authorization
├── user/           # 👤 User management & profiles
├── trading/        # 📊 Bot trading & position tracking
├── wallet/         # 💰 Balance & wallet operations
├── logging/        # 📝 Structured logging & context
└── notifications/  # 🚨 Error notifications & alerts
```

**Domain Responsibilities:**

#### 🔐 Authentication Domain
- JWT token generation and validation
- Password hashing and verification
- User session management
- Role-based access control

#### 📊 Trading Domain
- Bot lifecycle management
- Position tracking and synchronization
- Performance analytics
- Risk management rules

#### 💰 Wallet Domain
- Balance management and caching
- Wallet qualification checks
- Transaction history
- Account limits validation

#### 👤 User Domain
- Profile management
- Kodiak credential handling
- User settings and preferences

#### 📝 Logging Domain
- Structured logging with context
- Correlation ID tracking
- Performance timing
- Error context preservation

#### 🚨 Notifications Domain
- Error alerting via Discord webhooks
- System health monitoring
- User notification preferences

### 🏗️ Infrastructure Layer (`src/infrastructure/`)

**Purpose:** Technical capabilities and external integrations.

```
infrastructure/
├── cache/          # Redis caching & invalidation
├── security/       # Encryption, rate limiting, keys
├── external/       # Kodiak API integration
├── messaging/      # WebSocket & market streaming
├── async/          # Background job management
└── retry.service.ts # Cross-cutting retry logic
```

**Infrastructure Services:**

#### 🗄️ Cache Infrastructure
- Redis connection management
- Cache invalidation strategies
- Atomic operations with transactions

#### 🔒 Security Infrastructure
- Credential encryption/decryption
- Key management and rotation
- Rate limiting and DDoS protection

#### 🌐 External Infrastructure
- Kodiak API client with retry logic
- WebSocket connection management
- API rate limiting and circuit breakers

#### 📡 Messaging Infrastructure
- WebSocket server management
- Market data streaming
- Real-time event broadcasting

### 📚 Shared Layer (`src/shared/`)

**Purpose:** Common utilities and cross-cutting concerns.

```
shared/
├── types/          # TypeScript interfaces & types
├── utils/          # Pure utility functions
├── constants/      # Application constants
└── validation/     # Schema validation & sanitization
```

**Shared Components:**
- Context utilities for request tracing
- Cryptographic signature generation
- Common data validation schemas
- Application-wide constants

### ⚡ Workers Layer (`src/workers/`)

**Purpose:** CPU-intensive and background processing tasks.

```
workers/
├── password-worker.ts     # CPU-intensive password hashing
├── bot-reconciliation.ts  # Background position reconciliation
└── index.ts              # Worker exports and management
```

**Worker Responsibilities:**
- Offloading CPU-intensive operations
- Background data synchronization
- Scheduled maintenance tasks

---

## 🚀 Getting Started

### Prerequisites
- Node.js ≥ 25.0.9
- PostgreSQL 14+
- Redis 5.0+

### Development Setup

```bash
# Install dependencies
npm install

# Configure environment
cp ../.env.example ../.env
# Edit .env with database and API credentials

# Run migrations
npm run db:migrate

# Start development server with auto-reload
npm run dev
```

### Production Build

```bash
npm run build
npm start
```

---

## 📊 Domain Usage Examples

### Authentication Domain

```typescript
import { authService } from './core/auth';

// User registration
const result = await authService.register({
  email: 'user@example.com',
  password: 'securePassword123'
});

// JWT token generation
const tokens = await authService.generateTokens(userId);
```

### Trading Domain

```typescript
import { positionValidatorService } from './core/trading';

// Validate position size
const validation = await positionValidatorService.validateUserPosition(
  userId,
  1000, // notional amount
  'BTC-USDC', // symbol
  0.8 // max exposure percent
);
```

### Wallet Domain

```typescript
import { balanceService } from './core/wallet';

// Get cached balance
const balance = await balanceService.getUserBalance(userId);
```

### Logging Domain

```typescript
import { contextLogger } from './core/logging';

// Context-aware logging
contextLogger.info('User action completed', {
  userId,
  action: 'bot_started',
  botId
});
```

### Notifications Domain

```typescript
import { errorNotificationService } from './core/notifications';

// Send error alert
await errorNotificationService.notifyError(
  new Error('Database connection failed'),
  {
    category: ErrorCategory.DATABASE,
    operation: 'user_query',
    userId
  }
);
```

---

## 🧪 Testing

```bash
# Run all tests
npm test

# Run specific domain tests
npm run test:unit -- --grep "auth"

# Run integration tests
npm run test:integration
```

---

## 📈 Performance & Monitoring

### Key Metrics
- **Response Time:** <100ms for cached requests
- **Error Rate:** <0.1% for production endpoints
- **Cache Hit Rate:** >95% for frequently accessed data
- **Database Connection Pool:** Optimized for concurrent requests

### Monitoring
- Winston structured logging with correlation IDs
- Redis cache performance monitoring
- Database query performance tracking
- WebSocket connection health checks

---

## 🔒 Security Features

- **JWT Authentication** with refresh token rotation
- **bcrypt Password Hashing** (12 rounds)
- **Rate Limiting** (Redis-backed)
- **Helmet Security Headers**
- **CORS Protection** with origin validation
- **SQL Injection Prevention** via parameterized queries
- **XSS Protection** via input sanitization

---

## 📚 API Documentation

### REST Endpoints

| Domain | Endpoint | Method | Description |
|--------|----------|--------|-------------|
| Auth | `/api/auth/login` | POST | User authentication |
| Auth | `/api/auth/refresh` | POST | Token refresh |
| Trading | `/api/bots` | GET | List user bots |
| Trading | `/api/bots/:id/start` | POST | Start trading bot |
| Wallet | `/api/balance` | GET | Get user balance |
| User | `/api/profile` | GET | Get user profile |

### WebSocket Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `bot:status` | Server → Client | Bot status updates |
| `market:data` | Server → Client | Real-time market data |
| `cache:invalidation` | Server → Client | Cache invalidation notifications |

---

## 🛠️ Development Guidelines

### Adding New Features

1. **Identify Domain:** Determine which business domain owns the feature
2. **Create Service:** Add service class to appropriate domain folder
3. **Update Interface:** Add HTTP/WebSocket endpoints in `interfaces/`
4. **Add Tests:** Create unit and integration tests
5. **Update Documentation:** Update this README and API docs

### Code Organization Rules

- **One Domain Per Folder:** Keep domain boundaries clear
- **Dependency Direction:** Core → Infrastructure → Shared (never reverse)
- **Interface Segregation:** Small, focused interfaces
- **Single Responsibility:** One reason to change per module

### Naming Conventions

- **Services:** `{domain}Service` (e.g., `authService`)
- **Interfaces:** PascalCase with `I` prefix (e.g., `IAuthService`)
- **Files:** kebab-case for consistency
- **Folders:** Domain names (auth, trading, wallet, etc.)

---

## 🚨 Error Handling

### Structured Error Responses

```typescript
// Success response
{
  success: true,
  data: { /* result */ },
  timestamp: "2026-01-20T00:00:00Z"
}

// Error response
{
  success: false,
  error: {
    code: "VALIDATION_ERROR",
    message: "Invalid input parameters",
    details: { field: "email", issue: "required" }
  },
  timestamp: "2026-01-20T00:00:00Z"
}
```

### Error Categories

- `VALIDATION_ERROR` - Input validation failures
- `AUTHENTICATION_ERROR` - JWT/token issues
- `AUTHORIZATION_ERROR` - Permission denied
- `NOT_FOUND_ERROR` - Resource not found
- `CONFLICT_ERROR` - Business rule violations
- `EXTERNAL_ERROR` - Third-party API failures
- `INTERNAL_ERROR` - System failures

---

## 🔄 Deployment

### Environment Variables

```bash
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/tradebot

# Redis
REDIS_URL=redis://localhost:6379

# JWT
JWT_SECRET=your-jwt-secret-key
JWT_REFRESH_SECRET=your-refresh-secret-key

# Kodiak API
KODIAK_API_URL=https://api.orderly.org
KODIAK_ACCOUNT_ID=your-account-id

# Discord Notifications
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

### Health Checks

```bash
# Application health
GET /health

# Database connectivity
GET /health/database

# Redis connectivity
GET /health/redis

# External API status
GET /health/external
```

---

## 📈 Scaling Considerations

### Horizontal Scaling
- Stateless design enables multiple instances
- Redis-backed session storage
- Database connection pooling
- Load balancer configuration

### Performance Optimizations
- Redis caching for hot data
- Database query optimization
- Background job processing
- WebSocket connection pooling

---

## 🤝 Contributing

### Development Workflow

1. **Create Feature Branch:** `git checkout -b feature/your-feature`
2. **Domain-First Design:** Identify affected domains
3. **Clean Architecture:** Respect layer boundaries
4. **Comprehensive Testing:** Unit + integration tests
5. **Documentation Updates:** Keep READMEs current

### Code Review Checklist

- [ ] Domain boundaries respected
- [ ] Dependency injection used
- [ ] Error handling comprehensive
- [ ] Logging context-aware
- [ ] Tests written and passing
- [ ] Documentation updated

---

## 📚 Related Documentation

- **[Main Project README](../README.md)** - Overall project overview
- **[Frontend Documentation](../frontend/README.md)** - React UI details
- **[Engine Documentation](../engine/kodiak/README.md)** - Trading bot engine
- **[Database Setup](../DATABASE_SETUP.md)** - PostgreSQL configuration
- **[API Reference](API_REFERENCE.md)** - Complete API documentation

---

## 🎯 Architecture Achievements

✅ **Enterprise-Grade:** Production-ready domain-driven design
✅ **Scalable:** Clean architecture with clear separation of concerns
✅ **Maintainable:** Well-documented domain boundaries
✅ **Testable:** Dependency injection enables comprehensive testing
✅ **Secure:** Security-first design with multiple protection layers
✅ **Performant:** Optimized caching and background processing
✅ **Observable:** Comprehensive logging and monitoring

---

**This backend architecture represents a production-grade implementation of domain-driven design, providing a solid foundation for enterprise-scale trading applications.**

*Last Updated: January 20, 2026*
