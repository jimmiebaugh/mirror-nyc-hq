-- Phase 5.7.7: project_members general join + notifications_dispatch_writer
-- recipient-union extension.
--
-- Spec: OUTPUTS/phase-5-7-7-spec.md.
--
-- Changes:
--   1. New table public.project_members (third roster bucket alongside
--      project_account_managers + project_designers per plan decision #4).
--      Shape mirrors project_vendors (created_at + created_by tracked) rather
--      than the bare-bones initial-schema AM/D shape.
--   2. CREATE OR REPLACE notifications_dispatch_writer() — projects branch
--      now unions AM + D + members (was AM-only). All other branches copied
--      verbatim from the 5.7.3 followup-13 version (same OID, no DROP per
--      5.6.5.1 dep lesson).
--
-- Reversibility: additive. New table starts empty; new function body
-- continues to satisfy every existing trigger. No enum or column changes.
-- No backfill needed (the legacy AM + D tables are not touched).

BEGIN;

-- ============================================================================
-- 1. project_members table
-- ============================================================================

CREATE TABLE public.project_members (
  project_id uuid NOT NULL
    REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL
    REFERENCES public.users(id) ON DELETE CASCADE,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

CREATE INDEX project_members_user_idx ON public.project_members (user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_members TO authenticated;
GRANT ALL ON public.project_members TO service_role;

ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY project_members_select ON public.project_members
  FOR SELECT TO authenticated USING (true);

CREATE POLICY project_members_insert ON public.project_members
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY project_members_update ON public.project_members
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY project_members_delete ON public.project_members
  FOR DELETE TO authenticated USING (true);

COMMENT ON TABLE public.project_members IS
  'Phase 5.7.7: general project team join. Third bucket alongside '
  'project_account_managers + project_designers (per plan decision #4). '
  'No role column; bucket is "everyone else on the project". '
  'Notification routing parity with AM + D per plan § 7.A.';

-- ============================================================================
-- 2. notifications_dispatch_writer() — projects branch unions AM + D + members
--
-- Full body copy of the 5.7.3 followup-13 version with the projects branch's
-- recipient query swapped for a UNION across project_account_managers +
-- project_designers + project_members. CREATE OR REPLACE keeps the same OID;
-- all existing triggers (tasks / projects / note_mentions) keep firing
-- unchanged.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.notifications_dispatch_writer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recipient_ids uuid[];
  payload jsonb;
  proj_name text;
  actor_uid uuid;
  note_row RECORD;
  parent_title text;
  link_url text;
  mentioned_name text;
BEGIN
  actor_uid := auth.uid();

  -- ── tasks ────────────────────────────────────────────────────────────────
  IF TG_TABLE_NAME = 'tasks' THEN
    IF (TG_OP = 'INSERT' AND NEW.assignee_id IS NOT NULL)
       OR (TG_OP = 'UPDATE'
           AND NEW.assignee_id IS NOT NULL
           AND NEW.assignee_id IS DISTINCT FROM OLD.assignee_id) THEN
      SELECT name INTO proj_name
        FROM public.projects WHERE id = NEW.project_id;
      payload := jsonb_build_object(
        'event_type', 'task_assigned',
        'entity_type', 'task',
        'entity_id', NEW.id,
        'entity_name', NEW.title,
        'recipient_user_ids', jsonb_build_array(NEW.assignee_id),
        'actor_id', COALESCE(actor_uid, NEW.created_by),
        'extra', jsonb_build_object('project_name', proj_name)
      );
      PERFORM public.invoke_edge_function('notifications-dispatch', payload);
    END IF;

    IF TG_OP = 'UPDATE'
       AND NEW.status = 'Blocked'
       AND OLD.status IS DISTINCT FROM NEW.status
       AND NEW.created_by IS NOT NULL THEN
      payload := jsonb_build_object(
        'event_type', 'task_blocked',
        'entity_type', 'task',
        'entity_id', NEW.id,
        'entity_name', NEW.title,
        'recipient_user_ids', jsonb_build_array(NEW.created_by),
        'actor_id', actor_uid
      );
      PERFORM public.invoke_edge_function('notifications-dispatch', payload);
    END IF;

    RETURN NEW;
  END IF;

  -- ── projects ─────────────────────────────────────────────────────────────
  -- Phase 5.7.7: recipient set now unions AM + Designers + project_members.
  -- Pre-5.7.7 routed to AM only (Phase 5.5 omission). The expansion matches
  -- the plan § 7.A "identically to AM + D" wording plus the new 5.7.7 bucket.
  IF TG_TABLE_NAME = 'projects' THEN
    IF TG_OP = 'UPDATE'
       AND OLD.status IS DISTINCT FROM NEW.status THEN
      SELECT COALESCE(array_agg(DISTINCT user_id), ARRAY[]::uuid[])
        INTO recipient_ids
        FROM (
          SELECT user_id FROM public.project_account_managers
            WHERE project_id = NEW.id
          UNION
          SELECT user_id FROM public.project_designers
            WHERE project_id = NEW.id
          UNION
          SELECT user_id FROM public.project_members
            WHERE project_id = NEW.id
        ) roster;

      IF array_length(recipient_ids, 1) IS NOT NULL THEN
        payload := jsonb_build_object(
          'event_type', 'project_status_changed',
          'entity_type', 'project',
          'entity_id', NEW.id,
          'entity_name', NEW.name,
          'recipient_user_ids', to_jsonb(recipient_ids),
          'actor_id', actor_uid,
          'extra', jsonb_build_object(
            'old_status', OLD.status,
            'new_status', NEW.status,
            'project_name', NEW.name
          )
        );
        PERFORM public.invoke_edge_function('notifications-dispatch', payload);
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  -- ── note_mentions (Phase 5.7.2, extended 5.7.3 followup-13 for project) ──
  IF TG_TABLE_NAME = 'note_mentions' THEN
    SELECT n.parent_type, n.parent_id, n.body, n.author_id
      INTO note_row
      FROM public.notes_log n
     WHERE n.id = NEW.note_id;

    IF note_row IS NULL THEN
      RETURN NEW;
    END IF;

    IF note_row.parent_type = 'task' THEN
      SELECT title INTO parent_title FROM public.tasks WHERE id = note_row.parent_id;
      link_url := '/tasks/' || note_row.parent_id::text;
    ELSIF note_row.parent_type = 'deliverable' THEN
      SELECT title INTO parent_title FROM public.deliverables WHERE id = note_row.parent_id;
      link_url := '/deliverables/' || note_row.parent_id::text;
    ELSIF note_row.parent_type = 'project' THEN
      SELECT name INTO parent_title FROM public.projects WHERE id = note_row.parent_id;
      link_url := '/projects/' || note_row.parent_id::text;
    ELSIF note_row.parent_type = 'client' THEN
      SELECT name INTO parent_title FROM public.clients WHERE id = note_row.parent_id;
      link_url := '/clients/' || note_row.parent_id::text;
    ELSIF note_row.parent_type = 'vendor' THEN
      SELECT name INTO parent_title FROM public.vendors WHERE id = note_row.parent_id;
      link_url := '/vendors/' || note_row.parent_id::text;
    ELSIF note_row.parent_type = 'person' THEN
      SELECT full_name INTO parent_title FROM public.people WHERE id = note_row.parent_id;
      link_url := '/people/' || note_row.parent_id::text;
    ELSIF note_row.parent_type = 'venue' THEN
      SELECT name INTO parent_title FROM public.venues WHERE id = note_row.parent_id;
      link_url := '/venues/' || note_row.parent_id::text;
    ELSIF note_row.parent_type = 'outlook_entry' THEN
      SELECT name INTO parent_title FROM public.outlook_entries WHERE id = note_row.parent_id;
      link_url := '/outlook';
    ELSE
      parent_title := NULL;
      link_url := NULL;
    END IF;

    SELECT full_name INTO mentioned_name
      FROM public.users WHERE id = NEW.mentioned_user_id;

    payload := jsonb_build_object(
      'event_type', 'mention',
      'entity_type', note_row.parent_type,
      'entity_id', note_row.parent_id,
      'entity_name', COALESCE(parent_title, '(deleted)'),
      'recipient_user_ids', jsonb_build_array(NEW.mentioned_user_id),
      'actor_id', note_row.author_id,
      'extra', jsonb_build_object(
        'note_id', NEW.note_id,
        'snippet', LEFT(note_row.body, 140),
        'link_url', link_url,
        'mentioned_user_full_name', mentioned_name
      )
    );
    PERFORM public.invoke_edge_function('notifications-dispatch', payload);

    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;
