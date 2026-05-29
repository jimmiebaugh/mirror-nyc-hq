-- ============================================================================
-- Phase 5.16.1.2: Supabase Studio advisor focused fixes.
--
-- Closes the real, low-risk advisor findings; the rest are documented as
-- intentional (see docs/auth-model.md § "Intentional SECURITY DEFINER advisor
-- warnings") or deferred (see docs/decisions.md § Phase 5.16.1.2).
--
-- Four sections, all idempotent + reversible (down steps in the PR description):
--   1. §3a Bulk-import RPC GRANT lockdown (4 functions -> service_role only).
--   2. §3b Trigger function GRANT lockdown (2 functions).
--   3. §3c RLS policy init-plan wraps (2 policies).
--   4. §3d Selective FK indexes (6 plain CREATE INDEX IF NOT EXISTS).
--
-- VERIFIED against the linked project (Phase 5.16.1.2 working tree):
--   - No RLS policy references any REVOKE target (pg_policies grep clean);
--     the bulk-import RPCs are commit functions, not RLS predicate helpers,
--     so the REVOKE is safe per feedback_revoke_execute_check_rls_callers.
--   - The bulk-import edge function (supabase/functions/bulk-import/index.ts)
--     gates permission_role='admin' via a user-client, then invokes every RPC
--     through a SUPABASE_SERVICE_ROLE_KEY client. Zero frontend .rpc() callers.
--   - bulk_import_drafts column is `author` (not `author_id`).
--   - All 6 FK index targets are genuinely unindexed (each join PK leads with
--     the OTHER column; notes_log_parent_idx / vendor_ratings_vendor_idx don't
--     cover author_id / user_id).
--
-- SPEC DEVIATION (approved 2026-05-28): users_align_id_to_auth KEEPS its
-- `authenticated` grant. The Team-page add-member flow inserts users from the
-- browser as `authenticated` (src/pages/team/TeamMemberEdit.tsx:171), which
-- fires the BEFORE INSERT trg_users_align_id_to_auth in the authenticated role
-- context; trigger-function EXECUTE IS enforced here (the cause of the
-- 2026-05-19 sign-in lockout, Phase 5.8.8). Revoking would break add-member.
-- auth-model.md:132 documents this. We revoke only anon + PUBLIC; the residual
-- advisor 0029 flag is documented as intentional (parallels
-- users_protect_admin_columns).
--
-- Memory: feedback_revoke_execute_check_rls_callers,
-- project_users_column_trigger_gate, feedback_handle_new_user_swap_path_load_bearing.
-- ============================================================================


-- 1. §3a Bulk-import RPC GRANT lockdown --------------------------------------
--    Invoked only by the bulk-import edge function via the service-role client.
--    The in-function actor_id admin re-check stays as defense in depth.

REVOKE EXECUTE ON FUNCTION public.bulk_import_commit_projects(jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.bulk_import_commit_projects(jsonb) TO service_role;

REVOKE EXECUTE ON FUNCTION public.bulk_import_commit_vendors(jsonb)  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.bulk_import_commit_vendors(jsonb)  TO service_role;

REVOKE EXECUTE ON FUNCTION public.bulk_import_commit_venues(jsonb)   FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.bulk_import_commit_venues(jsonb)   TO service_role;

REVOKE EXECUTE ON FUNCTION public.bulk_import_undo(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.bulk_import_undo(uuid, uuid, boolean) TO service_role;


-- 2. §3b Trigger function GRANT lockdown -------------------------------------

-- users_align_id_to_auth: BEFORE INSERT on public.users. Fires from
--   - authenticated (Team-page add-member insert, TeamMemberEdit.tsx:171), and
--   - service_role (other server-side inserts).
-- KEEP authenticated + service_role (load-bearing). Revoke only anon + PUBLIC.
-- The function was created via CREATE OR REPLACE in 5.8.8 and never had PUBLIC
-- revoked, which is why the advisor flags it anon-callable (0028).
REVOKE EXECUTE ON FUNCTION public.users_align_id_to_auth() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.users_align_id_to_auth() TO authenticated, service_role;

-- users_protect_admin_columns: BEFORE UPDATE on public.users. Fires from
-- authenticated (Profile Settings + Team-page edits) and supabase_auth_admin
-- (the swap UPDATE inside handle_new_user). KEEP both grants (Phase 5.8.8).
-- Re-assert the known-good ACL; revoke anon + PUBLIC defensively.
REVOKE EXECUTE ON FUNCTION public.users_protect_admin_columns() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.users_protect_admin_columns() TO supabase_auth_admin, authenticated;


-- 3. §3c RLS policy init-plan wraps ------------------------------------------
--    Wrap auth.uid() in (select ...) so the planner evaluates it once per
--    query (InitPlan) instead of once per row. Behavior-identical; query plan
--    improves. Pattern per Phase 5.8.5 credentials_* rewrite.

-- bulk_import_drafts: author-scoped FOR ALL. Original (5.9.1) used the bare
-- `author = auth.uid()` shape; column is `author`.
DROP POLICY IF EXISTS bulk_import_drafts_author_all ON public.bulk_import_drafts;
CREATE POLICY bulk_import_drafts_author_all
  ON public.bulk_import_drafts
  FOR ALL TO authenticated
  USING (author = (select auth.uid()))
  WITH CHECK (author = (select auth.uid()));

-- anthropic_call_log: admin-only SELECT. Original (5.15) used the bare
-- `id = auth.uid()` shape inside the EXISTS.
DROP POLICY IF EXISTS anthropic_call_log_admin_read ON public.anthropic_call_log;
CREATE POLICY anthropic_call_log_admin_read
  ON public.anthropic_call_log
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.users
       WHERE id = (select auth.uid())
         AND permission_role = 'admin'
    )
  );


-- 4. §3d Selective FK indexes ------------------------------------------------
--    Plain CREATE INDEX (not CONCURRENTLY) because supabase db push wraps the
--    migration in a transaction; CONCURRENTLY cannot run inside one. At
--    Mirror's row counts the write-time lock window is negligible.
--    Each target FK column is unverified-unindexed (see header). The ~30
--    audit-column (_created_by / _updated_by) FKs are deferred (decisions.md).

CREATE INDEX IF NOT EXISTS project_account_managers_user_id_idx
  ON public.project_account_managers (user_id);

CREATE INDEX IF NOT EXISTS project_designers_user_id_idx
  ON public.project_designers (user_id);

CREATE INDEX IF NOT EXISTS vendor_ratings_user_id_idx
  ON public.vendor_ratings (user_id);

CREATE INDEX IF NOT EXISTS users_department_id_idx
  ON public.users (department_id);

CREATE INDEX IF NOT EXISTS notes_log_author_id_idx
  ON public.notes_log (author_id);

-- project_venues PK is (project_id, venue_id); the composite leads with
-- project_id, so venue->project reverse lookups (e.g. "which projects use this
-- venue") are unindexed. This adds the trailing-column index.
CREATE INDEX IF NOT EXISTS project_venues_venue_id_idx
  ON public.project_venues (venue_id);
