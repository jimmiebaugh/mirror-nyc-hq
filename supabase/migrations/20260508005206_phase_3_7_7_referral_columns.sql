-- Phase 3.7.7: referral ingestion.
--
-- Mirror managers can forward candidate emails from their own
-- @mirrornyc.com inbox to jobs@mirrornyc.com. ts-pull-candidates
-- detects the forward, unwraps the forwarded body to find the
-- original applicant's identity, ingests the candidate using that
-- identity, and flags the row as a referral with the forwarder's
-- email captured for downstream context.
--
-- Two new columns:
--   is_referral     — true when the candidate was ingested via a
--                     forward from a Mirror manager.
--   referrer_email  — the manager's email (the From: of the forwarding
--                     message). Null for direct-to-jobs@ applicants.

ALTER TABLE public.ts_candidates
  ADD COLUMN is_referral boolean NOT NULL DEFAULT false,
  ADD COLUMN referrer_email text;
