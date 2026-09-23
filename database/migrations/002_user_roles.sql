-- Migration: 002_user_roles.sql
-- Description: Add user roles system for permissions and qualifications
-- Date: 2026-01-17

-- User roles table (separate from user levels)
CREATE TABLE IF NOT EXISTS user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL CHECK (role IN ('QUALIFIED_ALPHA')),
  granted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  granted_by VARCHAR(100) DEFAULT 'system', -- 'system' or admin user ID
  criteria_met JSONB, -- Store qualification criteria that were met
  UNIQUE(user_id, role)
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role);

-- Add comments
COMMENT ON TABLE user_roles IS 'User permission roles (separate from account levels)';
COMMENT ON COLUMN user_roles.role IS 'Permission role (QUALIFIED_ALPHA, etc.)';
COMMENT ON COLUMN user_roles.criteria_met IS 'JSON object storing qualification criteria met';

-- Migration completed successfully
-- User roles system ready for private testing qualifications
