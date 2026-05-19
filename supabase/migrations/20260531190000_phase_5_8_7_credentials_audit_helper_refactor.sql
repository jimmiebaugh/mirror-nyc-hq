-- ============================================================================
-- Phase 5.8.7: Credentials RPC hardening close-out.
--
-- N005: replace inline EXISTS predicate with public.is_producer_or_admin()
--       helper call across all three credentials RPCs. Same semantics; cleaner
--       single source of truth. The 5.8.5.1 hotfix already GRANTed EXECUTE on
--       is_producer_or_admin() to authenticated, so the helper call is
--       reachable from the SECURITY DEFINER context.
--
-- N006: log every credentials_reveal_password call to public.activity_log for
--       a forensic trail. Mirrors industry practice for shared-credential
--       managers (1Password Business reports, LastPass admin audit, Vault
--       audit devices).
--
-- Carry-forwards from live 5.8.5 migration that must be preserved verbatim:
--   * (SELECT id FROM pgsodium.valid_key WHERE name='credentials') -- not
--     pgsodium.key; Supabase managed only exposes the valid_key view.
--   * crypto_aead_det_decrypt() 4-argument form with NULL::bytea nonce -- the
--     3-arg overload is not GRANTed to postgres on managed Supabase.
--   * NULLIF(p_username, '') / NULLIF(p_url, '') in credentials_create.
--
-- activity_log inventory (verified 2026-05-18 against live schema):
--   * columns: id, entity_type, entity_id, action, actor_id, payload, created_at.
--   * no CHECK constraint on entity_type, so 'credential' needs no widening.
--   * SECURITY DEFINER runs as postgres (BYPASSRLS), so the INSERT bypasses
--     RLS the same way the existing activity_log_writer trigger does.
-- ============================================================================

-- credentials_set_password: route predicate through helper.
CREATE OR REPLACE FUNCTION public.credentials_set_password(p_id uuid, p_password text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pgsodium, pg_temp
AS $$
BEGIN
  IF NOT public.is_producer_or_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  UPDATE public.credentials
    SET password_encrypted = pgsodium.crypto_aead_det_encrypt(
      p_password::bytea,
      ''::bytea,
      (SELECT id FROM pgsodium.valid_key WHERE name = 'credentials'),
      NULL::bytea
    ),
    updated_at = now(),
    updated_by = auth.uid()
    WHERE id = p_id;
END$$;

-- credentials_reveal_password: route predicate through helper + audit log.
CREATE OR REPLACE FUNCTION public.credentials_reveal_password(p_id uuid)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pgsodium, pg_temp
AS $$
DECLARE
  decrypted text;
BEGIN
  IF NOT public.is_producer_or_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- N006: forensic audit trail. One row per reveal, before the decrypt.
  INSERT INTO public.activity_log (entity_type, entity_id, action, actor_id, payload)
  VALUES ('credential', p_id, 'credential_revealed', auth.uid(), '{}'::jsonb);

  SELECT convert_from(
    pgsodium.crypto_aead_det_decrypt(
      password_encrypted,
      ''::bytea,
      (SELECT id FROM pgsodium.valid_key WHERE name = 'credentials'),
      NULL::bytea
    ),
    'UTF8'
  ) INTO decrypted
  FROM public.credentials
  WHERE id = p_id;
  RETURN decrypted;
END$$;

-- credentials_create: route predicate through helper.
CREATE OR REPLACE FUNCTION public.credentials_create(
  p_service_name text,
  p_username text,
  p_password text,
  p_url text
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pgsodium, pg_temp
AS $$
DECLARE
  new_id uuid;
BEGIN
  IF NOT public.is_producer_or_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  INSERT INTO public.credentials (
    service_name, username, password_encrypted, url,
    created_by, updated_by
  ) VALUES (
    p_service_name,
    NULLIF(p_username, ''),
    pgsodium.crypto_aead_det_encrypt(
      p_password::bytea,
      ''::bytea,
      (SELECT id FROM pgsodium.valid_key WHERE name = 'credentials'),
      NULL::bytea
    ),
    NULLIF(p_url, ''),
    auth.uid(),
    auth.uid()
  )
  RETURNING id INTO new_id;
  RETURN new_id;
END$$;
