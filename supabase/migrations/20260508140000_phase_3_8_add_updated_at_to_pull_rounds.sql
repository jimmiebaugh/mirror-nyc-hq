-- Phase 3.8 follow-up: add updated_at column to ts_pull_rounds.
--
-- The pull-watchdog (ts-cron-pull-watchdog) flags a round as stalled when
-- `status='running'` AND the row's heartbeat is older than 60 min. It was
-- written assuming a standard `updated_at` column, but the initial schema
-- migration didn't include one on ts_pull_rounds (every other ts_* table
-- has it via the conventions in docs/schema.md). Production cron logs
-- showed: `column ts_pull_rounds.updated_at does not exist`.
--
-- Add the column + the standard auto-update trigger so every UPDATE to a
-- pull-round row (heartbeat writes from the chunked pipeline at every
-- BATCH_SIZE boundary) bumps updated_at, giving the watchdog a real
-- heartbeat to read.
--
-- Backfill: existing rows get NOW() at column add (default), which is fine —
-- they're either complete/failed/stalled (so the watchdog's `status='running'`
-- filter excludes them) or genuinely-running with a recent heartbeat.

ALTER TABLE public.ts_pull_rounds
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS ts_pull_rounds_updated_at_auto ON public.ts_pull_rounds;
CREATE TRIGGER ts_pull_rounds_updated_at_auto
  BEFORE UPDATE ON public.ts_pull_rounds
  FOR EACH ROW
  EXECUTE FUNCTION public.updated_at_auto();
