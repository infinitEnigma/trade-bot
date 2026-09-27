-- Migration: 001_base_schema.sql
-- Description: Create base database schema with core tables for user management, strategies, bots, and Kodiak integration
-- Date: 2026-01-16

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table (core user management)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  user_level VARCHAR(20) DEFAULT 'BASIC' CHECK (user_level IN ('BASIC', 'VERIFIED', 'PREMIUM', 'ADMIN')),
  email_verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Kodiak credentials table (encrypted API credentials)
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
  UNIQUE(user_id),
  UNIQUE(account_id)
);

-- Strategies table (trading strategy definitions)
CREATE TABLE IF NOT EXISTS strategies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(50) NOT NULL CHECK (type IN ('GRID', 'TREND_FOLLOWING', 'ARBITRAGE', 'MEAN_REVERSION')),
  config JSONB NOT NULL DEFAULT '{}',
  active BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Bot instances table (running trading bots)
CREATE TABLE IF NOT EXISTS bot_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id UUID REFERENCES strategies(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(20) DEFAULT 'STOPPED' CHECK (status IN ('STOPPED', 'STARTING', 'RUNNING', 'STOPPING', 'ERROR', 'FORCE_STOPPING')),
  running_time INTEGER DEFAULT 0,
  total_trades INTEGER DEFAULT 0,
  total_pnl DECIMAL(20, 8) DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Trades table (trade execution history)
CREATE TABLE IF NOT EXISTS trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  strategy_id UUID REFERENCES strategies(id) ON DELETE SET NULL,
  bot_id UUID REFERENCES bot_instances(id) ON DELETE SET NULL,
  order_id VARCHAR(255) NOT NULL,
  symbol VARCHAR(50) NOT NULL,
  side VARCHAR(10) NOT NULL CHECK (side IN ('BUY', 'SELL')),
  quantity DECIMAL(20, 8) NOT NULL,
  price DECIMAL(20, 8) NOT NULL,
  pnl DECIMAL(20, 8) DEFAULT 0,
  fee DECIMAL(20, 8) DEFAULT 0,
  status VARCHAR(20) NOT NULL CHECK (status IN ('PENDING', 'FILLED', 'PARTIAL', 'CANCELLED', 'REJECTED')),
  executed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Ensure schema evolution: add missing columns if table exists from previous runs
ALTER TABLE trades ADD COLUMN IF NOT EXISTS bot_id UUID REFERENCES bot_instances(id) ON DELETE SET NULL;

-- Kodiak accounts table (account info from API)
CREATE TABLE IF NOT EXISTS kodiak_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  account_id VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  account_mode VARCHAR(50) DEFAULT 'REGULAR',
  max_leverage INTEGER DEFAULT 1,
  taker_fee_rate DECIMAL(10, 8) DEFAULT 0.001,
  maker_fee_rate DECIMAL(10, 8) DEFAULT 0.001,
  futures_taker_fee_rate DECIMAL(10, 8) DEFAULT 0.0005,
  futures_maker_fee_rate DECIMAL(10, 8) DEFAULT 0.0002,
  imr_factor JSONB DEFAULT '{}',
  max_notional JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id),
  UNIQUE(account_id)
);

-- Kodiak positions table (current positions)
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

-- Kodiak balances table (asset balances)
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

-- Kodiak statistics table (trading statistics)
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

-- Audit logs table (security and activity logging)
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL,
  details JSONB,
  ip_address VARCHAR(45),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Migration completed successfully
-- Base database schema ready for trading platform
