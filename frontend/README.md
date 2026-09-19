# Frontend React Application

**React 19 UI Dashboard for Trade Bot with Real-Time Updates**

[![React](https://img.shields.io/badge/React-19.2-blue)](package.json)
[![Vite](https://img.shields.io/badge/Vite-7.x-646CFF)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](package.json)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4.x-38B2AC)](package.json)

---

## Overview

The frontend is a modern React 19 single-page application (SPA) built with Vite, providing a real-time trading dashboard with bot management, strategy configuration, and market data visualization. It is **chain- and exchange-agnostic** - supporting multiple blockchains and exchanges through the backend's pluggable architecture.

### Key Features

- **Real-Time Bot Updates** - Socket.IO connection for live bot state changes (market data is fetched over HTTP)
- **Bot Management** - Start/stop bots with desired-state semantics (202 Accepted pattern)
- **Strategy Configuration** - Visual strategy parameter configuration
- **Market Data** - Price feeds, TradingView history, and market statistics sourced from Kodiak public endpoints
- **Authentication** - Secure JWT-based user authentication with refresh tokens
- **Wallet Authentication** - Connect a browser wallet and sign the welcome message (wagmi + viem) to upgrade `BASIC → REGISTERED`
- **Responsive Design** - Mobile-first design with Tailwind CSS
- **Tiered Access** - BASIC / REGISTERED / VERIFIED gating, plus an admin dashboard for admins

---

## User Access Tiers

The UI adapts to the authenticated user's access level, which is enforced server-side:

| Level          | How it is reached                                                                | What the UI exposes                                                                                                                    |
| -------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **BASIC**      | Email + password sign-up / sign-in                                               | Public market data, charts, dashboard pages. The Dashboard wallet widget is shown to every level so BASIC users can start the upgrade. |
| **REGISTERED** | Connect a wallet in the Dashboard widget and sign the welcome message            | Kodiak credential form in Settings becomes active                                                                                      |
| **VERIFIED**   | Provide exchange (Kodiak) API credentials in Settings; the backend verifies them | Trading strategies, bot configuration, private/exchange-specific data                                                                  |

```
BASIC ─connect wallet + sign message──▶ REGISTERED ──verify exchange keys in Settings──▶ VERIFIED
```

The Dashboard wallet widget (`shared/components/WalletConnectDialog.tsx`) is rendered for **all** authenticated users; in `BASIC` it drives the connect-and-sign upgrade, and in `REGISTERED`/`VERIFIED` it acts as an ownership-confirmation and status widget.

Two distinct wallet actions are intentionally separated:

- **Disconnect** - ends the browser wallet session only (wagmi `useDisconnect`). It does **not** change the account level.
- **Unlink wallet** - an explicit, audited call to `POST /api/user/unlink-wallet` that removes the linked wallet and downgrades the account level (`VERIFIED → REGISTERED`, `REGISTERED → BASIC`).

---

## Architecture

```
frontend/src/
├── features/              # Domain-driven feature modules
│   ├── auth/              # Authentication (login, register, profile)
│   ├── bots/              # Bot lifecycle management hooks
│   ├── dashboard/         # Main dashboard view
│   ├── strategies/        # Strategy management
│   ├── analytics/         # Performance analytics
│   ├── settings/          # User settings, Kodiak credentials
│   ├── admin/             # Admin dashboard
│   └── landing/           # Public landing page
├── infrastructure/        # Technical capabilities
│   ├── api/               # HTTP API client (Axios)
│   ├── websocket/         # Socket.IO client
│   ├── cache/             # Memory caching
│   └── config.ts          # App configuration
├── shared/                # Reusable UI components
│   ├── components/        # UI components (charts, forms, layout, wallet)
│   │   └── WalletConnectDialog.tsx  # Tier upgrade: connect + sign, unlink, status
│   ├── hooks/             # Shared React hooks
│   ├── services/          # Balance, analytics managers
│   └── utils/             # Utility functions
└── contexts/              # React contexts (theme, error)
```

### State Management

- **Zustand** - Lightweight global state management
- **TanStack Query** - Server state caching and synchronization
- **React Context** - Theme and error handling

### WebSocket Integration

The Socket.IO connection is established for **any authenticated user** (the access token is sent during the handshake). Per-event authorization is applied server-side, so lower tiers simply receive no privileged events. It carries:

- `bot.stateChanged` - Real-time bot lifecycle updates (only emitted for bots the user owns)

Market data is **not** streamed over the WebSocket. Prices, TradingView history, and statistics are fetched over HTTP from Kodiak public endpoints (via TanStack Query polling). The legacy Orderly `market-stream` client has been removed.

---

## Quick Start

### Prerequisites

- Node.js ≥ 25.0.9
- Backend API running (see [Backend Docs](../backend/README.md))

### Installation

```bash
cd frontend
npm install
```

### Configuration

Create `.env` in the frontend directory:

```bash
# API Configuration
VITE_API_URL=http://localhost:3000

# Development
VITE_NODE_ENV=development
```

### Development

```bash
# Start development server with hot reload
npm run dev

# Open in browser
# http://localhost:5173
```

### Building

```bash
# Build for production
npm run build

# Preview production build
npm run preview
```

### Testing

```bash
# Run the full suite once (CI-style, non-interactive)
npx vitest run

# Run in watch mode
npm test

# Run a single test file
npx vitest run src/test/unit/infrastructure/walletApi.test.ts

# Lint and formatting checks
npm run lint
npm run format:check
```

---

## Technology Stack

### Core Framework

- **React 19.2** - Latest React with concurrent features
- **TypeScript 5** - Full type safety and modern JavaScript features
- **Vite 7** - Fast build tool with HMR and optimized production builds

### UI & Styling

- **Tailwind CSS 4** - Utility-first CSS framework
- **Radix UI** - Accessible, unstyled UI components
- **Lucide React** - Beautiful icon library
- **Framer Motion** - Smooth animations and transitions

### Data & State Management

- **Zustand** - Lightweight, scalable state management
- **TanStack Query** - Powerful data fetching and caching
- **Axios** - HTTP client with interceptors
- **Socket.IO Client** - Real-time WebSocket communication

### Wallet / Web3

- **wagmi 3** - React hooks for Ethereum wallet connection, signing, and account state
- **viem** - Low-level Ethereum client used by wagmi
- **WalletConnectDialog** - Connects an injected browser wallet and signs the welcome message to upgrade the account from `BASIC` to `REGISTERED`; also exposes audited wallet unlinking

### Charts & Visualization

- **Lightweight Charts** - High-performance financial charts
- **Recharts** - React charting library for additional visualizations

---

## Bot Lifecycle Integration

The frontend interacts with the bot lifecycle system:

```
Frontend                    Backend                     Engine
   │                           │                          │
   ├── POST /api/bot/start ───▶│                          │
   │◀── 202 Accepted ──────────│                          │
   │   { desiredState: RUNNING │                          │
   │     actualState: STARTING }│                          │
   │                           ├── BOT_START command ────▶│
   │                           │                          │
   │◄══ WebSocket: bot.stateChanged (STARTING) ═══════════│
   │◄══ WebSocket: bot.stateChanged (RUNNING) ════════════│
   │                           │                          │
   ├── POST /api/bot/stop ────▶│                          │
   │◀── 202 Accepted ──────────│                          │
   │   { desiredState: STOPPED │                          │
   │     actualState: STOPPING }│                          │
   │                           ├── BOT_STOP command ─────▶│
   │                           │                          │
   │◄══ WebSocket: bot.stateChanged (STOPPING) ══════════│
   │◄══ WebSocket: bot.stateChanged (STOPPED) ═══════════│
```

---

## Code Standards

- **React**: Functional components with hooks
- **TypeScript**: Strict mode, no `any` types
- **Styling**: Tailwind CSS utility classes
- **Testing**: Vitest with React Testing Library
- **Performance**: Lazy loading and code splitting
- **Accessibility**: ARIA labels and keyboard navigation

---

**Frontend Status**: Functional | **React Version**: 19.2 | **Build Tool**: Vite 7 | **Updated**: September 14, 2026
