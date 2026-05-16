-- Phase 5.2.1.B: deliverables table.
--
-- Spec: OUTPUTS/phase-5-2-spec.md § 4b. New 4-value deliverable_status enum
-- per OUTPUTS/phase-5-locked-decisions-2026-05-15.md § 4. Polymorphic across
-- (project_id, due_date, status, assigned_user_ids); RLS is open-
-- authenticated to match the rest of HQ Core. Activity log writes via the
-- existing activity_log_writer trigger; completed_at is set by a parallel
-- trigger to tasks_completed_at_set.
--
-- Realtime publication: deliverables join supabase_realtime here so the
-- 5.2.1 Board view drag-drop reaches peer browsers via postgres_changes.

BEGIN;

-- ============================================================================
-- 1. Enum + table
-- ============================================================================

CREATE TYPE public.deliverable_status AS ENUM (
  'Upcoming',
  'In Progress',
  'Complete',
  'Skipped'
);

CREATE TABLE public.deliverables (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  title              text NOT NULL,
  type               text,
  -- Free-text in 5.2.1 (Kickoff / Venue Recon / Design Round / Client Approval
  -- / Install / Removal etc.). Future sub-phase may promote to a lookup.

  status             public.deliverable_status NOT NULL DEFAULT 'Upcoming',
  due_date           date,
  -- Nullable; the calendar view filters out deliverables with no date.

  notes              text,
  assigned_user_ids  uuid[] NOT NULL DEFAULT '{}',
  -- Multi-assignee per Surface 14 board card "first-name" stack. Not a FK
  -- array (Postgres can't FK an array element); the join lookup happens in
  -- app code against public.users.

  created_by         uuid NOT NULL REFERENCES public.users(id),
  -- Default ON DELETE RESTRICT: a user who authored a deliverable cannot be
  -- hard-deleted until that deliverable is reassigned or removed. Matches the
  -- spec; intentionally stricter than the shipped clients / projects /
  -- venues `created_by ON DELETE SET NULL` (which paired with a nullable
  -- column). Since the column is NOT NULL we cannot SET NULL on user delete.
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  completed_at       timestamptz
  -- Set by trigger when status flips to 'Complete'; cleared on flip away.
);

CREATE INDEX deliverables_project_idx
  ON public.deliverables (project_id);
CREATE INDEX deliverables_due_date_idx
  ON public.deliverables (due_date)
  WHERE due_date IS NOT NULL;
CREATE INDEX deliverables_assignee_gin_idx
  ON public.deliverables USING gin (assigned_user_ids);
CREATE INDEX deliverables_status_idx
  ON public.deliverables (status);

-- ============================================================================
-- 2. Triggers (updated_at, completed_at, activity_log)
-- ============================================================================

CREATE TRIGGER trg_deliverables_updated_at
  BEFORE UPDATE ON public.deliverables
  FOR EACH ROW EXECUTE FUNCTION public.updated_at_auto();

CREATE OR REPLACE FUNCTION public.deliverables_completed_at_set()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'Complete' THEN
    NEW.completed_at := now();
  ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.status = 'Complete' THEN
      NEW.completed_at := now();
    ELSE
      NEW.completed_at := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_deliverables_completed_at
  BEFORE INSERT OR UPDATE ON public.deliverables
  FOR EACH ROW EXECUTE FUNCTION public.deliverables_completed_at_set();

-- Extend activity_log_writer to support DELETE. The shipped body initialized
-- action_val + payload_val inside the INSERT / UPDATE branches only; DELETE
-- would leave both NULL and violate the NOT NULL on activity_log.action. The
-- existing projects / venues / tasks triggers fire only on INSERT OR UPDATE
-- so the gap was invisible. Deliverables (spec § 4b) and the 5.2.2 entity
-- triggers fire on INSERT OR UPDATE OR DELETE, so the function gains a
-- DELETE branch here. Same OID via CREATE OR REPLACE so existing triggers
-- keep resolving unchanged; their AFTER timing means they continue to
-- receive only INSERT / UPDATE events.
CREATE OR REPLACE FUNCTION public.activity_log_writer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  action_val text;
  payload_val jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    action_val := 'created';
    payload_val := jsonb_build_object('new', to_jsonb(NEW));
  ELSIF TG_OP = 'UPDATE' THEN
    IF (TG_TABLE_NAME IN ('projects', 'tasks', 'deliverables'))
       AND OLD.status IS DISTINCT FROM NEW.status THEN
      action_val := 'status_changed';
      payload_val := jsonb_build_object('from', OLD.status, 'to', NEW.status);
    ELSIF TG_TABLE_NAME = 'projects'
          AND OLD.archived_at IS DISTINCT FROM NEW.archived_at THEN
      action_val := CASE WHEN NEW.archived_at IS NULL THEN 'unarchived' ELSE 'archived' END;
      payload_val := jsonb_build_object('archived_at', NEW.archived_at);
    ELSE
      action_val := 'updated';
      payload_val := jsonb_build_object('id', NEW.id);
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    action_val := 'deleted';
    payload_val := jsonb_build_object('old', to_jsonb(OLD));
  END IF;

  INSERT INTO public.activity_log (entity_type, entity_id, action, actor_id, payload)
  VALUES (TG_TABLE_NAME, COALESCE(NEW.id, OLD.id), action_val, auth.uid(), payload_val);

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_activity_log_deliverables
  AFTER INSERT OR UPDATE OR DELETE ON public.deliverables
  FOR EACH ROW EXECUTE FUNCTION public.activity_log_writer();

-- ============================================================================
-- 3. RLS + grants (open-authenticated, matches HQ Core posture)
-- ============================================================================

ALTER TABLE public.deliverables ENABLE ROW LEVEL SECURITY;

CREATE POLICY deliverables_select ON public.deliverables
  FOR SELECT TO authenticated USING (true);
CREATE POLICY deliverables_insert ON public.deliverables
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY deliverables_update ON public.deliverables
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY deliverables_delete ON public.deliverables
  FOR DELETE TO authenticated USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.deliverables TO authenticated;
GRANT ALL                            ON public.deliverables TO service_role;

-- ============================================================================
-- 4. Realtime publication
-- ============================================================================

ALTER TABLE public.deliverables REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.deliverables;

COMMIT;
