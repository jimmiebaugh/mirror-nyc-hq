-- Phase 5.9.4 correction: drop exclusive_vendor from the Venues importer.
--
-- Jimmie's call (2026-05-20): exclusive vendors must NOT be settable via bulk
-- import at all — not via the template, and not via the EntityConfig full
-- picker either. The venue.exclusive_vendor_ids column stays (it predates the
-- importer, set on the manual VenueEdit surface); the importer just stops
-- reading or writing it.
--
-- Why this matters for the RPC (not just the frontend): the prior
-- bulk_import_commit_venues wrote `exclusive_vendor_ids = v_excl_vendors` on the
-- dedupe-update path. With the importer no longer sending the column,
-- v_excl_vendors would resolve to '{}' and a dedupe-update would WIPE a venue's
-- manually-curated exclusive vendors. So the RPC must stop touching the column
-- entirely (neither INSERT nor UPDATE). This CREATE OR REPLACE removes all
-- exclusive-vendor resolution + writes; the now-unused resolver helper is
-- dropped.

BEGIN;

DROP FUNCTION IF EXISTS public._bulk_import_resolve_exclusive_vendor_ref(text);

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
  v_updated_count  integer := 0;
  v_queued_types   uuid[] := '{}';
  v_created_refs   jsonb  := jsonb_build_object(
    'venue_types', 0,
    'cities', 0,
    'people', 0
  );
  v_city           text;
  v_type_id        uuid;
  v_type_ref       text;
  v_features       text[] := '{}';
  v_contact_name   text;
  v_contact_email  text;
  v_contact_phone  text;
  v_person_id      uuid;
  v_qrec           jsonb;
  v_existing_type  uuid;
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
  -- venue_types.name is a real UNIQUE constraint (case-sensitive). To respect
  -- existing rows when admin types a different case (e.g. "outdoor" when
  -- "Outdoor" exists), probe case-insensitively first; only INSERT if no
  -- case-insensitive match. ON CONFLICT (name) DO NOTHING covers the race.
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
    ON CONFLICT (name) DO NOTHING
    RETURNING id INTO v_type_id;
    IF v_type_id IS NULL THEN
      -- ON CONFLICT swallowed (race). Re-fetch.
      SELECT id INTO v_type_id FROM public.venue_types WHERE name = v_qrec->>'name' LIMIT 1;
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
      -- NOTE: exclusive_vendor_ids is intentionally NOT touched here. It is set
      -- only on the manual VenueEdit surface; the importer must never clobber it.
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
        contact_name = NULLIF(v_row->>'contact_name', ''),
        contact_email = NULLIF(v_row->>'contact_email', ''),
        contact_phone = NULLIF(v_row->>'contact_phone', ''),
        features = v_features,
        notes = NULLIF(v_row->>'notes', ''),
        bulk_import_session_id = v_session_id,
        updated_at = now()
      WHERE id = v_existing_id;
      v_venue_id := v_existing_id;
      v_updated_count := v_updated_count + 1;
      -- REPLACE venue_venue_types on update (importer owns the join).
      DELETE FROM public.venue_venue_types WHERE venue_id = v_venue_id;
    ELSE
      -- exclusive_vendor_ids omitted; the column default '{}' applies on create.
      INSERT INTO public.venues (
        name, address, neighborhood, city,
        capacity, square_footage, total_sq_ft,
        venue_slide_url, website_url,
        contact_name, contact_email, contact_phone,
        features, notes,
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
        NULLIF(v_row->>'contact_name', ''),
        NULLIF(v_row->>'contact_email', ''),
        NULLIF(v_row->>'contact_phone', ''),
        v_features,
        NULLIF(v_row->>'notes', ''),
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
    --    CRITICAL: venues link contacts through the venue_contact_people JOIN
    --    table, NOT a people.venue_id FK. (people.venue_id exists as a dead
    --    legacy column but PersonEdit/VenueDetail never read or write it; the
    --    join is the canonical, many-to-many link.) So this block:
    --      (a) create-or-venue-scoped-dedupe-reuse a Venue-affiliated people row
    --          (mutex requires client_id + vendor_id NULL for 'Venue'; leave
    --           people.venue_id NULL to match PersonEdit + the m2m model), then
    --      (b) ensure a (v_venue_id, person_id) venue_contact_people row exists.
    --    Dedupe is scoped to THIS venue by joining through venue_contact_people,
    --    NAME first then email (locked 2026-05-20). On the update path the join
    --    is ADDITIVE (ON CONFLICT DO NOTHING), NOT replaced — we never wipe a
    --    manually-added contact. (Contrast venue_venue_types, replaced on update.)
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
      ELSE
        -- Reuse the existing venue contact; backfill email/phone if missing.
        UPDATE public.people
           SET email = coalesce(email, v_contact_email),
               phone = coalesce(phone, v_contact_phone)
         WHERE id = v_person_id
           AND (email IS NULL OR phone IS NULL);
      END IF;
      -- Ensure the venue<->person join row exists (idempotent).
      INSERT INTO public.venue_contact_people (venue_id, person_id)
      VALUES (v_venue_id, v_person_id)
      ON CONFLICT (venue_id, person_id) DO NOTHING;
    END IF;

    v_row_index := v_row_index + 1;
  END LOOP;

  -- 6. Finalize the session row.
  UPDATE public.bulk_import_sessions
     SET row_count = coalesce(array_length(v_created_ids, 1), 0) + v_updated_count,
         created_refs = v_created_refs
   WHERE id = v_session_id;

  -- 7. One activity_log row for the session.
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
