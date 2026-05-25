-- Phase 5.12.3: capture the points-based dedupe score breakdown on
-- vs_candidate_venues rows that were merged into an HQ venue at
-- vs-generate-deck.pushVenuesToHq time.
--
-- Read by the Shortlist + SourcingReport + DeckPrep matrix
-- DedupeMetaIndicator (renders next to the SourcePill when set), and by
-- anyone debugging a wrong-merge by querying vs_candidate_venues
-- directly.
--
-- Shape (locked in spec phase-5-12-3-spec.md § 8.2):
--   {
--     "matched_venue_id": "<uuid>",
--     "matched_venue_name": "<HQ venues.name at match time>",
--     "score": {
--       "name": 0|25|60,
--       "address": 0|20|50,
--       "website": 0|20|40,
--       "city": 0|10,
--       "total": <int>,
--       "threshold": 60
--     },
--     "reason": "name partial match (25) + address (50) + city (10) = 85 / 60",
--     "matched_at": "<ISO timestamp>"
--   }
--
-- Nullable. Existing rows stay NULL (no backfill: pre-5.12.3 matches
-- ran the strict cascade and the scoring decomposition isn't
-- reconstructible).
--
-- Additive + nullable + RLS / GRANT / publication safe:
--   * No policy edits (vs_candidate_venues carries the open-authenticated
--     FOR ALL policy that covers new columns transparently).
--   * No GRANT edits (SELECT/INSERT/UPDATE/DELETE to authenticated +
--     ALL to service_role cover the new column).
--   * No ALTER PUBLICATION (vs_candidate_venues is in
--     supabase_realtime with REPLICA IDENTITY FULL; jsonb adds ride
--     the existing publication transparently).
--   * No function / trigger / enum changes.

BEGIN;

ALTER TABLE public.vs_candidate_venues
  ADD COLUMN dedupe_meta jsonb;

COMMENT ON COLUMN public.vs_candidate_venues.dedupe_meta IS
  'Phase 5.12.3: scoring breakdown captured at pushVenuesToHq match time. Shape per spec phase-5-12-3-spec.md § 8.2.';

COMMIT;
