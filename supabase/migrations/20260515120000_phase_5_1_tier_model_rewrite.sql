-- Phase 5.1: tier model rewrite.
--
-- Replaces the shipped 3-tier model (member / producer / admin) with the
-- locked Phase 5 4-tier model (admin / standard / freelance / pending). New
-- signups default to `pending` so an admin assigns the actual tier from the
-- Team page (lands in 5.4).
--
-- Backfill (per spec § 3 step 3):
--   admin    -> admin
--   producer -> admin     -- every producer in public.users today is also an
--                            admin in practice; producer-only gating was never
--                            wired in code. Folding into admin is conservative.
--                            If any producer was meant to be Standard, an admin
--                            flips individuals from the Team page in 5.4.
--   member   -> standard
--
-- The migration also rewrites `handle_new_user` so new signups land in
-- `pending` and writes a `notifications` row per existing admin so the bell
-- + Team page can surface the pending user once 5.4 / 5.5 land. The trigger
-- ALSO fires `notify-admin-of-pending-user` via `public.invoke_edge_function`
-- (Phase 3.8 helper) so an out-of-band admin email goes out immediately.
-- `invoke_edge_function` no-ops with a WARNING when the GUCs aren't set, so
-- this migration is safe to apply before the edge function is deployed.
--
-- `is_producer_or_admin()` previously read `permission_role IN ('producer',
-- 'admin')`; the 'producer' literal would error against the new enum. The
-- function is renamed semantically to "standard or admin" via body rewrite
-- (`permission_role IN ('admin', 'standard')`). Net effect: storage policies
-- that previously gated producer-or-admin (the master `venue_photos` bucket
-- write/update/delete) now gate Standard or Admin, which preserves intent
-- (block Freelance + Pending from master-venue photo writes). The function
-- NAME stays for compatibility with the VS storage policies that haven't
-- been rewritten yet; the body change is documented inline.
--
-- `is_admin()` body is unchanged. It references only the literal 'admin'
-- which is valid in both the old and new enum, so it keeps working through
-- the column-type swap.
--
-- `current_user_role()` returns `public.permission_role`. Because the type's
-- column reference is gone after the swap but the function's return-type
-- reference remains, we drop and recreate the function around the type swap.

-- ============================================================================
-- 1. New enum + column-type swap (preserves data via the USING backfill).
-- ============================================================================

CREATE TYPE public.permission_role_new AS ENUM ('admin', 'standard', 'freelance', 'pending');

-- Drop the column default first (its value is bound to the old enum type).
ALTER TABLE public.users ALTER COLUMN permission_role DROP DEFAULT;

-- Swap the column type, mapping every existing value into the new enum. The
-- ELSE 'pending' fallback covers any row in a state outside the three known
-- values (e.g. drift from a failed prior migration); without it the USING
-- result for an unmapped row would be NULL and the NOT NULL constraint
-- would abort the migration with a cryptic message.
ALTER TABLE public.users
  ALTER COLUMN permission_role TYPE public.permission_role_new
  USING (
    CASE permission_role::text
      WHEN 'admin'    THEN 'admin'::public.permission_role_new
      WHEN 'producer' THEN 'admin'::public.permission_role_new
      WHEN 'member'   THEN 'standard'::public.permission_role_new
      ELSE                 'pending'::public.permission_role_new
    END
  );

-- Set the new default. New signups land in `pending` until an admin assigns.
ALTER TABLE public.users
  ALTER COLUMN permission_role SET DEFAULT 'pending'::public.permission_role_new;

-- ============================================================================
-- 2. Drop functions that still reference the OLD permission_role type, then
--    drop the old type, then rename the new type to claim the canonical name.
-- ============================================================================

-- `current_user_role()` returns the old type; cannot drop the type until
-- the function is gone. Recreated below.
DROP FUNCTION IF EXISTS public.current_user_role();

-- `is_producer_or_admin()` body has a literal 'producer' that would fail
-- against the new enum the next time it runs. Drop and recreate with new
-- semantics (Standard or Admin) so the master-venue-photos storage policies
-- keep working without a wide-RLS rewrite in this sub-phase.
DROP FUNCTION IF EXISTS public.is_producer_or_admin();

-- Now drop the orphaned old type.
DROP TYPE public.permission_role;

-- Rename the new type to claim the canonical name.
ALTER TYPE public.permission_role_new RENAME TO permission_role;

-- ============================================================================
-- 3. Recreate the dropped helpers with the (now renamed) type.
-- ============================================================================

CREATE FUNCTION public.current_user_role()
RETURNS public.permission_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT permission_role FROM public.users WHERE id = auth.uid();
$$;

-- New semantics: Standard or Admin. Phase 5 tier model has no `producer`;
-- the function name stays for backward compatibility with shipped storage
-- policies that still reference it (master `venue_photos` bucket).
CREATE FUNCTION public.is_producer_or_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT permission_role IN ('admin', 'standard') FROM public.users WHERE id = auth.uid()),
    false
  );
$$;

GRANT EXECUTE ON FUNCTION public.current_user_role()      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_producer_or_admin()   TO authenticated, service_role;

-- ============================================================================
-- 4. Rewrite handle_new_user: insert as `pending`, write notifications rows
--    for every active admin, and fire the admin-notification edge function.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_email text := NEW.email;
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
  -- panel (lands Phase 5.5) will surface these; the Team page (lands Phase
  -- 5.4) will also query `users WHERE permission_role = 'pending'` directly.
  INSERT INTO public.notifications (user_id, type, title, body, link_url)
  SELECT
    u.id,
    'user_pending',
    new_email || ' is awaiting tier assignment',
    'Open the Team page to assign Admin, Standard, or Freelance.',
    '/team'
  FROM public.users u
  WHERE u.permission_role = 'admin' AND u.active = true;

  -- Immediate out-of-band signal: admin email via the notify-admin-of-pending-user
  -- edge function. Skipped (with a WARNING) if the GUCs aren't set, so this
  -- never fails the signup. Phase 5.5's `notifications-dispatch` will absorb
  -- this function.
  PERFORM public.invoke_edge_function(
    'notify-admin-of-pending-user',
    jsonb_build_object('user_id', NEW.id, 'email', new_email)
  );

  RETURN NEW;
END;
$$;
