-- Phase 5.9.6: Bulk-import undo (revert a committed import).
--
-- Adds the undo trail + the undo RPC behind the audit page's detail rail.
--   5a. Two tracking columns on bulk_import_sessions: imported_record_ids +
--       imported_person_ids (uuid[], NOT NULL DEFAULT '{}'). Existing rows
--       backfill to '{}', correctly marking them untracked / non-undoable.
--   5b. CREATE OR REPLACE the three commit RPCs to persist those arrays. Each
--       already computes v_created_ids; we now also write it (and, for vendors
--       + venues, the freshly-INSERTED contact-person ids ONLY -- never reused
--       ones) into the session row's final UPDATE.
--   5c. bulk_import_undo(p_session_id, p_actor_id, p_dry_run): SECURITY DEFINER,
--       admin re-check, one transaction. Deletes the import-created records +
--       their import-created contact People, the original activity row; writes
--       an undo summary activity row; hard-deletes the session row. Shared
--       lookups (cities, categories, venue_types) and queued clients/venues are
--       NEVER touched (§14-A). Gated to committed status + a 7-day window.
--
-- DESTRUCTIVE: 5c introduces a function that deletes rows. The destructive
-- effect is the point and is gated (admin + committed + 7-day window). Flagged
-- in the PR description per docs/conventions.
--
-- REVOKE check (memory: feedback_revoke_execute_check_rls_callers): this
-- migration only CREATE OR REPLACEs functions that already GRANT EXECUTE to
-- authenticated and adds one net-new function. No REVOKE on any RLS helper or
-- trigger function. EXECUTE is re-granted after each replace per the existing
-- importer migrations' pattern.

BEGIN;

-- 5a. Tracking columns. Additive, reversible.
ALTER TABLE public.bulk_import_sessions
  ADD COLUMN imported_record_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  ADD COLUMN imported_person_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

-- 5b-i. Projects commit RPC: persist imported_record_ids (projects create no
--       People, so imported_person_ids stays '{}'). Only the final UPDATE
--       changed vs 20260602110000.
CREATE OR REPLACE FUNCTION public.bulk_import_commit_projects(payload jsonb)
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
  v_project_id     uuid;
  v_existing_id    uuid;
  v_created_ids    uuid[] := '{}';
  v_updated_count  integer := 0;
  v_queued_clients uuid[] := '{}';
  v_queued_venues  uuid[] := '{}';
  v_created_refs   jsonb  := jsonb_build_object(
    'client', 0,
    'venue', 0,
    'project_categories', 0,
    'cities', 0
  );
  v_client_id      uuid;
  v_venue_id       uuid;
  v_email          text;
  v_user_id        uuid;
  v_cat            text;
  v_city           text;
  v_venue_ref      text;
BEGIN
  -- Auth: defense-in-depth admin check (actor comes from the payload because
  -- the edge function invokes via the service-role client, so auth.uid() is
  -- NULL inside this function).
  v_actor := (payload->>'actor_id')::uuid;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'actor_id required' USING ERRCODE = '22023';
  END IF;
  SELECT permission_role INTO v_role
    FROM public.users WHERE id = v_actor;
  IF v_role IS NULL OR v_role <> 'admin' THEN
    RAISE EXCEPTION 'actor must be admin' USING ERRCODE = '42501';
  END IF;

  -- 1. Queued clients first; build the id translation table.
  FOR v_row IN SELECT * FROM jsonb_array_elements(coalesce(payload->'queued_refs'->'client', '[]'::jsonb))
  LOOP
    INSERT INTO public.clients (name, industry, created_by)
    VALUES (v_row->>'name', NULLIF(v_row->>'industry', ''), v_actor)
    RETURNING id INTO v_client_id;
    v_queued_clients := array_append(v_queued_clients, v_client_id);
    v_created_refs := jsonb_set(v_created_refs, '{client}', to_jsonb((v_created_refs->>'client')::int + 1));
  END LOOP;

  -- 2. Queued venues.
  FOR v_row IN SELECT * FROM jsonb_array_elements(coalesce(payload->'queued_refs'->'venue', '[]'::jsonb))
  LOOP
    INSERT INTO public.venues (name, address, created_by)
    VALUES (v_row->>'name', NULLIF(v_row->>'address', ''), v_actor)
    RETURNING id INTO v_venue_id;
    v_queued_venues := array_append(v_queued_venues, v_venue_id);
    v_created_refs := jsonb_set(v_created_refs, '{venue}', to_jsonb((v_created_refs->>'venue')::int + 1));
  END LOOP;

  -- 3. Session row early so per-project rows can FK to it. row_count +
  -- created_refs get UPDATED at the end.
  INSERT INTO public.bulk_import_sessions (entity_type, actor, row_count, created_refs, column_set, status)
  VALUES (
    'project',
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

  -- 4. Per-row commit.
  FOR v_row IN SELECT * FROM jsonb_array_elements(coalesce(payload->'rows', '[]'::jsonb))
  LOOP
    v_dedupe_action := coalesce(v_row->>'dedupe_action', 'create');

    IF v_dedupe_action = 'skip' THEN
      v_row_index := v_row_index + 1;
      CONTINUE;
    END IF;

    -- Resolve client (existing id, queued slot, name, or null).
    v_client_id := public._bulk_import_resolve_client_ref(v_row->>'client', v_queued_clients);

    -- Auto-create category lookup if novel; project.category stays text.
    v_cat := NULLIF(v_row->>'category', '');
    IF v_cat IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.project_categories WHERE lower(name) = lower(v_cat)) THEN
      INSERT INTO public.project_categories (name, created_by) VALUES (v_cat, v_actor)
        ON CONFLICT DO NOTHING;
      v_created_refs := jsonb_set(v_created_refs, '{project_categories}', to_jsonb((v_created_refs->>'project_categories')::int + 1));
    END IF;

    -- Auto-create city lookup if novel.
    v_city := NULLIF(v_row->>'city', '');
    IF v_city IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.cities WHERE lower(name) = lower(v_city)) THEN
      INSERT INTO public.cities (name, created_by) VALUES (v_city, v_actor)
        ON CONFLICT DO NOTHING;
      v_created_refs := jsonb_set(v_created_refs, '{cities}', to_jsonb((v_created_refs->>'cities')::int + 1));
    END IF;

    IF v_dedupe_action = 'update' THEN
      -- Locate existing project, UPDATE columns, REPLACE roster.
      SELECT id INTO v_existing_id
        FROM public.projects
        WHERE lower(name) = lower(v_row->>'name')
          AND coalesce(job_number, '') = coalesce(v_row->>'job_number', '')
          AND archived_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1;
      IF v_existing_id IS NULL THEN
        RAISE EXCEPTION 'update target not found for row %', v_row_index USING ERRCODE = 'P0002';
      END IF;
      UPDATE public.projects SET
        name = v_row->>'name',
        job_number = NULLIF(v_row->>'job_number', ''),
        client_id = v_client_id,
        status = coalesce((NULLIF(v_row->>'status', ''))::public.project_status, status),
        category = v_cat,
        city = v_city,
        tags = coalesce((SELECT array_agg(t) FROM jsonb_array_elements_text(coalesce(v_row->'tags', '[]'::jsonb)) t), '{}'),
        budget = NULLIF(v_row->>'budget', '')::numeric,
        live_dates_start = NULLIF(v_row->>'live_start', '')::date,
        live_dates_end = NULLIF(v_row->>'live_end', '')::date,
        install_dates_start = NULLIF(v_row->>'install_start', '')::date,
        install_dates_end = NULLIF(v_row->>'install_end', '')::date,
        removal_dates_start = NULLIF(v_row->>'removal_start', '')::date,
        removal_dates_end = NULLIF(v_row->>'removal_end', '')::date,
        production_folder_url = NULLIF(v_row->>'production_folder_url', ''),
        design_decks_folder_url = NULLIF(v_row->>'design_decks_folder_url', ''),
        budget_sheet_url = NULLIF(v_row->>'budget_sheet_url', ''),
        latest_creative_deck_url = NULLIF(v_row->>'latest_creative_deck_url', ''),
        slack_channel_url = NULLIF(v_row->>'slack_channel_url', ''),
        bulk_import_session_id = v_session_id,
        updated_at = now()
      WHERE id = v_existing_id;
      v_project_id := v_existing_id;
      v_updated_count := v_updated_count + 1;
      -- Replace roster: CSV is authoritative on the update path (locked
      -- Replace, not merge). Blank roster column => empty roster after update.
      DELETE FROM public.project_account_managers WHERE project_id = v_project_id;
      DELETE FROM public.project_designers        WHERE project_id = v_project_id;
      DELETE FROM public.project_members          WHERE project_id = v_project_id;
      DELETE FROM public.project_venues           WHERE project_id = v_project_id;
    ELSE
      -- Create path.
      INSERT INTO public.projects (
        name, job_number, client_id, status, category, city, tags, budget,
        live_dates_start, live_dates_end,
        install_dates_start, install_dates_end,
        removal_dates_start, removal_dates_end,
        production_folder_url, design_decks_folder_url,
        budget_sheet_url, latest_creative_deck_url, slack_channel_url,
        created_by, bulk_import_session_id
      )
      VALUES (
        v_row->>'name',
        NULLIF(v_row->>'job_number', ''),
        v_client_id,
        coalesce((NULLIF(v_row->>'status', ''))::public.project_status, 'Queued'::public.project_status),
        v_cat,
        v_city,
        coalesce((SELECT array_agg(t) FROM jsonb_array_elements_text(coalesce(v_row->'tags', '[]'::jsonb)) t), '{}'),
        NULLIF(v_row->>'budget', '')::numeric,
        NULLIF(v_row->>'live_start', '')::date,
        NULLIF(v_row->>'live_end', '')::date,
        NULLIF(v_row->>'install_start', '')::date,
        NULLIF(v_row->>'install_end', '')::date,
        NULLIF(v_row->>'removal_start', '')::date,
        NULLIF(v_row->>'removal_end', '')::date,
        NULLIF(v_row->>'production_folder_url', ''),
        NULLIF(v_row->>'design_decks_folder_url', ''),
        NULLIF(v_row->>'budget_sheet_url', ''),
        NULLIF(v_row->>'latest_creative_deck_url', ''),
        NULLIF(v_row->>'slack_channel_url', ''),
        v_actor,
        v_session_id
      )
      RETURNING id INTO v_project_id;
      v_created_ids := array_append(v_created_ids, v_project_id);
    END IF;

    -- 5. Roster joins.
    -- account_lead: SINGLE email per row (locked single-email semantics).
    v_email := NULLIF(v_row->>'account_lead', '');
    IF v_email IS NULL THEN
      RAISE EXCEPTION 'project at row % missing account_lead', v_row_index USING ERRCODE = '23514';
    END IF;
    SELECT id INTO v_user_id FROM public.users WHERE email = v_email;
    IF v_user_id IS NULL THEN
      RAISE EXCEPTION 'account_lead email % not found at row %', v_email, v_row_index USING ERRCODE = '23503';
    END IF;
    INSERT INTO public.project_account_managers (project_id, user_id) VALUES (v_project_id, v_user_id)
      ON CONFLICT DO NOTHING;

    FOR v_email IN SELECT jsonb_array_elements_text(coalesce(v_row->'designer', '[]'::jsonb))
    LOOP
      SELECT id INTO v_user_id FROM public.users WHERE email = v_email;
      IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'designer email % not found at row %', v_email, v_row_index USING ERRCODE = '23503';
      END IF;
      INSERT INTO public.project_designers (project_id, user_id) VALUES (v_project_id, v_user_id)
        ON CONFLICT DO NOTHING;
    END LOOP;

    FOR v_email IN SELECT jsonb_array_elements_text(coalesce(v_row->'team_members', '[]'::jsonb))
    LOOP
      SELECT id INTO v_user_id FROM public.users WHERE email = v_email;
      IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'team_members email % not found at row %', v_email, v_row_index USING ERRCODE = '23503';
      END IF;
      INSERT INTO public.project_members (project_id, user_id, created_by) VALUES (v_project_id, v_user_id, v_actor)
        ON CONFLICT DO NOTHING;
    END LOOP;

    -- 6. project_venues: existing-id strings or "_queued:N".
    FOR v_venue_ref IN SELECT jsonb_array_elements_text(coalesce(v_row->'venue', '[]'::jsonb))
    LOOP
      v_venue_id := public._bulk_import_resolve_venue_ref(v_venue_ref, v_queued_venues);
      IF v_venue_id IS NULL THEN
        RAISE EXCEPTION 'venue ref % could not be resolved at row %', v_venue_ref, v_row_index USING ERRCODE = '23503';
      END IF;
      INSERT INTO public.project_venues (project_id, venue_id) VALUES (v_project_id, v_venue_id)
        ON CONFLICT DO NOTHING;
    END LOOP;

    -- Roster minimum: at least one account_lead (the single email above
    -- guarantees this, but re-assert defensively).
    IF NOT EXISTS (SELECT 1 FROM public.project_account_managers WHERE project_id = v_project_id) THEN
      RAISE EXCEPTION 'project at row % has no Account Lead', v_row_index USING ERRCODE = '23514';
    END IF;

    v_row_index := v_row_index + 1;
  END LOOP;

  -- 7. Finalize the session row. created_ids counts only fresh inserts;
  -- updates are reflected via the bulk_import_session_id stamp on the row.
  -- Phase 5.9.6: also persist the undo trail. Projects create no People, so
  -- imported_person_ids stays empty.
  UPDATE public.bulk_import_sessions
     SET row_count = coalesce(array_length(v_created_ids, 1), 0) + v_updated_count,
         created_refs = v_created_refs,
         imported_record_ids = v_created_ids,
         imported_person_ids = '{}'::uuid[]
   WHERE id = v_session_id;

  -- 8. One activity_log row for the session itself. Per-project activity rows
  -- fire automatically via trg_activity_log_projects on each insert/update.
  INSERT INTO public.activity_log (entity_type, entity_id, actor_id, action, payload)
  VALUES (
    'bulk_import_session',
    v_session_id,
    v_actor,
    'bulk_import',
    jsonb_build_object(
      'entity_type', 'project',
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
  -- Any RAISE rolls the whole transaction back. Re-raise so the edge function
  -- catches it + writes a failed_rollback audit row.
  RAISE;
END;
$func$;

GRANT EXECUTE ON FUNCTION public.bulk_import_commit_projects(jsonb) TO authenticated;

-- 5b-ii. Vendors commit RPC: persist imported_record_ids + the created (NOT
--        reused) contact-person ids. v_created_person_ids appends ONLY in the
--        people INSERT branch.
CREATE OR REPLACE FUNCTION public.bulk_import_commit_vendors(payload jsonb)
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
  v_vendor_id      uuid;
  v_existing_id    uuid;
  v_created_ids    uuid[] := '{}';
  v_created_person_ids uuid[] := '{}';
  v_updated_count  integer := 0;
  v_queued_cats    uuid[] := '{}';
  v_queued_subcats uuid[] := '{}';
  v_created_refs   jsonb  := jsonb_build_object(
    'vendor_categories', 0,
    'vendor_subcategories', 0,
    'vendor_capabilities', 0,
    'cities', 0,
    'people', 0
  );
  v_cat_id         uuid;
  v_subcat_id      uuid;
  v_parent_id      uuid;
  v_city           text;
  v_cap_text       text;
  v_caps_resolved  text[] := '{}';
  v_preferred_raw  text;
  v_preferred      bool;
  v_nationwide_raw text;
  v_nationwide     bool;
  v_contact_name   text;
  v_contact_email  text;
  v_contact_phone  text;
  v_person_id      uuid;
  v_qrec           jsonb;
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

  -- 1. Queued vendor_categories first; build id translation.
  FOR v_qrec IN SELECT * FROM jsonb_array_elements(coalesce(payload->'queued_refs'->'category', '[]'::jsonb))
  LOOP
    INSERT INTO public.vendor_categories (name, created_by)
    VALUES (v_qrec->>'name', v_actor)
    ON CONFLICT (lower(name)) DO UPDATE
      SET name = EXCLUDED.name
    RETURNING id INTO v_cat_id;
    IF v_cat_id IS NULL THEN
      SELECT id INTO v_cat_id FROM public.vendor_categories
        WHERE lower(name) = lower(v_qrec->>'name') LIMIT 1;
    END IF;
    v_queued_cats := array_append(v_queued_cats, v_cat_id);
    v_created_refs := jsonb_set(v_created_refs, '{vendor_categories}', to_jsonb((v_created_refs->>'vendor_categories')::int + 1));
  END LOOP;

  -- 2. Queued vendor_subcategories; resolve parent_category queued-then-existing.
  FOR v_qrec IN SELECT * FROM jsonb_array_elements(coalesce(payload->'queued_refs'->'subcategory', '[]'::jsonb))
  LOOP
    v_parent_id := NULL;
    IF (v_qrec->>'parent_category') IS NOT NULL AND (v_qrec->>'parent_category') <> '' THEN
      SELECT id INTO v_parent_id
        FROM public.vendor_categories
        WHERE id = ANY(v_queued_cats)
          AND lower(name) = lower(v_qrec->>'parent_category')
        LIMIT 1;
      IF v_parent_id IS NULL THEN
        SELECT id INTO v_parent_id
          FROM public.vendor_categories
          WHERE lower(name) = lower(v_qrec->>'parent_category')
          LIMIT 1;
      END IF;
    END IF;
    IF v_parent_id IS NULL THEN
      RAISE EXCEPTION 'subcategory % missing parent_category (got %)', v_qrec->>'name', v_qrec->>'parent_category' USING ERRCODE = '23503';
    END IF;
    INSERT INTO public.vendor_subcategories (name, parent_category_id, created_by)
    VALUES (v_qrec->>'name', v_parent_id, v_actor)
    ON CONFLICT (parent_category_id, name) DO UPDATE
      SET name = EXCLUDED.name
    RETURNING id INTO v_subcat_id;
    v_queued_subcats := array_append(v_queued_subcats, v_subcat_id);
    v_created_refs := jsonb_set(v_created_refs, '{vendor_subcategories}', to_jsonb((v_created_refs->>'vendor_subcategories')::int + 1));
  END LOOP;

  -- 3. Session row early so per-vendor rows can FK to it.
  INSERT INTO public.bulk_import_sessions (entity_type, actor, row_count, created_refs, column_set, status)
  VALUES (
    'vendor',
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

  -- 4. Per-row commit.
  FOR v_row IN SELECT * FROM jsonb_array_elements(coalesce(payload->'rows', '[]'::jsonb))
  LOOP
    v_dedupe_action := coalesce(v_row->>'dedupe_action', 'create');

    IF v_dedupe_action = 'skip' THEN
      v_row_index := v_row_index + 1;
      CONTINUE;
    END IF;

    v_cat_id    := public._bulk_import_resolve_vendor_category_ref(v_row->>'category', v_queued_cats);
    v_subcat_id := public._bulk_import_resolve_vendor_subcategory_ref(v_row->>'subcategory', v_queued_subcats, v_cat_id);

    v_city := NULLIF(v_row->>'city', '');
    IF v_city IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.cities WHERE lower(name) = lower(v_city)) THEN
      INSERT INTO public.cities (name, created_by) VALUES (v_city, v_actor)
        ON CONFLICT DO NOTHING;
      v_created_refs := jsonb_set(v_created_refs, '{cities}', to_jsonb((v_created_refs->>'cities')::int + 1));
    END IF;

    v_caps_resolved := '{}';
    FOR v_cap_text IN SELECT jsonb_array_elements_text(coalesce(v_row->'capabilities', '[]'::jsonb))
    LOOP
      v_cap_text := trim(v_cap_text);
      CONTINUE WHEN v_cap_text = '';
      IF NOT EXISTS (SELECT 1 FROM public.vendor_capabilities WHERE lower(name) = lower(v_cap_text)) THEN
        INSERT INTO public.vendor_capabilities (name, created_by) VALUES (v_cap_text, v_actor)
          ON CONFLICT DO NOTHING;
        v_created_refs := jsonb_set(v_created_refs, '{vendor_capabilities}', to_jsonb((v_created_refs->>'vendor_capabilities')::int + 1));
      END IF;
      v_caps_resolved := array_append(v_caps_resolved, v_cap_text);
    END LOOP;

    -- Coerce preferred + nationwide ("true" / "false" / "" -> bool / false).
    v_preferred_raw  := NULLIF(v_row->>'preferred', '');
    v_preferred      := COALESCE(lower(v_preferred_raw) = 'true', false);
    v_nationwide_raw := NULLIF(v_row->>'nationwide', '');
    v_nationwide     := COALESCE(lower(v_nationwide_raw) = 'true', false);

    IF v_dedupe_action = 'update' THEN
      SELECT id INTO v_existing_id
        FROM public.vendors
        WHERE lower(name) = lower(v_row->>'name')
          AND lower(coalesce(city, '')) = lower(coalesce(v_row->>'city', ''))
        ORDER BY created_at DESC
        LIMIT 1;
      IF v_existing_id IS NULL THEN
        RAISE EXCEPTION 'update target not found for row %', v_row_index USING ERRCODE = 'P0002';
      END IF;
      UPDATE public.vendors SET
        name = v_row->>'name',
        category_id = v_cat_id,
        subcategory_id = v_subcat_id,
        capabilities = v_caps_resolved,
        city = v_city,
        primary_address = NULLIF(v_row->>'primary_address', ''),
        website_url = NULLIF(v_row->>'website_url', ''),
        general_email = NULLIF(v_row->>'general_email', ''),
        contact_name = NULLIF(v_row->>'contact_name', ''),
        contact_email = NULLIF(v_row->>'contact_email', ''),
        contact_phone = NULLIF(v_row->>'contact_phone', ''),
        tags = coalesce((SELECT array_agg(t) FROM jsonb_array_elements_text(coalesce(v_row->'tags', '[]'::jsonb)) t), '{}'),
        preferred = v_preferred,
        nationwide = v_nationwide,
        legacy_notes = NULLIF(v_row->>'legacy_notes', ''),
        bulk_import_session_id = v_session_id,
        updated_at = now()
      WHERE id = v_existing_id;
      v_vendor_id := v_existing_id;
      v_updated_count := v_updated_count + 1;
    ELSE
      INSERT INTO public.vendors (
        name, category_id, subcategory_id, capabilities, city,
        primary_address, website_url, general_email,
        contact_name, contact_email, contact_phone,
        tags, preferred, nationwide, legacy_notes,
        created_by, bulk_import_session_id
      )
      VALUES (
        v_row->>'name',
        v_cat_id,
        v_subcat_id,
        v_caps_resolved,
        v_city,
        NULLIF(v_row->>'primary_address', ''),
        NULLIF(v_row->>'website_url', ''),
        NULLIF(v_row->>'general_email', ''),
        NULLIF(v_row->>'contact_name', ''),
        NULLIF(v_row->>'contact_email', ''),
        NULLIF(v_row->>'contact_phone', ''),
        coalesce((SELECT array_agg(t) FROM jsonb_array_elements_text(coalesce(v_row->'tags', '[]'::jsonb)) t), '{}'),
        v_preferred,
        v_nationwide,
        NULLIF(v_row->>'legacy_notes', ''),
        v_actor,
        v_session_id
      )
      RETURNING id INTO v_vendor_id;
      v_created_ids := array_append(v_created_ids, v_vendor_id);
    END IF;

    -- Vendor contact -> People record. Creates a vendor-affiliated person from
    -- the row's contact_* so VendorDetail derives them as the Primary Contact
    -- (it matches vendor.contact_email/name against affiliated people). Dedupe
    -- is scoped to THIS vendor; see the migration header for why we don't relink
    -- across orgs. Requires a name (people.full_name is NOT NULL).
    v_contact_name := NULLIF(btrim(v_row->>'contact_name'), '');
    IF v_contact_name IS NOT NULL THEN
      v_contact_email := NULLIF(btrim(v_row->>'contact_email'), '');
      v_contact_phone := NULLIF(btrim(v_row->>'contact_phone'), '');
      v_person_id := NULL;
      IF v_contact_email IS NOT NULL THEN
        SELECT id INTO v_person_id FROM public.people
          WHERE vendor_id = v_vendor_id AND lower(email) = lower(v_contact_email)
          ORDER BY created_at ASC LIMIT 1;
      END IF;
      IF v_person_id IS NULL THEN
        SELECT id INTO v_person_id FROM public.people
          WHERE vendor_id = v_vendor_id AND lower(full_name) = lower(v_contact_name)
          ORDER BY created_at ASC LIMIT 1;
      END IF;
      IF v_person_id IS NULL THEN
        INSERT INTO public.people (full_name, email, phone, vendor_id, affiliation_type, created_by)
        VALUES (
          v_contact_name,
          v_contact_email,
          v_contact_phone,
          v_vendor_id,
          'Vendor'::public.person_affiliation_type,
          v_actor
        )
        RETURNING id INTO v_person_id;
        v_created_refs := jsonb_set(v_created_refs, '{people}', to_jsonb((v_created_refs->>'people')::int + 1));
        -- Phase 5.9.6: track only freshly-created contact People for undo.
        -- A reused (pre-existing) person is never appended -> never deleted.
        v_created_person_ids := array_append(v_created_person_ids, v_person_id);
      ELSE
        -- Reuse the existing vendor contact; backfill email/phone if missing.
        UPDATE public.people
           SET email = coalesce(email, v_contact_email),
               phone = coalesce(phone, v_contact_phone)
         WHERE id = v_person_id
           AND (email IS NULL OR phone IS NULL);
      END IF;
    END IF;

    v_row_index := v_row_index + 1;
  END LOOP;

  -- 5. Finalize the session row. Phase 5.9.6: persist the undo trail
  -- (created records + created-only contact People).
  UPDATE public.bulk_import_sessions
     SET row_count = coalesce(array_length(v_created_ids, 1), 0) + v_updated_count,
         created_refs = v_created_refs,
         imported_record_ids = v_created_ids,
         imported_person_ids = v_created_person_ids
   WHERE id = v_session_id;

  -- 6. One activity_log row for the session.
  INSERT INTO public.activity_log (entity_type, entity_id, actor_id, action, payload)
  VALUES (
    'bulk_import_session',
    v_session_id,
    v_actor,
    'bulk_import',
    jsonb_build_object(
      'entity_type', 'vendor',
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

GRANT EXECUTE ON FUNCTION public.bulk_import_commit_vendors(jsonb) TO authenticated;

-- 5b-iii. Venues commit RPC: persist imported_record_ids + the created (NOT
--         reused) contact-person ids.
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

    v_row_index := v_row_index + 1;
  END LOOP;

  -- 6. Finalize the session row. Phase 5.9.6: persist the undo trail
  -- (created records + created-only contact People).
  UPDATE public.bulk_import_sessions
     SET row_count = coalesce(array_length(v_created_ids, 1), 0) + v_updated_count,
         created_refs = v_created_refs,
         imported_record_ids = v_created_ids,
         imported_person_ids = v_created_person_ids
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

-- 5c. The undo RPC. SECURITY DEFINER, admin re-check, one transaction. Deletes
--     the import-created records + their import-created contact People; never
--     the shared lookups (cities, categories, venue_types) or queued
--     clients/venues. Gated to committed status + a 7-day window.
CREATE OR REPLACE FUNCTION public.bulk_import_undo(
  p_session_id uuid,
  p_actor_id   uuid,
  p_dry_run    boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_window_days  constant integer := 7;  -- §14-D: tunable. Keep in sync with
                                         -- BULK_IMPORT_UNDO_WINDOW_DAYS (client).
  v_role         public.permission_role;
  v_session      public.bulk_import_sessions%ROWTYPE;
  v_rec_ids      uuid[];
  v_person_ids   uuid[];
  v_cascade      jsonb;
  v_counts       jsonb;
BEGIN
  -- Admin re-check (actor from payload; auth.uid() is NULL under service role).
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'actor_id required' USING ERRCODE = '22023';
  END IF;
  SELECT permission_role INTO v_role FROM public.users WHERE id = p_actor_id;
  IF v_role IS NULL OR v_role <> 'admin' THEN
    RAISE EXCEPTION 'actor must be admin' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_session FROM public.bulk_import_sessions WHERE id = p_session_id;
  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'session not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_session.status <> 'committed' THEN
    RAISE EXCEPTION 'only committed imports can be undone' USING ERRCODE = '22023';
  END IF;
  IF v_session.committed_at < now() - make_interval(days => v_window_days) THEN
    RAISE EXCEPTION 'import is older than % days; undo window closed', v_window_days USING ERRCODE = '22023';
  END IF;

  v_rec_ids    := v_session.imported_record_ids;
  v_person_ids := v_session.imported_person_ids;
  IF coalesce(array_length(v_rec_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'import has no undo trail (committed before undo tracking)' USING ERRCODE = '22023';
  END IF;

  -- Build cascade counts for the warning / result, per entity type. These are
  -- the rows the record delete will cascade away (FK ON DELETE CASCADE).
  IF v_session.entity_type = 'project' THEN
    v_cascade := jsonb_build_object(
      'deliverables', (SELECT count(*) FROM public.deliverables WHERE project_id = ANY(v_rec_ids)),
      'tasks', (SELECT count(*) FROM public.tasks WHERE project_id = ANY(v_rec_ids)),
      'project_account_managers', (SELECT count(*) FROM public.project_account_managers WHERE project_id = ANY(v_rec_ids)),
      'project_designers', (SELECT count(*) FROM public.project_designers WHERE project_id = ANY(v_rec_ids)),
      'project_members', (SELECT count(*) FROM public.project_members WHERE project_id = ANY(v_rec_ids)),
      'project_venues', (SELECT count(*) FROM public.project_venues WHERE project_id = ANY(v_rec_ids)),
      'project_vendors', (SELECT count(*) FROM public.project_vendors WHERE project_id = ANY(v_rec_ids))
    );
  ELSIF v_session.entity_type = 'vendor' THEN
    v_cascade := jsonb_build_object(
      'vendor_files', (SELECT count(*) FROM public.vendor_files WHERE vendor_id = ANY(v_rec_ids)),
      'vendor_ratings', (SELECT count(*) FROM public.vendor_ratings WHERE vendor_id = ANY(v_rec_ids)),
      'project_vendors', (SELECT count(*) FROM public.project_vendors WHERE vendor_id = ANY(v_rec_ids))
    );
  ELSIF v_session.entity_type = 'venue' THEN
    v_cascade := jsonb_build_object(
      'venue_venue_types', (SELECT count(*) FROM public.venue_venue_types WHERE venue_id = ANY(v_rec_ids)),
      'venue_contact_people', (SELECT count(*) FROM public.venue_contact_people WHERE venue_id = ANY(v_rec_ids))
    );
  ELSE
    v_cascade := '{}'::jsonb;
  END IF;

  v_counts := jsonb_build_object(
    'entity_type', v_session.entity_type,
    'records', coalesce(array_length(v_rec_ids, 1), 0),
    'contacts', coalesce(array_length(v_person_ids, 1), 0),
    'cascade', v_cascade
  );

  IF p_dry_run THEN
    RETURN jsonb_build_object('ok', true, 'dry_run', true, 'counts', v_counts);
  END IF;

  -- Delete created contact People first (FK to org is SET NULL, so the record
  -- delete would orphan them otherwise). Only the tracked-created ids.
  IF coalesce(array_length(v_person_ids, 1), 0) > 0 THEN
    DELETE FROM public.people WHERE id = ANY(v_person_ids);
  END IF;

  -- Delete the created records; cascades remove deliverables/tasks/joins/
  -- ratings/files. entity_type drives the table.
  IF v_session.entity_type = 'project' THEN
    DELETE FROM public.projects WHERE id = ANY(v_rec_ids);
  ELSIF v_session.entity_type = 'vendor' THEN
    DELETE FROM public.vendors WHERE id = ANY(v_rec_ids);
  ELSIF v_session.entity_type = 'venue' THEN
    DELETE FROM public.venues WHERE id = ANY(v_rec_ids);
  END IF;

  -- Remove the original import activity row; write the undo summary row
  -- (entity_id keeps the session id for traceability; it is not an FK).
  DELETE FROM public.activity_log
    WHERE entity_type = 'bulk_import_session'
      AND entity_id = p_session_id
      AND action = 'bulk_import';
  INSERT INTO public.activity_log (entity_type, entity_id, actor_id, action, payload)
  VALUES ('bulk_import_session', p_session_id, p_actor_id, 'bulk_import_undo', v_counts);

  -- Hard-delete the session row last (any updated-not-created records keep
  -- surviving; their bulk_import_session_id SET NULLs via the FK).
  DELETE FROM public.bulk_import_sessions WHERE id = p_session_id;

  RETURN jsonb_build_object('ok', true, 'dry_run', false, 'counts', v_counts);
EXCEPTION WHEN OTHERS THEN
  RAISE;  -- rolls the whole undo back
END;
$func$;

GRANT EXECUTE ON FUNCTION public.bulk_import_undo(uuid, uuid, boolean) TO authenticated;

COMMIT;
