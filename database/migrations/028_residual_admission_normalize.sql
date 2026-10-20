-- Migration 028: normalize partial residual-abandonment records.
-- Gate: run database/ops/residual-admission-preflight.sql against the restored
-- snapshot after 027 and attach the output to the PR before applying this file.
-- Only null-pattern PARTIAL rows are normalized. All-set invalid values and
-- all-set zero quantities are preserved. Log insert + clearing update are one
-- statement, so they commit or roll back together.
-- Rerun safety: the predicate excludes all-null rows, so after a successful
-- run a repeat yields zero inserted log rows and zero updated sessions.

WITH partial_rows AS MATERIALIZED (
  SELECT id, residual_abandoned_at, residual_abandoned_by,
         residual_abandon_reason, residual_accepted_quantity,
         residual_accepted_symbol
  FROM bot_instances
  WHERE NOT (
    residual_abandoned_at IS NULL AND residual_abandoned_by IS NULL
    AND residual_abandon_reason IS NULL AND residual_accepted_quantity IS NULL
    AND residual_accepted_symbol IS NULL
  )
  AND NOT (
    residual_abandoned_at IS NOT NULL AND residual_abandoned_by IS NOT NULL
    AND residual_abandon_reason IS NOT NULL
    AND residual_accepted_quantity IS NOT NULL
    AND residual_accepted_symbol IS NOT NULL
  )
),
logged AS (
  INSERT INTO residual_normalization_log (
    session_id, residual_abandoned_at, residual_abandoned_by,
    residual_abandon_reason, residual_accepted_quantity,
    residual_accepted_symbol, pattern, migration_id, actor, reason
  )
  SELECT id, residual_abandoned_at, residual_abandoned_by,
         residual_abandon_reason, residual_accepted_quantity,
         residual_accepted_symbol, 'PARTIAL', '027', 'migration:027',
         'Partial residual-abandonment record normalized to unresolved; original values preserved in this log.'
  FROM partial_rows
  RETURNING session_id
)
UPDATE bot_instances AS bi
SET residual_abandoned_at = NULL,
    residual_abandoned_by = NULL,
    residual_abandon_reason = NULL,
    residual_accepted_quantity = NULL,
    residual_accepted_symbol = NULL
FROM logged
WHERE bi.id = logged.session_id;
