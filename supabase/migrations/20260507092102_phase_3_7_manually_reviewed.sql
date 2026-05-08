-- Phase 3.7.2: manually_reviewed flag on candidates.
--
-- Tracks whether the candidate's status was decided by the AI evaluation
-- (false → renders as "auto" in the UI) or confirmed/changed by a human
-- reviewer (true → renders as "manual"). One-way only: flips false → true
-- on user action, never reverts to false.
--
-- User actions that flip the flag:
--   - StatusDropdown change (value differs from current)
--   - StatusDropdown re-select-same (confirming the AI's pick)
--   - Direct click on the small grey "auto" pill in CandidateTable
--   - Being included in a bulk action (bulk reject, bulk promote, etc.)
--
-- Re-Evaluate flows (ts-evaluate-candidate, ts-bulk-reevaluate, round-scoped
-- re-eval) must respect manually_reviewed = true: update score, breakdown,
-- top_strengths, key_gaps, recruiter_overview, quick_overview — but DO NOT
-- change status. The human's decision stands.
--
-- All existing rows backfill to false (treat existing AI-evaluated candidates
-- as "auto" / unreviewed). Reviewers can manually flip them as they go.

ALTER TABLE public.ts_candidates
  ADD COLUMN manually_reviewed boolean NOT NULL DEFAULT false;
