-- Phase 5.11.3: project_tags + venue_features lookup tables.
--
-- Promotes the free-text `projects.tags text[]` and `venues.features text[]`
-- arrays to managed lookup tables, matching the vendor_capabilities pattern
-- (Phase 5.2.3 spec § 3.A). The columns themselves stay text[] for now;
-- the UI swaps from InlineTagInput (free typing) to RecordCombobox.multi
-- backed by these lookup tables (typeahead + inline quick-add).
--
-- Backfill: every distinct existing value in projects.tags and
-- venues.features gets seeded as a lookup row, attributed to the
-- "earliest creator" available on the parent table so the audit columns
-- remain populated. New values inserted via the UI's quick-add will use
-- auth.uid() via the existing useLookup hook.
--
-- All operations are additive and reversible (DROP TABLE rolls them back).

BEGIN;

-- ============================================================================
-- Step 1: project_tags lookup
-- ============================================================================

CREATE TABLE public.project_tags (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  created_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX project_tags_name_unique_idx
  ON public.project_tags (LOWER(name));

ALTER TABLE public.project_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY project_tags_select ON public.project_tags
  FOR SELECT TO authenticated USING (true);
CREATE POLICY project_tags_insert ON public.project_tags
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY project_tags_update ON public.project_tags
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY project_tags_delete ON public.project_tags
  FOR DELETE TO authenticated USING (public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_tags TO authenticated;
GRANT ALL                            ON public.project_tags TO service_role;

-- ============================================================================
-- Step 2: venue_features lookup
-- ============================================================================

CREATE TABLE public.venue_features (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  created_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX venue_features_name_unique_idx
  ON public.venue_features (LOWER(name));

ALTER TABLE public.venue_features ENABLE ROW LEVEL SECURITY;

CREATE POLICY venue_features_select ON public.venue_features
  FOR SELECT TO authenticated USING (true);
CREATE POLICY venue_features_insert ON public.venue_features
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY venue_features_update ON public.venue_features
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY venue_features_delete ON public.venue_features
  FOR DELETE TO authenticated USING (public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.venue_features TO authenticated;
GRANT ALL                            ON public.venue_features TO service_role;

-- ============================================================================
-- Step 3: backfill from existing array columns
-- ============================================================================
--
-- Picks the lowest-created_at owner across the parent table as the
-- attribution for every seeded tag/feature. `name` casing is preserved
-- from the first occurrence; subsequent occurrences with different
-- casing collapse via the LOWER(name) unique index + ON CONFLICT.

DO $$
DECLARE
  v_actor uuid;
BEGIN
  SELECT created_by INTO v_actor
    FROM public.projects
    WHERE created_by IS NOT NULL
    ORDER BY created_at ASC
    LIMIT 1;

  IF v_actor IS NOT NULL THEN
    INSERT INTO public.project_tags (name, created_by)
    SELECT DISTINCT trim(t), v_actor
      FROM public.projects, UNNEST(tags) AS t
      WHERE t IS NOT NULL AND length(trim(t)) > 0
    ON CONFLICT DO NOTHING;
  END IF;
END$$;

DO $$
DECLARE
  v_actor uuid;
BEGIN
  SELECT created_by INTO v_actor
    FROM public.venues
    WHERE created_by IS NOT NULL
    ORDER BY created_at ASC
    LIMIT 1;

  IF v_actor IS NOT NULL THEN
    INSERT INTO public.venue_features (name, created_by)
    SELECT DISTINCT trim(f), v_actor
      FROM public.venues, UNNEST(features) AS f
      WHERE f IS NOT NULL AND length(trim(f)) > 0
    ON CONFLICT DO NOTHING;
  END IF;
END$$;

COMMIT;
