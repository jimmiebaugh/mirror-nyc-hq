-- Phase 3.7.2.1: deprecate auto_rejected status.
--
-- Now that manually_reviewed=false distinguishes AI-decided from
-- human-confirmed rejections, the auto_rejected status is redundant.
-- A candidate the AI rejected is just status='reject' with
-- manually_reviewed=false. The AUTO pill in the UI signals it's still
-- the AI's pick.
--
-- The 'auto_rejected' value remains in the ts_candidate_status enum
-- for safety (Postgres enum value drops require an enum rebuild dance
-- and there's no operational benefit to dropping it now). New writes
-- never use it; existing rows are migrated below.
--
-- Backfill: any row currently flagged auto_rejected becomes
-- reject + manually_reviewed=false. The AUTO pill renders, signaling
-- the AI made this call. A reviewer can confirm by clicking the pill
-- (or by re-selecting / changing the status), flipping to MANUAL.

UPDATE public.ts_candidates
SET status = 'reject',
    manually_reviewed = false
WHERE status = 'auto_rejected';
