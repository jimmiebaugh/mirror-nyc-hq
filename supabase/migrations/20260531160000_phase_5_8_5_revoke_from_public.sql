-- ============================================================================
-- Phase 5.8.5: PUBLIC-grant revoke for SECURITY DEFINER functions.
--
-- Migration 20260531110000 issued `REVOKE EXECUTE ... FROM anon, authenticated`
-- on these functions, but Postgres's default for every CREATE FUNCTION is
-- an implicit `GRANT EXECUTE TO PUBLIC`. PUBLIC includes anon AND
-- authenticated, so the role-specific REVOKE had no observable effect.
-- The advisor `*_security_definer_function_executable` counts confirmed
-- the leak (both family counts went UP after the partial fix).
--
-- This migration revokes from PUBLIC and re-grants to the roles that
-- actually need EXECUTE:
--   * 6 trigger functions (+ rls_auto_enable if it exists) — no GRANT
--     needed; trigger invocation runs under the function owner's role
--     and ignores caller EXECUTE privilege.
--   * 3 RLS helpers (current_user_role / is_admin / is_producer_or_admin)
--     — LANGUAGE sql STABLE; the planner inlines them inside RLS policy
--     expressions, so no caller EXECUTE is needed. Zero `.rpc(...)` call
--     sites in src/ as of 2026-05-18.
--   * promote_outlook_to_project(uuid) — legitimate UI RPC; re-GRANT
--     to authenticated only.
--   * credentials_create / credentials_set_password /
--     credentials_reveal_password — intentional SECURITY DEFINER RPCs;
--     re-GRANT to authenticated. These continue to appear in the
--     `authenticated_security_definer_function_executable` advisor family
--     as the documented F001 carve-out.
-- ============================================================================

REVOKE EXECUTE ON FUNCTION public.activity_log_writer()                 FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.activity_log_writer_note_mention()    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user()                     FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notifications_dispatch_writer()       FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.users_protect_admin_columns()         FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.vs_candidate_venues_shortlist_sync()  FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'rls_auto_enable'
  ) THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC';
  END IF;
END$$;

REVOKE EXECUTE ON FUNCTION public.current_user_role()       FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_admin()                FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_producer_or_admin()    FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.promote_outlook_to_project(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.promote_outlook_to_project(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.credentials_set_password(uuid, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.credentials_set_password(uuid, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.credentials_reveal_password(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.credentials_reveal_password(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.credentials_create(text, text, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.credentials_create(text, text, text, text) TO authenticated;
