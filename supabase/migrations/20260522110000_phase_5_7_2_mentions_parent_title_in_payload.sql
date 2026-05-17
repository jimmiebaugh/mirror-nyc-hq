-- Phase 5.7.2 follow-up: include parent_title in the activity_log payload
-- written by `activity_log_writer_note_mention`. Lets the activity feed +
-- Home RecentActivityCard render "User A mentioned User B in TaskX" with the
-- parent as a click-through link instead of the original "in this task"
-- generic phrasing.
--
-- Strictly additive: CREATE OR REPLACE keeps the same OID (no DROP), the
-- trigger binding survives, and the payload shape gains a key without
-- changing existing ones. Idempotent.

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

  -- Resolve parent_title per parent_type. The same mapping the
  -- notifications_dispatch_writer note_mentions branch uses; kept inline
  -- (and not factored into a helper) because the two functions are SECURITY
  -- DEFINER and intentionally self-contained per the 5.6.5.1 dep lesson.
  IF note_row.parent_type = 'task' THEN
    SELECT title INTO parent_title FROM public.tasks WHERE id = note_row.parent_id;
  ELSIF note_row.parent_type = 'deliverable' THEN
    SELECT title INTO parent_title FROM public.deliverables WHERE id = note_row.parent_id;
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
