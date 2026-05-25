-- Phase 5.12.9: neighborhoods lookup nested under cities.
--
-- Producer ask (plan doc § 5.12.9): make `neighborhood` a managed lookup so
-- producers pick from a city-scoped list instead of typing free text every
-- time. Mirrors vendor_subcategories (Phase 5.6.2) shape with city as the
-- parent instead of vendor_categories.
--
-- Column types on consumer tables (venues.neighborhood text,
-- vs_candidate_venues.neighborhood text, vs_scouts.brief_data
-- .target_neighborhoods text[]) stay UNCHANGED per the cities precedent:
-- the lookup is the typeahead + admin curation source; stored values are
-- still the option name. No FK on the consumer side.
--
-- Backfill is idempotent (ON CONFLICT DO NOTHING under the city-scoped
-- LOWER(name) unique index) so a re-run leaves the table identical.

BEGIN;

-- 1) Table
CREATE TABLE public.neighborhoods (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  city_id    uuid NOT NULL REFERENCES public.cities(id) ON DELETE CASCADE,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX neighborhoods_city_name_unique_idx
  ON public.neighborhoods (city_id, LOWER(name));
CREATE INDEX neighborhoods_city_id_idx
  ON public.neighborhoods (city_id);

ALTER TABLE public.neighborhoods ENABLE ROW LEVEL SECURITY;

CREATE POLICY neighborhoods_select ON public.neighborhoods
  FOR SELECT TO authenticated USING (true);
CREATE POLICY neighborhoods_insert ON public.neighborhoods
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY neighborhoods_update ON public.neighborhoods
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY neighborhoods_delete ON public.neighborhoods
  FOR DELETE TO authenticated USING (public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.neighborhoods TO authenticated;
GRANT ALL                            ON public.neighborhoods TO service_role;

-- 2) Backfill.
--
-- Scrapes distinct (city, neighborhood) pairs from three sources, resolves
-- city to canonical cities.id (via LOWER(name) match), and seeds rows with
-- NULL created_by (no specific producer attribution).
--
-- Source A: venues.neighborhood + venues.city (text columns; ignore rows
-- without both).
-- Source B: vs_candidate_venues.neighborhood + parent scout's city
-- (vs_scouts.city; the candidate doesn't carry its own city).
-- Source C: vs_scouts.brief_data->'target_neighborhoods' array elements +
-- vs_scouts.city.
--
-- All three sources funnel into one CTE, dedupe via SELECT DISTINCT, and
-- INSERT ON CONFLICT DO NOTHING. Trims surrounding whitespace; skips empty
-- strings and any neighborhood string that has no resolvable city.
DO $$
DECLARE
  v_inserted int;
BEGIN
  WITH src AS (
    -- A: HQ venues
    SELECT TRIM(v.neighborhood) AS name, TRIM(v.city) AS city_name
      FROM public.venues v
      WHERE v.neighborhood IS NOT NULL
        AND LENGTH(TRIM(v.neighborhood)) > 0
        AND v.city IS NOT NULL
        AND LENGTH(TRIM(v.city)) > 0
    UNION
    -- B: VS candidate venues (city comes from parent scout)
    SELECT TRIM(cv.neighborhood) AS name, TRIM(s.city) AS city_name
      FROM public.vs_candidate_venues cv
      JOIN public.vs_scouts s ON s.id = cv.scout_id
      WHERE cv.neighborhood IS NOT NULL
        AND LENGTH(TRIM(cv.neighborhood)) > 0
        AND s.city IS NOT NULL
        AND LENGTH(TRIM(s.city)) > 0
    UNION
    -- C: VS brief target_neighborhoods JSONB array.
    -- jsonb_array_elements_text raises 22023 on non-array JSON values
    -- (scalar / null / object). Guard with jsonb_typeof so legacy
    -- hand-edited scouts with non-array brief_data don't abort the
    -- backfill.
    SELECT TRIM(t.value) AS name, TRIM(s.city) AS city_name
      FROM public.vs_scouts s,
           jsonb_array_elements_text(
             CASE
               WHEN jsonb_typeof(s.brief_data -> 'target_neighborhoods') = 'array'
                 THEN s.brief_data -> 'target_neighborhoods'
               ELSE '[]'::jsonb
             END
           ) AS t(value)
      WHERE LENGTH(TRIM(t.value)) > 0
        AND s.city IS NOT NULL
        AND LENGTH(TRIM(s.city)) > 0
  ),
  resolved AS (
    SELECT DISTINCT src.name, c.id AS city_id
      FROM src
      JOIN public.cities c
        ON LOWER(c.name) = LOWER(src.city_name)
  )
  INSERT INTO public.neighborhoods (name, city_id, created_by)
  SELECT r.name, r.city_id, NULL
    FROM resolved r
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RAISE NOTICE '[phase_5_12_9_neighborhoods_backfill] inserted % distinct (city, neighborhood) rows', v_inserted;
END$$;

COMMIT;
