-- Phase 5.12.0: retire vs_candidate_venues_shortlist_sync.
--
-- The HQ Venues match-or-insert + linked_venue_id wiring moves from this
-- shortlist-time trigger into vs-generate-deck (fires at Generate Deck
-- click, after the producer has reviewed + edited the venue overview on
-- DeckPrep). See docs/decisions.md Phase 5.12.0 entry for rationale.
--
-- DROP CASCADE: drops the trigger first (only dependency on the function),
-- then the function. Idempotent so a re-run no-ops.

DROP TRIGGER IF EXISTS trg_vs_candidate_venues_shortlist_sync
  ON public.vs_candidate_venues;

DROP FUNCTION IF EXISTS public.vs_candidate_venues_shortlist_sync() CASCADE;

-- Phase 5.12.0 § 6.1: White Box added to CANONICAL_TYPES (server +
-- frontend lockstep). The venue_types lookup table needs the matching
-- row so the HQ push from vs-generate-deck can resolve canonicalized
-- 'White Box' tokens into venue_venue_types join rows. Idempotent so
-- a re-run no-ops; producers may have already added the row via
-- Settings -> Lookup Lists.
INSERT INTO public.venue_types (name) VALUES ('White Box')
ON CONFLICT (name) DO NOTHING;
