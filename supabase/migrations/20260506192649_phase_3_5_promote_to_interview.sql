-- ============================================================================
-- Rename ts_candidate_status enum value 'promote' -> 'interview'
-- ============================================================================
-- Original schema (20260506061457_initial_schema.sql) used `promote` as the
-- "advance the candidate" status label. In practice, the concrete next-stage
-- action Jimmie wants is scheduling an interview — `interview` is the better
-- name. Rename in place; no rows use `promote` at the time of migration so
-- this is safe (verified pre-migration).
-- ============================================================================

ALTER TYPE public.ts_candidate_status RENAME VALUE 'promote' TO 'interview';
