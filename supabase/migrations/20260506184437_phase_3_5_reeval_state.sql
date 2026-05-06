-- ============================================================================
-- Phase 3.5: bulk re-eval state on ts_roles
-- ============================================================================
-- Phase 3.5's ts-bulk-reevaluate is role-scoped (master pool across all rounds),
-- not round-scoped like the source repo's reevaluate-round. So the per-run
-- state (status, counters, heartbeat) lives on ts_roles, not ts_pull_rounds.
--
-- The Phase 3.7 watchdog reads ts_roles.reeval_last_progress_at to detect
-- stalled bulk re-evals. The legacy ts_pull_rounds.reeval_last_progress_at
-- (added in 3.2) is now obsolete; left in place for now, can be dropped in
-- a future cleanup migration.
-- ============================================================================

CREATE TYPE public.ts_role_reeval_status AS ENUM ('idle', 'running', 'complete', 'failed');

ALTER TABLE public.ts_roles
  ADD COLUMN reeval_status public.ts_role_reeval_status NOT NULL DEFAULT 'idle',
  ADD COLUMN reeval_status_filter text,
  ADD COLUMN reeval_total integer NOT NULL DEFAULT 0,
  ADD COLUMN reeval_processed integer NOT NULL DEFAULT 0,
  ADD COLUMN reeval_failed integer NOT NULL DEFAULT 0,
  ADD COLUMN reeval_started_at timestamptz,
  ADD COLUMN reeval_completed_at timestamptz,
  ADD COLUMN reeval_last_progress_at timestamptz;

CREATE INDEX idx_ts_roles_reeval_active
  ON public.ts_roles (reeval_last_progress_at)
  WHERE reeval_status = 'running';
