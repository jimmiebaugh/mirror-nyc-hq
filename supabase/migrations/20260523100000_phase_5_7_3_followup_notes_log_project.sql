-- Phase 5.7.3 followup-13: widen notes_log.parent_type to include 'project'.
--
-- Project detail's Status Notes flips from a single free-form
-- InlineEditText (writing to projects.status_notes) to the shared
-- InternalNotesEditor (writing append-only rows to notes_log with
-- @-mention support). That requires:
--
--   1. Widen notes_log.parent_type CHECK to add 'project'.
--   2. CREATE OR REPLACE notifications_dispatch_writer() to add a
--      'project' branch to the note_mentions parent-type case so the
--      notification can resolve a parent_title + link_url. Same OID,
--      no DROP (5.6.5.1 lesson).
--   3. CREATE OR REPLACE activity_log_writer_note_mention() to add a
--      'project' branch to the parent-type case so the activity feed
--      reads "Actor mentioned User in Project X" with X linked.
--   4. Idempotent backfill of existing projects.status_notes into
--      notes_log (matches the 5.7.2 pattern for tasks.description +
--      deliverables.notes). Authored by projects.created_by; created_at
--      preserved from the project. NOT EXISTS guard makes re-runs safe.
--
-- projects.status_notes column stays on disk; the backfill copies it
-- once and the new InternalNotesEditor takes over going forward. A
-- future cleanup pass can drop the column after a soak.
--
-- projects.client_notes is NOT touched. Phase 5.7.3 followup-13 drops
-- the Client Notes card from the UI per Jimmie; the column data stays
-- on disk pending an explicit decision to drop it.

BEGIN;

-- ============================================================================
-- 1. Widen notes_log.parent_type CHECK
-- ============================================================================

ALTER TABLE public.notes_log DROP CONSTRAINT IF EXISTS notes_log_parent_type_check;
ALTER TABLE public.notes_log
  ADD CONSTRAINT notes_log_parent_type_check
  CHECK (parent_type IN (
    'client', 'vendor', 'person', 'venue', 'outlook_entry', 'task', 'deliverable', 'project'
  ));

-- ============================================================================
-- 2. notifications_dispatch_writer() — add 'project' branch to note_mentions
-- ============================================================================
-- Full body copy of the 5.7.2 + 5.7.2-followup version with the new branch
-- inserted into the note_mentions parent-type case. CREATE OR REPLACE keeps
-- the same OID; all existing triggers (tasks / projects / note_mentions) keep
-- firing unchanged.

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
  IF TG_TABLE_NAME = 'projects' THEN
    IF TG_OP = 'UPDATE'
       AND OLD.status IS DISTINCT FROM NEW.status THEN
      SELECT COALESCE(array_agg(user_id), ARRAY[]::uuid[])
        INTO recipient_ids
        FROM public.project_account_managers
       WHERE project_id = NEW.id;

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

-- ============================================================================
-- 3. activity_log_writer_note_mention() — add 'project' branch
-- ============================================================================

CREATE OR REPLACE FUNCTION public.activity_log_writer_note_mention()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  note_row RECORD;
  mentioned_name text;
  parent_title text;
BEGIN
  SELECT n.parent_type, n.parent_id, n.body, n.author_id
    INTO note_row
    FROM public.notes_log n
   WHERE n.id = NEW.note_id;

  IF note_row IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT full_name INTO mentioned_name
    FROM public.users WHERE id = NEW.mentioned_user_id;

  IF note_row.parent_type = 'task' THEN
    SELECT title INTO parent_title FROM public.tasks WHERE id = note_row.parent_id;
  ELSIF note_row.parent_type = 'deliverable' THEN
    SELECT title INTO parent_title FROM public.deliverables WHERE id = note_row.parent_id;
  ELSIF note_row.parent_type = 'project' THEN
    SELECT name INTO parent_title FROM public.projects WHERE id = note_row.parent_id;
  ELSIF note_row.parent_type = 'client' THEN
    SELECT name INTO parent_title FROM public.clients WHERE id = note_row.parent_id;
  ELSIF note_row.parent_type = 'vendor' THEN
    SELECT name INTO parent_title FROM public.vendors WHERE id = note_row.parent_id;
  ELSIF note_row.parent_type = 'person' THEN
    SELECT full_name INTO parent_title FROM public.people WHERE id = note_row.parent_id;
  ELSIF note_row.parent_type = 'venue' THEN
    SELECT name INTO parent_title FROM public.venues WHERE id = note_row.parent_id;
  ELSIF note_row.parent_type = 'outlook_entry' THEN
    SELECT name INTO parent_title FROM public.outlook_entries WHERE id = note_row.parent_id;
  ELSE
    parent_title := NULL;
  END IF;

  INSERT INTO public.activity_log (entity_type, entity_id, action, actor_id, payload)
  VALUES (
    note_row.parent_type,
    note_row.parent_id,
    'mentioned',
    note_row.author_id,
    jsonb_build_object(
      'mentioned_user_id', NEW.mentioned_user_id,
      'mentioned_user_full_name', mentioned_name,
      'note_id', NEW.note_id,
      'snippet', LEFT(note_row.body, 140),
      'parent_title', parent_title
    )
  );
  RETURN NEW;
END;
$$;

-- ============================================================================
-- 4. Idempotent backfill: projects.status_notes -> notes_log
-- ============================================================================
-- One notes_log row per existing project with a non-empty status_notes,
-- authored by projects.created_by and timestamped to projects.created_at so
-- the row sorts at the project's birth in the notes list. NOT EXISTS guard
-- makes re-runs (or running this on prod after a partial migration) safe.

INSERT INTO public.notes_log (parent_type, parent_id, body, author_id, created_at)
SELECT 'project', p.id, p.status_notes, p.created_by, p.created_at
  FROM public.projects p
 WHERE p.status_notes IS NOT NULL
   AND TRIM(p.status_notes) <> ''
   AND p.created_by IS NOT NULL
   AND NOT EXISTS (
     -- Match 5.7.2 backfill: any existing notes_log row for this
     -- (parent_type, parent_id) short-circuits, even if a user has
     -- edited the status_notes column since the first run. Avoids
     -- double-insert if `projects.status_notes` drifts before the
     -- column is dropped.
     SELECT 1 FROM public.notes_log nl
      WHERE nl.parent_type = 'project'
        AND nl.parent_id = p.id
   );

COMMIT;
