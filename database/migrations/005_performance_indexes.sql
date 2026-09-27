-- Performance Indexes for N+1 Query Optimization
-- This migration adds indexes to support efficient JOIN operations
-- in the getAuthenticatedUserData query used by the auth middleware

-- Index on users.id for primary key lookups (should already exist, but ensure)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_id ON users(id);

-- Index on users.email for login queries (should already exist)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email ON users(email);

-- Index on user_roles.user_id for role lookups
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);

-- Index on user_roles.role for role-based queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_roles_role ON user_roles(role);

-- Composite index on user_roles for efficient JOINs
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_roles_user_id_role ON user_roles(user_id, role);

-- Index on kodiak_credentials.user_id for credential lookups
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_kodiak_credentials_user_id ON kodiak_credentials(user_id);

-- Index on kodiak_credentials.verified for filtering verified credentials
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_kodiak_credentials_verified ON kodiak_credentials(verified);

-- Composite index for kodiak_credentials JOIN optimization
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_kodiak_credentials_user_id_verified ON kodiak_credentials(user_id, verified);

-- Index on audit_logs.user_id for user activity queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);

-- Index on audit_logs.action for filtering by action type
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);

-- Composite index for audit log queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_user_id_action ON audit_logs(user_id, action);

-- Index on bot_instances.user_id for user bot queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bot_instances_user_id ON bot_instances(user_id);

-- Index on bot_instances.status for status filtering
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bot_instances_status ON bot_instances(status);

-- Composite index for bot queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bot_instances_user_id_status ON bot_instances(user_id, status);

-- Index on strategies.active for filtering active strategies
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_strategies_active ON strategies(active);

-- Performance analysis queries (run these after deployment to verify index usage)
-- SELECT schemaname, tablename, attname, n_distinct, correlation FROM pg_stats WHERE tablename IN ('users', 'user_roles', 'kodiak_credentials');
-- SELECT * FROM pg_stat_user_indexes WHERE relname IN ('users', 'user_roles', 'kodiak_credentials', 'audit_logs', 'bot_instances', 'strategies');
-- EXPLAIN ANALYZE SELECT u.id, u.email, u.user_level, COALESCE(JSON_AGG(DISTINCT ur.role) FILTER (WHERE ur.role IS NOT NULL), '[]'::json) as roles, CASE WHEN kc.id IS NOT NULL THEN true ELSE false END as has_credentials FROM users u LEFT JOIN user_roles ur ON u.id = ur.user_id LEFT JOIN kodiak_credentials kc ON u.id = kc.user_id AND kc.verified = true WHERE u.id = 'test-user-id' GROUP BY u.id, u.email, u.user_level, kc.id;
