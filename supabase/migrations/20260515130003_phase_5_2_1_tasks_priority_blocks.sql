-- Phase 5.2.1.D: tasks.priority + tasks.blocked_by columns.
--
-- Spec: OUTPUTS/phase-5-2-spec.md § 4d. Adds the two task fields the
-- Surface 13 wireframe needs (Priority pill, "Notes / Blocks" column;
-- existing `description` column carries notes, the new `blocked_by`
-- carries the relations). uuid[] over a join table per spec Q7 recommended.
-- GIN index keeps the "tasks blocked by X" query cheap.
--
-- No backfill beyond defaults: every existing row gets priority = 'Normal'
-- and blocked_by = '{}'. The CHECK constraint locks priority to the four
-- Surface 13 values (Urgent / High / Normal / Low).

BEGIN;

ALTER TABLE public.tasks
  ADD COLUMN priority text NOT NULL DEFAULT 'Normal'
    CHECK (priority IN ('Urgent', 'High', 'Normal', 'Low')),
  ADD COLUMN blocked_by uuid[] NOT NULL DEFAULT '{}';

CREATE INDEX tasks_blocked_by_gin_idx
  ON public.tasks USING gin (blocked_by);

CREATE INDEX tasks_priority_idx
  ON public.tasks (priority);

COMMIT;
