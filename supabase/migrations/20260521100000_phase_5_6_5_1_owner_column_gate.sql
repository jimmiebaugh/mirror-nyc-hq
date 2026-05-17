-- Phase 5.6.5.1: Extend users_protect_admin_columns trigger to gate
-- is_owner writes to owners only. Matches the existing pattern for
-- permission_role + active (admin-gated).
--
-- Why a SELECT against public.users and not a helper function: mirrors
-- the inline-SELECT shape from the 5.6.5 RLS policies
-- ((SELECT is_owner FROM users WHERE id = auth.uid()) = true). Avoids
-- introducing an is_owner() SQL function that would later need
-- policy-dependency audits if dropped.
--
-- Why no self-revoke: prevents the last-owner-locks-themselves-out
-- failure mode as a side effect. To step down, another owner must
-- revoke them. UI also disables the checkbox when editing your own row
-- so the rule is visible before save.
--
-- Spec: OUTPUTS/phase-5-6-5-1-spec.md § 5. Decisions log: spec § 14.

BEGIN;

CREATE OR REPLACE FUNCTION public.users_protect_admin_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.permission_role IS DISTINCT FROM NEW.permission_role AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can change permission_role';
  END IF;
  IF OLD.active IS DISTINCT FROM NEW.active AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can change active status';
  END IF;
  IF OLD.is_owner IS DISTINCT FROM NEW.is_owner THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND is_owner = true
    ) THEN
      RAISE EXCEPTION 'Only owners can change is_owner';
    END IF;
    -- Owners can't revoke their own owner flag. To step down, another
    -- owner has to do it for them. Prevents the last-owner-accidentally-
    -- locks-themselves-out failure mode as a side effect.
    IF NEW.id = auth.uid() AND OLD.is_owner = true AND NEW.is_owner = false THEN
      RAISE EXCEPTION 'Owners cannot revoke their own owner status';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
