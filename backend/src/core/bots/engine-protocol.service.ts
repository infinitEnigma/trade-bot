/**
 * Engine Protocol Service - Redis Streams control plane (Backend ⇄ Engine)
 *
 * Implements the protocol defined in `@trade-bot/shared/src/protocol`:
 * - Sends commands to `tradebot:engine:commands`
 * - Consumes events from `tradebot:engine:events` (consumer group, manual ack)
 *
 * Design notes:
 * - Commands persist in the stream until consumed (at-least-once delivery).
 * - Every message carries messageId (dedup) and correlationId (tracing).
 * - Events are acked only AFTER the handler completes.
 * - No credentials/secrets ever flow through this protocol.
 *
 * @format
 */

import {
  BotCommandPayload,
  BotCommandType,
  BotEvent,
  EngineCommand,
  EngineEvent,
  ProtocolMessage,
  createBotCommand,
  isBotEvent,
  isEngineLedgerEventType,
} from "@trade-bot/shared";
import { redisLogger as logger } from "../../core/logging/context-aware-logger.service";

// ===========================================
// STREAM NAMES & CONSUMER GROUPS
// ===========================================

export const BOT_COMMANDS_STREAM = "tradebot:engine:commands";
export const BOT_EVENTS_STREAM = "tradebot:engine:events";

/** Consumer group the backend uses to read engine events. */
export const BACKEND_EVENTS_CONSUMER_GROUP = "backend-group";
/** Consumer group the engine uses to read backend commands. */
export const ENGINE_COMMANDS_CONSUMER_GROUP = "engine-workers";

/** Bounded size for the backend-side event deduplication set. */
const DEDUP_SET_MAX_SIZE = 10_000;

/** Minimum idle time before a pending event is claimed by XAUTOCLAIM. */
export const PENDING_RECOVERY_MIN_IDLE_MS = Number(
  process.env.PENDING_RECOVERY_MIN_IDLE_MS ?? 60_000
);
/** How often the event loop attempts a pending-event recovery pass. */
const PENDING_RECOVERY_INTERVAL_MS = Number(
  process.env.PENDING_RECOVERY_INTERVAL_MS ?? 30_000
);
/** Pending entries idle at least this long count as "stuck" for backlog alerts. */
export const PENDING_STUCK_ALERT_THRESHOLD_MS = Number(
  process.env.PENDING_STUCK_ALERT_THRESHOLD_MS ?? 30_000
);
/** Number of stuck pending entries before a backlog warning is logged. */
export const PENDING_ALERT_THRESHOLD = Number(
  process.env.PENDING_ALERT_THRESHOLD ?? 5
);
/** Redelivery count at which a pending entry is flagged as a poison message. */
export const PENDING_POISON_MAX_DELIVERIES = Number(
  process.env.PENDING_POISON_MAX_DELIVERIES ?? 10
);

/**
 * Wire shapes rebuilt from `infrastructure/cache/redis/{streams,connection-manager}.ts`
 * using shared protocol types, so core never imports the concrete Redis classes.
 * The concrete adapters stay structurally assignable to these ports.
 */
export interface EngineProtocolStreamMessage {
  id: string;
  data: ProtocolMessage<unknown> | EngineCommand | EngineEvent;
}

export interface EngineProtocolReadOptions {
  block?: number;
  count?: number;
  consumerGroup?: string;
  consumerName?: string;
}

export interface EngineProtocolPendingInsight {
  pendingTotal: number;
  stuckCount: number;
  oldestStuckIdleMs: number;
  maxDeliveries: number;
  poisonIds: string[];
}

/** Port: Redis connection lifecycle. Implemented by `RedisConnectionManager`. */
export interface IEngineProtocolRedisConnection {
  connect(): Promise<void>;
}

/** Port: Redis stream operations. Implemented by `RedisStreamOperations`. */
export interface IEngineProtocolRedisStreams {
  publish(
    stream: string,
    message: ProtocolMessage<unknown> | EngineCommand | EngineEvent
  ): Promise<{ success: boolean; id?: string; error?: string }>;
  read(
    stream: string,
    options?: EngineProtocolReadOptions
  ): Promise<{
    success: boolean;
    messages?: EngineProtocolStreamMessage[];
    error?: string;
  }>;
  ack(
    stream: string,
    consumerGroup: string,
    messageIds: string | string[]
  ): Promise<{ success: boolean; count?: number; error?: string }>;
  claimPending(
    stream: string,
    consumerGroup: string,
    consumerName: string,
    minIdleMs: number,
    count?: number
  ): Promise<{
    success: boolean;
    messages?: EngineProtocolStreamMessage[];
    error?: string;
  }>;
  getPendingInsight(
    stream: string,
    consumerGroup: string,
    options: {
      stuckThresholdMs: number;
      poisonThreshold: number;
      maxScan?: number;
    }
  ): Promise<EngineProtocolPendingInsight>;
  getPendingDeliveries(
    stream: string,
    consumerGroup: string,
    messageId: string
  ): Promise<number>;
  isMessageProcessed(scope: string, messageId: string): Promise<boolean>;
  markMessageProcessed(
    scope: string,
    messageId: string,
    ttlSeconds?: number
  ): Promise<boolean>;
  createConsumerGroup(
    stream: string,
    consumerGroup: string,
    startId?: string
  ): Promise<{ success: boolean; error?: string }>;
}

export interface EngineProtocolServiceDependencies {
  streamOperations?: IEngineProtocolRedisStreams;
  connectionManager?: IEngineProtocolRedisConnection;
  consumerName?: string;
  /** Durable integrity alert raised when a financial event hits the poison
   * threshold and must remain pending for recovery. Wired at the composition
   * root (index.ts) to write an operator-visible alert (e.g. bot_lifecycle_events).
   * Optional: when unset, no alert is raised and the event stays pending. */
  integrityAlertHandler?: (
    event: BotEvent,
    deliveries: number
  ) => Promise<void>;
}

/**
 * Module-level Redis deps the no-arg singleton uses by default. Wired at
 * startup (index.ts `setEngineProtocolRedisDeps`, BEFORE `start()` is called);
 * core never constructs the concrete adapters itself.
 */
let defaultRedisDeps: EngineProtocolServiceDependencies = {};

/** Startup wiring for the engine-protocol Redis ports. */
export function setEngineProtocolRedisDeps(
  deps: EngineProtocolServiceDependencies
): void {
  defaultRedisDeps = deps;
}

export interface SendCommandResult {
  success: boolean;
  messageId?: string;
  correlationId?: string;
  error?: string;
}

export type BotEventHandler = (event: BotEvent) => Promise<void> | void;

/**
 * Backend-side half of the engine control protocol.
 *
 * Owns the Redis Streams plumbing for commands/events and the event
 * consumer loop. Lifecycle policy (transitions, persistence) lives in
 * BotLifecycleService; this class knows nothing about it.
 */
export class EngineProtocolService {
  private readonly deps: EngineProtocolServiceDependencies;
  private consumerName: string;
  private eventHandler: BotEventHandler | null = null;
  /** Durable integrity alert callback — wired by the composition root. */
  private integrityAlertHandler: ((event: BotEvent, deliveries: number) => Promise<void>) | null = null;
  private isListening = false;
  /** Recently processed event messageIds for at-least-once deduplication. */
  private processedMessageIds: Set<string> = new Set();
  /** Scope for the durable (Redis-backed) dedup markers. */
  private readonly dedupScope = "backend-engine-events";

  constructor(deps: EngineProtocolServiceDependencies = {}) {
    this.deps = deps;
    this.consumerName = deps.consumerName ?? "backend-consumer";
    this.integrityAlertHandler = deps.integrityAlertHandler ?? null;
  }

  /**
   * Fail-fast accessor for the connection port: instance deps first, then the
   * module-level defaults wired at startup. An unwired port must never no-op.
   */
  private get connectionManager(): IEngineProtocolRedisConnection {
    const impl =
      this.deps.connectionManager ?? defaultRedisDeps.connectionManager;
    if (!impl) {
      throw new Error(
        "Engine protocol Redis deps not wired — call setEngineProtocolRedisDeps() at startup"
      );
    }
    return impl;
  }

  /** Fail-fast accessor for the stream port (same wiring as above). */
  private get streamOperations(): IEngineProtocolRedisStreams {
    const impl =
      this.deps.streamOperations ?? defaultRedisDeps.streamOperations;
    if (!impl) {
      throw new Error(
        "Engine protocol Redis deps not wired — call setEngineProtocolRedisDeps() at startup"
      );
    }
    return impl;
  }

  // ===========================================
  // LIFECYCLE
  // ===========================================

  /**
   * Connect to Redis, ensure the consumer group exists and start the
   * event listener loop with the given handler.
   */
  async start(eventHandler: BotEventHandler): Promise<void> {
    if (this.isListening) {
      logger.debug("Engine protocol already listening");
      return;
    }

    this.eventHandler = eventHandler;

    await this.connectionManager.connect();
    await this.streamOperations.createConsumerGroup(
      BOT_EVENTS_STREAM,
      BACKEND_EVENTS_CONSUMER_GROUP
    );

    this.isListening = true;
    // Fire-and-forget: the loop runs for the lifetime of the process.
    void this.eventListenerLoop();
    logger.info("Engine protocol service started", {
      commandsStream: BOT_COMMANDS_STREAM,
      eventsStream: BOT_EVENTS_STREAM,
    });
  }

  /**
   * Stop consuming engine events. In-flight messages are left unacked
   * and will be redelivered on the next start.
   */
  stop(): void {
    this.isListening = false;
    this.eventHandler = null;
    logger.info("Engine protocol service stopped");
  }

  // ===========================================
  // COMMANDS (Backend → Engine)
  // ===========================================

  /**
   * Publish a lifecycle command to the engine.
   * Returns the envelope ids so callers can correlate acknowledgements.
   */
  async sendCommand<P extends BotCommandPayload>(
    type: BotCommandType,
    payload: P,
    correlationId?: string
  ): Promise<SendCommandResult> {
    const command: ProtocolMessage<P> = createBotCommand<P>(
      type,
      payload,
      correlationId
    );

    const result = await this.streamOperations.publish(
      BOT_COMMANDS_STREAM,
      command
    );

    if (!result.success) {
      logger.error("Failed to publish bot command", undefined, {
        type,
        botId: (payload as { botId?: string }).botId,
        error: result.error,
      });
      return {
        success: false,
        error: result.error,
        correlationId: command.correlationId,
      };
    }

    logger.info("Bot command published", {
      type,
      botId: (payload as { botId?: string }).botId,
      messageId: command.messageId,
      correlationId: command.correlationId,
      streamId: result.id,
    });

    return {
      success: true,
      messageId: command.messageId,
      correlationId: command.correlationId,
    };
  }
  // ===========================================
  // EVENT CONSUMER LOOP
  // ===========================================

  private async eventListenerLoop(): Promise<void> {
    let lastRecoveryAt = 0;
    while (this.isListening) {
      try {
        const result = await this.streamOperations.read(BOT_EVENTS_STREAM, {
          block: 1000,
          count: 10,
          consumerGroup: BACKEND_EVENTS_CONSUMER_GROUP,
          consumerName: this.consumerName,
        });

        // Process any newly delivered events first.
        if (result.success && result.messages) {
          for (const message of result.messages) {
            await this.processEventMessage(message.id, message.data);
          }
        }

        // Reclaim pending events on a time-based schedule regardless of
        // traffic. Pending-ledger events (left unacked by the financial-event
        // poison guard) must be retried even when the stream is continuously
        // busy; `recoverPendingEvents` is internally rate-limited to
        // PENDING_RECOVERY_INTERVAL_MS so this is never a hot loop.
        await this.recoverPendingEvents(lastRecoveryAt).then(recovered => {
          if (recovered) {
            lastRecoveryAt = Date.now();
          }
        });
      } catch (error) {
        if (this.isListening) {
          logger.error("Error reading engine events", undefined, {
            error: error instanceof Error ? error.message : String(error),
          });
          // Avoid hot-spinning on persistent Redis failures.
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
  }

  /**
   * Claim and process pending events that a previous backend consumer read
   * but never acked (crash before ACK). Rate-limited to one XAUTOCLAIM scan
   * per recovery interval; only messages idle beyond PENDING_RECOVERY_MIN_IDLE_MS
   * are claimed so healthy in-flight processing is never disturbed.
   * Returns true if a recovery pass ran.
   */
  private async recoverPendingEvents(lastRecoveryAt: number): Promise<boolean> {
    const now = Date.now();
    if (now - lastRecoveryAt < PENDING_RECOVERY_INTERVAL_MS) {
      return false;
    }
    const result = await this.streamOperations.claimPending(
      BOT_EVENTS_STREAM,
      BACKEND_EVENTS_CONSUMER_GROUP,
      this.consumerName,
      PENDING_RECOVERY_MIN_IDLE_MS
    );
    if (result.success && result.messages) {
      for (const message of result.messages) {
        await this.processEventMessage(message.id, message.data);
      }
    }
    await this.logPendingInsight();
    return true;
  }

  /**
   * Observability pass over the events PEL: log the backlog depth and flag
   * stuck entries / poison messages (redelivered >= PENDING_POISON_MAX_DELIVERIES
   * times without ever being ACKed). Poison entries are logged, not dropped -
   * at-least-once delivery is preserved; the warn exists so operators notice
   * a handler that keeps failing for the same event.
   */
  private async logPendingInsight(): Promise<void> {
    try {
      const insight = await this.streamOperations.getPendingInsight(
        BOT_EVENTS_STREAM,
        BACKEND_EVENTS_CONSUMER_GROUP,
        {
          stuckThresholdMs: PENDING_STUCK_ALERT_THRESHOLD_MS,
          poisonThreshold: PENDING_POISON_MAX_DELIVERIES,
        }
      );
      logger.debug("Pending event queue insight", {
        stream: BOT_EVENTS_STREAM,
        consumerGroup: BACKEND_EVENTS_CONSUMER_GROUP,
        ...insight,
      });
      if (insight.stuckCount >= PENDING_ALERT_THRESHOLD) {
        logger.warn("Pending event backlog detected", {
          stream: BOT_EVENTS_STREAM,
          consumerGroup: BACKEND_EVENTS_CONSUMER_GROUP,
          stuckCount: insight.stuckCount,
          oldestStuckIdleMs: insight.oldestStuckIdleMs,
          pendingTotal: insight.pendingTotal,
        });
      }
      if (insight.poisonIds.length > 0) {
        logger.warn(
          "Poison engine events detected (repeated redelivery without ACK)",
          {
            stream: BOT_EVENTS_STREAM,
            consumerGroup: BACKEND_EVENTS_CONSUMER_GROUP,
            poisonIds: insight.poisonIds,
            maxDeliveries: insight.maxDeliveries,
          }
        );
      }
    } catch (error) {
      // Observability must never break the recovery loop.
      logger.debug("Pending insight check failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async processEventMessage(
    streamId: string,
    data: unknown
  ): Promise<void> {
    if (!isBotEvent(data)) {
      logger.warn("Ignoring malformed engine event", { streamId });
      await this.safeAck(streamId);
      return;
    }

    // Durable deduplication (survives restarts, Redis-backed with TTL).
    if (await this.alreadyProcessed(data.messageId)) {
      logger.debug("Duplicate engine event ignored", {
        messageId: data.messageId,
        type: data.type,
      });
      await this.safeAck(streamId);
      return;
    }

    try {
      if (this.eventHandler) {
        await this.eventHandler(data);
      }

      await this.markProcessed(data.messageId);

      await this.safeAck(streamId);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // L22/L25: cap the redelivery loop. A handler that keeps throwing for
      // the same event is a poison message (e.g. an event that cannot be
      // applied to the bot's current state); leaving it unacked forever makes
      // the PEL spin once per pending-recovery pass. Past the threshold the
      // entry is alert-and-dropped so it cannot bury the stream.
      //
      // Ledger events (ORDER_INTENT / TRADE_EXECUTED / POSITION_UPDATED /
      // PERFORMANCE_SNAPSHOT) contribute durable financial state and must
      // never be declared processed merely because persistence keeps failing.
      // The ledger's unique key makes redelivery idempotent, so leaving the
      // message pending preserves at-least-once delivery until an explicit
      // reconciliation resolves it. Non-ledger events retain the bounded
      // poison-handling where dropping is appropriate.
      const isLedgerEvent = isEngineLedgerEventType(data.type);
      const deliveries = await this.pendingDeliveries(streamId);
      if (deliveries >= PENDING_POISON_MAX_DELIVERIES) {
        if (isLedgerEvent) {
          logger.error(
            "Persistent financial-event failure: event left unacked for recovery",
            undefined,
            {
              streamId,
              messageId: data.messageId,
              eventType: data.type,
              financialEvent: true,
              deliveries,
              maxDeliveries: PENDING_POISON_MAX_DELIVERIES,
              error: errorMessage,
            }
          );
          // Raise a durable integrity alert so operators can see the stuck
          // financial event — it is not silently left pending with only a log
          // line. Observability failure must never break the recovery loop.
          if (this.integrityAlertHandler) {
            try {
              await this.integrityAlertHandler(data, deliveries);
            } catch (alertError) {
              logger.error(
                "Integrity alert handler failed",
                alertError as Error,
                {
                  streamId,
                  messageId: data.messageId,
                  eventType: data.type,
                }
              );
            }
          }
          // Intentionally neither markProcessed() nor safeAck(): the message
          // stays pending so pending-event recovery can redeliver it once the
          // persistence problem is fixed. Do not blindly replay — reconcile
          // against the durable ledger first if a prior delivery may have
          // already booked the fill.
          return;
        }
        logger.error(
          "Poison engine event ACKed and dropped after repeated redelivery",
          undefined,
          {
            streamId,
            messageId: data.messageId,
            eventType: data.type,
            deliveries,
            maxDeliveries: PENDING_POISON_MAX_DELIVERIES,
            error: errorMessage,
          }
        );
        await this.markProcessed(data.messageId);
        await this.safeAck(streamId);
        return;
      }

      logger.error(
        "Engine event handler failed, message left unacked for redelivery",
        undefined,
        {
          streamId,
          messageId: data.messageId,
          eventType: data.type,
          error: errorMessage,
        }
      );
    }
  }

  /** Redelivery counter for one pending entry; 0 when unknown (keep retrying). */
  private async pendingDeliveries(streamId: string): Promise<number> {
    try {
      return await this.streamOperations.getPendingDeliveries(
        BOT_EVENTS_STREAM,
        BACKEND_EVENTS_CONSUMER_GROUP,
        streamId
      );
    } catch (error) {
      logger.debug("Pending deliveries lookup failed", {
        streamId,
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /** Durable (Redis) plus in-memory fallback dedup check. */
  private async alreadyProcessed(messageId: string): Promise<boolean> {
    if (this.processedMessageIds.has(messageId)) {
      return true;
    }
    try {
      return await this.streamOperations.isMessageProcessed(
        this.dedupScope,
        messageId
      );
    } catch (error) {
      logger.error(
        "Dedup marker read failed — failing open",
        error as Error,
        { scope: this.dedupScope, messageId }
      );
      return false; // fail open: let the handler run; repository idempotency is the backstop
    }
  }

  private async markProcessed(messageId: string): Promise<void> {
    this.processedMessageIds.add(messageId);
    if (this.processedMessageIds.size > DEDUP_SET_MAX_SIZE) {
      this.processedMessageIds = new Set(
        Array.from(this.processedMessageIds).slice(-DEDUP_SET_MAX_SIZE / 2)
      );
    }
    try {
      await this.streamOperations.markMessageProcessed(
        this.dedupScope,
        messageId
      );
    } catch (error) {
      // Dedup marker write failure must not be treated as a handler failure.
      // Fail open: the in-memory marker is set, so this process won't
      // reprocess the message; the Redis marker will be retried on the next
      // delivery of the same messageId. Repository-level idempotency is the
      // backstop against duplicate financial effects.
      logger.error(
        "Dedup marker write failed — failing open",
        error as Error,
        { scope: this.dedupScope, messageId }
      );
    }
  }

  private async safeAck(streamId: string): Promise<void> {
    const ackResult = await this.streamOperations.ack(
      BOT_EVENTS_STREAM,
      BACKEND_EVENTS_CONSUMER_GROUP,
      streamId
    );
    if (!ackResult.success) {
      logger.warn("Failed to ack engine event", {
        streamId,
        error: ackResult.error,
      });
    }
  }
}

// ===========================================
// SINGLETON
// ===========================================

// Singleton instance
export const engineProtocolService = new EngineProtocolService();
