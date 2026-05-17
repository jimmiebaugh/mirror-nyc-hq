-- Phase 5.7.2: @-mentions feed + append-only Notes on Tasks + Deliverables.
--
-- Spec: OUTPUTS/phase-5-7-2-spec.md.
--
-- Changes:
--   1. Widen `notes_log.parent_type` CHECK to include 'task' and 'deliverable'
--      so the shared `<InternalNotesEditor />` can host the Notes card on
--      TaskDetail + DeliverableDetail (spec § 6.B).
--   2. Create `note_mentions` table + RLS + GRANTs. One row per @-mention.
--   3. Extend `notifications_dispatch_writer()` with a `'note_mentions'`
--      branch that POSTs `event_type='mention'` to `notifications-dispatch`.
--      Recreated via CREATE OR REPLACE (same OID, no DROP) per the 5.6.5.1
--      policy-dep lesson.
--   4. AFTER INSERT trigger on `note_mentions` that fires the dispatch.
--   5. Sibling `activity_log_writer_note_mention()` + trigger that writes a
--      single `activity_log` row per mention, attributed to the parent
--      task/deliverable/etc. with action='mentioned' and payload carrying
--      `mentioned_user_id`, `mentioned_user_full_name`, `note_id`, `snippet`.
--   6. Backfill existing `tasks.description` + `deliverables.notes` into
--      `notes_log` (parent_type='task' / 'deliverable'). Idempotent via
--      NOT EXISTS guard. Legacy columns are not dropped; future cleanup pass
--      can drop after a soak.
--
-- Reversibility: additive. The CHECK widening preserves all existing rows.
-- The note_mentions table cascades on note delete + user delete. The backfill
-- is idempotent. No enum changes required (notifications.type already includes
-- 'mention'; user_notification_preferences.trigger_key already includes 'mention').

-- ============================================================================
-- 1. Widen notes_log.parent_type CHECK
-- ============================================================================

ALTER TABLE public.notes_log DROP CONSTRAINT IF EXISTS notes_log_parent_type_check;
ALTER TABLE public.notes_log
  ADD CONSTRAINT notes_log_parent_type_check
  CHECK (parent_type IN (
    'client', 'vendor', 'person', 'venue', 'outlook_entry', 'task', 'deliverable'
  ));

-- ============================================================================
-- 2. note_mentions table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.note_mentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id uuid NOT NULL REFERENCES public.notes_log(id) ON DELETE CASCADE,
  mentioned_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  start_offset int NOT NULL,
  length int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS note_mentions_mentioned_user_idx
  ON public.note_mentions (mentioned_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS note_mentions_note_idx
  ON public.note_mentions (note_id);

ALTER TABLE public.note_mentions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS note_mentions_select_all ON public.note_mentions;
CREATE POLICY note_mentions_select_all
  ON public.note_mentions FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS note_mentions_insert_author ON public.note_mentions;
CREATE POLICY note_mentions_insert_author
  ON public.note_mentions FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.notes_log
      WHERE id = note_mentions.note_id
        AND author_id = auth.uid()
    )
  );

-- No UPDATE policy. No DELETE policy (CASCADE only).

GRANT SELECT, INSERT ON public.note_mentions TO authenticated;
GRANT ALL ON public.note_mentions TO service_role;

-- ============================================================================
-- 3. Extend notifications_dispatch_writer with a note_mentions branch.
--
-- CREATE OR REPLACE (same OID) so the existing tasks + projects triggers stay
-- bound. The new branch resolves the parent note's metadata + parent-entity
-- title + link_url, then POSTs event_type='mention' to notifications-dispatch.
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
  -- auth.uid() reads the JWT 'sub' claim from the current request context.
  -- When the trigger fires from a user-driven write (UI -> RLS-scoped client),
  -- the claim is populated and we get the acting user's id. When the trigger
  -- fires from a service-role or trigger-chained write, auth.uid() returns
  -- NULL; downstream dispatch treats NULL as "no actor" and skips self-exclusion.
  actor_uid := auth.uid();

  -- ── tasks ────────────────────────────────────────────────────────────────
  IF TG_TABLE_NAME = 'tasks' THEN
    -- task_assigned: fires when assignee_id is set on INSERT or changed on UPDATE.
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

    -- task_blocked: fires when status flips to 'Blocked' on UPDATE.
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

  -- ── note_mentions (Phase 5.7.2) ──────────────────────────────────────────
  IF TG_TABLE_NAME = 'note_mentions' THEN
    SELECT n.parent_type, n.parent_id, n.body, n.author_id
      INTO note_row
      FROM public.notes_log n
     WHERE n.id = NEW.note_id;

    IF note_row IS NULL THEN
      RETURN NEW;
    END IF;

    -- Resolve parent title + link_url by parent_type. Deliverables don't have
    -- their own detail route in HQ yet; link to the parent project per the
    -- activity-feed convention (formatSentence.ts deliverable branch).
    IF note_row.parent_type = 'task' THEN
      SELECT title INTO parent_title FROM public.tasks WHERE id = note_row.parent_id;
      link_url := '/tasks/' || note_row.parent_id::text;
    ELSIF note_row.parent_type = 'deliverable' THEN
      SELECT title INTO parent_title FROM public.deliverables WHERE id = note_row.parent_id;
      link_url := '/deliverables/' || note_row.parent_id::text;
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
-- 4. AFTER INSERT trigger on note_mentions
-- ============================================================================

DROP TRIGGER IF EXISTS trg_notifications_dispatch_note_mentions ON public.note_mentions;
CREATE TRIGGER trg_notifications_dispatch_note_mentions
  AFTER INSERT ON public.note_mentions
  FOR EACH ROW EXECUTE FUNCTION public.notifications_dispatch_writer();

-- ============================================================================
-- 5. activity_log writer for note_mentions
--
-- Dedicated sibling function (not reusing activity_log_writer) because the
-- generic writer keys entity_type from TG_TABLE_NAME; for mentions we want
-- entity_type to track the note's parent (task / deliverable / etc.), not
-- 'note_mentions'. Payload carries enough data for the activity feed to
-- render "Actor mentioned Mentioned-User in Parent" without a follow-up
-- SELECT (mentioned_user_full_name resolved here, not client-side).
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
      'snippet', LEFT(note_row.body, 140)
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_activity_log_note_mentions ON public.note_mentions;
CREATE TRIGGER trg_activity_log_note_mentions
  AFTER INSERT ON public.note_mentions
  FOR EACH ROW EXECUTE FUNCTION public.activity_log_writer_note_mention();

-- ============================================================================
-- 6. Backfill legacy text columns into notes_log.
--
-- Idempotent: NOT EXISTS guard skips rows that already have a notes_log entry
-- for their (parent_type, parent_id). The legacy `tasks.description` and
-- `deliverables.notes` columns stay on disk; the InternalNotesEditor takes
-- over the read/write surface for these notes.
-- ============================================================================

INSERT INTO public.notes_log (parent_type, parent_id, body, author_id, created_at)
SELECT 'task', t.id, t.description, t.created_by, COALESCE(t.updated_at, t.created_at)
  FROM public.tasks t
 WHERE t.description IS NOT NULL
   AND LENGTH(TRIM(t.description)) > 0
   AND NOT EXISTS (
     SELECT 1 FROM public.notes_log nl
     WHERE nl.parent_type = 'task' AND nl.parent_id = t.id
   );

INSERT INTO public.notes_log (parent_type, parent_id, body, author_id, created_at)
SELECT 'deliverable', d.id, d.notes, d.created_by, COALESCE(d.updated_at, d.created_at)
  FROM public.deliverables d
 WHERE d.notes IS NOT NULL
   AND LENGTH(TRIM(d.notes)) > 0
   AND NOT EXISTS (
     SELECT 1 FROM public.notes_log nl
     WHERE nl.parent_type = 'deliverable' AND nl.parent_id = d.id
   );
