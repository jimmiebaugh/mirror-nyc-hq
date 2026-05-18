-- ============================================================================
-- Phase 5.8.5: credentials column encryption via pgsodium.
--
-- Audit finding F001 + Jimmie's 2026-05-18 accept-risk-not-intentional call.
-- pgsodium extension confirmed enabled on amipjjmphblfxpghjnel.
--
-- Adds password_encrypted bytea column, writes credentials_set_password RPC
-- (encrypts via pgsodium.crypto_aead_det_encrypt), writes
-- credentials_reveal_password RPC (decrypts on demand), backfills existing
-- plaintext, then drops the plaintext column.
--
-- Auth predicate: the existing credentials policies inline the non-freelance
-- check (`permission_role IN ('admin', 'standard')`) rather than calling a
-- helper function. The new RPCs inline the same predicate for parity.
--
-- Implementation notes:
--   * Supabase managed Postgres blocks direct INSERT on `pgsodium.key`; use
--     the documented `pgsodium.create_key(...)` API and read keys from the
--     `pgsodium.valid_key` view.
--   * Of the four `crypto_aead_det_encrypt` / `crypto_aead_det_decrypt`
--     overloads, only the 4-argument
--     `(message, additional, key_uuid, nonce)` form is GRANTed to the
--     `postgres` role on the managed Supabase instance. Pass `NULL::bytea`
--     for the nonce to keep the deterministic-auto-derive behavior.
--   * `public.credentials` no longer has a `related_note` column (dropped
--     in `20260516170000_phase_5_4_feedback.sql`). `credentials_create`
--     does not expose that param.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pgsodium.valid_key WHERE name = 'credentials') THEN
    PERFORM pgsodium.create_key(key_type := 'aead-det', name := 'credentials');
  END IF;
END$$;

ALTER TABLE public.credentials
  ADD COLUMN password_encrypted bytea;

-- Backfill: encrypt every plaintext password.
UPDATE public.credentials
  SET password_encrypted = pgsodium.crypto_aead_det_encrypt(
    password::bytea,
    ''::bytea,
    (SELECT id FROM pgsodium.valid_key WHERE name = 'credentials'),
    NULL::bytea
  )
  WHERE password_encrypted IS NULL AND password IS NOT NULL;

ALTER TABLE public.credentials
  ALTER COLUMN password_encrypted SET NOT NULL;

ALTER TABLE public.credentials
  DROP COLUMN password;

-- ----------------------------------------------------------------------------
-- Set-password RPC. Called from AccountLoginsPage when adding or editing a
-- credential's password. Other columns (service_name, username, url) continue
-- to use the standard PostgREST UPDATE path.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.credentials_set_password(p_id uuid, p_password text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pgsodium, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND permission_role IN ('admin', 'standard')
  ) THEN
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

-- ----------------------------------------------------------------------------
-- Reveal-password RPC. Called from AccountLoginsPage when the user hits
-- the per-row reveal toggle. Returns plaintext for the 30-second window;
-- frontend caches in-memory and clears on idle.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.credentials_reveal_password(p_id uuid)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pgsodium, pg_temp
AS $$
DECLARE
  decrypted text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND permission_role IN ('admin', 'standard')
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
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

-- ----------------------------------------------------------------------------
-- Create-credential RPC. Needed because password_encrypted is NOT NULL but
-- the client has no way to produce a valid pgsodium ciphertext on its own.
-- Atomic insert keeps the schema constraint intact (no nullable transient
-- state) and matches the SECURITY DEFINER pattern used for set/reveal.
-- ----------------------------------------------------------------------------
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
  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND permission_role IN ('admin', 'standard')
  ) THEN
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

REVOKE EXECUTE ON FUNCTION public.credentials_set_password(uuid, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.credentials_set_password(uuid, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.credentials_reveal_password(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.credentials_reveal_password(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.credentials_create(text, text, text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.credentials_create(text, text, text, text) TO authenticated;
