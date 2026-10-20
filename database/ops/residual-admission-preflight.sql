-- Residual admission migration gate.
-- Run against the restored production-like snapshot after applying migration
-- 027 only and BEFORE migration 028. Attach every result set to the PR and get
-- explicit ops approval before normalization. This script is read-only.
--
-- Counts are independent predicates, so a row with multiple value violations
-- contributes to every relevant value-level count. ALL_SET_ZERO is valid and
-- must not be normalized.
SELECT
  count(*) FILTER (WHERE residual_abandoned_at IS NULL
    AND residual_abandoned_by IS NULL AND residual_abandon_reason IS NULL
    AND residual_accepted_quantity IS NULL AND residual_accepted_symbol IS NULL) AS all_null,
  count(*) FILTER (WHERE residual_abandoned_at IS NOT NULL
    AND residual_abandoned_by IS NOT NULL AND residual_abandon_reason IS NOT NULL
    AND residual_accepted_quantity IS NOT NULL AND residual_accepted_symbol IS NOT NULL) AS all_set,
  count(*) FILTER (WHERE residual_abandoned_at IS NOT NULL
    AND residual_abandoned_by IS NOT NULL AND residual_abandon_reason IS NOT NULL
    AND residual_accepted_quantity = 0 AND residual_accepted_symbol IS NOT NULL) AS all_set_zero,
  count(*) FILTER (WHERE NOT (
      residual_abandoned_at IS NULL AND residual_abandoned_by IS NULL
      AND residual_abandon_reason IS NULL AND residual_accepted_quantity IS NULL
      AND residual_accepted_symbol IS NULL)
    AND NOT (
      residual_abandoned_at IS NOT NULL AND residual_abandoned_by IS NOT NULL
      AND residual_abandon_reason IS NOT NULL AND residual_accepted_quantity IS NOT NULL
      AND residual_accepted_symbol IS NOT NULL)) AS partial,
  count(*) FILTER (WHERE residual_abandoned_at IS NOT NULL
    AND residual_abandoned_by IS NOT NULL AND residual_abandon_reason IS NOT NULL
    AND residual_accepted_quantity IS NOT NULL AND residual_accepted_quantity < 0
    AND residual_accepted_symbol IS NOT NULL) AS negative_qty_all_set,
  count(*) FILTER (WHERE residual_abandoned_at IS NOT NULL
    AND residual_abandoned_by IS NOT NULL AND residual_abandon_reason IS NOT NULL
    AND residual_accepted_quantity IS NOT NULL AND residual_accepted_symbol IS NOT NULL
    AND length(btrim(residual_abandon_reason)) = 0) AS empty_reason_all_set,
  count(*) FILTER (WHERE residual_abandoned_at IS NOT NULL
    AND residual_abandoned_by IS NOT NULL AND residual_abandon_reason IS NOT NULL
    AND residual_accepted_quantity IS NOT NULL AND residual_accepted_symbol IS NOT NULL
    AND length(btrim(residual_accepted_symbol)) = 0) AS empty_symbol_all_set,
  count(*) FILTER (WHERE residual_abandoned_at IS NOT NULL
    AND residual_abandoned_by IS NOT NULL AND residual_abandon_reason IS NOT NULL
    AND residual_accepted_quantity IS NOT NULL AND residual_accepted_symbol IS NOT NULL
    AND length(btrim(residual_abandon_reason)) NOT BETWEEN 1 AND 500) AS invalid_reason_length_all_set,
  count(*) FILTER (WHERE residual_abandoned_at IS NOT NULL
    AND residual_abandoned_by IS NOT NULL AND residual_abandon_reason IS NOT NULL
    AND residual_accepted_quantity IS NOT NULL AND residual_accepted_symbol IS NOT NULL
    AND length(btrim(residual_accepted_symbol)) NOT BETWEEN 1 AND 64) AS invalid_symbol_length_all_set
FROM bot_instances;

-- Abandonment audit events missing required self-contained evidence. If this
-- count is nonzero, STOP: do not rely on event metadata as preservation proof.
SELECT count(*) AS abandonment_events_missing_required_metadata
FROM bot_lifecycle_events
WHERE event_type = 'RESIDUAL_ABANDONED'
  AND (
    metadata->>'operator' IS NULL
    OR metadata->>'acceptedQuantity' IS NULL
    OR metadata->>'symbol' IS NULL
    OR metadata->>'reason' IS NULL
    OR metadata->>'residualAbandonedAt' IS NULL
    OR metadata->>'rawParserInput' IS NULL
  );

SELECT count(*) AS residual_abandoned_event_count
FROM bot_lifecycle_events
WHERE event_type = 'RESIDUAL_ABANDONED';

SELECT count(*) AS existing_residual_normalization_log_count
FROM residual_normalization_log
WHERE migration_id = '027';
