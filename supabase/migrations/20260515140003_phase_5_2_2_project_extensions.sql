-- Phase 5.2.2.D: projects table extensions.
--
-- Spec: OUTPUTS/phase-5-2-spec.md § 4h + § 13 Q10.
--
-- Two scope bundles:
--   1. Five new project columns (job_number, category, city, tags, budget)
--      backing the Surface 04 List view columns + the Surface 07 detail
--      title row (`#2604` coral job number, "Pop-Up · LA" category + city,
--      Summer 2026 / CPG / Outdoor tag chips, $185,000 budget reference).
--   2. Q10 recommendation: rename the shipped `projects.notes` column to
--      `status_notes` and add a new `client_notes` column. Surface 07 has
--      two distinct sidebar cards (Status Notes + Client Notes); the
--      single shipped `notes` column carried the Status Notes role in
--      5.2.1 and gets the cleaner identifier in 5.2.2.
--
-- Budget rule (spec § 5.A.7): budget is a planning reference figure, not
-- an invoice amount. Stays compatible with locked-decisions Q6. Renders
-- on Surface 07 detail + Surface 08 edit; never on pipeline-summary
-- surfaces (Pipeline counts row, Billing tile, List view columns, board
-- cards, timeline labels, calendar event banners).
--
-- Recreated in Phase 5.2.1 Revision after the halted 5.2.2 worktree was
-- deleted; SQL matches what was applied to the live linked DB on
-- 2026-05-15 (registered as migration 20260515140003).

BEGIN;

ALTER TABLE public.projects
  RENAME COLUMN notes TO status_notes;

ALTER TABLE public.projects
  ADD COLUMN client_notes  text,
  ADD COLUMN job_number    text,
  ADD COLUMN category      text,
  ADD COLUMN city          text,
  ADD COLUMN tags          text[] NOT NULL DEFAULT '{}',
  ADD COLUMN budget        numeric;

CREATE INDEX projects_job_number_idx
  ON public.projects (job_number)
  WHERE job_number IS NOT NULL;
CREATE INDEX projects_city_idx
  ON public.projects (city)
  WHERE city IS NOT NULL;
CREATE INDEX projects_category_idx
  ON public.projects (category)
  WHERE category IS NOT NULL;

COMMIT;
