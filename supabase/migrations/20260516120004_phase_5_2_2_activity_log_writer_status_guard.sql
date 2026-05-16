-- Phase 5.2.2.I: harden activity_log_writer against tables without a status column.
--
-- The shipped function evaluated `OLD.status IS DISTINCT FROM NEW.status` inside
-- an AND expression that doesn't short-circuit on RECORD field access. Any UPDATE
-- on a table without a status column (people, organizations, venues, the new
-- lookup tables) crashed with "record OLD has no field status".
--
-- Fix: nest the table-name guard so the field access only runs for status-
-- bearing tables, and use to_jsonb()->>'status' as defense-in-depth (returns
-- NULL on missing keys instead of erroring).

BEGIN;

CREATE OR REPLACE FUNCTION public.activity_log_writer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_action text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.activity_log (entity_type, entity_id, action, actor_id, payload)
    VALUES (TG_TABLE_NAME, OLD.id, 'deleted', auth.uid(), to_jsonb(OLD));
    RETURN OLD;
  ELSIF TG_OP = 'INSERT' THEN
    v_action := 'created';
  ELSIF TG_OP = 'UPDATE' THEN
    v_action := 'updated';
    IF TG_TABLE_NAME IN ('projects', 'tasks', 'deliverables') THEN
      IF to_jsonb(OLD)->>'status' IS DISTINCT FROM to_jsonb(NEW)->>'status' THEN
        v_action := 'status_changed';
      END IF;
    END IF;
  END IF;
  INSERT INTO public.activity_log (entity_type, entity_id, action, actor_id, payload)
  VALUES (TG_TABLE_NAME, NEW.id, v_action, auth.uid(), to_jsonb(NEW));
  RETURN NEW;
END;
$func$;

COMMIT;
