-- Phase 5.2.2.C: venues extensions + venue_rate_history + notes_log widening
-- + people.venue_id (Q8 recommendation).
--
-- Spec: OUTPUTS/phase-5-2-spec.md § 4g + § 6.C.2 + § 13 Q8 + § 13 Q9.
--
-- Five scope bundles in this single migration:
--   1. Multi-select Venue Type via `venue_venue_types` join table. Backfill
--      from the existing single `venues.venue_type_id` FK, then drop the
--      single FK + its index. The `vs_candidate_venues_shortlist_sync`
--      trigger does NOT write `venue_type_id` on the HQ side; it inserts
--      (name, address, neighborhood, features, website_url, notes,
--      created_by). Safe to drop without trigger touch.
--   2. New venue columns (city, venue_slide_url, total_sq_ft,
--      exclusive_vendors_org_ids).
--   3. Append-only `venue_rate_history` table. SELECT + INSERT only for
--      authenticated; no UPDATE / no DELETE on rates. Most-recent row per
--      (venue_id, rate_kind) drives the detail-page "Event Day Rate $X
--      as of <date>" display.
--   4. Widen the `notes_log` CHECK constraint to allow `parent_type = 'venue'`
--      so the shipped Internal Notes editor (Phase 5.2.2) serves Venue
--      detail too. The constraint was authored in Phase 5.1 as IN
--      ('organization', 'person').
--   5. `people.venue_id` (Q8): nullable FK so a venue contact ties to the
--      one venue they belong to without needing a join table.
--
-- Recreated in Phase 5.2.1 Revision after the halted 5.2.2 worktree was
-- deleted; SQL matches what was applied to the live linked DB on
-- 2026-05-15 (registered as migration 20260515140002).

BEGIN;

-- ============================================================================
-- 1. Multi-select Venue Type
-- ============================================================================

CREATE TABLE public.venue_venue_types (
  venue_id      uuid NOT NULL REFERENCES public.venues(id)      ON DELETE CASCADE,
  venue_type_id uuid NOT NULL REFERENCES public.venue_types(id) ON DELETE CASCADE,
  PRIMARY KEY (venue_id, venue_type_id)
);
CREATE INDEX venue_venue_types_venue_idx ON public.venue_venue_types (venue_id);
CREATE INDEX venue_venue_types_type_idx  ON public.venue_venue_types (venue_type_id);

INSERT INTO public.venue_venue_types (venue_id, venue_type_id)
SELECT id, venue_type_id
FROM public.venues
WHERE venue_type_id IS NOT NULL;

-- Drop the index first, then the column.
DROP INDEX IF EXISTS public.idx_venues_venue_type_id;
ALTER TABLE public.venues DROP COLUMN venue_type_id;

ALTER TABLE public.venue_venue_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY venue_venue_types_select ON public.venue_venue_types
  FOR SELECT TO authenticated USING (true);
CREATE POLICY venue_venue_types_insert ON public.venue_venue_types
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY venue_venue_types_update ON public.venue_venue_types
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY venue_venue_types_delete ON public.venue_venue_types
  FOR DELETE TO authenticated USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.venue_venue_types TO authenticated;
GRANT ALL                            ON public.venue_venue_types TO service_role;

-- ============================================================================
-- 2. New venue columns
-- ============================================================================

ALTER TABLE public.venues
  ADD COLUMN city                      text,
  ADD COLUMN venue_slide_url           text,
  ADD COLUMN total_sq_ft               int,
  ADD COLUMN exclusive_vendors_org_ids uuid[] NOT NULL DEFAULT '{}';

CREATE INDEX venues_city_idx ON public.venues (city) WHERE city IS NOT NULL;

-- ============================================================================
-- 3. Venue rate history (append-only)
-- ============================================================================

CREATE TYPE public.venue_rate_kind AS ENUM ('event_day', 'prod_day');

CREATE TABLE public.venue_rate_history (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id       uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  rate_kind      public.venue_rate_kind NOT NULL,
  amount_usd     int NOT NULL,
  effective_from date NOT NULL DEFAULT current_date,
  created_by     uuid NOT NULL REFERENCES public.users(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX venue_rate_history_lookup_idx
  ON public.venue_rate_history (venue_id, rate_kind, effective_from DESC);

ALTER TABLE public.venue_rate_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY venue_rate_history_select ON public.venue_rate_history
  FOR SELECT TO authenticated USING (true);
CREATE POLICY venue_rate_history_insert ON public.venue_rate_history
  FOR INSERT TO authenticated WITH CHECK (true);
-- No UPDATE policy: rates are append-only history.
-- No DELETE policy: rates never delete.

GRANT SELECT, INSERT ON public.venue_rate_history TO authenticated;
GRANT ALL            ON public.venue_rate_history TO service_role;

-- ============================================================================
-- 4. Widen notes_log CHECK constraint to include 'venue'
-- ============================================================================

ALTER TABLE public.notes_log DROP CONSTRAINT notes_log_parent_type_check;
ALTER TABLE public.notes_log ADD CONSTRAINT notes_log_parent_type_check
  CHECK (parent_type IN ('organization', 'person', 'venue'));

-- ============================================================================
-- 5. people.venue_id (Q8 recommendation)
-- ============================================================================

ALTER TABLE public.people
  ADD COLUMN venue_id uuid REFERENCES public.venues(id) ON DELETE SET NULL;

CREATE INDEX people_venue_idx
  ON public.people (venue_id)
  WHERE venue_id IS NOT NULL;

COMMIT;
