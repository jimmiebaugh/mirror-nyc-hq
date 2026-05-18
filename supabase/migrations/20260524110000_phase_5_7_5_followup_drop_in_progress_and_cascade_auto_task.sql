-- Phase 5.7.5 follow-up round 1.
--
-- (1) Drop the 'In Progress' value from public.deliverable_status. Upcoming
--     covers all future deliverables; the dropped status was vestigial.
--     Existing rows currently set to 'In Progress' migrate to 'Upcoming'.
--
-- (2) Tighten the auto-task lifecycle on deliverable hard-delete. The 5.7.5
--     base migration shipped `ON DELETE SET NULL` on
--     tasks.source_deliverable_id so manually edited auto-tasks would
--     survive a deliverable wipe. Walked back: when the parent deliverable
--     is hard-deleted, surviving auto-tasks (whose source_user_id is still
--     in the deliverable's assigned_user_ids at delete time) should go too.
--     Drop + re-add the FK with `ON DELETE CASCADE`.
--
-- Postgres can't drop a single enum value in place; standard rebuild
-- procedure: new enum, ALTER COLUMN TYPE with cast, drop old, rename.

BEGIN;

-- ============================================================================
-- 1. Backfill any 'In Progress' deliverables to 'Upcoming' before the swap.
--    (Cast through text so the WHERE clause survives the type change.)
-- ============================================================================

UPDATE public.deliverables
SET status = 'Upcoming'::public.deliverable_status
WHERE status::text = 'In Progress';

-- ============================================================================
-- 2. Enum rebuild.
-- ============================================================================

CREATE TYPE public.deliverable_status_v2 AS ENUM (
  'Upcoming',
  'Complete',
  'Skipped'
);

ALTER TABLE public.deliverables
  ALTER COLUMN status DROP DEFAULT;

ALTER TABLE public.deliverables
  ALTER COLUMN status TYPE public.deliverable_status_v2
  USING (status::text::public.deliverable_status_v2);

ALTER TABLE public.deliverables
  ALTER COLUMN status SET DEFAULT 'Upcoming'::public.deliverable_status_v2;

DROP TYPE public.deliverable_status;
ALTER TYPE public.deliverable_status_v2 RENAME TO deliverable_status;

-- ============================================================================
-- 3. Switch tasks.source_deliverable_id FK to ON DELETE CASCADE.
-- ============================================================================

ALTER TABLE public.tasks
  DROP CONSTRAINT tasks_source_deliverable_id_fkey;

ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_source_deliverable_id_fkey
  FOREIGN KEY (source_deliverable_id)
  REFERENCES public.deliverables(id)
  ON DELETE CASCADE;

COMMENT ON COLUMN public.tasks.source_deliverable_id IS
  'Phase 5.7.5 (5.7.5.1 follow-up): when this task was auto-created by '
  'adding a user to a deliverable''s assigned_user_ids, points back to '
  'that deliverable. ON DELETE CASCADE so surviving auto-tasks die with '
  'their parent deliverable; user feedback walked back the original '
  '"manual edits preserved" posture.';

COMMIT;
