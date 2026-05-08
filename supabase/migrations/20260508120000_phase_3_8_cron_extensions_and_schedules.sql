-- Phase 3.8: cron + watchdogs.
--
-- Enables pg_cron + pg_net, then schedules every cron job. Each cron job
-- POSTs to its corresponding edge function via net.http_post with the
-- x-internal-secret header so requireInternalOrUserAuth accepts the call.
--
-- Conventions (per docs/cron-jobs.md):
--   - Schedules live in migrations, not the Supabase Dashboard cron UI.
--   - Cron callers send x-internal-secret: ${INTERNAL_API_SECRET}.
--   - Watchdogs detect-and-flag, never auto-restart.
--
-- IMPORTANT: this migration assumes two GUCs are populated on the database
-- before/at apply time:
--   app.supabase_url        — e.g. https://amipjjmphblfxpghjnel.supabase.co
--   app.internal_api_secret — same value as the edge-function secret of that name
--
-- Set them via Supabase SQL editor (or psql) BEFORE applying this migration:
--   ALTER DATABASE postgres SET app.supabase_url        = 'https://<ref>.supabase.co';
--   ALTER DATABASE postgres SET app.internal_api_secret = '<the secret>';
--
-- Applying without those values set leaves the cron schedules in place but
-- they no-op (function call returns 401). Re-run the unschedule/schedule
-- helpers below after setting the GUCs.
--
-- Schedule cadences (UTC):
--   ts-cron-scheduled-pulls       12:00 daily        (8am ET, accepting EDT/EST drift)
--   ts-cron-pull-watchdog         every 5 minutes
--   ts-cron-reeval-watchdog       every 5 minutes
--   ts-cron-final-review-watchdog every 5 minutes
--   ts-cron-storage-cleanup       03:00 daily
--   ts-cron-monthly-spend-reset   00:01 on the 1st of every month

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Helper: shared body. Reads GUCs at call time so a later GUC update is picked
-- up without rescheduling. Returns the request_id so the caller can join
-- net._http_response for debugging.
CREATE OR REPLACE FUNCTION public.invoke_edge_function(fn_name text, body jsonb DEFAULT '{}'::jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  base_url text := current_setting('app.supabase_url', true);
  secret   text := current_setting('app.internal_api_secret', true);
  req_id   bigint;
BEGIN
  IF base_url IS NULL OR secret IS NULL THEN
    RAISE WARNING 'invoke_edge_function: app.supabase_url or app.internal_api_secret GUC is not set; skipping call to %', fn_name;
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

-- Defensive: drop any prior schedules with these names so re-runs are idempotent.
DO $$
DECLARE
  job_name text;
BEGIN
  FOR job_name IN SELECT unnest(ARRAY[
    'ts-cron-scheduled-pulls',
    'ts-cron-pull-watchdog',
    'ts-cron-reeval-watchdog',
    'ts-cron-final-review-watchdog',
    'ts-cron-storage-cleanup',
    'ts-cron-monthly-spend-reset'
  ])
  LOOP
    PERFORM cron.unschedule(job_name) FROM cron.job WHERE jobname = job_name;
  END LOOP;
END $$;

-- Schedule.
SELECT cron.schedule(
  'ts-cron-scheduled-pulls',
  '0 12 * * *',
  $cron$ SELECT public.invoke_edge_function('ts-cron-scheduled-pulls', '{}'::jsonb); $cron$
);

SELECT cron.schedule(
  'ts-cron-pull-watchdog',
  '*/5 * * * *',
  $cron$ SELECT public.invoke_edge_function('ts-cron-pull-watchdog', '{}'::jsonb); $cron$
);

SELECT cron.schedule(
  'ts-cron-reeval-watchdog',
  '*/5 * * * *',
  $cron$ SELECT public.invoke_edge_function('ts-cron-reeval-watchdog', '{}'::jsonb); $cron$
);

SELECT cron.schedule(
  'ts-cron-final-review-watchdog',
  '*/5 * * * *',
  $cron$ SELECT public.invoke_edge_function('ts-cron-final-review-watchdog', '{}'::jsonb); $cron$
);

SELECT cron.schedule(
  'ts-cron-storage-cleanup',
  '0 3 * * *',
  $cron$ SELECT public.invoke_edge_function('ts-cron-storage-cleanup', '{}'::jsonb); $cron$
);

SELECT cron.schedule(
  'ts-cron-monthly-spend-reset',
  '1 0 1 * *',
  $cron$ SELECT public.invoke_edge_function('ts-cron-monthly-spend-reset', '{}'::jsonb); $cron$
);
