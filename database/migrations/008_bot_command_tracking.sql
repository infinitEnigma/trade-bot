-- ============================================================
-- Migration 008: Bot Command Tracking
--
-- Tracks every lifecycle command sent to the engine so that
-- commands which are accepted by Redis but never processed
-- (engine down, message lost) can be timed out by the backend
-- supervision sweeper instead of leaving bots stuck in
-- STARTING/STOPPING forever.
-- ============================================================

CREATE TABLE IF NOT EXISTS bot_commands (
  correlation_id UUID PRIMARY KEY,
  bot_id UUID NOT NULL REFERENCES bot_instances(id) ON DELETE CASCADE,
  command_type VARCHAR(32) NOT NULL,
  state VARCHAR(16) NOT NULL DEFAULT 'PENDING'
    CHECK (state IN ('PENDING', 'ACCEPTED', 'FAILED', 'TIMED_OUT')),
  sent_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  resolved_at TIMESTAMP WITH TIME ZONE,
  error_code VARCHAR(64),
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_bot_commands_pending ON bot_commands(state, expires_at)
  WHERE state = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_bot_commands_bot_id ON bot_commands(bot_id, sent_at);

COMMENT ON TABLE bot_commands IS 'Tracks lifecycle commands sent to the engine for timeout supervision (see BotLifecycleService.sweepTimedOutCommands)';
