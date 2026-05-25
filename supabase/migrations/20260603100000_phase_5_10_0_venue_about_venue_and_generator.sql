-- Phase 5.10.0: venues.notes -> venues.about_venue rename + the About Venue
-- AI generator (frontend + edge function ship in the same squash).
--
-- Two related additions ship together (one squash, one Netlify deploy):
--   A. RENAME the venues.notes column to venues.about_venue. The column has
--      always been the "About Venue" deck-copy body on Surface 09 detail; the
--      `notes` name is misleading because HQ already has the polymorphic
--      `notes_log` Internal Notes table. RENAME COLUMN is OID-preserving:
--      indexes, FKs, triggers, views, and the realtime publication all
--      auto-track; RLS policies don't reference column names. No data
--      migration needed (values carry over verbatim).
--   B. CREATE OR REPLACE bulk_import_commit_venues with the rename folded in.
--      Body is byte-identical to the 5.9.7 version (20260602210000) EXCEPT the
--      three `notes` column references swap to `about_venue`:
--        - INSERT column list   (was `notes,`)
--        - INSERT value list    (was `NULLIF(v_row->>'notes', ''),`)
--        - UPDATE SET clause     (was `notes = NULLIF(v_row->>'notes', ''),`)
--      The importer commit payload (src/lib/hq/bulkImport/entities/venue.ts)
--      sends `about_venue` after this rename, so the RPC reads
--      v_row->>'about_venue' to match.
--
-- COORDINATION (spec §14): this CREATE OR REPLACE is rebased onto the 5.9.7
-- body (20260602210000), which already rebased onto the 5.9.6 undo body
-- (20260602200000). All three compose: 5.9.6 persists the undo trail
-- (imported_record_ids + imported_person_ids), 5.9.7 adds the event_day rate
-- write + general_email write-through, 5.10.0 swaps notes -> about_venue.
-- Nothing is lost.
--
-- Reversibility: the ALTER is a pure rename (a down-migration would rename
-- back). The function is a CREATE OR REPLACE on an existing SECURITY DEFINER
-- RPC (a down-migration would need the prior 5.9.7 body). Additive otherwise;
-- flagged in the PR description per docs/conventions.
--
-- SQL verification (memory feedback_security_definer_rpc_sql_verification):
-- none of the four bug classes apply. No new INSERT targets, no new
-- array_length reads, no new helper calls, no new jsonb_array_elements_text
-- expressions. The three swaps are mechanical column renames.
--
-- REVOKE check (memory feedback_revoke_execute_check_rls_callers): this
-- migration only CREATE OR REPLACEs an existing function that already GRANTs
-- EXECUTE to authenticated; no REVOKE on any RLS helper or trigger function.
-- EXECUTE is re-granted after the replace per the importer migrations' pattern.

BEGIN;

-- A. Rename the column. OID-preserving; no dependent-object changes needed.
ALTER TABLE public.venues RENAME COLUMN notes TO about_venue;

-- B. Replace the venue commit RPC. Body is the 5.9.7 version with the three
--    notes -> about_venue swaps.
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
        -- Phase 5.9.6: track only freshly-created contact People for undo.
        -- A reused (pre-existing) person is never appended -> never deleted.
        v_created_person_ids := array_append(v_created_person_ids, v_person_id);
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

    -- 6. Event Day Rate -> append one venue_rate_history row, dated today, only
    --    when the amount changed vs the venue's current most-recent event_day
    --    rate. The table is append-only; this keeps a repeat import a no-op.
    --    Strip $ / commas defensively (the grid MoneyCell already sends bare
    --    digits; a raw POST may not).
    v_rate_raw := NULLIF(regexp_replace(coalesce(v_row->>'event_day_rate', ''), '[$,]', '', 'g'), '');
    IF v_rate_raw IS NOT NULL THEN
      v_rate := v_rate_raw::int;  -- validator already enforced non-neg integer
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

  -- 7. Finalize the session row. Phase 5.9.6: persist the undo trail
  -- (created records + created-only contact People).
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
