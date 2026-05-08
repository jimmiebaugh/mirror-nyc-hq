-- Phase 3.8 follow-up: stop using custom GUCs for the cron helper.
--
-- Background: 20260508120000 set up `public.invoke_edge_function` to read
-- `app.supabase_url` and `app.internal_api_secret` from database GUCs set
-- via `ALTER DATABASE postgres SET ...`. Supabase-hosted Postgres restricts
-- ALTER DATABASE / ALTER ROLE on custom parameters even for the dashboard
-- SQL editor's `postgres` role, so the GUCs can't actually be set in
-- production.
--
-- Fix: hardcode the project URL (it's public — `https://<ref>.supabase.co`
-- is in every browser tab anyway) and read the internal secret from
-- Supabase Vault, which IS settable from the dashboard SQL editor and is
-- the platform's intended pattern for secrets accessible from Postgres.
--
-- Setup AFTER this migration:
--   1. Insert the INTERNAL_API_SECRET value into the vault (one-time):
--        SELECT vault.create_secret('<the secret>', 'INTERNAL_API_SECRET');
--   2. The helper picks it up on next cron firing.
--
-- The vault.decrypted_secrets view is gated by RLS / role membership so
-- arbitrary client code can't read it; only roles allowed by the
-- Supabase Vault default policy (postgres + supabase_admin) can decrypt.

CREATE OR REPLACE FUNCTION public.invoke_edge_function(fn_name text, body jsonb DEFAULT '{}'::jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  base_url constant text := 'https://amipjjmphblfxpghjnel.supabase.co';
  secret   text;
  req_id   bigint;
BEGIN
  -- Read INTERNAL_API_SECRET from Supabase Vault. Returns NULL if no secret
  -- by that name has been created yet — in that case the helper warns and
  -- no-ops so the migration is safe to apply before the secret is loaded.
  SELECT decrypted_secret
    INTO secret
    FROM vault.decrypted_secrets
   WHERE name = 'INTERNAL_API_SECRET'
   LIMIT 1;

  IF secret IS NULL THEN
    RAISE WARNING 'invoke_edge_function: vault secret "INTERNAL_API_SECRET" not found; skipping call to %', fn_name;
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url := base_url || '/functions/v1/' || fn_name,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-secret', secret
    ),
    body := body,
    timeout_milliseconds := 30000
  ) INTO req_id;
  RETURN req_id;
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_edge_function(text, jsonb) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.invoke_edge_function(text, jsonb) TO postgres;
