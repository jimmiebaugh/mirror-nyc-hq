-- Phase 4.5-port: persistence channel for vs-research-venues failures.
-- The EdgeRuntime.waitUntil pattern divorces request lifetime from work
-- lifetime, so the Researching page can't read failure off an HTTP response.
-- vs-research-venues writes vs_scouts.status='failed' + research_error=<msg>
-- on any failure; the page Realtime-subscribes and navigates to the error
-- route. NULL means "no failure on the most recent run" (the function clears
-- it at kickoff so a retry from a prior failed state starts clean).

-- No explicit GRANT needed: table-level GRANTs on vs_scouts were issued
-- in 20260512200000_phase_4_1_port_schema.sql (authenticated + service_role
-- with the standard SELECT / INSERT / UPDATE / DELETE block) and cover all
-- columns including those added by future ALTER TABLE ADD COLUMN.
ALTER TABLE public.vs_scouts ADD COLUMN research_error text;

COMMENT ON COLUMN public.vs_scouts.research_error IS
  'Phase 4.5-port: persisted error message from the most recent vs-research-venues run. NULL when no failure on the latest run. The Researching page Realtime-subscribes for this; on non-null with status=failed, navigates to /sourcing/error/research-timeout.';
