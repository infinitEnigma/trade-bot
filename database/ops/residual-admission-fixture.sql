-- Residual admission migration fixture.
-- Inserts bot_instances rows exercising every residual-abandonment pattern so
-- migration 029 (normalize) can be exercised against known data:
--   * partial_row        : PARTIAL pattern (timestamp set, quantity null)  -> normalized+cleared, original logged
--   * zero_row           : all_set_zero  (all five set, quantity = 0)      -> PRESERVED, not touched
--   * clean_row          : all_null                                    -> untouched
--   * invalid_all_set_row: all set with negative quantity                  -> stays (value constraints NOT VALID),
--                        satisfies all-null-or-all-set so 030 validate passes
--
-- Because the all-null-or-all-set CHECK is NOT VALID but still enforced on new
-- writes, we temporarily drop it to insert historical partial rows (simulating
-- data that pre-dates the constraint), then re-add it NOT VALID.
-- Run BEFORE migration 029 (normalize).

-- Temporarily drop all residual constraints so we can insert historical
-- rows that violate them (simulating data that pre-dates the constraints),
-- then re-add all as NOT VALID.
ALTER TABLE bot_instances DROP CONSTRAINT IF EXISTS bot_instances_residual_abandon_complete;
ALTER TABLE bot_instances DROP CONSTRAINT IF EXISTS bot_instances_residual_abandon_reason_valid;
ALTER TABLE bot_instances DROP CONSTRAINT IF EXISTS bot_instances_residual_abandon_quantity_valid;
ALTER TABLE bot_instances DROP CONSTRAINT IF EXISTS bot_instances_residual_abandon_symbol_valid;

-- FK references point to existing rows in this snapshot:
--   user      d8396d12-a202-46f0-9ff6-90b9fb35bf67
--   account   e1d8ee12-31e4-489d-bca0-c5ff2e61f103

-- PARTIAL: timestamp set, companions null -> should be normalized (cleared + logged)
INSERT INTO bot_instances (id, user_id, exchange_account_id, status, actual_state, force_stop_reason,
                           residual_abandoned_at, residual_abandoned_by, residual_abandon_reason,
                           residual_accepted_quantity, residual_accepted_symbol)
VALUES (gen_random_uuid(), 'd8396d12-a202-46f0-9ff6-90b9fb35bf67',
        'e1d8ee12-31e4-489d-bca0-c5ff2e61f103', 'STOPPED', 'STOPPED',
        'cleanup_incomplete: position 2 BTC not flattened',
        '2026-01-01 00:00:00+00', NULL, NULL, NULL, NULL)
RETURNING id AS partial_row_id;

-- all_set_zero: all five set, quantity = 0 -> must be preserved by 029
INSERT INTO bot_instances (id, user_id, exchange_account_id, status, actual_state, force_stop_reason,
                           residual_abandoned_at, residual_abandoned_by, residual_abandon_reason,
                           residual_accepted_quantity, residual_accepted_symbol)
VALUES (gen_random_uuid(), 'd8396d12-a202-46f0-9ff6-90b9fb35bf67',
        'e1d8ee12-31e4-489d-bca0-c5ff2e61f103', 'STOPPED', 'STOPPED',
        'cleanup_incomplete: position 0 BTC not flattened',
        '2026-01-02 00:00:00+00', 'd8396d12-a202-46f0-9ff6-90b9fb35bf67', 'operator accepted flat', 0, 'BTC')
RETURNING id AS zero_row_id;

-- clean_row: all null -> untouched
INSERT INTO bot_instances (id, user_id, exchange_account_id, status, actual_state, force_stop_reason)
VALUES (gen_random_uuid(), 'd8396d12-a202-46f0-9ff6-90b9fb35bf67',
        'e1d8ee12-31e4-489d-bca0-c5ff2e61f103', 'STOPPED', 'STOPPED',
        'emergency_stop:FULL_SHUTDOWN')
RETURNING id AS clean_row_id;

-- invalid_all_set_row: all five set, quantity negative -> value constraint NOT VALID so it can exist;
-- satisfies all-null-or-all-set so 030 validate still passes
INSERT INTO bot_instances (id, user_id, exchange_account_id, status, actual_state, force_stop_reason,
                           residual_abandoned_at, residual_abandoned_by, residual_abandon_reason,
                           residual_accepted_quantity, residual_accepted_symbol)
VALUES (gen_random_uuid(), 'd8396d12-a202-46f0-9ff6-90b9fb35bf67',
        'e1d8ee12-31e4-489d-bca0-c5ff2e61f103', 'STOPPED', 'STOPPED',
        'cleanup_incomplete: position unknown',
        '2026-01-03 00:00:00+00', 'd8396d12-a202-46f0-9ff6-90b9fb35bf67', 'bad reason', -1, 'BAD')
RETURNING id AS invalid_row_id;

-- Re-add all residual constraints NOT VALID (existing violations allowed).
ALTER TABLE bot_instances
  ADD CONSTRAINT bot_instances_residual_abandon_complete CHECK (
    (residual_abandoned_at IS NULL AND residual_abandoned_by IS NULL
     AND residual_abandon_reason IS NULL AND residual_accepted_quantity IS NULL
     AND residual_accepted_symbol IS NULL)
    OR
    (residual_abandoned_at IS NOT NULL AND residual_abandoned_by IS NOT NULL
     AND residual_abandon_reason IS NOT NULL AND residual_accepted_quantity IS NOT NULL
     AND residual_accepted_symbol IS NOT NULL)
  ) NOT VALID;
ALTER TABLE bot_instances
  ADD CONSTRAINT bot_instances_residual_abandon_reason_valid
    CHECK (residual_abandon_reason IS NULL OR length(btrim(residual_abandon_reason)) BETWEEN 1 AND 500) NOT VALID;
ALTER TABLE bot_instances
  ADD CONSTRAINT bot_instances_residual_abandon_quantity_valid
    CHECK (residual_accepted_quantity IS NULL OR residual_accepted_quantity >= 0) NOT VALID;
ALTER TABLE bot_instances
  ADD CONSTRAINT bot_instances_residual_abandon_symbol_valid
    CHECK (residual_accepted_symbol IS NULL OR length(btrim(residual_accepted_symbol)) BETWEEN 1 AND 64) NOT VALID;
