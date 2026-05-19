-- Phase 5.8.8 hotfix: auth pre-provisioning sign-in regression.
--
-- Three layers, all idempotent:
--
-- 1. GRANT EXECUTE on the two SECURITY DEFINER functions that the
--    supabase_auth_admin role and (for the BEFORE UPDATE protect trigger)
--    the authenticated role must be able to invoke. Phase 5.8.5
--    REVOKE'd EXECUTE FROM PUBLIC and the 5.8.5.1 hotfix only re-GRANTed
--    the three RLS predicate helpers. These two slipped through, breaking
--    every new sign-in until applied via Dashboard SQL editor on
--    2026-05-19. Recording here so a fresh `supabase db reset` rebuilds
--    the state correctly.
--
-- 2. CREATE OR REPLACE handle_new_user with the Phase 5.4 pre-provisioning
--    swap path PRESERVED and the new-user email dispatch scoped to active
--    OWNERS instead of all admins (decision 2026-05-19 PM: bell-panel goes
--    to all admins, email to owners only to reduce noise). Phase 5.5's
--    notifications rewrite silently dropped the swap block; this body is
--    the authoritative form. The swap block is load-bearing — DO NOT
--    remove on any future CREATE OR REPLACE.
--
-- 3. NEW: users_align_id_to_auth BEFORE INSERT trigger on public.users.
--    The Phase 5.4 swap path only fires on auth.users INSERT. If the
--    user signs in BEFORE being pre-provisioned (or an admin deletes a
--    pending row and re-creates via the Team-page form), the swap can
--    never fire retroactively, leaving two rows with mismatched ids
--    (auth uid vs the Team-page random uuid). PostgREST queries by
--    auth.uid() then return zero rows; the user sees "Access restricted"
--    and stays in a loop. This BEFORE INSERT trigger reads auth.users
--    for the incoming email and aligns NEW.id to the existing auth uid
--    when one is present, making pre-provisioning idempotent regardless
--    of order. Plays nicely with handle_new_user's fresh-signup path:
--    NEW.id already equals the auth uid in that case, so the trigger is
--    a no-op there.
--
-- One-time data repair tail: jobs@mirrornyc.com hit this bug on
-- 2026-05-19 during the incident. UPDATE realigns the row's id to the
-- existing auth uid. Bounded predicate makes the UPDATE idempotent.
--
-- Memory: feedback_handle_new_user_swap_path_load_bearing,
-- feedback_revoke_execute_check_rls_callers,
-- project_new_user_notification_two_channel_split.


-- 1. GRANT EXECUTE on auth-trigger functions ---------------------------

GRANT EXECUTE ON FUNCTION public.handle_new_user() TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.users_protect_admin_columns() TO supabase_auth_admin, authenticated;


-- 2. handle_new_user with swap block + owner-scoped email dispatch -----

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  new_email text := NEW.email;
  existing_user_id uuid;
  owner_ids uuid[];
BEGIN
  -- Phase 5.4 pre-provisioning swap (do not remove on future CREATE OR REPLACE).
  -- Admin seeded a row with a random uuid before the user signed in. Swap that
  -- row's id to the auth uid so future auth.uid() comparisons line up. Also
  -- stamp avatar + last_active_at.
  SELECT id INTO existing_user_id
  FROM public.users
  WHERE email = new_email;

  IF existing_user_id IS NOT NULL AND existing_user_id <> NEW.id THEN
    UPDATE public.users
    SET id = NEW.id,
        avatar_url = COALESCE(NEW.raw_user_meta_data->>'avatar_url', avatar_url),
        last_active_at = now()
    WHERE id = existing_user_id;
    RETURN NEW;
  END IF;

  IF existing_user_id = NEW.id THEN
    UPDATE public.users SET last_active_at = now() WHERE id = NEW.id;
    RETURN NEW;
  END IF;

  -- Fresh signup path: mirror auth.users row as pending.
  INSERT INTO public.users (id, email, full_name, avatar_url, permission_role, active, last_active_at)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'avatar_url',
    'pending',
    true,
    now()
  )
  ON CONFLICT (id) DO NOTHING;

  -- Durable in-app signal: one notifications row per active admin.
  -- Bell-panel readers stay broad (any admin can assign a tier).
  INSERT INTO public.notifications (user_id, type, title, body, link_url, delivered_in_app)
  SELECT
    u.id,
    'user_pending',
    new_email || ' is awaiting tier assignment',
    'Open the Team page to assign Admin, Standard, or Freelance.',
    '/users',
    true
  FROM public.users u
  WHERE u.permission_role = 'admin' AND u.active = true;

  -- Phase 5.8.8 email-to-owners scope (in-app stays admin-wide).
  -- Bell-panel covers all admins; email reserved for owner-tier escalation.
  SELECT COALESCE(array_agg(u.id), ARRAY[]::uuid[])
    INTO owner_ids
    FROM public.users u
   WHERE u.is_owner = true AND u.active = true;

  IF array_length(owner_ids, 1) IS NOT NULL THEN
    PERFORM public.invoke_edge_function(
      'notifications-dispatch',
      jsonb_build_object(
        'event_type', 'user_pending',
        'entity_type', 'user',
        'entity_id', NEW.id,
        'entity_name', new_email,
        'recipient_user_ids', to_jsonb(owner_ids),
        'actor_id', NULL,
        'extra', jsonb_build_object('email', new_email)
      )
    );
  END IF;

  RETURN NEW;
END;
$function$;

-- CREATE OR REPLACE doesn't reset grants, but re-stating to be explicit
-- after the body rewrite in case a future db reset replays only this file.
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO supabase_auth_admin;


-- 3. BEFORE INSERT alignment trigger on public.users -------------------

CREATE OR REPLACE FUNCTION public.users_align_id_to_auth()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  existing_auth_uid uuid;
BEGIN
  IF NEW.email IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT id INTO existing_auth_uid
  FROM auth.users
  WHERE email = NEW.email
  LIMIT 1;
  IF existing_auth_uid IS NOT NULL AND existing_auth_uid <> NEW.id THEN
    NEW.id := existing_auth_uid;
  END IF;
  RETURN NEW;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.users_align_id_to_auth() TO authenticated, service_role;

DROP TRIGGER IF EXISTS trg_users_align_id_to_auth ON public.users;
CREATE TRIGGER trg_users_align_id_to_auth
  BEFORE INSERT ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.users_align_id_to_auth();


-- 4. One-time data repair: jobs@mirrornyc.com 2026-05-19 mismatch ------

UPDATE public.users
SET id = '4bf9e260-76f9-4867-b9e2-717cdea95f9a'
WHERE email = 'jobs@mirrornyc.com'
  AND id = '3d6d22b8-f5bb-4360-a912-c9653fcd2017';
