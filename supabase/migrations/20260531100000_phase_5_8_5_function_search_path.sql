-- ============================================================================
-- Phase 5.8.5: function_search_path_mutable cleanup.
--
-- Audit finding: Supabase advisor flagged 5 functions whose search_path is
-- not pinned. Each function is SECURITY DEFINER (or invoked from RLS), so
-- a mutable search_path is a privilege-escalation surface. Pin to
-- `public, pg_temp` (lookups against public, no temp-table override).
--
-- Zero behavior change. Mechanical ALTER FUNCTION x 5.
-- ============================================================================

ALTER FUNCTION public.updated_at_auto()
  SET search_path = public, pg_temp;

ALTER FUNCTION public.ts_roles_closed_at_set()
  SET search_path = public, pg_temp;

ALTER FUNCTION public.tasks_completed_at_set()
  SET search_path = public, pg_temp;

ALTER FUNCTION public.invoke_edge_function(text, jsonb)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.deliverables_completed_at_set()
  SET search_path = public, pg_temp;
