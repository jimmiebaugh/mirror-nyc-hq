-- Phase 3.8: drop the dead ts_pull_rounds.reeval_last_progress_at column.
--
-- Background: Phase 3.2 spec put bulk-re-eval state on ts_pull_rounds (round-
-- scoped). Phase 3.5 moved it to ts_roles (role-scoped) because bulk re-eval
-- always operates over the role's full master pool, never a single round.
-- The original column on ts_pull_rounds has been unused since that move.
-- The new ts-cron-reeval-watchdog (Phase 3.8) reads ts_roles only.
--
-- Safe to drop: no edge function or frontend reference exists. Verified
-- with: rg -n "reeval_last_progress_at" supabase/functions src
-- (only ts_roles references remain after this migration).

ALTER TABLE public.ts_pull_rounds
  DROP COLUMN IF EXISTS reeval_last_progress_at;
