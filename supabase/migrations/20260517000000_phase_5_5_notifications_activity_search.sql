-- Phase 5.5: notifications dispatch + activity feed + search + states polish.
--
-- Spec: OUTPUTS/phase-5-5-spec.md § 9. Adds:
--   1. user_notification_preferences table (per-user, per-trigger toggles)
--   2. notifications.delivered_slack column (tracks Slack DM delivery)
--   3. notifications joins supabase_realtime publication + REPLICA IDENTITY FULL
--      so the bell badge can live-update via postgres_changes on INSERT.
--   4. notifications_dispatch_writer() trigger function + tasks / projects
--      triggers that POST to the notifications-dispatch edge function when
--      task assignment / task status / project status events occur.
--   5. handle_new_user() rewrite: calls notifications-dispatch with
--      event_type='user_pending' instead of notify-admin-of-pending-user.
--      The legacy function stays deployed (one-phase fallback).
--   6. pg_cron schedules for deliverable_due_3d (09:00 ET / 13:00 UTC),
--      task_due_today (08:00 ET / 12:00 UTC), event_date_today (07:00 ET /
--      11:00 UTC). Each invokes a dedicated cron edge function which queries
--      the relevant table and fans out to notifications-dispatch per recipient.
--
-- Cron caveats: same as Phase 3.8. The pg_cron jobs no-op (with WARNING) if
-- app.supabase_url / app.internal_api_secret GUCs are unset. Production has
-- them set; if a fresh-clone DB lacks them, set them per the Phase 3.8 header.
--
-- Reversibility: additive. The new table cascades on user delete; the new
-- column defaults false; the realtime publication add is harmless to existing
-- subscribers; the cron jobs unschedule cleanly on rollback.

-- ============================================================================
-- 1. user_notification_preferences table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.user_notification_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  trigger_key text NOT NULL,
  in_app boolean NOT NULL DEFAULT true,
  slack_dm boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, trigger_key)
);

CREATE INDEX IF NOT EXISTS user_notification_preferences_user_idx
  ON public.user_notification_preferences (user_id);

ALTER TABLE public.user_notification_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_notification_preferences_own_select
  ON public.user_notification_preferences;
CREATE POLICY user_notification_preferences_own_select
  ON public.user_notification_preferences
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS user_notification_preferences_own_insert
  ON public.user_notification_preferences;
CREATE POLICY user_notification_preferences_own_insert
  ON public.user_notification_preferences
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS user_notification_preferences_own_update
  ON public.user_notification_preferences;
CREATE POLICY user_notification_preferences_own_update
  ON public.user_notification_preferences
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS user_notification_preferences_own_delete
  ON public.user_notification_preferences;
CREATE POLICY user_notification_preferences_own_delete
  ON public.user_notification_preferences
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.user_notification_preferences TO authenticated;
GRANT ALL ON public.user_notification_preferences TO service_role;

DROP TRIGGER IF EXISTS trg_user_notification_preferences_updated_at
  ON public.user_notification_preferences;
CREATE TRIGGER trg_user_notification_preferences_updated_at
  BEFORE UPDATE ON public.user_notification_preferences
  FOR EACH ROW EXECUTE FUNCTION public.updated_at_auto();

-- ============================================================================
-- 2. notifications.delivered_slack column
-- ============================================================================

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS delivered_slack boolean NOT NULL DEFAULT false;

-- ============================================================================
-- 3. notifications realtime publication + REPLICA IDENTITY FULL
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'notifications'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications';
  END IF;
END $$;

ALTER TABLE public.notifications REPLICA IDENTITY FULL;

-- ============================================================================
-- 4. notifications_dispatch_writer trigger function
--
-- Wired to:
--   - tasks AFTER INSERT OR UPDATE: when assignee_id is set/changed, fire
--     task_assigned to the new assignee. When status changes to 'blocked',
--     fire task_blocked to the creator.
--   - projects AFTER UPDATE: when status changes, fire project_status_changed
--     to every project_account_managers row for the project.
--
-- The trigger function POSTs to notifications-dispatch via
-- public.invoke_edge_function (same Phase 3.8 self-invoke pattern); failures
-- are non-fatal because invoke_edge_function captures errors as RAISE WARNING.
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
    -- task_status enum (post-5.2.1 reshape): 'To Do' | 'Doing' | 'Blocked' | 'Done'.
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
    -- project_status_changed: fires when status changes on UPDATE.
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

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notifications_dispatch_tasks ON public.tasks;
CREATE TRIGGER trg_notifications_dispatch_tasks
  AFTER INSERT OR UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.notifications_dispatch_writer();

DROP TRIGGER IF EXISTS trg_notifications_dispatch_projects ON public.projects;
CREATE TRIGGER trg_notifications_dispatch_projects
  AFTER UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.notifications_dispatch_writer();

-- ============================================================================
-- 5. handle_new_user rewrite: call notifications-dispatch instead of
--    notify-admin-of-pending-user.
--
-- The legacy function stays deployed for one phase as a fallback; we only
-- redirect the trigger. The durable notifications rows for active admins
-- still get written here (the dispatch function would write them too, but
-- doing it in the trigger keeps the in-app signal independent of the edge
-- function's success).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_email text := NEW.email;
  admin_ids uuid[];
BEGIN
  -- Mirror the auth.users row into public.users with the pending default.
  INSERT INTO public.users (id, email, full_name, avatar_url, permission_role, active)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'avatar_url',
    'pending',
    true
  )
  ON CONFLICT (id) DO NOTHING;

  -- Durable in-app signal: one notifications row per active admin. The bell
  -- panel (Phase 5.5) surfaces these; the Team page queries
  -- `users WHERE permission_role = 'pending'` directly.
  INSERT INTO public.notifications (user_id, type, title, body, link_url, delivered_in_app)
  SELECT
    u.id,
    'user_pending',
    new_email || ' is awaiting tier assignment',
    'Open the Team page to assign Admin, Standard, or Freelance.',
    '/users',
    true
  FROM public.users u
  WHERE u.permission_role = 'admin' AND u.active = true;

  -- Out-of-band signal: notifications-dispatch handles the admin email path
  -- (event_type='user_pending' preserves the legacy email behavior). Skipped
  -- with a WARNING if the GUCs aren't set, so this never fails the signup.
  SELECT COALESCE(array_agg(u.id), ARRAY[]::uuid[])
    INTO admin_ids
    FROM public.users u
   WHERE u.permission_role = 'admin' AND u.active = true;

  IF array_length(admin_ids, 1) IS NOT NULL THEN
    PERFORM public.invoke_edge_function(
      'notifications-dispatch',
      jsonb_build_object(
        'event_type', 'user_pending',
        'entity_type', 'user',
        'entity_id', NEW.id,
        'entity_name', new_email,
        'recipient_user_ids', to_jsonb(admin_ids),
        'actor_id', NULL,
        'extra', jsonb_build_object('email', new_email)
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================================
-- 6. pg_cron schedules for daily notification jobs.
--
-- Each cron entry invokes a dedicated edge function which does the heavy
-- lifting (query the table, resolve recipients, call notifications-dispatch
-- per row). Cadences land at ET hours offset to UTC (UTC = ET + 4 hours
-- during EDT; accepting EDT/EST drift the same way ts-cron-scheduled-pulls
-- does).
--
-- The cron callers themselves are added in the dispatch function rollout;
-- the schedules just hit edge function endpoints by name. If those functions
-- aren't deployed yet the call 404s and net.http_post logs the failure
-- without trigger fallout.
-- ============================================================================

DO $$
DECLARE
  job_name text;
BEGIN
  FOR job_name IN SELECT unnest(ARRAY[
    'hq-cron-deliverable-due-3d',
    'hq-cron-task-due-today',
    'hq-cron-event-date-today'
  ])
  LOOP
    PERFORM cron.unschedule(job_name) FROM cron.job WHERE jobname = job_name;
  END LOOP;
END $$;

SELECT cron.schedule(
  'hq-cron-deliverable-due-3d',
  '0 13 * * *',
  $cron$ SELECT public.invoke_edge_function('hq-cron-deliverable-due-3d', '{}'::jsonb); $cron$
);

SELECT cron.schedule(
  'hq-cron-task-due-today',
  '0 12 * * *',
  $cron$ SELECT public.invoke_edge_function('hq-cron-task-due-today', '{}'::jsonb); $cron$
);

SELECT cron.schedule(
  'hq-cron-event-date-today',
  '0 11 * * *',
  $cron$ SELECT public.invoke_edge_function('hq-cron-event-date-today', '{}'::jsonb); $cron$
);
