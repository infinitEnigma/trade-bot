# Trade Bot

**Automated Perpetual Futures Trading Platform for Berachain**

[![License: Apache](https://img.shields.io/badge/License-Apache-yellow.svg)](LICENSE)
[![Node Version](https://img.shields.io/badge/node-%3E%3D25.0.0-brightgreen)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](tsconfig.json)

---

## Overview

Trade Bot is a **production-ready, full-stack automated trading platform** for perpetual futures on Berachain. It enables users to deploy algorithmic trading strategies with a modular architecture featuring a React 19 frontend, Node.js 25 Express backend, and independent trading engine.

| Component | Technology | Status | Documentation |
|-----------|-----------|--------|---------------|
| **Network** | Berachain Mainnet (80094) | ✅ Live | - |
| **Exchange** | Kodiak (Orderly) | ✅ Integrated | - |
| **Frontend** | React 19 + Vite + Tailwind CSS | ✅ Complete | [📖 Frontend Docs](frontend/README.md) |
| **Backend** | Express.js + PostgreSQL + Redis | ✅ Complete | [📖 Backend Docs](backend/README.md) |
| **Trading Engine** | TypeScript (Node.js) | ✅ Operational | [📖 Engine Docs](engine/kodiak/README.md) |
| **Deployment** | Bare Metal Server | ✅ Ready | - |

---

## Quick Start

### Prerequisites
- Node.js ≥ 25.0.9
- PostgreSQL 14+
- Redis 5.0+

### Installation & Development

```bash
# Clone and install dependencies
git clone <repo-url> && cd trade-bot
npm install

# Configure environment
cp .env.example .env
# Edit .env with your database, Redis, and API credentials

# Run database migrations
npm run db:migrate

# Start all services
npm run dev

# Or start individual services
npm run dev:frontend   # http://localhost:5173
npm run dev:backend    # http://localhost:3000
npm run dev:engine     # Trading bot engine
```

### Production Build

```bash
npm run build          # Build all packages
npm start              # Start production server
```

---

## Architecture

```
┌────────────────────────────────────────────────────┐
│              Bare Metal Server                     │
├────────────────────────────────────────────────────┤
│                                                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────┐  │
│  │  Frontend    │  │   Backend    │  │  Engine  │  │
│  │  React 19    │  │  Express.js  │  │ Trading  │  │
│  │  + Vite      │  │  Node.js 25  │  │  Bot     │  │
│  └──────────────┘  └──────────────┘  └──────────┘  │
│       │                   │                 │      │
│       └───────────────────┼─────────────────┘      │
│                           ▼                        │
│                ┌──────────────────────┐            │
│                │  PostgreSQL + Redis  │            │
│                └──────────────────────┘            │
│                                                    │
└────────────────────────────────────────────────────┘
                      │
                      ▼
            ┌──────────────────────┐
            │ Kodiak/Orderly API   │
            │ (Berachain Mainnet)  │
            └──────────────────────┘
```

### Monorepo Packages

| Package | Purpose | Status |
|---------|---------|--------|
| `frontend/` | React 19 UI dashboard with real-time charts | ✅ Production |
| `backend/` | Express.js REST/WebSocket API server | ✅ Production |
| `engine/kodiak/` | Independent trading bot engine | ✅ Production |
| `shared/` | Shared TypeScript type definitions | ✅ Complete |
| `database/` | PostgreSQL migrations & schema | ✅ Complete |

---

## Technology Stack

### Frontend
- **React 19.2** - UI framework with hooks
- **Vite** - Fast build tool with HMR
- **TypeScript 5** - Type-safe development
- **Tailwind CSS 4** - Utility-first styling
- **React Router 7** - Client-side routing
- **Zustand** - Lightweight state management
- **Recharts + Lightweight Charts** - Market data visualization
- **Socket.IO** - Real-time bot status updates

### Backend
- **Node.js 25** - JavaScript runtime
- **Express.js 5** - REST API framework
- **TypeScript 5** - Type-safe backend code
- **PostgreSQL 14+** - Primary data store
- **Redis 5** - Caching & rate limiting
- **JWT + bcrypt** - Authentication & security
- **Helmet** - HTTP security headers
- **Winston** - Structured logging with rotation

### Trading Engine
- **TypeScript 5** - Type-safe trading logic
- **node-cron** - Periodic strategy execution
- **PostgreSQL** - Trade persistence
- **WebSocket (ws)** - Kodiak market feeds
- **Winston** - Trade execution logging

---

## 📖 Detailed Documentation

- **[🎨 Frontend Documentation](frontend/README.md)** - React UI setup, components, and development
- **[⚙️ Backend Documentation](backend/README.md)** - API reference, database setup, and server configuration
- **[🤖 Trading Engine Documentation](engine/kodiak/README.md)** - Strategy implementation, bot management, and configuration
- **[🗄️ Database Setup](DATABASE_SETUP.md)** - PostgreSQL schema and migrations
- **[🚀 Deployment Guide](docs/DEPLOYMENT_SETUP.md)** - Production deployment instructions

---

## Development

### Project Structure

```
trade-bot/
├── frontend/              # React 19 UI application
│   ├── README.md         # Frontend documentation
│   ├── src/pages/        # Route components
│   ├── src/components/   # Reusable UI components
│   └── src/lib/api.ts    # API client
│
├── backend/              # Express.js API server
│   ├── README.md        # Backend documentation
│   ├── src/routes/      # API endpoint handlers
│   ├── src/services/    # Business logic
│   └── src/database/    # Database pool & migrations
│
├── engine/kodiak/       # Trading bot engine
│   ├── README.md       # Engine documentation
│   ├── src/strategies/ # Strategy implementations
│   └── src/services/   # Orderly API client
│
├── shared/              # Shared TypeScript types
├── database/            # PostgreSQL migrations
└── docs/               # Additional documentation
```

### Scripts

```bash
# Development
npm run dev              # Start all services
npm run dev:frontend    # Frontend only (Vite)
npm run dev:backend     # Backend only with auto-reload
npm run dev:engine      # Bot engine only

# Building
npm run build           # Build all packages

# Testing
npm run test            # Run full test suite
```

---

## Security

- ✅ **A+ SSL Rating** (SSL Labs)
- ✅ **JWT Authentication** with encrypted storage
- ✅ **Rate Limiting** (100 req/15s per IP)
- ✅ **CORS Protection** with origin validation
- ✅ **Helmet Security Headers**
- ✅ **SQL Injection Protection**
- ✅ **Password Hashing** (bcrypt 12 rounds)
- ✅ **HSTS Enabled** with preload support

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Commit changes: `git commit -am 'Add feature'`
4. Push branch: `git push origin feature/your-feature`
5. Open a pull request

### Code Standards
- TypeScript strict mode enabled
- ESLint configuration enforced
- Prettier formatting on commit
- Comprehensive error handling
- Detailed logging for debugging

---

## Roadmap

### Q1 2026
- [ ] Trend Following strategy
- [ ] Daily loss halt circuit breaker
- [ ] Expand test coverage to >80%
- [ ] Email verification enforcement

### Q2 2026
- [ ] Arbitrage strategy
- [ ] Backtesting framework
- [ ] Analytics dashboard

### Q3 2026
- [ ] Horizontal scaling
- [ ] Advanced risk management
- [ ] Mobile app support

---

## License

Apache License 2.0 - See [LICENSE](LICENSE) for details

---

## Resources

- **[Kodiak/Orderly Documentation](https://docs.orderly.network/)**
- **[Berachain Documentation](https://docs.berachain.com/)**
- **[TypeScript Documentation](https://www.typescriptlang.org/)**

---

**Status**: Production Ready | **Version**: 1.0.0 | **Updated**: January 17, 2026
