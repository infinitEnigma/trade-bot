-- Migration: 010_wallet_addresses.sql
-- Wallet linking for BASIC -> REGISTERED upgrade flow.
-- Wallets are linked via signed-message verification, independent of
-- Kodiak exchange credentials (kodiak_credentials table).

CREATE TABLE IF NOT EXISTS wallet_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet_address VARCHAR(42) NOT NULL,
  verified BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id),
  UNIQUE(wallet_address)
);

CREATE INDEX IF NOT EXISTS idx_wallet_addresses_user_id ON wallet_addresses(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_addresses_address ON wallet_addresses(wallet_address);
