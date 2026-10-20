-- Residual admission migration gate.
-- Run against the restored production-like snapshot after applying migration
-- 027 only and BEFORE migration 028. Attach every result set to the PR and get
-- explicit ops approval before normalization. This script is read-only.
--
-- Row-pattern counts. "ALL_SET_ZERO" is valid and must not be normalized.
SELECT pattern, count(*) AS row_count
FROM (
  SELECT CASE
    WHEN residual_abandoned_at IS NULL
     AND residual_abandoned_by IS NULL
     AND residual_abandon_reason IS NULL
     AND residual_accepted_quantity IS NULL
     AND residual_accepted_symbol IS NULL
      THEN 'ALL_NULL'
    WHEN residual_abandoned_at IS NOT NULL
     AND residual_abandoned_by IS NOT NULL
     AND residual_abandon_reason IS NOT NULL
     AND residual_accepted_quantity IS NOT NULL
     AND residual_accepted_symbol IS NOT NULL
     AND residual_accepted_quantity = 0
      THEN 'ALL_SET_ZERO'
    WHEN residual_abandoned_at IS NOT NULL
     AND residual_abandoned_by IS NOT NULL
     AND residual_abandon_reason IS NOT NULL
     AND residual_accepted_quantity IS NOT NULL
     AND residual_accepted_symbol IS NOT NULL
      THEN 'ALL_SET'
    ELSE 'PARTIAL'
  END AS pattern
  FROM bot_instances
) patterns
GROUP BY pattern
ORDER BY pattern;

-- Value-level violations among all-set rows. Migration 027 deliberately
-- preserves these; the counts determine whether a later validation is safe.
SELECT pattern, count(*) AS row_count
FROM (
  SELECT CASE
    WHEN residual_accepted_quantity < 0 THEN 'NEGATIVE_QTY'
    WHEN length(btrim(residual_abandon_reason)) NOT BETWEEN 1 AND 500 THEN 'INVALID_REASON'
    WHEN length(btrim(residual_accepted_symbol)) NOT BETWEEN 1 AND 64 THEN 'INVALID_SYMBOL'
    ELSE 'VALID_ALL_SET'
  END AS pattern
  FROM bot_instances
  WHERE residual_abandoned_at IS NOT NULL
    AND residual_abandoned_by IS NOT NULL
    AND residual_abandon_reason IS NOT NULL
    AND residual_accepted_quantity IS NOT NULL
    AND residual_accepted_symbol IS NOT NULL
) all_set_rows
GROUP BY pattern
ORDER BY pattern;

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

-- Event totals and existing forensic log totals help document the snapshot.
SELECT
  (SELECT count(*) FROM bot_lifecycle_events WHERE event_type = 'RESIDUAL_ABANDONED') AS residual_abandoned_event_count,
  (SELECT count(*) FROM residual_normalization_log WHERE migration_id = '027') AS prior_027_normalization_log_count;
