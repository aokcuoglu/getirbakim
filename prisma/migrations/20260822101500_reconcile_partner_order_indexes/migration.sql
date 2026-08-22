-- The partial due index is the authoritative retry scan index. Remove only
-- the redundant non-partial index emitted by the original outbox migration.
DROP INDEX IF EXISTS "catalog"."partner_order_events_next_attempt_at_idx";
