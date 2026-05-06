-- ============================================================================
-- Phase 3.4 pull pipeline schema additions
-- ============================================================================
-- The source repo's chunked pull pipeline writes progress counters and an
-- attempt number on the round row so the UI and the watchdog can report
-- meaningfully without joining ts_candidates per render. Mirror those columns
-- onto ts_pull_rounds. Also add round_number for the "R1 / R2 / R3" labels
-- on the role status pill — incremented per role at round-create time.
-- ============================================================================

ALTER TABLE public.ts_pull_rounds
  ADD COLUMN candidates_found integer NOT NULL DEFAULT 0,
  ADD COLUMN processed_count integer NOT NULL DEFAULT 0,
  ADD COLUMN attempt integer NOT NULL DEFAULT 1,
  ADD COLUMN round_number integer;

CREATE INDEX idx_ts_pull_rounds_role_round_number
  ON public.ts_pull_rounds (role_id, round_number DESC);
