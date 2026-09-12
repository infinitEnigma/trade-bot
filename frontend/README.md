# Frontend React Application

**React 19 UI Dashboard for Trade Bot with Real-Time Updates**

[![React](https://img.shields.io/badge/React-19.2-blue)](package.json)
[![Vite](https://img.shields.io/badge/Vite-7.x-646CFF)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](package.json)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4.x-38B2AC)](package.json)

---

## Overview

The frontend is a modern React 19 single-page application (SPA) built with Vite, providing a real-time trading dashboard with bot management, strategy configuration, and market data visualization.

### Key Features

- **Real-Time Updates** - WebSocket connection for live bot state changes and market data
- **Bot Management** - Start/stop bots with desired-state semantics (202 Accepted pattern)
- **Strategy Configuration** - Visual strategy parameter configuration
- **Market Data** - Real-time price feeds and market statistics
- **Authentication** - Secure JWT-based user authentication with refresh tokens
- **Responsive Design** - Mobile-first design with Tailwind CSS
- **Role-Based Access** - Admin dashboard, qualified user features

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
│   ├── components/        # UI components (charts, forms, layout)
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

The WebSocket is only initialized for authenticated `VERIFIED` users. It receives:
- `bot.stateChanged` - Real-time bot lifecycle updates
- Market data streaming (when subscribed)

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
# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
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

**Frontend Status**: Functional | **React Version**: 19.2 | **Build Tool**: Vite 7 | **Updated**: September 12, 2026
