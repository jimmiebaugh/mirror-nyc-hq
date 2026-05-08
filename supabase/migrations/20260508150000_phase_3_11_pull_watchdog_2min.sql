-- Phase 3.11.1: bump ts-cron-pull-watchdog cadence from every 5 min to
-- every 2 min.
--
-- The pull-watchdog stall threshold is now 5 min (tightened from 60 in
-- the same change). With a 5-min cadence + 5-min threshold, worst-case
-- detection lands 10 min after stall onset (cron fires 5 min after
-- threshold is crossed). Bumping cadence to every 2 min lands detection
-- within 5-7 min of onset, which matches the user-facing expectation
-- that a stuck pull surfaces fast.
--
-- The OTHER watchdogs (re-eval, final-review) keep their 5-min cadence —
-- their thresholds are 30 / 20 min so faster cadence wouldn't earn its
-- keep, and the upstream operations are slower-moving anyway.

SELECT cron.unschedule('ts-cron-pull-watchdog') FROM cron.job WHERE jobname = 'ts-cron-pull-watchdog';

SELECT cron.schedule(
  'ts-cron-pull-watchdog',
  '*/2 * * * *',
  $cron$ SELECT public.invoke_edge_function('ts-cron-pull-watchdog', '{}'::jsonb); $cron$
);
