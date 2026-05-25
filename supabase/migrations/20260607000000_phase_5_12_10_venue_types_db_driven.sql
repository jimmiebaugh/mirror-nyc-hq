-- Phase 5.12.10: VS venue-types DB-driven. Single migration covering:
--   (1) Backfill the 9 legacy palette names so the runtime canonical
--       set covers existing TYPE_STYLES keys on day 1.
--   (2) DROP test rows not in the legacy 9 with zero venue_venue_types
--       references (per OQ #4; existing VS data is testing records).
--   (3) CONSOLIDATE any remaining case-variants among survivors,
--       re-pointing joins to the canonical-cased winner via an insert-
--       then-delete on venue_venue_types (avoids the (venue_id,
--       venue_type_id) PRIMARY KEY violation an UPDATE pattern would
--       hit when a venue references multiple losers in the same lower-
--       name group OR already references the winner alongside losers).
--   (4) DROP the case-sensitive venue_types_name_key UNIQUE constraint
--       and ADD a case-insensitive expression unique index (mirrors
--       the cities pattern from 20260516120000_phase_5_2_2_cities.sql).
--   (5) CREATE OR REPLACE bulk_import_commit_venues with the live
--       (5.10.0-body) function modified so the venue_types insert
--       uses ON CONFLICT DO NOTHING (no target); the existing
--       ON CONFLICT (name) target no longer resolves after step (4).
--       Also swap the race re-read from `WHERE name = v_qrec->>'name'`
--       to `WHERE LOWER(name) = LOWER(v_qrec->>'name')` so a case-
--       variant race-loser still resolves the winner's id.

BEGIN;

-- Step 1: backfill the 9 legacy palette names. ON CONFLICT (name)
-- uses the pre-swap UNIQUE constraint (this step runs BEFORE step 4).
INSERT INTO public.venue_types (name) VALUES
  ('Retail'),
  ('Event Venue'),
  ('White Box'),
  ('Industrial'),
  ('Warehouse'),
  ('Gallery'),
  ('Studio'),
  ('Outdoor'),
  ('Mobile')
ON CONFLICT (name) DO NOTHING;

-- Step 2: drop test rows not in the legacy 9 AND with zero references.
DELETE FROM public.venue_types
WHERE name NOT IN (
  'Retail', 'Event Venue', 'White Box', 'Industrial',
  'Warehouse', 'Gallery', 'Studio', 'Outdoor', 'Mobile'
)
  AND id NOT IN (
    SELECT DISTINCT venue_type_id FROM public.venue_venue_types
  );

-- Step 3: consolidate remaining case-variants. For each LOWER(name)
-- group with >1 row, pick the canonical winner (legacy-9-cased name
-- preferred; else oldest by created_at). INSERT a winner join for
-- every (venue_id, loser) pair via SELECT DISTINCT ... ON CONFLICT
-- DO NOTHING; then DELETE loser join rows; then DELETE loser
-- venue_types rows. The insert-then-delete shape avoids violating
-- the venue_venue_types PRIMARY KEY (venue_id, venue_type_id)
-- (defined in 20260515140002_phase_5_2_2_venues_extensions.sql line
-- 36-40), which an UPDATE ... SET venue_type_id = winner pattern
-- would hit when a venue references multiple losers in the same
-- lower-name group OR already references the winner alongside one
-- or more losers.
DO $$
DECLARE
  v_grp RECORD;
  v_winner uuid;
  v_legacy_set text[] := ARRAY[
    'Retail', 'Event Venue', 'White Box', 'Industrial',
    'Warehouse', 'Gallery', 'Studio', 'Outdoor', 'Mobile'
  ];
BEGIN
  FOR v_grp IN
    SELECT LOWER(name) AS lname,
           array_agg(
             id ORDER BY
               (CASE WHEN name = ANY(v_legacy_set) THEN 0 ELSE 1 END),
               created_at ASC
           ) AS ids
    FROM public.venue_types
    GROUP BY LOWER(name)
    HAVING COUNT(*) > 1
  LOOP
    v_winner := v_grp.ids[1];
    -- Insert winner join for every venue that referenced any loser.
    -- DISTINCT collapses the multi-loser-per-venue case; ON CONFLICT
    -- DO NOTHING swallows the case where the venue already has the
    -- winner row in addition to one or more losers. After this
    -- statement, every venue that referenced any loser also
    -- references the winner.
    INSERT INTO public.venue_venue_types (venue_id, venue_type_id)
    SELECT DISTINCT venue_id, v_winner
      FROM public.venue_venue_types
     WHERE venue_type_id = ANY(v_grp.ids[2:])
    ON CONFLICT DO NOTHING;
    -- Drop loser join rows (PRIMARY KEY violation now impossible
    -- because the winner rows already exist where needed).
    DELETE FROM public.venue_venue_types
     WHERE venue_type_id = ANY(v_grp.ids[2:]);
    -- Delete loser venue_types rows.
    DELETE FROM public.venue_types WHERE id = ANY(v_grp.ids[2:]);
    RAISE NOTICE 'Consolidated venue_types case-variants for "%": kept %, dropped %', v_grp.lname, v_winner, v_grp.ids[2:];
  END LOOP;
END $$;

-- Step 4: drop the case-sensitive UNIQUE constraint, add LOWER index.
ALTER TABLE public.venue_types DROP CONSTRAINT venue_types_name_key;
CREATE UNIQUE INDEX venue_types_name_lower_unique_idx
  ON public.venue_types (LOWER(name));

-- Step 5: CREATE OR REPLACE bulk_import_commit_venues with the live
-- (5.10.0) body, changing TWO venue_types-related lines to align
-- with the case-insensitive lookup:
--
--   (a) Insert ON CONFLICT clause: `ON CONFLICT (name) DO NOTHING`
--       -> `ON CONFLICT DO NOTHING`. The column-level `(name)`
--       target no longer resolves after step 4's constraint swap;
--       the targetless form swallows any unique violation regardless
--       of which index fired.
--   (b) Race re-read after a swallowed conflict (5.10.0 line 124):
--       `WHERE name = v_qrec->>'name'` -> `WHERE LOWER(name)
--       = LOWER(v_qrec->>'name')`. Without this swap, a race-loser
--       inserting "retail" while "Retail" wins gets the conflict
--       swallowed, then the exact-case re-read returns null, and
--       v_queued_types ends up with a NULL id (downstream venue join
--       insert fails). The case-insensitive re-read resolves the
--       winner regardless of casing.
--
-- Body lifted verbatim from
-- 20260603100000_phase_5_10_0_venue_about_venue_and_generator.sql
-- (the 5.10.0 about_venue rename + bulk-import RPC swap) with the
-- two substring swaps above applied inside the v_queued_types loop.
-- No other body changes.

CREATE OR REPLACE FUNCTION public.bulk_import_commit_venues(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_actor          uuid;
  v_session_id     uuid;
  v_role           public.permission_role;
  v_row            jsonb;
  v_row_index      integer := 0;
  v_dedupe_action  text;
  v_venue_id       uuid;
  v_existing_id    uuid;
  v_created_ids    uuid[] := '{}';
  v_created_person_ids uuid[] := '{}';
  v_updated_count  integer := 0;
  v_queued_types   uuid[] := '{}';
  v_created_refs   jsonb  := jsonb_build_object(
    'venue_types', 0,
    'cities', 0,
    'people', 0,
    'venue_rates', 0
  );
  v_city           text;
  v_type_id        uuid;
  v_type_ref       text;
  v_vendor_id_ref  text;
  v_vendor_id      uuid;
  v_excl_vendors   uuid[] := '{}';
  v_features       text[] := '{}';
  v_contact_name   text;
  v_contact_email  text;
  v_contact_phone  text;
  v_person_id      uuid;
  v_qrec           jsonb;
  v_existing_type  uuid;
  v_rate_raw       text;
  v_rate           int;
  v_current_rate   int;
BEGIN
  -- Auth: defense-in-depth admin check.
  v_actor := (payload->>'actor_id')::uuid;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'actor_id required' USING ERRCODE = '22023';
  END IF;
  SELECT permission_role INTO v_role
    FROM public.users WHERE id = v_actor;
  IF v_role IS NULL OR v_role <> 'admin' THEN
    RAISE EXCEPTION 'actor must be admin' USING ERRCODE = '42501';
  END IF;

  -- 1. Queued venue_types first; build id translation.
  -- Post-5.12.10: venue_types uniqueness is now an expression index on
  -- LOWER(name). The existence probe is already case-insensitive so the
  -- non-race path matches across casings; the INSERT's ON CONFLICT
  -- clause drops the (name) target because the column-level constraint
  -- no longer exists (the targetless form swallows the unique violation
  -- regardless of which index fired). The race re-read is also case-
  -- insensitive so a race-loser inserting "retail" while "Retail" wins
  -- still resolves the winner's id.
  FOR v_qrec IN SELECT * FROM jsonb_array_elements(coalesce(payload->'queued_refs'->'venue_type', '[]'::jsonb))
  LOOP
    v_existing_type := NULL;
    SELECT id INTO v_existing_type FROM public.venue_types
      WHERE LOWER(name) = LOWER(v_qrec->>'name') LIMIT 1;
    IF v_existing_type IS NOT NULL THEN
      v_queued_types := array_append(v_queued_types, v_existing_type);
      CONTINUE; -- reuse existing; do not bump created_refs counter
    END IF;
    INSERT INTO public.venue_types (name)
    VALUES (v_qrec->>'name')
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_type_id;
    IF v_type_id IS NULL THEN
      -- ON CONFLICT swallowed (race). Re-fetch case-insensitively so a
      -- case-variant winner ("Retail" vs the loser's "retail") still
      -- resolves to the winner's id.
      SELECT id INTO v_type_id FROM public.venue_types
        WHERE LOWER(name) = LOWER(v_qrec->>'name') LIMIT 1;
    END IF;
    v_queued_types := array_append(v_queued_types, v_type_id);
    v_created_refs := jsonb_set(v_created_refs, '{venue_types}', to_jsonb((v_created_refs->>'venue_types')::int + 1));
  END LOOP;

  -- 2. Session row early so per-venue rows can FK to it.
  INSERT INTO public.bulk_import_sessions (entity_type, actor, row_count, created_refs, column_set, status)
  VALUES (
    'venue',
    v_actor,
    0,
    v_created_refs,
    coalesce(
      (SELECT array_agg(elem) FROM jsonb_array_elements_text(coalesce(payload->'column_set', '[]'::jsonb)) elem),
      '{}'::text[]
    ),
    'committed'
  )
  RETURNING id INTO v_session_id;

  -- 3. Per-row loop.
  FOR v_row IN SELECT * FROM jsonb_array_elements(coalesce(payload->'rows', '[]'::jsonb))
  LOOP
    v_dedupe_action := coalesce(v_row->>'dedupe_action', 'create');

    IF v_dedupe_action = 'skip' THEN
      v_row_index := v_row_index + 1;
      CONTINUE;
    END IF;

    -- Auto-create city lookup if novel (matches 5.9.3 pattern).
    v_city := NULLIF(v_row->>'city', '');
    IF v_city IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.cities WHERE LOWER(name) = LOWER(v_city)) THEN
      INSERT INTO public.cities (name, created_by) VALUES (v_city, v_actor)
        ON CONFLICT DO NOTHING;
      v_created_refs := jsonb_set(v_created_refs, '{cities}', to_jsonb((v_created_refs->>'cities')::int + 1));
    END IF;

    -- Resolve exclusive_vendor_ids array.
    v_excl_vendors := '{}';
    FOR v_vendor_id_ref IN SELECT jsonb_array_elements_text(coalesce(v_row->'exclusive_vendor_ids', '[]'::jsonb))
    LOOP
      v_vendor_id_ref := btrim(v_vendor_id_ref);
      CONTINUE WHEN v_vendor_id_ref = '';
      v_vendor_id := public._bulk_import_resolve_exclusive_vendor_ref(v_vendor_id_ref);
      IF v_vendor_id IS NULL THEN
        RAISE EXCEPTION 'exclusive_vendor % could not be resolved at row %', v_vendor_id_ref, v_row_index USING ERRCODE = '23503';
      END IF;
      v_excl_vendors := array_append(v_excl_vendors, v_vendor_id);
    END LOOP;

    -- Resolve features (plain write-through, no auto-create).
    v_features := coalesce(
      (SELECT array_agg(btrim(elem)) FROM jsonb_array_elements_text(coalesce(v_row->'features', '[]'::jsonb)) elem WHERE btrim(elem) <> ''),
      '{}'::text[]
    );

    IF v_dedupe_action = 'update' THEN
      SELECT id INTO v_existing_id
        FROM public.venues
        WHERE LOWER(name) = LOWER(v_row->>'name')
          AND LOWER(coalesce(address, '')) = LOWER(coalesce(v_row->>'address', ''))
        ORDER BY created_at DESC
        LIMIT 1;
      IF v_existing_id IS NULL THEN
        RAISE EXCEPTION 'update target not found for row %', v_row_index USING ERRCODE = 'P0002';
      END IF;
      UPDATE public.venues SET
        name = v_row->>'name',
        address = NULLIF(v_row->>'address', ''),
        neighborhood = NULLIF(v_row->>'neighborhood', ''),
        city = v_city,
        capacity = NULLIF(v_row->>'capacity', '')::integer,
        square_footage = NULLIF(v_row->>'square_footage', '')::integer,
        total_sq_ft = NULLIF(v_row->>'total_sq_ft', '')::integer,
        venue_slide_url = NULLIF(v_row->>'venue_slide_url', ''),
        website_url = NULLIF(v_row->>'website_url', ''),
        general_email = NULLIF(v_row->>'general_email', ''),
        contact_name = NULLIF(v_row->>'contact_name', ''),
        contact_email = NULLIF(v_row->>'contact_email', ''),
        contact_phone = NULLIF(v_row->>'contact_phone', ''),
        features = v_features,
        about_venue = NULLIF(v_row->>'about_venue', ''),
        exclusive_vendor_ids = v_excl_vendors,
        bulk_import_session_id = v_session_id,
        updated_at = now()
      WHERE id = v_existing_id;
      v_venue_id := v_existing_id;
      v_updated_count := v_updated_count + 1;
      -- REPLACE venue_venue_types on update (importer owns the join).
      DELETE FROM public.venue_venue_types WHERE venue_id = v_venue_id;
    ELSE
      INSERT INTO public.venues (
        name, address, neighborhood, city,
        capacity, square_footage, total_sq_ft,
        venue_slide_url, website_url, general_email,
        contact_name, contact_email, contact_phone,
        features, about_venue, exclusive_vendor_ids,
        created_by, bulk_import_session_id
      )
      VALUES (
        v_row->>'name',
        NULLIF(v_row->>'address', ''),
        NULLIF(v_row->>'neighborhood', ''),
        v_city,
        NULLIF(v_row->>'capacity', '')::integer,
        NULLIF(v_row->>'square_footage', '')::integer,
        NULLIF(v_row->>'total_sq_ft', '')::integer,
        NULLIF(v_row->>'venue_slide_url', ''),
        NULLIF(v_row->>'website_url', ''),
        NULLIF(v_row->>'general_email', ''),
        NULLIF(v_row->>'contact_name', ''),
        NULLIF(v_row->>'contact_email', ''),
        NULLIF(v_row->>'contact_phone', ''),
        v_features,
        NULLIF(v_row->>'about_venue', ''),
        v_excl_vendors,
        v_actor,
        v_session_id
      )
      RETURNING id INTO v_venue_id;
      v_created_ids := array_append(v_created_ids, v_venue_id);
    END IF;

    -- 4. venue_venue_types join writes (resolve each type, INSERT idempotently).
    FOR v_type_ref IN SELECT jsonb_array_elements_text(coalesce(v_row->'venue_types', '[]'::jsonb))
    LOOP
      v_type_ref := btrim(v_type_ref);
      CONTINUE WHEN v_type_ref = '';
      v_type_id := public._bulk_import_resolve_venue_type_ref(v_type_ref, v_queued_types);
      IF v_type_id IS NULL THEN
        RAISE EXCEPTION 'venue_type ref % could not be resolved at row %', v_type_ref, v_row_index USING ERRCODE = '23503';
      END IF;
      INSERT INTO public.venue_venue_types (venue_id, venue_type_id)
        VALUES (v_venue_id, v_type_id)
        ON CONFLICT DO NOTHING;
    END LOOP;

    -- 5. Contact PEOPLE row + venue_contact_people JOIN row.
    --    See 5.10.0 docblock for the venue-scoped dedupe rationale; body
    --    unchanged.
    v_contact_name := NULLIF(btrim(v_row->>'contact_name'), '');
    IF v_contact_name IS NOT NULL THEN
      v_contact_email := NULLIF(btrim(v_row->>'contact_email'), '');
      v_contact_phone := NULLIF(btrim(v_row->>'contact_phone'), '');
      v_person_id := NULL;
      SELECT p.id INTO v_person_id
        FROM public.people p
        JOIN public.venue_contact_people vcp ON vcp.person_id = p.id
       WHERE vcp.venue_id = v_venue_id AND LOWER(p.full_name) = LOWER(v_contact_name)
       ORDER BY p.created_at ASC LIMIT 1;
      IF v_person_id IS NULL AND v_contact_email IS NOT NULL THEN
        SELECT p.id INTO v_person_id
          FROM public.people p
          JOIN public.venue_contact_people vcp ON vcp.person_id = p.id
         WHERE vcp.venue_id = v_venue_id AND LOWER(p.email) = LOWER(v_contact_email)
         ORDER BY p.created_at ASC LIMIT 1;
      END IF;
      IF v_person_id IS NULL THEN
        INSERT INTO public.people (full_name, email, phone, affiliation_type, created_by)
        VALUES (
          v_contact_name,
          v_contact_email,
          v_contact_phone,
          'Venue'::public.person_affiliation_type,
          v_actor
        )
        RETURNING id INTO v_person_id;
        v_created_refs := jsonb_set(v_created_refs, '{people}', to_jsonb((v_created_refs->>'people')::int + 1));
        v_created_person_ids := array_append(v_created_person_ids, v_person_id);
      ELSE
        UPDATE public.people
           SET email = coalesce(email, v_contact_email),
               phone = coalesce(phone, v_contact_phone)
         WHERE id = v_person_id
           AND (email IS NULL OR phone IS NULL);
      END IF;
      INSERT INTO public.venue_contact_people (venue_id, person_id)
      VALUES (v_venue_id, v_person_id)
      ON CONFLICT (venue_id, person_id) DO NOTHING;
    END IF;

    -- 6. Event Day Rate -> append one venue_rate_history row, dated today,
    --    only when the amount changed vs the venue's current most-recent
    --    event_day rate. The table is append-only; this keeps a repeat
    --    import a no-op.
    v_rate_raw := NULLIF(regexp_replace(coalesce(v_row->>'event_day_rate', ''), '[$,]', '', 'g'), '');
    IF v_rate_raw IS NOT NULL THEN
      v_rate := v_rate_raw::int;
      SELECT amount_usd INTO v_current_rate
        FROM public.venue_rate_history
        WHERE venue_id = v_venue_id AND rate_kind = 'event_day'
        ORDER BY effective_from DESC, created_at DESC
        LIMIT 1;
      IF v_current_rate IS DISTINCT FROM v_rate THEN
        INSERT INTO public.venue_rate_history (venue_id, rate_kind, amount_usd, effective_from, created_by)
        VALUES (v_venue_id, 'event_day', v_rate, current_date, v_actor);
        v_created_refs := jsonb_set(
          v_created_refs, '{venue_rates}',
          to_jsonb(coalesce((v_created_refs->>'venue_rates')::int, 0) + 1)
        );
      END IF;
    END IF;

    v_row_index := v_row_index + 1;
  END LOOP;

  -- 7. Finalize the session row. Persist the undo trail (created records +
  -- created-only contact People; 5.9.6).
  UPDATE public.bulk_import_sessions
     SET row_count = coalesce(array_length(v_created_ids, 1), 0) + v_updated_count,
         created_refs = v_created_refs,
         imported_record_ids = v_created_ids,
         imported_person_ids = v_created_person_ids
   WHERE id = v_session_id;

  -- 8. One activity_log row for the session.
  INSERT INTO public.activity_log (entity_type, entity_id, actor_id, action, payload)
  VALUES (
    'bulk_import_session',
    v_session_id,
    v_actor,
    'bulk_import',
    jsonb_build_object(
      'entity_type', 'venue',
      'row_count', coalesce(array_length(v_created_ids, 1), 0) + v_updated_count,
      'created', coalesce(array_length(v_created_ids, 1), 0),
      'updated', v_updated_count,
      'created_refs', v_created_refs
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'session_id', v_session_id,
    'created_ids', to_jsonb(v_created_ids),
    'updated_count', v_updated_count,
    'created_refs', v_created_refs
  );
EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$func$;

GRANT EXECUTE ON FUNCTION public.bulk_import_commit_venues(jsonb) TO authenticated;

COMMIT;
