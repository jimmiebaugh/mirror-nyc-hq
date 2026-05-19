-- ============================================================================
-- Phase 5.8.5: REVOKE EXECUTE on SECURITY DEFINER functions.
--
-- Audit finding: 11 SECURITY DEFINER functions had broad EXECUTE grants to
-- `anon` / `authenticated`. Trigger functions are never called directly via
-- PostgREST; revoke from both roles. RLS-helper functions
-- (current_user_role / is_admin / is_producer_or_admin) had ZERO direct
-- `.rpc(...)` call sites in src/ as of 2026-05-18; revoke from both roles
-- (the planner still inlines them into RLS policy expressions; the REVOKE
-- only affects direct PostgREST RPC calls). promote_outlook_to_project is a
-- legitimate RPC; revoke anon only.
--
-- rls_auto_enable was flagged by the advisor but does not appear in our
-- migration history (possible Phase 3 cruft). Guarded with DO/IF EXISTS so
-- the migration succeeds whether or not the function lives in prod.
-- ============================================================================

-- 7 trigger functions: REVOKE from anon + authenticated.
REVOKE EXECUTE ON FUNCTION public.activity_log_writer()                 FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.activity_log_writer_note_mention()    FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user()                     FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notifications_dispatch_writer()       FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.users_protect_admin_columns()         FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.vs_candidate_venues_shortlist_sync()  FROM anon, authenticated;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'rls_auto_enable'
  ) THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon, authenticated';
  END IF;
END$$;

-- 3 RLS helpers: zero direct RPC call sites in src/ per 2026-05-18 grep.
-- REVOKE from both roles; planner-inlined RLS usage continues to work.
REVOKE EXECUTE ON FUNCTION public.current_user_role()       FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_admin()                FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_producer_or_admin()    FROM anon, authenticated;

-- 1 legitimate RPC consumed by the UI: anon only.
REVOKE EXECUTE ON FUNCTION public.promote_outlook_to_project(uuid) FROM anon;
