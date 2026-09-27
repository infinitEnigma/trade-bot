-- Migration: 006_fix_user_level_constraint.sql
-- Description: Update user_level check constraint to match actual levels: BASIC, REGISTERED, VERIFIED
-- Date: 2026-01-20

-- Drop both possible constraint names (the original one from base schema and any renamed ones)
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_user_level_check;
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_user_level_valid;

-- Create new constraint with correct levels
ALTER TABLE users ADD CONSTRAINT users_user_level_check CHECK (user_level IN ('BASIC', 'REGISTERED', 'VERIFIED'));

-- Migration completed successfully
