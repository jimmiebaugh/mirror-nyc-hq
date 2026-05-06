-- ============================================================================
-- Reverse Q1 from the Talent Scout port plan: keep ONE eval per candidate.
-- ============================================================================
-- Initial decision (Q1) was to keep history. After running Phase 3.5 by hand,
-- Jimmie's preference is the simpler model: re-evaluation overwrites the prior
-- eval. The candidate-detail UI shows the latest scoring; older evaluations
-- are not interesting for review.
--
-- This adds a UNIQUE constraint on ts_evaluations.candidate_id so future
-- inserts use UPSERT (ON CONFLICT (candidate_id) DO UPDATE). Existing rows
-- are already 1-per-candidate (verified pre-migration); no dedupe needed.
--
-- The history-only columns (scorecard_snapshot, eval_prompt_snapshot,
-- internal_notes_at_time, triggered_by, evaluated_at) stay — they now
-- describe the LATEST eval rather than a snapshot in time, which is still
-- useful for "when was this last evaluated and against which scorecard".
-- ============================================================================

ALTER TABLE public.ts_evaluations
  ADD CONSTRAINT ts_evaluations_candidate_id_unique UNIQUE (candidate_id);
