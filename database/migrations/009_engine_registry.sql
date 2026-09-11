-- ============================================================
-- Migration 009: Engine Registry (liveness + authoritative identity)
--
-- Tracks known engine instances, their registration epoch and
-- heartbeat liveness. The backend marks engines OFFLINE after a
-- heartbeat timeout and transitions their RUNNING bots to UNKNOWN.
-- ============================================================

CREATE TABLE IF NOT EXISTS engine_registry (
  engine_id VARCHAR(64) PRIMARY KEY,
  epoch BIGINT NOT NULL DEFAULT 0,
  status VARCHAR(16) NOT NULL DEFAULT 'ONLINE'
    CHECK (status IN ('ONLINE', 'OFFLINE')),
  version VARCHAR(64),
  started_at TIMESTAMP WITH TIME ZONE,
  last_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  registered_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_engine_registry_status ON engine_registry(status, last_seen_at);

COMMENT ON TABLE engine_registry IS 'Engine instances with heartbeat liveness; epoch rejects events from superseded engine processes';
