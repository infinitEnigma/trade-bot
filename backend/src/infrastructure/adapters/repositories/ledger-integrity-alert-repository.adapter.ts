import { query } from "../../../database/pool";

export interface LedgerIntegrityAlert {
  botId: string;
  eventType: string;
  messageId: string;
  correlationId?: string;
  deliveries: number;
  reason: string;
}

/**
 * Durable poison-event alerts. This table deliberately does not FK bot_id:
 * an UNKNOWN_BOT fill must remain observable even when its bot row is absent.
 * The unique key makes retries/concurrent consumers idempotent.
 */
export class LedgerIntegrityAlertRepository {
  async record(alert: LedgerIntegrityAlert): Promise<void> {
    await query(
      `INSERT INTO ledger_integrity_alerts
         (bot_id, event_type, message_id, correlation_id, deliveries, reason)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (event_type, message_id) DO UPDATE
         SET deliveries = GREATEST(ledger_integrity_alerts.deliveries, EXCLUDED.deliveries),
             last_seen_at = CURRENT_TIMESTAMP,
             correlation_id = COALESCE(EXCLUDED.correlation_id, ledger_integrity_alerts.correlation_id)`,
      [
        alert.botId,
        alert.eventType,
        alert.messageId,
        alert.correlationId ?? null,
        alert.deliveries,
        alert.reason,
      ]
    );
  }
}
