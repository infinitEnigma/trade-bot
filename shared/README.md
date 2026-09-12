# Shared Package

**Cross-Package TypeScript Contracts for Trade Bot**

---

## Overview

The `@trade-bot/shared` package contains **chain- and exchange-agnostic** TypeScript types and interfaces shared between the frontend, backend, and engine packages. It serves as the single source of truth for the communication contracts between all packages.

> **⚠️ Known Issue**: This package has become a "god package" containing protocol types, domain models, API contracts, error classes, and logging types. It should be split into focused modules (see P2 issue below).

---

## Structure

```
shared/src/
├── index.ts              # Main barrel export
├── protocol/             # Bot lifecycle protocol types
│   ├── bot-state.ts      # State machine & transitions
│   ├── bot-command.ts    # Command types & envelope
│   ├── bot-event.ts      # Event types
│   └── engine-lifecycle.ts # Engine registration & heartbeat
└── types/                # Domain models & contracts
    ├── domain.ts         # Rich domain models (Position, etc.)
    ├── infrastructure.ts # Infrastructure contracts
    ├── errors.ts         # Error classes
    ├── logging.ts        # Logging types
    ├── repositories.ts   # Repository interfaces
    ├── role-management.ts # Role types
    ├── engine-contract.ts # Engine integration contract
    └── frontend-backend-contract.ts # API DTOs
```

---

## Protocol Types

The `protocol/` directory defines the Backend ↔ Engine communication protocol:

### Bot State Machine (`bot-state.ts`)

```typescript
type BotActualState = "STOPPED" | "STARTING" | "RUNNING" | "STOPPING" | "ERROR" | "UNKNOWN";
type BotDesiredState = "RUNNING" | "STOPPED";

// Valid transitions
const VALID_TRANSITIONS: Record<BotActualState, BotActualState[]> = {
    STOPPED: ["STARTING"],
    STARTING: ["RUNNING", "STOPPED", "ERROR"],
    RUNNING: ["STOPPING", "ERROR", "UNKNOWN"],
    STOPPING: ["STOPPED", "ERROR"],
    UNKNOWN: ["RUNNING", "STOPPED", "ERROR"],
    ERROR: ["STARTING", "STOPPED"],
};
```

### Protocol Envelope (`bot-command.ts`)

```typescript
interface ProtocolMessage<T> {
    version: 1;
    messageId: string;      // Unique per message (deduplication)
    correlationId: string;  // Groups command with its events
    timestamp: string;      // ISO-8601
    type: string;
    payload: T;
}

// Command types
type BotCommandType = "BOT_START" | "BOT_STOP" | "BOT_STATUS_REQUEST";
```

### Bot Events (`bot-event.ts`)

```typescript
type BotEventType = "COMMAND_ACCEPTED" | "COMMAND_FAILED" | "STATE_CHANGED" | "ENGINE_REGISTER" | "ENGINE_HEARTBEAT";
```

### Engine Lifecycle (`engine-lifecycle.ts`)

```typescript
interface EngineRegisterEventPayload {
    engineId: string;
    epoch: number;          // Monotonically increasing on restart
    version: string;
    startedAt: string;
}

interface EngineHeartbeatEventPayload {
    engineId: string;
    epoch: number;
    activeBotIds: string[]; // Runtime inventory for reconciliation
    version: string;
}
```

---

## Usage

```typescript
import {
    // Protocol types
    BotActualState,
    BotDesiredState,
    BotCommand,
    BotEvent,
    createBotCommand,
    createBotEvent,
    assertTransition,
    isBotCommand,
    isBotEvent,
    // Domain types
    User,
    Strategy,
    Order,
    // Error classes
    AppError,
    ValidationError,
} from "@trade-bot/shared";
```

---

## Known Issues

| Priority | Issue | Description |
|----------|-------|-------------|
| 🟡 P2 | God Package | Contains too many unrelated types. Should be split into `@trade-bot/protocol`, `@trade-bot/domain`, `@trade-bot/contracts`. |
| 🟡 P2 | Legacy Models | Contains both old (`BotStatus.status: RUNNING | STOPPED | ERROR`) and new lifecycle state models. Should be consolidated. |

---

## Building

```bash
npm run build    # Build ESM and CJS outputs
npm run dev      # Watch mode
npm run test     # Run tests
```

---

**Shared Status**: Functional | **Version**: 1.0.0 | **Updated**: September 12, 2026
