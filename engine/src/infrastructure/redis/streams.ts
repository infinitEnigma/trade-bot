import { createClient, RedisClientType } from "redis";
import { logger } from "../../utils/logger";
import { EngineCommand, EngineEvent, ProtocolMessage } from "@trade-bot/shared";

// Stream names (lifecycle control plane - see shared/src/protocol)
export const ENGINE_COMMANDS_STREAM = "tradebot:engine:commands";
export const ENGINE_EVENTS_STREAM = "tradebot:engine:events";

// Consumer group names
export const ENGINE_COMMANDS_CONSUMER_GROUP = "engine-workers";
export const ENGINE_EVENTS_CONSUMER_GROUP = "backend-group";

// Consumer names
export const BACKEND_CONSUMER_NAME = "backend-consumer";
export const ENGINE_CONSUMER_NAME = "engine-consumer";

/**
 * Wire types carried by the stream layer. The control-plane protocol types
 * (`ProtocolMessage` from shared/src/protocol) are natively accepted, so
 * callers no longer need casts; the legacy `EngineCommand`/`EngineEvent`
 * interfaces remain supported for the legacy guards below.
 */
export type StreamPayload =
  ProtocolMessage<unknown> | EngineCommand | EngineEvent;

export interface StreamMessage {
  id: string;
  data: StreamPayload;
}

export interface StreamReadOptions {
  block?: number; // Milliseconds to block
  count?: number; // Number of messages to read
  consumerGroup?: string;
  consumerName?: string;
}

/** Single pending (un-ACKed) stream entry as returned by XPENDING. */
export interface PendingEntryInsight {
  id: string;
  consumer: string;
  idleMs: number;
  deliveries: number;
}

/** Aggregated PEL observability snapshot for one consumer group. */
export interface PendingInsight {
  pendingTotal: number;
  /** Entries idle at least the caller-provided stuck threshold. */
  stuckCount: number;
  /** Largest idle time among stuck entries (0 when none are stuck). */
  oldestStuckIdleMs: number;
  /** Highest redelivery count seen in the scanned entries. */
  maxDeliveries: number;
  /** Entries redelivered >= the caller-provided poison threshold. */
  poisonIds: string[];
}

export class RedisStreamOperations {
  private client: RedisClientType;

  constructor(
    private redisUrl: string = process.env.REDIS_URL || "redis://localhost:6379"
  ) {
    this.client = createClient({
      url: this.redisUrl,
    });

    this.client.on("error", err => {
      logger.error("Redis client error", { error: err.message });
    });

    this.client.on("connect", () => {
      logger.info("Redis client connected");
    });
  }

  async connect(): Promise<void> {
    if (!this.client.isOpen) {
      await this.client.connect();
      // Explicitly select database 1 after connecting
      await this.client.select(1);
      logger.info("Redis database 1 selected");
    }
  }

  async disconnect(): Promise<void> {
    if (this.client.isOpen) {
      await this.client.disconnect();
    }
  }

  /**
   * Publish a message to a stream
   */
  async publish(
    stream: string,
    message: StreamPayload
  ): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      const id = await this.client.xAdd(stream, "*", {
        data: JSON.stringify(message),
      });

      logger.debug("Message published to stream", {
        stream,
        id,
        type: message.type,
      });
      return { success: true, id };
    } catch (error) {
      const errorMessage = (error as Error).message;
      logger.error("Stream publish error", {
        stream,
        type: message.type,
        error: errorMessage,
      });
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Read messages from a stream
   */
  async read(
    stream: string,
    options: StreamReadOptions = {}
  ): Promise<{ success: boolean; messages?: StreamMessage[]; error?: string }> {
    try {
      if (options.consumerGroup && options.consumerName) {
        // Read from consumer group - always use ">" to get NEW messages.
        // Acking is the caller's responsibility (manual ack after
        // processing), so at-least-once delivery works correctly.
        const result = await this.client.xReadGroup(
          options.consumerGroup,
          options.consumerName,
          { key: stream, id: ">" },
          {
            BLOCK: options.block || 0,
            COUNT: options.count || 10,
          }
        );

        if (!result) {
          return { success: true, messages: [] };
        }

        const messages = result.flatMap(group =>
          group.messages.map(msg => ({
            id: msg.id,
            data: JSON.parse(msg.message.data),
          }))
        );

        logger.debug("Messages read from stream (consumer group)", {
          stream,
          consumerGroup: options.consumerGroup,
          count: messages.length,
        });

        return { success: true, messages };
      } else {
        // Read directly from stream
        const result = await this.client.xRead(
          { key: stream, id: "0" },
          {
            BLOCK: options.block || 0,
            COUNT: options.count || 10,
          }
        );

        if (!result) {
          return { success: true, messages: [] };
        }

        const messages = result.flatMap(group =>
          group.messages.map(msg => ({
            id: msg.id,
            data: JSON.parse(msg.message.data),
          }))
        );

        logger.debug("Messages read from stream", {
          stream,
          count: messages.length,
        });

        return { success: true, messages };
      }
    } catch (error) {
      const errorMessage = (error as Error).message;
      logger.error("Stream read error", { stream, error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Acknowledge a message in a consumer group
   */
  async ack(
    stream: string,
    consumerGroup: string,
    messageIds: string | string[]
  ): Promise<{ success: boolean; count?: number; error?: string }> {
    try {
      const ids = Array.isArray(messageIds) ? messageIds : [messageIds];
      const count = await this.client.xAck(stream, consumerGroup, ids);

      logger.debug("Messages acknowledged", { stream, consumerGroup, count });
      return { success: true, count };
    } catch (error) {
      const errorMessage = (error as Error).message;
      logger.error("Stream acknowledge error", {
        stream,
        consumerGroup,
        error: errorMessage,
      });
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Create a consumer group
   */
  async createConsumerGroup(
    stream: string,
    consumerGroup: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Start at '0' (not '$') so a fresh deployment consumes commands
      // that were queued before the group existed.
      await this.client.xGroupCreate(stream, consumerGroup, "0", {
        MKSTREAM: true,
      });
      logger.info("Consumer group created", { stream, consumerGroup });
      return { success: true };
    } catch (error) {
      const errorMessage = (error as Error).message;
      if (errorMessage.includes("BUSYGROUP")) {
        logger.debug("Consumer group already exists", {
          stream,
          consumerGroup,
        });
        return { success: true };
      }
      logger.error("Consumer group creation error", {
        stream,
        consumerGroup,
        error: errorMessage,
      });
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Trim a stream to maintain size
   */
  async trim(
    stream: string,
    maxLength: number,
    approximate: boolean = true
  ): Promise<{ success: boolean; trimmedCount?: number; error?: string }> {
    try {
      const trimmedCount = await this.client.xTrim(
        stream,
        "MAXLEN",
        approximate ? `~${maxLength}` : maxLength
      );

      logger.debug("Stream trimmed", { stream, maxLength, trimmedCount });
      return { success: true, trimmedCount };
    } catch (error) {
      const errorMessage = (error as Error).message;
      logger.error("Stream trim error", {
        stream,
        maxLength,
        error: errorMessage,
      });
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Get stream information
   */
  async info(stream: string): Promise<{
    success: boolean;
    length?: number;
    firstId?: string;
    lastId?: string;
    error?: string;
  }> {
    try {
      const info = await this.client.xInfoStream(stream);

      return {
        success: true,
        length: info.length,
        firstId: info["first-entry"]?.id,
        lastId: info["last-entry"]?.id,
      };
    } catch (error) {
      const errorMessage = (error as Error).message;
      logger.error("Stream info error", { stream, error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Delete a message from a stream
   */
  async delete(
    stream: string,
    messageId: string
  ): Promise<{ success: boolean; deletedCount?: number; error?: string }> {
    try {
      const deletedCount = await this.client.xDel(stream, messageId);

      logger.debug("Message deleted", { stream, messageId });
      return { success: true, deletedCount };
    } catch (error) {
      const errorMessage = (error as Error).message;
      logger.error("Stream delete error", {
        stream,
        messageId,
        error: errorMessage,
      });
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Recover pending messages via XAUTOCLAIM: claims entries read by a
   * consumer that crashed/never acked, provided they were idle at least
   * `minIdleMs`. Long idle threshold avoids disturbing in-flight work.
   */
  async claimPending(
    stream: string,
    consumerGroup: string,
    consumerName: string,
    minIdleMs: number,
    count: number = 10
  ): Promise<{ success: boolean; messages?: StreamMessage[]; error?: string }> {
    try {
      const reply = await this.client.xAutoClaim(
        stream,
        consumerGroup,
        consumerName,
        minIdleMs,
        "0-0",
        { COUNT: count }
      );
      const messages = this.normalizeClaimedMessages(reply?.messages ?? []);
      if (messages.length > 0) {
        logger.info("Recovered pending stream messages via XAUTOCLAIM", {
          stream,
          consumerGroup,
          count: messages.length,
        });
      }
      return { success: true, messages };
    } catch (error) {
      const errorMessage = (error as Error).message;
      // XAUTOCLAIM requires Redis >= 6.2; older servers (e.g. 6.0.x) reject
      // it with "ERR unknown command". Fall back to XPENDING + XCLAIM
      // (available since Redis 5.0), which recovers the same stuck entries.
      if (/unknown command/i.test(errorMessage)) {
        logger.debug(
          "XAUTOCLAIM unavailable on this Redis version - using XPENDING/XCLAIM fallback",
          {
            stream,
            consumerGroup,
          }
        );
        return this.claimPendingLegacy(
          stream,
          consumerGroup,
          consumerName,
          minIdleMs,
          count
        );
      }
      logger.error("Stream claim-pending error", {
        stream,
        consumerGroup,
        error: errorMessage,
      });
      return { success: false, error: errorMessage };
    }
  }

  /** Map raw XAUTOCLAIM/XCLAIM message entries to StreamMessage[]. */
  private normalizeClaimedMessages(
    entries: ({ id: string; message: Record<string, string> } | null)[]
  ): StreamMessage[] {
    return (
      entries.filter(m => m !== null) as {
        id: string;
        message: Record<string, string>;
      }[]
    ).map(msg => ({
      id: msg.id,
      data: JSON.parse(msg.message.data),
    }));
  }

  /**
   * Redis < 6.2 fallback for XAUTOCLAIM. XPENDING with the IDLE filter is
   * itself a Redis >= 6.2 feature, so this uses the plain XPENDING range
   * form (Redis 5.0+) and applies the min-idle filter client-side, then
   * XCLAIMs the matching ids. XCLAIM's server-side min-idle re-check keeps
   * the claim race-free (entries re-delivered in the meantime return null).
   * The PEL only grows when a consumer crashes without ACKing, so scanning
   * a bounded page is sufficient; dedup markers make reprocessing safe.
   */
  private async claimPendingLegacy(
    stream: string,
    consumerGroup: string,
    consumerName: string,
    minIdleMs: number,
    count: number
  ): Promise<{ success: boolean; messages?: StreamMessage[]; error?: string }> {
    try {
      // Bounded page: healthy consumers ACK immediately, so the PEL
      // only accumulates entries after a crash.
      const pending = await this.client.xPendingRange(
        stream,
        consumerGroup,
        "-",
        "+",
        Math.max(count, 100)
      );
      const ids = (pending ?? [])
        .filter(p => p.millisecondsSinceLastDelivery >= minIdleMs)
        .slice(0, count)
        .map(p => p.id);
      if (ids.length === 0) {
        return { success: true, messages: [] };
      }
      const claimed = await this.client.xClaim(
        stream,
        consumerGroup,
        consumerName,
        minIdleMs,
        ids
      );
      const messages = this.normalizeClaimedMessages(claimed ?? []);
      if (messages.length > 0) {
        logger.info("Recovered pending stream messages via XPENDING/XCLAIM", {
          stream,
          consumerGroup,
          count: messages.length,
        });
      }
      return { success: true, messages };
    } catch (error) {
      const errorMessage = (error as Error).message;
      logger.error("Stream claim-pending fallback error", {
        stream,
        consumerGroup,
        error: errorMessage,
      });
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Inspect the consumer group's pending-entries list (PEL) for
   * observability: how many entries exist, how many are stuck (idle beyond
   * `stuckThresholdMs`), and whether any entry looks like a poison message
   * (redelivered at least `poisonThreshold` times without being ACKed).
   * Uses the plain XPENDING range form (Redis 5.0+), so it works on
   * pre-6.2 servers. Bounded scan; callers are responsible for logging.
   */
  async getPendingInsight(
    stream: string,
    consumerGroup: string,
    options: {
      stuckThresholdMs: number;
      poisonThreshold: number;
      maxScan?: number;
    }
  ): Promise<PendingInsight> {
    const entries = await this.client.xPendingRange(
      stream,
      consumerGroup,
      "-",
      "+",
      options.maxScan ?? 500
    );
    const rows = entries ?? [];

    let stuckCount = 0;
    let oldestStuckIdleMs = 0;
    let maxDeliveries = 0;
    const poisonIds: string[] = [];

    for (const entry of rows) {
      const idleMs = entry.millisecondsSinceLastDelivery;
      maxDeliveries = Math.max(maxDeliveries, entry.deliveriesCounter);
      if (idleMs >= options.stuckThresholdMs) {
        stuckCount++;
        oldestStuckIdleMs = Math.max(oldestStuckIdleMs, idleMs);
      }
      if (entry.deliveriesCounter >= options.poisonThreshold) {
        poisonIds.push(entry.id);
      }
    }

    return {
      pendingTotal: rows.length,
      stuckCount,
      oldestStuckIdleMs,
      maxDeliveries,
      poisonIds,
    };
  }

  /**
   * Durable at-least-once deduplication marker (Redis-backed with TTL) -
   * survives engine restarts, unlike the in-memory set.
   */
  async markMessageProcessed(
    scope: string,
    messageId: string,
    ttlSeconds: number = 24 * 60 * 60
  ): Promise<boolean> {
    try {
      const result = await this.client.set(
        `tradebot:dedup:${scope}:${messageId}`,
        "1",
        { EX: ttlSeconds, NX: true }
      );
      return result === "OK";
    } catch (error) {
      logger.error(
        "Dedup marker write failed - falling back to in-memory dedup",
        { scope, messageId, error: (error as Error).message }
      );
      return true; // Fail open: better to double-process than to drop.
    }
  }

  async isMessageProcessed(scope: string, messageId: string): Promise<boolean> {
    try {
      return (
        (await this.client.get(`tradebot:dedup:${scope}:${messageId}`)) === "1"
      );
    } catch (error) {
      logger.error("Dedup marker read failed", {
        scope,
        messageId,
        error: (error as Error).message,
      });
      return false;
    }
  }
}

// Singleton instance
let redisStreamOperations: RedisStreamOperations | null = null;

export function getRedisStreamOperations(): RedisStreamOperations {
  if (!redisStreamOperations) {
    redisStreamOperations = new RedisStreamOperations();
  }
  return redisStreamOperations;
}
