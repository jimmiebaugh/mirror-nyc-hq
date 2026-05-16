-- Phase 5.2.1.A: project_status + task_status enum reshape.
--
-- Spec: OUTPUTS/phase-5-2-spec.md § 4a. Locks the canonical 14-value
-- project_status enum and the canonical 4-value task_status enum per
-- OUTPUTS/phase-5-locked-decisions-2026-05-15.md § 4.
--
-- Same pattern as Phase 5.1's tier-model rewrite (`permission_role`): create
-- a new enum type alongside the old one, swap the column via ALTER COLUMN
-- TYPE ... USING (CASE ...) to backfill every existing row, drop the old
-- type, rename the new type to claim the canonical name. ALTER COLUMN TYPE
-- rebuilds dependent btree indexes automatically; the body of any plpgsql
-- function that compared the column against legacy literals must be
-- CREATE OR REPLACE'd in the same migration so name resolution at next
-- execution sees a valid enum literal.
--
-- Dependency enumeration (done before authoring):
-- - projects.status column (NOT NULL DEFAULT 'Quoting')        -> retyped
-- - idx_projects_status (btree)                                -> auto-rebuilt
-- - tasks.status column (NOT NULL DEFAULT 'todo')              -> retyped
-- - idx_tasks_status (btree)                                   -> auto-rebuilt
-- - tasks_completed_at_set() trigger function (compares to 'done')
--                                                              -> CREATE OR REPLACE'd
-- - activity_log_writer() (compares OLD.status IS DISTINCT FROM NEW.status,
--   then stringifies via jsonb_build_object; enum-agnostic by IS DISTINCT
--   FROM semantics + text I/O on the new label strings)        -> untouched
-- - RLS / storage policies: none reference either enum         -> untouched
--
-- Backfill mapping for project_status (six legacy values dropped, six new
-- values added; one rename Awaiting FB -> Awaiting Feedback). Catch-alls
-- flagged below; review per-row post-migration if the catch-all is wrong
-- for a specific project.
--   'Awaiting FB'        -> 'Awaiting Feedback'        (rename)
--   'Awaiting Files'     -> 'In Progress'              (catch-all)
--   'Awaiting Approval'  -> 'Awaiting Feedback'        (semantic match)
--   'Event Live'         -> 'In Production'            (semantic match)
--   'Proof Out'          -> 'In Production'            (catch-all)
--   'In Review'          -> 'In Progress'              (catch-all)
--   All other 8 values map to themselves (Quoting, Quote Sent, On Hold,
--   In Progress, Complete, In Production, Billing, Location Scouting).
--
-- Backfill mapping for task_status (lowercase strings -> mixed case):
--   'todo'        -> 'To Do'
--   'in_progress' -> 'Doing'
--   'blocked'     -> 'Blocked'
--   'done'        -> 'Done'
--
-- Realtime publication: tasks and projects join supabase_realtime here so
-- the 5.2.1 Board views can drag-drop status changes and peers receive the
-- update via postgres_changes. REPLICA IDENTITY FULL ensures the full new
-- row arrives in the payload. Deliverables is added in the 5.2.1.B
-- migration alongside the table.

BEGIN;

-- ============================================================================
-- 1. Project status reshape
-- ============================================================================

CREATE TYPE public.project_status_v2 AS ENUM (
  'Approved',
  'In Production',
  'In Progress',
  'Location Scouting',
  'Install',
  'Removal',
  'Billing',
  'Queued',
  'Quoting',
  'Quote Sent',
  'Awaiting Feedback',
  'On Hold',
  'Complete',
  'Cancelled'
);

-- Drop the default first (its expression is bound to the old enum type).
ALTER TABLE public.projects ALTER COLUMN status DROP DEFAULT;

ALTER TABLE public.projects
  ALTER COLUMN status TYPE public.project_status_v2
  USING (
    CASE status::text
      WHEN 'Awaiting FB'       THEN 'Awaiting Feedback'::public.project_status_v2
      WHEN 'Awaiting Files'    THEN 'In Progress'::public.project_status_v2
      WHEN 'Awaiting Approval' THEN 'Awaiting Feedback'::public.project_status_v2
      WHEN 'Event Live'        THEN 'In Production'::public.project_status_v2
      WHEN 'Proof Out'         THEN 'In Production'::public.project_status_v2
      WHEN 'In Review'         THEN 'In Progress'::public.project_status_v2
      ELSE status::text::public.project_status_v2
    END
  );

-- Queued is the new "no status yet" terminal default per locked-decisions.
ALTER TABLE public.projects
  ALTER COLUMN status SET DEFAULT 'Queued'::public.project_status_v2;

DROP TYPE public.project_status;
ALTER TYPE public.project_status_v2 RENAME TO project_status;

-- ============================================================================
-- 2. Task status reshape
-- ============================================================================

CREATE TYPE public.task_status_v2 AS ENUM (
  'To Do',
  'Doing',
  'Blocked',
  'Done'
);

ALTER TABLE public.tasks ALTER COLUMN status DROP DEFAULT;

ALTER TABLE public.tasks
  ALTER COLUMN status TYPE public.task_status_v2
  USING (
    CASE status::text
      WHEN 'todo'        THEN 'To Do'::public.task_status_v2
      WHEN 'in_progress' THEN 'Doing'::public.task_status_v2
      WHEN 'blocked'     THEN 'Blocked'::public.task_status_v2
      WHEN 'done'        THEN 'Done'::public.task_status_v2
      ELSE                    'To Do'::public.task_status_v2
      -- Drift catch-all (matches the Phase 5.1 permission_role precedent).
      -- Without it, an unmapped row would produce NULL and abort the swap
      -- mid-rewrite against the NOT NULL constraint.
    END
  );

ALTER TABLE public.tasks
  ALTER COLUMN status SET DEFAULT 'To Do'::public.task_status_v2;

DROP TYPE public.task_status;
ALTER TYPE public.task_status_v2 RENAME TO task_status;

-- ============================================================================
-- 3. Rewrite the tasks_completed_at_set trigger function so its literal
--    comparison matches the new enum label. The function body was compiled
--    against 'done'; at next execution it would cast 'done' to the new
--    enum and raise (invalid input value for enum). CREATE OR REPLACE keeps
--    the same OID so the BEFORE trigger keeps resolving without a re-attach.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tasks_completed_at_set()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'Done' THEN
    NEW.completed_at := now();
  ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.status = 'Done' THEN
      NEW.completed_at := now();
    ELSE
      NEW.completed_at := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ============================================================================
-- 4. Realtime publication for tasks + projects (Board view drag-drop).
--    Deliverables is added in the 5.2.1.B migration with the table.
-- ============================================================================

ALTER TABLE public.tasks REPLICA IDENTITY FULL;
ALTER TABLE public.projects REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE public.projects;

COMMIT;
