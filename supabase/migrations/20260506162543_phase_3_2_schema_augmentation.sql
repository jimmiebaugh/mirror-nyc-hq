-- ============================================================================
-- Phase 3.2 schema augmentation
-- ============================================================================
-- Three changes to support the Talent Scout port:
--
--   1. ts_pull_rounds gets two operational columns the chunked streaming pull
--      pipeline depends on (pending queue + reeval heartbeat).
--   2. ts_evaluations: per-evaluation history table. Snapshots the scorecard
--      and eval prompt at evaluation time so old scores stay reproducible
--      when the role's prompt or scorecard changes.
--   3. global_settings.cap_alert_sent_this_month: paired with
--      anthropic_spend_current_month_usd so the spend tracker emails the admin
--      once per cap crossing instead of every API call after the cap is hit.
--
-- A monthly cron (NOT in this migration) resets anthropic_spend_current_month_usd
-- and cap_alert_sent_this_month at the start of each calendar month. Implemented
-- in a later phase; the column shape is what's being locked in here.
-- ============================================================================

-- 1. ts_pull_rounds operational columns ---------------------------------------

ALTER TABLE public.ts_pull_rounds
  ADD COLUMN pending_candidates jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN reeval_last_progress_at timestamptz;

-- 2. ts_evaluations history table ---------------------------------------------

CREATE TABLE public.ts_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id uuid NOT NULL REFERENCES public.ts_roles(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES public.ts_candidates(id) ON DELETE CASCADE,
  scorecard_snapshot jsonb NOT NULL,
  eval_prompt_snapshot text NOT NULL,
  score numeric,
  score_breakdown jsonb,
  recruiter_overview text,
  top_strengths jsonb,
  key_gaps jsonb,
  tier text,
  internal_notes_at_time text,
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  triggered_by uuid REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE INDEX idx_ts_evaluations_candidate_evaluated_at
  ON public.ts_evaluations (candidate_id, evaluated_at DESC);

ALTER TABLE public.ts_evaluations ENABLE ROW LEVEL SECURITY;

CREATE POLICY ts_evaluations_all ON public.ts_evaluations FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Per the canonical pattern in 20260506065157_grant_data_api_access.sql:
-- new tables need explicit GRANTs since auto-expose is off.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ts_evaluations TO authenticated;
GRANT ALL ON public.ts_evaluations TO service_role;

-- 3. global_settings spend-cap alert flag -------------------------------------

ALTER TABLE public.global_settings
  ADD COLUMN cap_alert_sent_this_month boolean NOT NULL DEFAULT false;
