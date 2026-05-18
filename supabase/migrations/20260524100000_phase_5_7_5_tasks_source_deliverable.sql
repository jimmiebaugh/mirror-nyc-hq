-- Phase 5.7.5: source-deliverable tracking on tasks so the auto-task
-- lifecycle from deliverable assignees can find the matching task on
-- unassign (and so a future audit can answer "which tasks came from
-- which deliverable").

ALTER TABLE public.tasks
  ADD COLUMN source_deliverable_id uuid REFERENCES public.deliverables(id) ON DELETE SET NULL,
  ADD COLUMN source_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL;

-- Partial unique index prevents the (race-condition) case of two
-- simultaneous adds creating duplicate auto-tasks for the same
-- (deliverable, user) pair. Manually created tasks (both columns NULL)
-- are not constrained.
CREATE UNIQUE INDEX tasks_source_deliverable_user_idx
  ON public.tasks (source_deliverable_id, source_user_id)
  WHERE source_deliverable_id IS NOT NULL
    AND source_user_id IS NOT NULL;

COMMENT ON COLUMN public.tasks.source_deliverable_id IS
  'Phase 5.7.5: when this task was auto-created by adding a user to a '
  'deliverable''s assigned_user_ids, points back to that deliverable. '
  'ON DELETE SET NULL so the task survives if the parent deliverable is '
  'hard-deleted (per plan #8 / #9: manual edits preserved).';

COMMENT ON COLUMN public.tasks.source_user_id IS
  'Phase 5.7.5: pairs with source_deliverable_id to identify which '
  'auto-task was created for which assignee. Used for the unassign '
  'lookup so the right task gets deleted.';
