-- Migration: 002_initial_data.sql
-- Description: Add indexes, constraints, and initial data for performance and data integrity
-- Date: 2026-01-16

-- Performance indexes for frequently queried columns
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_user_level ON users(user_level);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_kodiak_credentials_user_id ON kodiak_credentials(user_id);
CREATE INDEX IF NOT EXISTS idx_kodiak_credentials_account_id ON kodiak_credentials(account_id);
CREATE INDEX IF NOT EXISTS idx_kodiak_credentials_verified ON kodiak_credentials(verified);

CREATE INDEX IF NOT EXISTS idx_strategies_user_id ON strategies(user_id);
CREATE INDEX IF NOT EXISTS idx_strategies_type ON strategies(type);
CREATE INDEX IF NOT EXISTS idx_strategies_active ON strategies(active);
CREATE INDEX IF NOT EXISTS idx_strategies_created_at ON strategies(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bot_instances_user_id ON bot_instances(user_id);
CREATE INDEX IF NOT EXISTS idx_bot_instances_strategy_id ON bot_instances(strategy_id);
CREATE INDEX IF NOT EXISTS idx_bot_instances_status ON bot_instances(status);
CREATE INDEX IF NOT EXISTS idx_bot_instances_created_at ON bot_instances(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_trades_user_id ON trades(user_id);
CREATE INDEX IF NOT EXISTS idx_trades_strategy_id ON trades(strategy_id);
CREATE INDEX IF NOT EXISTS idx_trades_bot_id ON trades(bot_id);
CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);
CREATE INDEX IF NOT EXISTS idx_trades_side ON trades(side);
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
CREATE INDEX IF NOT EXISTS idx_trades_executed_at ON trades(executed_at DESC);

CREATE INDEX IF NOT EXISTS idx_kodiak_accounts_user_id ON kodiak_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_kodiak_accounts_account_id ON kodiak_accounts(account_id);

CREATE INDEX IF NOT EXISTS idx_kodiak_positions_user_id ON kodiak_positions(user_id);
CREATE INDEX IF NOT EXISTS idx_kodiak_positions_symbol ON kodiak_positions(symbol);
CREATE INDEX IF NOT EXISTS idx_kodiak_positions_updated_at ON kodiak_positions(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_kodiak_balances_user_id ON kodiak_balances(user_id);
CREATE INDEX IF NOT EXISTS idx_kodiak_balances_asset ON kodiak_balances(asset);

CREATE INDEX IF NOT EXISTS idx_kodiak_statistics_user_id ON kodiak_statistics(user_id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);

-- Composite indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_bot_instances_user_strategy ON bot_instances(user_id, strategy_id);
CREATE INDEX IF NOT EXISTS idx_trades_user_strategy_timestamp ON trades(user_id, strategy_id, executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_trades_user_timestamp ON trades(user_id, executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_kodiak_positions_user_symbol ON kodiak_positions(user_id, symbol);

-- Partial indexes for active records
CREATE INDEX IF NOT EXISTS idx_strategies_active_only ON strategies(user_id, name) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_bot_instances_running ON bot_instances(strategy_id) WHERE status = 'RUNNING';

-- Add foreign key constraints (already defined in CREATE TABLE, but explicit here for clarity)
-- Note: PostgreSQL automatically creates indexes for foreign keys, but we add explicit ones above for performance

-- Add check constraints for data validation
ALTER TABLE users ADD CONSTRAINT chk_user_level_valid CHECK (user_level IN ('BASIC', 'VERIFIED', 'PREMIUM', 'ADMIN'));
ALTER TABLE strategies ADD CONSTRAINT chk_strategy_type_valid CHECK (type IN ('GRID', 'TREND_FOLLOWING', 'ARBITRAGE', 'MEAN_REVERSION'));
ALTER TABLE bot_instances ADD CONSTRAINT chk_bot_status_valid CHECK (status IN ('STOPPED', 'STARTING', 'RUNNING', 'STOPPING', 'ERROR', 'FORCE_STOPPING'));
ALTER TABLE trades ADD CONSTRAINT chk_trade_side_valid CHECK (side IN ('BUY', 'SELL'));
ALTER TABLE trades ADD CONSTRAINT chk_trade_status_valid CHECK (status IN ('PENDING', 'FILLED', 'PARTIAL', 'CANCELLED', 'REJECTED'));

-- Add NOT NULL constraints where appropriate
ALTER TABLE kodiak_credentials ALTER COLUMN account_id SET NOT NULL;
ALTER TABLE strategies ALTER COLUMN name SET NOT NULL;
ALTER TABLE strategies ALTER COLUMN type SET NOT NULL;
ALTER TABLE trades ALTER COLUMN order_id SET NOT NULL;
ALTER TABLE trades ALTER COLUMN symbol SET NOT NULL;
ALTER TABLE trades ALTER COLUMN side SET NOT NULL;
ALTER TABLE trades ALTER COLUMN quantity SET NOT NULL;
ALTER TABLE trades ALTER COLUMN price SET NOT NULL;
ALTER TABLE trades ALTER COLUMN status SET NOT NULL;

-- Add default data
-- Note: No default users or credentials inserted for security reasons
-- Users must register and connect their Kodiak accounts

-- Create a view for user trading summary (optional, for analytics)
CREATE OR REPLACE VIEW user_trading_summary AS
SELECT
  u.id as user_id,
  u.email,
  u.user_level,
  COUNT(DISTINCT s.id) as total_strategies,
  COUNT(DISTINCT bi.id) as total_bots,
  COUNT(t.id) as total_trades,
  COALESCE(SUM(t.pnl), 0) as total_pnl,
  COALESCE(AVG(t.pnl), 0) as avg_trade_pnl,
  MAX(t.executed_at) as last_trade_date,
  CASE WHEN kc.verified THEN 'CONNECTED' ELSE 'NOT_CONNECTED' END as kodiak_status
FROM users u
LEFT JOIN strategies s ON u.id = s.user_id
LEFT JOIN bot_instances bi ON u.id = bi.user_id
LEFT JOIN trades t ON u.id = t.user_id
LEFT JOIN kodiak_credentials kc ON u.id = kc.user_id
GROUP BY u.id, u.email, u.user_level, kc.verified;

-- Grant permissions (if using Row Level Security in future)
-- GRANT SELECT ON user_trading_summary TO authenticated_users;

-- Add comments for documentation
COMMENT ON TABLE users IS 'Core user accounts with authentication and authorization';
COMMENT ON TABLE kodiak_credentials IS 'Encrypted Kodiak API credentials for trading';
COMMENT ON TABLE strategies IS 'Trading strategy definitions and configurations';
COMMENT ON TABLE bot_instances IS 'Running instances of trading bots';
COMMENT ON TABLE trades IS 'Historical trade execution records';
COMMENT ON TABLE kodiak_accounts IS 'Kodiak account information from API';
COMMENT ON TABLE kodiak_positions IS 'Current trading positions from Kodiak';
COMMENT ON TABLE kodiak_balances IS 'Asset balances from Kodiak';
COMMENT ON TABLE kodiak_statistics IS 'Trading statistics and volume data';
COMMENT ON TABLE audit_logs IS 'Security audit trail for user actions';
COMMENT ON VIEW user_trading_summary IS 'Aggregated trading statistics per user';

-- Migration completed successfully
-- Database indexes, constraints, and views created
