-- Durable ledger-integrity alerts must survive unknown bot IDs and lifecycle-audit write failures.
-- Intentionally no FK on bot_id: an unattributed fill may reference a bot row that does not exist.
CREATE TABLE IF NOT EXISTS ledger_integrity_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id TEXT NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  message_id VARCHAR(128) NOT NULL,
  correlation_id VARCHAR(128),
  deliveries INTEGER NOT NULL CHECK (deliveries >= 0),
  reason TEXT NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMPTZ,
  UNIQUE (event_type, message_id)
);

CREATE INDEX IF NOT EXISTS idx_ledger_integrity_alerts_open
  ON ledger_integrity_alerts (last_seen_at DESC)
  WHERE resolved_at IS NULL;
