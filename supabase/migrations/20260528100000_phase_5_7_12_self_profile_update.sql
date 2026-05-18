-- Phase 5.7.12: harden the column gate on public.users so the new
-- /settings/profile surface (Standard + Freelance self-writes) cannot
-- escalate beyond the whitelisted columns.
--
-- Spec deviation (recorded in COWORK_SYNC.md): the spec proposed a
-- separate users_update_self policy + an additive column-list GRANT.
-- Both are no-ops against the live schema:
--   * users_update already permits self-writes via
--     `USING (id = auth.uid() OR public.is_admin())`.
--   * authenticated already holds `GRANT SELECT, UPDATE, DELETE ON
--     public.users` (whole-table), so an additive column-list GRANT
--     does not restrict the writable set in Postgres.
-- The real gap is the existing `users_protect_admin_columns` trigger
-- which guards only `permission_role` + `active`. Self-writes to
-- `is_owner`, `email`, `full_name`, and `avatar_url` were unprotected.
--
-- This migration extends the trigger function to also block non-admin
-- changes to those columns. Admin paths (TeamMemberEdit form, TierPopover)
-- are unaffected because `public.is_admin()` returns true for them.
--
-- avatar_url is intentionally NOT gated here: useAuth re-stamps
-- users.avatar_url on session resolve when the Google OAuth metadata
-- URL differs from the stored row (src/hooks/useAuth.tsx). That path
-- runs under the user's JWT, so blocking it in the trigger would
-- break every non-admin sign-in. The /settings/profile UI exposes
-- avatar_url read-only this sub-phase, so the surface-level escalation
-- vector is narrow (deface own profile photo via devtools, no impact
-- on others). When 5.7.14 Leftovers adds photo upload, gating moves
-- to a storage policy on the avatars bucket instead of a column gate.

CREATE OR REPLACE FUNCTION public.users_protect_admin_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_admin() THEN
    RETURN NEW;
  END IF;
  IF OLD.permission_role IS DISTINCT FROM NEW.permission_role THEN
    RAISE EXCEPTION 'Only admins can change permission_role';
  END IF;
  IF OLD.active IS DISTINCT FROM NEW.active THEN
    RAISE EXCEPTION 'Only admins can change active status';
  END IF;
  IF OLD.is_owner IS DISTINCT FROM NEW.is_owner THEN
    RAISE EXCEPTION 'Only admins can change owner status';
  END IF;
  IF OLD.email IS DISTINCT FROM NEW.email THEN
    RAISE EXCEPTION 'Only admins can change email';
  END IF;
  IF OLD.full_name IS DISTINCT FROM NEW.full_name THEN
    RAISE EXCEPTION 'Only admins can change full_name';
  END IF;
  RETURN NEW;
END;
$$;
