-- ============================================================================
-- Revert ts_evaluations to history mode
-- ============================================================================
-- Phase 3.5 briefly flipped Q1 from "keep history" to "overwrite on re-eval"
-- (migration 20260506185604_phase_3_5_eval_overwrite.sql added a UNIQUE
-- constraint on candidate_id). On reflection, keeping the audit trail wins:
-- the candidate-detail UI still shows only the latest fields (mirrored onto
-- ts_candidates), but re-evals INSERT new ts_evaluations rows so the history
-- is preserved for future audit / regression tracking.
--
-- Drop the UNIQUE constraint. Edge functions revert to INSERT.
-- ============================================================================

ALTER TABLE public.ts_evaluations
  DROP CONSTRAINT IF EXISTS ts_evaluations_candidate_id_unique;
