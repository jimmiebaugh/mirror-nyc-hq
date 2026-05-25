-- Phase 5.12.2: canonicalize vs_scouts.city against the cities lookup.
--
-- Pre-5.12.2, vs_scouts.city was free-text. The 5.12.1 HQ Venues pool query
-- compares this column against venues.city via .ilike() (case-insensitive
-- equality, NO wildcards), so a scout whose city doesn't match a canonical
-- cities row exactly (modulo case + leading/trailing whitespace) gets zero
-- HQ pool hits even when relevant venues exist.
--
-- Backfill posture: CASE/TRIM canonicalization ONLY. The migration does NOT
-- auto-create new cities rows from unmatched scout values. Reason: legacy
-- scouts often carry alias-style values like "New York, NY" or "LA" that
-- the previous Input's placeholder ("e.g. New York, NY") implicitly
-- encouraged. Auto-creating those as novel cities rows would pollute the
-- lookup AND leave the 5.12.1 HQ pool gate broken (the new "New York, NY"
-- row still wouldn't match the existing "New York" row in cities or any
-- venues.city = 'New York'). Better: leave unmatched values in place, log
-- them, and let Jimmie clean up manually during testing per the planning
-- decision (existing scouts are test data).
--
-- The migration:
--   1. For each non-empty vs_scouts.city, look up cities by LOWER(name).
--   2. If a canonical row exists, UPDATE the scout's city to the canonical
--      name (case-correction + trim).
--   3. If no canonical row exists, RAISE NOTICE + leave the scout's city
--      unchanged. Caller cleans up manually.
--   4. Empty / null scout.city values are left alone (producer fills via
--      the picker on reopen).
--
-- The migration also handles the cities.created_by NOT NULL constraint
-- defensively. vs_scouts.created_by is ON DELETE SET NULL, so a scout
-- whose owner has been deleted carries NULL there. Since this migration
-- never INSERTs into cities, that mismatch can't trigger a transaction
-- abort. Documented here so the no-auto-create choice doubles as the
-- null-owner safeguard.

BEGIN;

DO $$
DECLARE
  v_scout record;
  v_trimmed text;
  v_canonical_name text;
  v_unmatched_count int := 0;
BEGIN
  FOR v_scout IN
    SELECT id, city, created_by
    FROM public.vs_scouts
    WHERE city IS NOT NULL AND length(trim(city)) > 0
  LOOP
    v_trimmed := trim(v_scout.city);

    -- Lookup canonical name (case-insensitive).
    SELECT name INTO v_canonical_name
    FROM public.cities
    WHERE lower(name) = lower(v_trimmed)
    LIMIT 1;

    IF v_canonical_name IS NULL THEN
      -- Unmatched legacy value. Do NOT auto-create. Leave the scout's
      -- city in place; Jimmie cleans up manually during testing.
      v_unmatched_count := v_unmatched_count + 1;
      RAISE NOTICE
        '[phase-5-12-2-backfill] unmatched scout city: scout_id=% city=%',
        v_scout.id, v_scout.city;
      CONTINUE;
    END IF;

    -- Canonical match exists. UPDATE the scout if the stored value isn't
    -- byte-identical to the canonical row's name.
    IF v_canonical_name <> v_scout.city THEN
      UPDATE public.vs_scouts
      SET city = v_canonical_name
      WHERE id = v_scout.id;
    END IF;
  END LOOP;

  IF v_unmatched_count > 0 THEN
    RAISE NOTICE
      '[phase-5-12-2-backfill] % unmatched scout(s) left untouched; manual cleanup required',
      v_unmatched_count;
  END IF;
END;
$$;

COMMIT;
