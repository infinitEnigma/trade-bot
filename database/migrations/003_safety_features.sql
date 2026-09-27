-- Migration: 003_safety_features.sql
-- Description: Add safety features for Phase 2 (position limits, emergency stop, bot heartbeat)
-- Date: 2026-01-14

-- Add columns for safety features to bots table
ALTER TABLE bot_instances
ADD COLUMN IF NOT EXISTS last_heartbeat TIMESTAMP,
ADD COLUMN IF NOT EXISTS account_balance DECIMAL(20, 8),
ADD COLUMN IF NOT EXISTS max_leverage INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS exposure DECIMAL(20, 8) DEFAULT 0,
ADD COLUMN IF NOT EXISTS force_stop_reason VARCHAR(255);

-- Add audit log table for safety events
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  action VARCHAR(50) NOT NULL,
  details JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);

-- Add safety configuration table
CREATE TABLE IF NOT EXISTS safety_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id),
  max_exposure_percent DECIMAL(5, 2) DEFAULT 80.0,
  daily_loss_limit DECIMAL(20, 8),
  max_position_size DECIMAL(20, 8),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add trades table for bot performance tracking
CREATE TABLE IF NOT EXISTS trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  strategy_id UUID REFERENCES strategies(id),
  bot_id UUID REFERENCES bot_instances(id),
  order_id VARCHAR(100) NOT NULL,
  symbol VARCHAR(50) NOT NULL,
  side VARCHAR(10) NOT NULL, -- BUY, SELL
  quantity DECIMAL(20, 8) NOT NULL,
  price DECIMAL(20, 8) NOT NULL,
  pnl DECIMAL(20, 8) DEFAULT 0,
  fee DECIMAL(20, 8) DEFAULT 0,
  status VARCHAR(20) NOT NULL, -- NEW, FILLED, CANCELLED, etc.
  executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_trades_user_id ON trades(user_id);
CREATE INDEX IF NOT EXISTS idx_trades_strategy_id ON trades(strategy_id);
CREATE INDEX IF NOT EXISTS idx_trades_bot_id ON trades(bot_id);
CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);
CREATE INDEX IF NOT EXISTS idx_trades_executed_at ON trades(executed_at);

-- Add Kodiak positions table for tracking
CREATE TABLE IF NOT EXISTS kodiak_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  symbol VARCHAR(50) NOT NULL,
  position_qty DECIMAL(20, 8) NOT NULL,
  cost_position DECIMAL(20, 8) DEFAULT 0,
  average_open_price DECIMAL(20, 8) DEFAULT 0,
  mark_price DECIMAL(20, 8) DEFAULT 0,
  unsettled_pnl DECIMAL(20, 8) DEFAULT 0,
  pnl_24_h DECIMAL(20, 8) DEFAULT 0,
  leverage DECIMAL(5, 2) DEFAULT 1,
  imr DECIMAL(20, 8) DEFAULT 0.1,
  mmr DECIMAL(20, 8) DEFAULT 0.05,
  est_liq_price DECIMAL(20, 8),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, symbol)
);

CREATE INDEX IF NOT EXISTS idx_kodiak_positions_user_id ON kodiak_positions(user_id);
CREATE INDEX IF NOT EXISTS idx_kodiak_positions_symbol ON kodiak_positions(symbol);

-- Add Kodiak statistics table
CREATE TABLE IF NOT EXISTS kodiak_statistics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id),
  days_since_registration INTEGER DEFAULT 0,
  fees_paid_last_30_days DECIMAL(20, 8) DEFAULT 0,
  perp_fees_paid_last_30_days DECIMAL(20, 8) DEFAULT 0,
  perp_trading_volume_last_24_hours DECIMAL(20, 8) DEFAULT 0,
  perp_trading_volume_last_30_days DECIMAL(20, 8) DEFAULT 0,
  perp_trading_volume_ytd DECIMAL(20, 8) DEFAULT 0,
  trading_volume_last_24_hours DECIMAL(20, 8) DEFAULT 0,
  trading_volume_last_30_days DECIMAL(20, 8) DEFAULT 0,
  trading_volume_ytd DECIMAL(20, 8) DEFAULT 0,
  perp_trading_volume_last_7_days DECIMAL(20, 8) DEFAULT 0,
  perp_trading_volume_ltd DECIMAL(20, 8) DEFAULT 0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add Kodiak accounts table
CREATE TABLE IF NOT EXISTS kodiak_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id),
  account_id VARCHAR(100) NOT NULL,
  email VARCHAR(255),
  account_mode VARCHAR(20) DEFAULT 'REGULAR',
  max_leverage INTEGER DEFAULT 1,
  taker_fee_rate DECIMAL(10, 8) DEFAULT 0.001,
  maker_fee_rate DECIMAL(10, 8) DEFAULT 0.001,
  futures_taker_fee_rate DECIMAL(10, 8) DEFAULT 0.0005,
  futures_maker_fee_rate DECIMAL(10, 8) DEFAULT 0.0002,
  imr_factor JSONB DEFAULT '{}',
  max_notional JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Migration completed successfully
-- All safety features database schema ready
