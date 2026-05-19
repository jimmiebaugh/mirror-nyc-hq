-- ============================================================================
-- Phase 5.8.5: auth_rls_initplan policy rewrites.
--
-- Audit finding: 21 RLS policies across 8 tables called auth.uid() directly
-- in their USING / WITH CHECK clauses. Postgres evaluates such calls per-row
-- rather than once-per-statement. Wrapping as `(select auth.uid())` lets the
-- planner cache the value as an initplan, dropping CPU on large scans to
-- zero. Mechanical; zero behavior change.
--
-- This migration covers 17 of the 21 policies on 7 tables:
--   users (1), notifications (2), notes_log (2),
--   user_notification_preferences (4), saved_views (4),
--   note_mentions (1), vendor_ratings (3).
--
-- The remaining 4 credentials policies are rewritten alongside the F001
-- encryption work in 20260531150000_phase_5_8_5_credentials_policy_init_plan.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. users (1 policy)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS users_update ON public.users;
CREATE POLICY users_update ON public.users FOR UPDATE TO authenticated
  USING (id = (select auth.uid()) OR public.is_admin())
  WITH CHECK (id = (select auth.uid()) OR public.is_admin());

-- ----------------------------------------------------------------------------
-- 2. notifications (2 policies)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS notifications_select ON public.notifications;
CREATE POLICY notifications_select ON public.notifications FOR SELECT TO authenticated
  USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS notifications_update ON public.notifications;
CREATE POLICY notifications_update ON public.notifications FOR UPDATE TO authenticated
  USING (user_id = (select auth.uid()))
  WITH CHECK (user_id = (select auth.uid()));

-- ----------------------------------------------------------------------------
-- 3. notes_log (2 policies; notes_log_select is `USING (true)` and untouched)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS notes_log_insert ON public.notes_log;
CREATE POLICY notes_log_insert ON public.notes_log
  FOR INSERT TO authenticated
  WITH CHECK (author_id = (select auth.uid()));

DROP POLICY IF EXISTS notes_log_delete ON public.notes_log;
CREATE POLICY notes_log_delete ON public.notes_log
  FOR DELETE TO authenticated
  USING (
    author_id = (select auth.uid())
    OR public.is_admin()
  );

-- ----------------------------------------------------------------------------
-- 4. user_notification_preferences (4 policies)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS user_notification_preferences_own_select
  ON public.user_notification_preferences;
CREATE POLICY user_notification_preferences_own_select
  ON public.user_notification_preferences
  FOR SELECT TO authenticated
  USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS user_notification_preferences_own_insert
  ON public.user_notification_preferences;
CREATE POLICY user_notification_preferences_own_insert
  ON public.user_notification_preferences
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (select auth.uid()));

DROP POLICY IF EXISTS user_notification_preferences_own_update
  ON public.user_notification_preferences;
CREATE POLICY user_notification_preferences_own_update
  ON public.user_notification_preferences
  FOR UPDATE TO authenticated
  USING (user_id = (select auth.uid()))
  WITH CHECK (user_id = (select auth.uid()));

DROP POLICY IF EXISTS user_notification_preferences_own_delete
  ON public.user_notification_preferences;
CREATE POLICY user_notification_preferences_own_delete
  ON public.user_notification_preferences
  FOR DELETE TO authenticated
  USING (user_id = (select auth.uid()));

-- ----------------------------------------------------------------------------
-- 5. saved_views (4 policies, scope-aware per Phase 5.6.5)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS saved_views_select ON public.saved_views;
CREATE POLICY saved_views_select ON public.saved_views
  FOR SELECT TO authenticated
  USING (user_id = (select auth.uid()) OR scope = 'global');

DROP POLICY IF EXISTS saved_views_insert ON public.saved_views;
CREATE POLICY saved_views_insert ON public.saved_views
  FOR INSERT TO authenticated
  WITH CHECK (
    (scope = 'user' AND user_id = (select auth.uid()))
    OR
    (scope = 'global' AND (SELECT is_owner FROM public.users WHERE id = (select auth.uid())) = true)
  );

DROP POLICY IF EXISTS saved_views_update ON public.saved_views;
CREATE POLICY saved_views_update ON public.saved_views
  FOR UPDATE TO authenticated
  USING (
    (scope = 'user' AND user_id = (select auth.uid()))
    OR
    (scope = 'global' AND (SELECT is_owner FROM public.users WHERE id = (select auth.uid())) = true)
  )
  WITH CHECK (
    (scope = 'user' AND user_id = (select auth.uid()))
    OR
    (scope = 'global' AND (SELECT is_owner FROM public.users WHERE id = (select auth.uid())) = true)
  );

DROP POLICY IF EXISTS saved_views_delete ON public.saved_views;
CREATE POLICY saved_views_delete ON public.saved_views
  FOR DELETE TO authenticated
  USING (
    (scope = 'user' AND user_id = (select auth.uid()))
    OR
    (scope = 'global' AND (SELECT is_owner FROM public.users WHERE id = (select auth.uid())) = true)
  );

-- ----------------------------------------------------------------------------
-- 6. note_mentions (1 policy; note_mentions_select_all is `USING (true)` and untouched)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS note_mentions_insert_author ON public.note_mentions;
CREATE POLICY note_mentions_insert_author
  ON public.note_mentions FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.notes_log
      WHERE id = note_mentions.note_id
        AND author_id = (select auth.uid())
    )
  );

-- ----------------------------------------------------------------------------
-- 7. vendor_ratings (3 policies; vendor_ratings_select_authenticated is
--    `USING (true)` and untouched)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS vendor_ratings_insert_self ON public.vendor_ratings;
CREATE POLICY vendor_ratings_insert_self ON public.vendor_ratings
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (select auth.uid()));

DROP POLICY IF EXISTS vendor_ratings_update_self ON public.vendor_ratings;
CREATE POLICY vendor_ratings_update_self ON public.vendor_ratings
  FOR UPDATE TO authenticated
  USING (user_id = (select auth.uid()))
  WITH CHECK (user_id = (select auth.uid()));

DROP POLICY IF EXISTS vendor_ratings_delete_self ON public.vendor_ratings;
CREATE POLICY vendor_ratings_delete_self ON public.vendor_ratings
  FOR DELETE TO authenticated
  USING (user_id = (select auth.uid()));
