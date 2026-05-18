-- Phase 5.7.12 follow-up: allow non-admins to edit their own full_name
-- from /settings/profile. The first 5.7.12 migration added full_name to
-- the admin-only column gate; Jimmie's smoke pass flipped the call so
-- users own their displayed name.
--
-- Remaining gated columns (non-admin self-write blocked):
--   - permission_role  (tier escalation)
--   - active           (deactivation bypass)
--   - is_owner         (owner delegation bypass)
--   - email            (auth identity bypass)
--
-- email stays gated because it's the auth identity (Google OAuth match
-- key in handle_new_user); changing it client-side would orphan the row
-- from the auth.users record on next sign-in.

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
  RETURN NEW;
END;
$$;
