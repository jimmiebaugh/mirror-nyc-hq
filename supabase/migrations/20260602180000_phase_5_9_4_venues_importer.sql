-- Phase 5.9.4: Venues bulk importer.
--
-- Plugs the Venue entity into the 5.9.1 bulk-import primitive. Mirrors the
-- 5.9.3 vendor RPC shape (SECURITY DEFINER, admin re-check, _queued:N
-- translation, single session + activity row, dedupe-update path that
-- REPLACES the owned join). Three deltas vs Vendor:
--   (a) venue_types is a JOIN (venue_venue_types), so resolution + write is
--       two-step: lookup-create the type, then INSERT the join row.
--   (b) exclusive_vendor_ids is a uuid[] of vendor IDs (app-validated array,
--       resolved against vendors, allowCreate=false), written through directly.
--   (c) features is a plain text[] with no companion lookup (no auto-create).
--
-- CONTACT-PEOPLE divergence: venues link a contact through the
-- venue_contact_people JOIN table (PK venue_id, person_id), NOT a
-- people.venue_id FK. people.venue_id is a dead legacy column that
-- PersonEdit / VenueDetail never read or write. So per row we create (or
-- venue-scoped-dedupe-reuse) a Venue-affiliated people row (client_id +
-- vendor_id NULL per the affiliation mutex; venue_id left NULL to match the
-- m2m model) AND insert a venue_contact_people (venue_id, person_id) join row.
-- Venue-scoped dedupe matches existing contacts THROUGH the join, name-first
-- then email (locked 2026-05-20). The join is ADDITIVE on the update path
-- (ON CONFLICT DO NOTHING), never replaced, so a manually-added contact is
-- never wiped. Contrast venue_venue_types, which IS replaced on update.
--
-- venue_types.name is a real UNIQUE CONSTRAINT (case-sensitive), so queued
-- creates use ON CONFLICT (name) DO NOTHING; a case-insensitive existence
-- probe runs first so "outdoor" reuses an existing "Outdoor". venue_types
-- has NO created_by column (unlike vendor_categories), so the INSERT omits it.

BEGIN;

-- 1. Audit stamp column on venues (parallel to projects 5.9.2 + vendors 5.9.3).
ALTER TABLE public.venues
  ADD COLUMN bulk_import_session_id uuid
    REFERENCES public.bulk_import_sessions(id)
    ON UPDATE CASCADE
    ON DELETE SET NULL;

CREATE INDEX venues_bulk_import_session_idx
  ON public.venues (bulk_import_session_id)
  WHERE bulk_import_session_id IS NOT NULL;

-- 2. Helpers.

-- Resolves a venue_type ref token to a uuid. Token may be:
--   - existing venue_types.id (uuid string)
--   - existing venue_type name (case-insensitive match)
--   - "_queued:N" referring to the N-th queued venue_type in this batch
-- Returns NULL when input is empty / null.
CREATE OR REPLACE FUNCTION public._bulk_import_resolve_venue_type_ref(
  ref text,
  queued uuid[]
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $func$
DECLARE
  v_idx integer;
  v_id  uuid;
BEGIN
  IF ref IS NULL OR ref = '' THEN
    RETURN NULL;
  END IF;
  IF starts_with(ref, '_queued:') THEN
    v_idx := substring(ref FROM 9)::integer;
    IF v_idx < 0 OR v_idx >= coalesce(array_length(queued, 1), 0) THEN
      RAISE EXCEPTION '_queued:% out of bounds for venue_type refs', v_idx USING ERRCODE = '22023';
    END IF;
    RETURN queued[v_idx + 1];
  END IF;
  BEGIN
    v_id := ref::uuid;
    RETURN v_id;
  EXCEPTION WHEN invalid_text_representation THEN
    SELECT id INTO v_id FROM public.venue_types WHERE LOWER(name) = LOWER(ref) LIMIT 1;
    RETURN v_id;
  END;
END;
$func$;

-- Resolves an exclusive_vendor ref token to a uuid. Token may be:
--   - existing vendors.id (uuid string)
--   - existing vendor name (case-insensitive match; most-recent wins if dupes)
--   - "_queued:N" is NOT supported here (allowCreate=false on this ref kind;
--     admin must pre-populate vendors before referencing in a venue import)
-- Returns NULL when input is empty / null.
CREATE OR REPLACE FUNCTION public._bulk_import_resolve_exclusive_vendor_ref(
  ref text
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $func$
DECLARE
  v_id  uuid;
BEGIN
  IF ref IS NULL OR ref = '' THEN
    RETURN NULL;
  END IF;
  IF starts_with(ref, '_queued:') THEN
    RAISE EXCEPTION 'inline-create disabled for exclusive_vendor refs; add the vendor first' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_id := ref::uuid;
    RETURN v_id;
  EXCEPTION WHEN invalid_text_representation THEN
    SELECT id INTO v_id FROM public.vendors WHERE LOWER(name) = LOWER(ref) ORDER BY created_at DESC LIMIT 1;
    RETURN v_id;
  END;
END;
$func$;

GRANT EXECUTE ON FUNCTION public._bulk_import_resolve_venue_type_ref(text, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public._bulk_import_resolve_exclusive_vendor_ref(text)   TO authenticated;

-- 3. SECURITY DEFINER RPC: atomic commit for Venue bulk import.
--
-- Payload shape (JSON):
-- {
--   "actor_id": "<uuid>",
--   "column_set": ["name", "venue_types", ...],
--   "rows": [
--     {
--       "name": "The Pavilion",
--       "address": "2049 Century Park E, Los Angeles, CA",
--       "neighborhood": "Century City",
--       "city": "Los Angeles",
--       "venue_types": ["_queued:0", "<existing-id-or-name>"],
--       "capacity": 390,
--       "square_footage": 13000,
--       "total_sq_ft": 13000,
--       "venue_slide_url": "",
--       "website_url": "https://...",
--       "contact_name": "Sara Lin",
--       "contact_email": "sara@pavilion.example.com",
--       "contact_phone": "310-555-0188",
--       "exclusive_vendor_ids": ["Lumen Lighting Co", "<existing-id>"],
--       "features": ["Pillar-free", "22ft ceilings"],
--       "notes": "Daytime rates significantly cheaper Mon-Wed",
--       "dedupe_action": "create" | "skip" | "update" | null
--     }
--   ],
--   "queued_refs": {
--     "venue_type": [{ "name": "Event Venue" }, { "name": "Outdoor" }]
--   }
-- }
--
-- Returns: { ok, session_id, created_ids[], updated_count, created_refs }

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
        contact_name = NULLIF(v_row->>'contact_name', ''),
        contact_email = NULLIF(v_row->>'contact_email', ''),
        contact_phone = NULLIF(v_row->>'contact_phone', ''),
        features = v_features,
        notes = NULLIF(v_row->>'notes', ''),
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
        venue_slide_url, website_url,
        contact_name, contact_email, contact_phone,
        features, notes, exclusive_vendor_ids,
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
    --    CRITICAL: venues link contacts through the venue_contact_people JOIN
    --    table, NOT a people.venue_id FK. (people.venue_id exists as a dead
    --    legacy column but PersonEdit/VenueDetail never read or write it; the
    --    join is the canonical, many-to-many link.) So this block:
    --      (a) create-or-venue-scoped-dedupe-reuse a Venue-affiliated people row
    --          (mutex requires client_id + vendor_id NULL for 'Venue'; leave
    --           people.venue_id NULL to match PersonEdit + the m2m model), then
    --      (b) ensure a (v_venue_id, person_id) venue_contact_people row exists.
    --    Dedupe is scoped to THIS venue by joining through venue_contact_people,
    --    NAME first then email (locked 2026-05-20: venue contacts more often
    --    share a venue-aliased email like bookings@ than a name across
    --    multiple records, so name disambiguates better). On the update path
    --    the join is ADDITIVE (ON CONFLICT DO NOTHING), NOT replaced — we
    --    never wipe a manually-added contact. (Contrast venue_venue_types,
    --    which IS replaced on update.)
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
