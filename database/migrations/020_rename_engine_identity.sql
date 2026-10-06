-- Migration: 020_rename_engine_identity.sql
-- Exchange-agnostic rebrand: `kodiak-engine-*` -> `trading-engine-*`.
--
-- The engine migrates its persisted identity in lockstep (see
-- engine/src/domain/engine-identity.ts: a persisted kodiak-engine-<suffix>
-- becomes trading-engine-<suffix>, same suffix), so this file renames the DB
-- rows to the ids the engine will actually start with:
-- - engine_registry: renamed in place (PK swap; only collides if a suffix was
--   ever registered under both prefixes, which the loader's deterministic
--   swap makes impossible for rows created by this migration's own target).
-- - bot_instances.engine_id: renamed so handleStateChanged's
--   non-authoritative-engine guard keeps accepting state events for the
--   already-registered bots — without this they would wedge in STARTING the
--   next time they are started.
--
-- epoch = 0: the swapped prefix is a NEW identity for the (engineId, epoch)
-- staleness guard. The loader restarts the epoch at 1 (old state-file epoch
-- is dropped with the old prefix); ENGINE_REGISTER only lands when
-- EXCLUDED.epoch >= engine_registry.epoch, so keeping the historical epoch
-- would reject every registration until enough restarts accumulated.
--
-- Rerun-safe: replace() only matches the old prefix; a second run's LIKE
-- finds nothing and both UPDATEs no-op.

UPDATE engine_registry
   SET engine_id = replace(engine_id, 'kodiak-engine-', 'trading-engine-'),
       epoch = 0,
       updated_at = CURRENT_TIMESTAMP
 WHERE engine_id LIKE 'kodiak-engine-%';

UPDATE bot_instances
   SET engine_id = replace(engine_id, 'kodiak-engine-', 'trading-engine-')
 WHERE engine_id LIKE 'kodiak-engine-%';