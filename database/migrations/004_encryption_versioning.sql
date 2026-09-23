-- Migration: 004_encryption_versioning.sql
-- Description: Add encryption key versioning and rotation support
-- Date: 2026-01-18

-- Encryption keys table for key versioning and rotation
CREATE TABLE IF NOT EXISTS encryption_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version INTEGER NOT NULL UNIQUE,
  encrypted_key TEXT NOT NULL, -- Key encrypted with master key
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP WITH TIME ZONE, -- Optional expiration for rotated keys
  active BOOLEAN DEFAULT TRUE
);

-- Add encryption version tracking to credentials table
ALTER TABLE kodiak_credentials
ADD COLUMN IF NOT EXISTS encryption_version INTEGER DEFAULT 1;

-- Create index for efficient key lookups
CREATE INDEX IF NOT EXISTS idx_encryption_keys_version ON encryption_keys(version);
CREATE INDEX IF NOT EXISTS idx_encryption_keys_active ON encryption_keys(active);

-- Insert initial encryption key (version 1)
-- Note: This would normally be done programmatically, but for schema migration we include it
INSERT INTO encryption_keys (version, encrypted_key, active)
VALUES (1, 'PLACEHOLDER_ENCRYPTED_KEY', true)
ON CONFLICT (version) DO NOTHING;

-- Add comments for documentation
COMMENT ON TABLE encryption_keys IS 'Stores encryption keys for key rotation and versioning';
COMMENT ON COLUMN encryption_keys.version IS 'Encryption version number (incremented on rotation)';
COMMENT ON COLUMN encryption_keys.encrypted_key IS 'The actual encryption key, encrypted with master key';
COMMENT ON COLUMN encryption_keys.expires_at IS 'When this key version expires (for cleanup)';
COMMENT ON COLUMN encryption_keys.active IS 'Whether this key version is still active';

COMMENT ON COLUMN kodiak_credentials.encryption_version IS 'Version of encryption used for this credential';

-- Migration completed successfully
-- Encryption versioning ready for quarterly key rotation
