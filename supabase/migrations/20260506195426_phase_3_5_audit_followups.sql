-- ============================================================================
-- Phase 3.5 audit follow-ups
-- ============================================================================
-- Add ts_candidates.location: Claude's eval output includes a candidate_location
-- field that the source repo persists and uses for candidate-detail metadata
-- + search matching. HQ was throwing it away. Restore the column and have
-- ts-pull-candidates / ts-evaluate-candidate write to it.
-- ============================================================================

ALTER TABLE public.ts_candidates
  ADD COLUMN location text;
