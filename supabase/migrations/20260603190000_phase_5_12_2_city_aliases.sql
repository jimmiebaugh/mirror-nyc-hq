-- Phase 5.12.2 (alias extension): cities aliases lookup.
--
-- Producer ask surfaced during 5.12.2 smoke (2026-05-23 PM): the brief
-- parser pulls "Los Angeles" / "Los Angeles, CA" / "New York" / "New York
-- City" from PDFs, but the canonical cities rows are "LA" and "NYC". The
-- existing case-insensitive cities lookup can't reconcile these because
-- the strings genuinely differ; aliases need to be data, not regex.
--
-- This migration:
--   1. Creates `city_aliases` (alias text, city_id uuid FK to cities).
--   2. Seeds the 4 LA/NYC alias rows.
--   3. Re-runs the 5.12.2 scout backfill through state-suffix stripping
--      + alias resolution so the 5 "Los Angeles*" scouts unmatched by the
--      first pass get canonicalized to "LA". "Dallas, TX" still stays
--      unmatched (no canonical "Dallas" row exists; producer choice).
--
-- The same producer-driven runtime-vs-backfill asymmetry decided in the
-- 5.12.2 case/trim backfill holds here: the migration NEVER auto-creates
-- new cities or alias rows, only canonicalizes through the existing
-- table. Unmatched legacy values remain in place + log to NOTICE.
--
-- Settings UI for admin alias curation is intentionally deferred to a
-- follow-on sub-phase. The seed covers the two cities Jimmie uses today;
-- new aliases land via SQL until the Settings -> Lookup Lists card
-- extends to a paired (alias, city) shape.

BEGIN;

CREATE TABLE public.city_aliases (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alias      text NOT NULL,
  city_id    uuid NOT NULL REFERENCES public.cities(id) ON DELETE CASCADE,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX city_aliases_alias_unique_idx
  ON public.city_aliases (LOWER(alias));
CREATE INDEX city_aliases_city_id_idx
  ON public.city_aliases (city_id);

ALTER TABLE public.city_aliases ENABLE ROW LEVEL SECURITY;

CREATE POLICY city_aliases_select ON public.city_aliases
  FOR SELECT TO authenticated USING (true);
CREATE POLICY city_aliases_insert ON public.city_aliases
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY city_aliases_update ON public.city_aliases
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY city_aliases_delete ON public.city_aliases
  FOR DELETE TO authenticated USING (public.is_admin());

GRANT SELECT, INSERT, UPDATE ON public.city_aliases TO authenticated;
GRANT ALL                    ON public.city_aliases TO service_role;

-- Seed the LA + NYC aliases. created_by intentionally NULL on the seed
-- (no specific producer triggered these; the table FK is nullable for
-- this case). Idempotent via the LOWER(alias) unique index.
INSERT INTO public.city_aliases (alias, city_id)
SELECT v.alias, c.id
FROM (VALUES
  ('Los Angeles',     'LA'),
  ('Los Angeles, CA', 'LA'),
  ('New York',        'NYC'),
  ('New York City',   'NYC')
) AS v(alias, target)
JOIN public.cities c ON LOWER(c.name) = LOWER(v.target)
ON CONFLICT DO NOTHING;

-- Second backfill pass: now that aliases exist, re-resolve scout city
-- values through the full ladder (exact -> alias -> state-strip-exact ->
-- state-strip-alias). The 5 "Los Angeles" / "Los Angeles, CA" scouts
-- from the 5.12.2 first-pass NOTICE log should canonicalize to "LA".
-- The 1 "Dallas, TX" scout stays unmatched (no canonical row).
DO $$
DECLARE
  v_scout         record;
  v_trimmed       text;
  v_stripped      text;
  v_canonical     text;
  v_remaining     int := 0;
  v_canonicalized int := 0;
BEGIN
  FOR v_scout IN
    SELECT id, city
    FROM public.vs_scouts
    WHERE city IS NOT NULL AND length(trim(city)) > 0
  LOOP
    v_trimmed   := trim(v_scout.city);
    -- Strip a trailing ", XX" 2-letter state suffix (case-insensitive).
    v_stripped  := trim(regexp_replace(v_trimmed, ',\s*[A-Za-z]{2}\s*$', '', 'g'));
    v_canonical := NULL;

    -- (1) Direct cities match on trimmed.
    SELECT name INTO v_canonical
    FROM public.cities WHERE LOWER(name) = LOWER(v_trimmed) LIMIT 1;

    -- (2) Alias match on trimmed.
    IF v_canonical IS NULL THEN
      SELECT c.name INTO v_canonical
      FROM public.city_aliases a
      JOIN public.cities c ON c.id = a.city_id
      WHERE LOWER(a.alias) = LOWER(v_trimmed)
      LIMIT 1;
    END IF;

    -- (3) Direct cities match on state-stripped (only if strip differed).
    IF v_canonical IS NULL AND v_stripped <> v_trimmed AND length(v_stripped) > 0 THEN
      SELECT name INTO v_canonical
      FROM public.cities WHERE LOWER(name) = LOWER(v_stripped) LIMIT 1;
    END IF;

    -- (4) Alias match on state-stripped.
    IF v_canonical IS NULL AND v_stripped <> v_trimmed AND length(v_stripped) > 0 THEN
      SELECT c.name INTO v_canonical
      FROM public.city_aliases a
      JOIN public.cities c ON c.id = a.city_id
      WHERE LOWER(a.alias) = LOWER(v_stripped)
      LIMIT 1;
    END IF;

    IF v_canonical IS NULL THEN
      v_remaining := v_remaining + 1;
      RAISE NOTICE
        '[phase-5-12-2-alias-backfill] still-unmatched scout city: scout_id=% city=%',
        v_scout.id, v_scout.city;
      CONTINUE;
    END IF;

    IF v_canonical <> v_scout.city THEN
      UPDATE public.vs_scouts SET city = v_canonical WHERE id = v_scout.id;
      v_canonicalized := v_canonicalized + 1;
    END IF;
  END LOOP;

  RAISE NOTICE
    '[phase-5-12-2-alias-backfill] canonicalized=% remaining-unmatched=%',
    v_canonicalized, v_remaining;
END;
$$;

COMMIT;
