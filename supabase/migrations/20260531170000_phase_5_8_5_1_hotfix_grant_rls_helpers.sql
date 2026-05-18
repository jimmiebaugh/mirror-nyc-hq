-- Phase 5.8.5.1 hotfix: re-GRANT EXECUTE on RLS helper functions to authenticated.
--
-- 5.8.5 migration #7 (20260531160000_phase_5_8_5_revoke_from_public.sql)
-- REVOKE'd EXECUTE FROM PUBLIC on these 3 helpers without re-GRANTing to
-- authenticated, on the assumption that SQL function inlining would
-- skip the permission check. Wrong: SECURITY DEFINER blocks inlining;
-- every caller (including RLS predicate evaluation) needs EXECUTE.
-- Production TS open-roles list went empty within seconds of the push;
-- Jimmie noticed within minutes; hotfix GRANT applied via Supabase
-- Dashboard SQL editor 2026-05-18, production restored immediately.
--
-- This migration records the GRANTs in the tree so future rebuilds
-- re-apply them. GRANTs are idempotent; running this against prod is
-- a no-op since the dashboard hotfix already granted these.
--
-- Memory: feedback_revoke_execute_check_rls_callers.md.

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_producer_or_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;
