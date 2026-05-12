-- Phase 4.1-port: schema for the Venue Scout 1:1 port from
-- mirror-nyc-venue-scout-pro. Drops the failed-attempt vs_* shapes (Phase
-- 4.1 - 4.6 on main, archived on vs-port-fresh's parent main) and creates the
-- port shape per docs/venue-scout-port-plan.md § 2.
--
-- Locked decisions per port plan § 8:
--   8.1 single-round per scout (no vs_sourcing_rounds table)
--   8.2 brief inline on vs_scouts (no vs_briefs table)
--   8.3 vs_scouts in supabase_realtime + REPLICA IDENTITY FULL for the
--       Researching / Compiling / Generating loading-page subscriptions
--   8.4 current_step text state machine (9 values from VS Pro)
--   8.5 deck history as vs_scouts.generated_decks jsonb array (no
--       vs_pitch_decks table)
--   8.6 RLS open to all authenticated (collaborative agency-wide workflow)

BEGIN;

-- ============================================================================
-- 1. Drop failed-attempt schema. CASCADE handles per-table indexes + triggers.
-- ============================================================================
-- The shortlist sync trigger function and the vs_* enums are independent
-- objects (CASCADE on tables doesn't reach them); drop explicitly so the new
-- schema doesn't inherit orphans.
-- The four RPCs from main reference dropped tables; drop or they'd be left in
-- a broken state on the remote DB.

DROP TABLE IF EXISTS public.vs_venue_photos CASCADE;
DROP TABLE IF EXISTS public.vs_pitch_decks CASCADE;
DROP TABLE IF EXISTS public.vs_candidate_venues CASCADE;
DROP TABLE IF EXISTS public.vs_sourcing_rounds CASCADE;
DROP TABLE IF EXISTS public.vs_briefs CASCADE;
DROP TABLE IF EXISTS public.vs_scouts CASCADE;

DROP FUNCTION IF EXISTS public.vs_candidate_venues_shortlist_sync() CASCADE;
DROP FUNCTION IF EXISTS public.start_over_scout(uuid);
DROP FUNCTION IF EXISTS public.swap_venue_photo_slots(uuid, integer, integer);
DROP FUNCTION IF EXISTS public.insert_pitch_deck_version(uuid, uuid);
DROP FUNCTION IF EXISTS public.create_scout_with_brief(jsonb, jsonb);

DROP TYPE IF EXISTS public.vs_research_status;
DROP TYPE IF EXISTS public.vs_sourcing_round_status;
DROP TYPE IF EXISTS public.vs_sourcing_round_source_type;
DROP TYPE IF EXISTS public.vs_scout_phase;

-- ============================================================================
-- 2. Create the port shape.
-- ============================================================================

-- vs_scouts: brief inline, generated_decks jsonb history, current_step state
-- machine. Maps to VS Pro `projects` table (see port plan § 2 field rename
-- map). HQ-specific operational columns added at the bottom.
CREATE TABLE public.vs_scouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,

  -- Brief fields inline per § 8.2. `brief_data jsonb` carries flexible
  -- per-scout extras the producer surfaces from the uploaded brief PDF.
  client_name text,
  event_name text,
  live_dates text,
  city text,
  budget numeric,
  brief_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  event_overview text,

  -- Workflow state machine per § 8.4. Text + CHECK rather than enum so the
  -- port can adjust step names without a migration; matches VS Pro's shape.
  current_step text NOT NULL DEFAULT 'sheet_prompt'
    CHECK (current_step IN (
      'sheet_prompt', 'sheet_upload', 'researching', 'sourcing_report',
      'shortlist', 'review_selects', 'compiling', 'deck_prep', 'completed'
    )),

  -- VS Pro carries a `status` text column independent of `current_step`
  -- (draft / active / archived in VS Pro semantics). Keep for parity.
  status text NOT NULL DEFAULT 'draft',

  -- Sheet upload artifacts and AI-derived alignment columns (collapsed onto
  -- the scout per § 8.1 single-round decision).
  sheet_storage_path text,
  derived_columns jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Deck history per § 8.5: array of
  --   { deck_id, deck_name, version, generated_at, venue_count, slide_count,
  --     edit_url, embed_url }
  generated_decks jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Producer-controlled venue order for deck slides (lifted from VS Pro).
  deck_order jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- HQ-specific operational columns (no VS Pro analog; needed for HQ auth
  -- + Scout Index sort + project-link integration).
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  archived_at timestamptz,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  -- last_touched_at tracks meaningful activity (sourcing kick-off, brief
  -- save, deck generated), not bookkeeping updated_at. Drives the Scout
  -- Index sort.
  last_touched_at timestamptz NOT NULL DEFAULT now(),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- vs_candidate_venues: maps to VS Pro `venues` (renamed because HQ already
-- has a `venues` table for the master venue list). venue_notes inlined as
-- `notes` per § 2 (matches HQ convention, notes are 1:1 with parent row
-- everywhere else).
CREATE TABLE public.vs_candidate_venues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scout_id uuid NOT NULL REFERENCES public.vs_scouts(id) ON DELETE CASCADE,

  -- Set by the shortlist sync trigger when a candidate flips into the
  -- master HQ venues table. (Trigger lands when the Shortlist surface ports
  -- in Phase 4.6-port; column reserved here.)
  linked_venue_id uuid REFERENCES public.venues(id) ON DELETE SET NULL,

  name text NOT NULL,
  neighborhood text,
  address text,
  -- VS Pro stores `type`; rename to `venue_type` because `type` reads as a
  -- system word in TS / Postgres tooling.
  venue_type text,
  key_features text[] NOT NULL DEFAULT '{}',
  website_url text,
  size_sq_ft integer,
  capacity integer,
  derived_attrs jsonb NOT NULL DEFAULT '{}'::jsonb,
  recommendations text[] NOT NULL DEFAULT '{}',
  considerations text[] NOT NULL DEFAULT '{}',

  -- VS Pro stores `ranking_score`; rename to `rank` for parity with HQ
  -- Talent Scout's score naming.
  rank integer CHECK (rank IS NULL OR (rank >= 0 AND rank <= 100)),

  -- VS Pro: 'sheet' | 'research' | 'manual'
  source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('sheet', 'research', 'manual')),

  shortlisted boolean NOT NULL DEFAULT false,
  pitched boolean NOT NULL DEFAULT false,
  venue_overview text,
  include_in_deck boolean NOT NULL DEFAULT true,

  -- venue_notes from VS Pro inlined per § 2.
  notes text,
  pitch_notes text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- vs_venue_photos: lifted from VS Pro with HQ rename. ON DELETE CASCADE so a
-- Start Over (which deletes all candidate venues for a scout) cleans photos
-- automatically.
CREATE TABLE public.vs_venue_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_venue_id uuid NOT NULL REFERENCES public.vs_candidate_venues(id) ON DELETE CASCADE,
  -- 1 = top_left, 2 = top_right, 3 = bottom_left, 4 = bottom_right on the
  -- generated deck slide.
  slot integer NOT NULL CHECK (slot BETWEEN 1 AND 4),
  storage_path text NOT NULL,
  file_name text,
  file_size_bytes integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (candidate_venue_id, slot)
);

-- ============================================================================
-- 3. Indexes.
-- ============================================================================

CREATE INDEX idx_vs_scouts_archived_at ON public.vs_scouts(archived_at);
CREATE INDEX idx_vs_scouts_project_id ON public.vs_scouts(project_id);
CREATE INDEX idx_vs_scouts_last_touched_at ON public.vs_scouts(last_touched_at DESC);
CREATE INDEX idx_vs_candidate_venues_scout_id ON public.vs_candidate_venues(scout_id);
CREATE INDEX idx_vs_candidate_venues_linked_venue_id ON public.vs_candidate_venues(linked_venue_id);
CREATE INDEX idx_vs_venue_photos_candidate_venue_id ON public.vs_venue_photos(candidate_venue_id);

-- ============================================================================
-- 4. updated_at_auto triggers (function defined in initial_schema).
-- ============================================================================

CREATE TRIGGER trg_vs_scouts_updated_at BEFORE UPDATE ON public.vs_scouts
  FOR EACH ROW EXECUTE FUNCTION public.updated_at_auto();
CREATE TRIGGER trg_vs_candidate_venues_updated_at BEFORE UPDATE ON public.vs_candidate_venues
  FOR EACH ROW EXECUTE FUNCTION public.updated_at_auto();

-- ============================================================================
-- 5. RLS open to all authenticated per § 8.6. Collaborative agency-wide
--    workflow; any authenticated @mirrornyc.com user can read or write any
--    scout, candidate venue, or photo.
-- ============================================================================

ALTER TABLE public.vs_scouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vs_candidate_venues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vs_venue_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY vs_scouts_all_authenticated ON public.vs_scouts
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY vs_candidate_venues_all_authenticated ON public.vs_candidate_venues
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY vs_venue_photos_all_authenticated ON public.vs_venue_photos
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================================
-- 6. Explicit GRANTs per docs/conventions.md (auto-expose stays off).
-- ============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vs_scouts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vs_candidate_venues TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vs_venue_photos TO authenticated;
GRANT ALL ON public.vs_scouts TO service_role;
GRANT ALL ON public.vs_candidate_venues TO service_role;
GRANT ALL ON public.vs_venue_photos TO service_role;

-- ============================================================================
-- 7. Realtime per § 8.3. Researching / Compiling / Generating loading pages
--    subscribe to vs_scouts.current_step changes via postgres_changes.
-- ============================================================================

ALTER TABLE public.vs_scouts REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.vs_scouts;

COMMIT;
