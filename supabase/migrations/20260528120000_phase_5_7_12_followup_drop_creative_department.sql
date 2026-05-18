-- Phase 5.7.12 follow-up: drop the 'Creative' department from the
-- lookup. Per Jimmie's 2026-05-18 call: Creative was a leftover from
-- the 5.4 seed list (Leadership / Accounts / Creative / Design /
-- Event Production); the team actually treats Creative work as Design.
-- Reassign every users.department_id pointing at Creative to Design,
-- then delete the Creative row.
--
-- Idempotent: re-running on an environment where Creative is already
-- gone is a no-op. Errors out only if Design is missing (which would
-- mean the 5.4 seed never ran).

DO $$
DECLARE
  creative_id uuid;
  design_id uuid;
BEGIN
  SELECT id INTO creative_id FROM public.departments WHERE name = 'Creative';
  IF creative_id IS NULL THEN
    RETURN;
  END IF;

  SELECT id INTO design_id FROM public.departments WHERE name = 'Design';
  IF design_id IS NULL THEN
    RAISE EXCEPTION 'Cannot drop Creative: Design department is missing (5.4 seed?)';
  END IF;

  UPDATE public.users
     SET department_id = design_id
   WHERE department_id = creative_id;

  DELETE FROM public.departments WHERE id = creative_id;
END $$;
