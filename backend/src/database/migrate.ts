/** @format */

import { Pool } from "pg";

// PostgreSQL connection pool
const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432"),
  database: process.env.DB_NAME || "trade_bot",
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "postgres",
});

const migrations = `
-- Users table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  user_level VARCHAR(20) DEFAULT 'BASIC',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Kodiak credentials table
CREATE TABLE IF NOT EXISTS kodiak_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  account_id VARCHAR(255) NOT NULL,
  api_key_encrypted TEXT NOT NULL,
  secret_key_encrypted TEXT NOT NULL,
  wallet_signature TEXT,
  wallet_address VARCHAR(255),
  verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id)
);

-- Strategies table
CREATE TABLE IF NOT EXISTS strategies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(50) NOT NULL,
  config JSONB NOT NULL DEFAULT '{}',
  active BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Bot instances table
CREATE TABLE IF NOT EXISTS bot_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id UUID REFERENCES strategies(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(20) DEFAULT 'STOPPED',
  running_time INTEGER DEFAULT 0,
  total_trades INTEGER DEFAULT 0,
  total_pnl DECIMAL(20, 8) DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Trades table
CREATE TABLE IF NOT EXISTS trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  strategy_id UUID REFERENCES strategies(id) ON DELETE SET NULL,
  order_id VARCHAR(255) NOT NULL,
  symbol VARCHAR(50) NOT NULL,
  side VARCHAR(10) NOT NULL,
  quantity DECIMAL(20, 8) NOT NULL,
  price DECIMAL(20, 8) NOT NULL,
  pnl DECIMAL(20, 8),
  fee DECIMAL(20, 8) DEFAULT 0,
  status VARCHAR(20) NOT NULL,
  executed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Kodiak account info table
CREATE TABLE IF NOT EXISTS kodiak_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  account_id VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  account_mode VARCHAR(50),
  max_leverage INTEGER,
  taker_fee_rate DECIMAL(10, 8) DEFAULT 0,
  maker_fee_rate DECIMAL(10, 8) DEFAULT 0,
  futures_taker_fee_rate DECIMAL(10, 8) DEFAULT 0,
  futures_maker_fee_rate DECIMAL(10, 8) DEFAULT 0,
  imr_factor JSONB DEFAULT '{}',
  max_notional JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id)
);

-- Kodiak positions table
CREATE TABLE IF NOT EXISTS kodiak_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  symbol VARCHAR(50) NOT NULL,
  position_qty DECIMAL(20, 8) DEFAULT 0,
  cost_position DECIMAL(20, 8) DEFAULT 0,
  average_open_price DECIMAL(20, 8) DEFAULT 0,
  mark_price DECIMAL(20, 8) DEFAULT 0,
  unsettled_pnl DECIMAL(20, 8) DEFAULT 0,
  pnl_24_h DECIMAL(20, 8) DEFAULT 0,
  leverage INTEGER DEFAULT 1,
  imr DECIMAL(5, 4) DEFAULT 0.1,
  mmr DECIMAL(5, 4) DEFAULT 0.05,
  est_liq_price DECIMAL(20, 8) DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, symbol)
);

-- Kodiak balances table
CREATE TABLE IF NOT EXISTS kodiak_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  asset VARCHAR(10) NOT NULL,
  holding DECIMAL(30, 8) DEFAULT 0,
  frozen DECIMAL(30, 8) DEFAULT 0,
  pending_short_qty DECIMAL(20, 8) DEFAULT 0,
  pending_long_qty DECIMAL(20, 8) DEFAULT 0,
  pnl_24_h DECIMAL(20, 8) DEFAULT 0,
  fee_24_h DECIMAL(20, 8) DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, asset)
);

-- Kodiak statistics table
CREATE TABLE IF NOT EXISTS kodiak_statistics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
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
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id)
);

-- Audit logs table
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL,
  details JSONB,
  ip_address VARCHAR(45),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Add wallet_address column if it doesn't exist
ALTER TABLE kodiak_credentials ADD COLUMN IF NOT EXISTS wallet_address VARCHAR(255);

-- Safety Features Migration (Phase 2)
-- Add columns for safety features to bot_instances table
ALTER TABLE bot_instances
ADD COLUMN IF NOT EXISTS last_heartbeat TIMESTAMP,
ADD COLUMN IF NOT EXISTS account_balance DECIMAL(20, 8),
ADD COLUMN IF NOT EXISTS max_leverage INTEGER DEFAULT 20,
ADD COLUMN IF NOT EXISTS force_stop_reason VARCHAR(255),
ADD COLUMN IF NOT EXISTS exposure DECIMAL(20, 8) DEFAULT 0,
ADD COLUMN IF NOT EXISTS position DECIMAL(20, 8) DEFAULT 0;

-- Add safety configuration table for user-specific risk limits
CREATE TABLE IF NOT EXISTS safety_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id),
  max_exposure_percent DECIMAL(5, 2) DEFAULT 80.0,
  daily_loss_limit DECIMAL(20, 8),
  max_position_size DECIMAL(20, 8),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_bot_instances_user_strategy ON bot_instances(user_id, strategy_id);
CREATE INDEX IF NOT EXISTS idx_bot_instances_status ON bot_instances(status);
CREATE INDEX IF NOT EXISTS idx_bot_instances_last_heartbeat ON bot_instances(last_heartbeat);
CREATE INDEX IF NOT EXISTS idx_kodiak_positions_user_symbol ON kodiak_positions(user_id, symbol);
CREATE INDEX IF NOT EXISTS idx_trades_user_strategy_timestamp ON trades(user_id, strategy_id, executed_at DESC);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_kodiak_credentials_user_id ON kodiak_credentials(user_id);
CREATE INDEX IF NOT EXISTS idx_strategies_user_id ON strategies(user_id);
CREATE INDEX IF NOT EXISTS idx_bot_instances_strategy_id ON bot_instances(strategy_id);
CREATE INDEX IF NOT EXISTS idx_trades_user_id ON trades(user_id);
CREATE INDEX IF NOT EXISTS idx_trades_strategy_id ON trades(strategy_id);
CREATE INDEX IF NOT EXISTS idx_trades_executed_at ON trades(executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
`;

async function runMigrations() {
  console.log("Running database migrations...");

  try {
    await pool.query(migrations);
    console.log("Migrations completed successfully!");
  } catch (error) {
    console.error("Migration failed:", error);
    throw error;
  } finally {
    await pool.end();
  }
}

runMigrations();
