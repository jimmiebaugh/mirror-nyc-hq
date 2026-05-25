-- Phase 5.12.2 (alias cleanup): repair runtime pollution from pre-alias
-- vs-parse-brief inserts.
--
-- Pre-alias vs-parse-brief 5.12.2 (deployed earlier this session) ran the
-- bare case-insensitive cities lookup against a raw parsed city. For
-- "Los Angeles, CA" it found no canonical row + INSERTed a brand-new
-- "Los Angeles, CA" cities row, then set scout.city to that polluting
-- name. The 20260603190000 alias migration's backfill loop checked
-- direct cities lookup BEFORE alias lookup, so the polluting row hit
-- first and the alias never got a chance to redirect.
--
-- This migration:
--   1. Re-runs the alias backfill with ALIAS-FIRST ordering (the
--      corrected resolution order also baked into vs-parse-brief), so
--      free-text city columns across vs_scouts / venues / vendors /
--      projects / clients all canonicalize through aliases.
--   2. DELETEs polluting cities rows whose LOWER(name) matches an
--      alias's LOWER(alias). Safe because step 1 already redirected
--      every referencing row to the canonical name.
--
-- Idempotent: on a fresh DB where vs-parse-brief never created
-- polluting rows, every step is a no-op.

BEGIN;

-- Helper: returns the canonical city name for an input, applying the
-- alias-first ladder + state-suffix stripping. NULL on miss. Inline so
-- this migration doesn't introduce a public function.

DO $$
DECLARE
  v_row              record;
  v_trimmed          text;
  v_stripped         text;
  v_canonical        text;
  v_table            text;
  v_canonicalized    int := 0;
  v_total_unmatched  int := 0;
BEGIN
  -- Iterate every alias-able free-text city column. The five tables are
  -- the canonical HQ cities reference list per docs/schema.md cities
  -- (lookup) section. Hardcoded list because there's no FK relationship
  -- to walk.
  FOR v_table IN
    SELECT unnest(ARRAY['vs_scouts','venues','vendors','projects','clients']::text[])
  LOOP
    FOR v_row IN EXECUTE format(
      'SELECT id, city FROM public.%I WHERE city IS NOT NULL AND length(trim(city)) > 0',
      v_table
    ) LOOP
      v_trimmed   := trim(v_row.city);
      v_stripped  := trim(regexp_replace(v_trimmed, ',\s*[A-Za-z]{2}\s*$', '', 'g'));
      v_canonical := NULL;

      -- (1) Alias match on trimmed (priority over direct cities match
      -- so polluting cities rows can't short-circuit canonicalization).
      SELECT c.name INTO v_canonical
      FROM public.city_aliases a
      JOIN public.cities c ON c.id = a.city_id
      WHERE LOWER(a.alias) = LOWER(v_trimmed)
      LIMIT 1;

      -- (2) Alias match on state-stripped.
      IF v_canonical IS NULL AND v_stripped <> v_trimmed AND length(v_stripped) > 0 THEN
        SELECT c.name INTO v_canonical
        FROM public.city_aliases a
        JOIN public.cities c ON c.id = a.city_id
        WHERE LOWER(a.alias) = LOWER(v_stripped)
        LIMIT 1;
      END IF;

      -- (3) Direct cities match on trimmed.
      IF v_canonical IS NULL THEN
        SELECT name INTO v_canonical
        FROM public.cities WHERE LOWER(name) = LOWER(v_trimmed) LIMIT 1;
      END IF;

      -- (4) Direct cities match on state-stripped.
      IF v_canonical IS NULL AND v_stripped <> v_trimmed AND length(v_stripped) > 0 THEN
        SELECT name INTO v_canonical
        FROM public.cities WHERE LOWER(name) = LOWER(v_stripped) LIMIT 1;
      END IF;

      IF v_canonical IS NULL THEN
        v_total_unmatched := v_total_unmatched + 1;
        RAISE NOTICE
          '[phase-5-12-2-alias-cleanup] still-unmatched %.city: id=% city=%',
          v_table, v_row.id, v_row.city;
        CONTINUE;
      END IF;

      IF v_canonical <> v_row.city THEN
        EXECUTE format('UPDATE public.%I SET city = $1 WHERE id = $2', v_table)
          USING v_canonical, v_row.id;
        v_canonicalized := v_canonicalized + 1;
      END IF;
    END LOOP;
  END LOOP;

  RAISE NOTICE
    '[phase-5-12-2-alias-cleanup] canonicalized=% remaining-unmatched=%',
    v_canonicalized, v_total_unmatched;
END;
$$;

-- DELETE polluting cities rows: any city whose LOWER(name) equals an
-- alias's LOWER(alias). Step 1 already redirected every referencing
-- row, so this DELETE drops orphans. Excludes rows that ARE the
-- canonical target of an alias (alias "Los Angeles" -> city "LA": LA
-- must NOT be deleted; "Los Angeles" the cities row CAN be deleted if
-- it exists).
DELETE FROM public.cities c
USING public.city_aliases a
WHERE LOWER(c.name) = LOWER(a.alias)
  AND c.id <> a.city_id;

COMMIT;
