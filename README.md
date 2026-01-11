# Trade Bot - Automated Strategy Execution

## **Perpetual Futures Trading on Perps Platforms**

**currently supported -> Kodiak <https://perps.kodiak.finance>**

---

## 🎯 Project Overview

Automated trading platform for perpetual futures on Berachain, integrated with Kodiak platform.

| Attribute | Value |
| ----------- | ------- |
| Network | Berachain Mainnet (chainID: 80094) |
| API | Orderly/Kodiak on Berachain |
| Deployment | Bare Metal |
| UI Theme | Dark mode default (light toggle available) |
| Trading | Real trading with safety limits |

---

## 🏗️ Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                     Bare Metal Server                       │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  Frontend   │  │  Backend    │  │  Bot Engine         │  │
│  │  (Nginx)    │  │  (Node.js)  │  │  (Separate Process) │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
│         │               │                    │              │
│         └───────────────┼────────────────────┘              │
│                         ▼                                   │
│              ┌─────────────────────┐                        │
│              │  PostgreSQL + Redis │                        │
│              └─────────────────────┘                        │
└─────────────────────────────────────────────────────────────┘
                        │
                        ▼
              ┌─────────────────────┐
              │  Kodiak/Orderly     │
              │  API (Mainnet)      │
              └─────────────────────┘
```

---

## 📁 Project Structure

```text
trade-bot/
├── frontend/              # React 18 Dashboard
├── backend/               # Node.js 20 API Server
├── engine/kodiak/         # Trading Bot Engine
├── database/              # PostgreSQL migrations
├── shared/                # Shared TypeScript types
└── README.md              # This document
```

---

## 🔗 API Endpoints (Berachain/Kodiak)

### Public API

- **Base URL**: `https://api.orderly.org/v1/`
- **WebSocket**: `wss://ws-evm.orderly.org/ws/stream/{account_id}`

### Private API  

- **Base URL**: `https://api.orderly.org/v1/`
- **WebSocket**: `wss://ws-private-evm.orderly.org/v2/ws/private/stream/{account_id}`

### Key Endpoints (Rest)

| Method | Endpoint | Description |
| -------- | ---------- | ------------- |
| GET | `/v1/public/account?account_id=${value.accountId}` | Account - Wallet Address |
| GET | `/v1/public/ticker` | Market ticker |
| GET | `/v1/client/info` | Account - Info |
| GET | `/v1/client/statistics` | Account - Stats |
| GET | `/v1/kline` | OHLC data |
| GET | `/v1/orderbook` | Order book |
| GET | `/v1/positions` | User open positions |
| GET | `/v1/position_history?limit=100` | User positions history |
| POST | `/v1/order` | Create order |
| DELETE | `/v1/order` | Cancel order |

---

## 📊 Implementation Phases

### Phase 1: Infrastructure & Foundation

- [x] Initialize monorepo with workspace configuration
- [x] Set up shared types package
- [x] Configure TypeScript with strict mode
- [x] Set up PostgreSQL database schema
- [x] Configure Redis for caching/sessions
- [x] Create environment configuration files

### Phase 2: Backend Server

- [x] JWT authentication (register, login, refresh)
- [x] User level management (Basic → Registered → Verified)
- [x] AES-256 encryption for API credentials
- [x] Kodiak API client implementation
- [x] REST API routes (auth, user, market, strategies, bot)
- [x] WebSocket server for real-time updates
- [x] Rate limiting and security middleware

### Phase 3: Frontend Dashboard

- [x] React 18 + Vite + TypeScript setup
- [x] Tailwind CSS with dark glassmorphism theme
- [x] Authentication pages (Login/Register)
- [x] Dashboard with portfolio overview
- [ ] Candlestick charts (recharts)
- [ ] Kodiak API client implementation
- [ ] Strategy management UI

### Phase 4: Bot Engine

- [ ] Core engine architecture
- [ ] Kodiak API client implementation
- [ ] Grid Trading Strategy implementation
- [ ] Risk management system
- [ ] Backend communication protocol
- [ ] Performance tracking

### Phase 5: Integration & Testing

- [ ] Frontend-Backend integration
- [ ] Backend-Bot integration
- [ ] End-to-end testing
- [ ] Security audit
- [ ] Performance optimization

### Phase 6: Deployment

- [ ] Nginx setup
- [ ] Production deployment
- [ ] Monitoring & logging

---

## 🎨 UI Design Specs

### Color Palette (Dark Mode)

| Color | Hex | Usage |
| ------- | ----- | ------- |
| Background | `#0a0a0f` | Main background |
| Surface | `#13131a` | Cards, panels |
| Primary | `#6366f1` | Actions, links |
| Success | `#10b981` | Profits, buy |
| Danger | `#ef4444` | Losses, sell |
| Text | `#e2e8f0` | Primary text |
| Text-muted | `#94a3b8` | Secondary text |

### Components

- Glassmorphism cards with backdrop blur
- Smooth Framer Motion animations
- Responsive layout (desktop-first)
- Real-time data updates
- Professional Trading Charts
- Strategy Management Tools

---

## 🤖 Grid Trading Strategy

### Strategy Parameters

| Parameter | Type | Description |
| ----------- | ------ | ------------- |
| symbol | string | Trading pair (e.g., PERP_BTC_USDC) |
| gridSize | number | Number of grid levels |
| orderQuantity | number | Size per order |
| gridRange | number | Price range percentage |
| takeProfit | number | Profit per grid |

### How It Works

1. Calculate price bands based on current price
2. Place limit orders at regular intervals
3. When order fills, place opposite order
4. Repeat to capture small profits

---

## ⚠️ Safety Features

- [ ] Position size limits per trade
- [ ] Max daily loss halt
- [ ] Emergency stop button
- [ ] Confirmation dialogs for large orders
- [ ] Comprehensive logging
- [ ] Real-time monitoring

---

## 📅 Implementation Order

1. **Week 1**: Infrastructure & Database
2. **Week 2**: Backend Authentication & API
3. **Week 3**: Frontend Core & Dashboard
4. **Week 4**: Bot Engine Core
5. **Week 5**: Integration & Testing
6. **Week 6**: Polish & Deployment

---

## 📝 Database Schema

### Users Table

```sql
id UUID PRIMARY KEY,
email VARCHAR(255) UNIQUE,
password_hash VARCHAR(255),
user_level VARCHAR(20), -- BASIC, REGISTERED, VERIFIED
created_at TIMESTAMP,
updated_at TIMESTAMP
```

### Kodiak Credentials Table

```sql
id UUID PRIMARY KEY,
user_id UUID REFERENCES users(id),
account_id VARCHAR(255),
api_key_encrypted TEXT,
secret_key_encrypted TEXT,
wallet_signature TEXT,
verified BOOLEAN,
created_at TIMESTAMP
```

### Strategies Table

```sql
id UUID PRIMARY KEY,
user_id UUID REFERENCES users(id),
name VARCHAR(255),
type VARCHAR(50), -- GRID, TREND, etc.
config JSONB,
active BOOLEAN,
created_at TIMESTAMP
```

### Trades Table

```sql
id UUID PRIMARY KEY,
user_id UUID REFERENCES users(id),
strategy_id UUID REFERENCES strategies(id),
order_id VARCHAR(255),
symbol VARCHAR(50),
side VARCHAR(10),
quantity DECIMAL,
price DECIMAL,
pnl DECIMAL,
status VARCHAR(20),
executed_at TIMESTAMP
```

---

## 🔐 Authentication Levels

| Level | Requirements | Access |
| ------- | -------------- | -------- |
| **Basic** | Email + Password | Platform access, market data |
| **Registered** | Kodiak API keys | Trading data, positions |
| **Verified** | Wallet signature | Full access, bot control |

---

## 🚀 Getting Started

```bash
# Clone the repository
git clone <repo-url>
cd trade-bot

# Install dependencies
cd frontend && npm install
cd ../backend && npm install
cd ../engine/kodiak && npm install
cd ../shared && npm install

# Start development environment
cd shared && npm build
cd ../engine/kodiak && npm build
cd ../backend && npm run dev
cd frontend && npm run dev
```

---

## 📚 Resources

- [Kodiak/Orderly Documentation](https://docs.orderly.network/)
- [Berachain Documentation](https://docs.berachain.com/)
- [AI Assistant Guide](./AI_ASSISTANT_GUIDE.md)

---

**Last Updated**: January 11, 2026
**Version**: 1.0.0
