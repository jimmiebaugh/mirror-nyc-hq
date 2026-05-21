-- Phase 5.9.2.1: drop the people roster from the Projects importer.
--
-- Account Lead / Designer / Team Members are no longer parsed at import time;
-- they're set retroactively on the project's edit page. This CREATE OR REPLACE
-- removes from bulk_import_commit_projects:
--   - the required account_lead resolution + project_account_managers INSERT
--   - the designer + team_members loops
--   - the "at least one Account Lead" roster-minimum check
--   - the UPDATE-path DELETEs of project_account_managers / project_designers /
--     project_members (the importer must NOT wipe rosters a producer set by
--     hand; only project_venues is still owned by the import, so its
--     DELETE + re-INSERT replace semantics stay)
--
-- Client / category / city / venue handling and the session + activity_log
-- writes are unchanged. CREATE OR REPLACE preserves the OID + the existing
-- GRANT EXECUTE TO authenticated.

BEGIN;

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
  v_cat            text;
  v_city           text;
  v_venue_ref      text;
BEGIN
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

  -- 3. Session row early so per-project rows can FK to it.
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

    v_client_id := public._bulk_import_resolve_client_ref(v_row->>'client', v_queued_clients);

    v_cat := NULLIF(v_row->>'category', '');
    IF v_cat IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.project_categories WHERE lower(name) = lower(v_cat)) THEN
      INSERT INTO public.project_categories (name, created_by) VALUES (v_cat, v_actor)
        ON CONFLICT DO NOTHING;
      v_created_refs := jsonb_set(v_created_refs, '{project_categories}', to_jsonb((v_created_refs->>'project_categories')::int + 1));
    END IF;

    v_city := NULLIF(v_row->>'city', '');
    IF v_city IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.cities WHERE lower(name) = lower(v_city)) THEN
      INSERT INTO public.cities (name, created_by) VALUES (v_city, v_actor)
        ON CONFLICT DO NOTHING;
      v_created_refs := jsonb_set(v_created_refs, '{cities}', to_jsonb((v_created_refs->>'cities')::int + 1));
    END IF;

    IF v_dedupe_action = 'update' THEN
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
      -- Replace ONLY the venue roster (still import-owned). Account managers /
      -- designers / members are set retroactively and must not be wiped here.
      DELETE FROM public.project_venues WHERE project_id = v_project_id;
    ELSE
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

    -- 5. project_venues join. Venue values are existing-id strings or "_queued:N".
    FOR v_venue_ref IN SELECT jsonb_array_elements_text(coalesce(v_row->'venue', '[]'::jsonb))
    LOOP
      v_venue_id := public._bulk_import_resolve_venue_ref(v_venue_ref, v_queued_venues);
      IF v_venue_id IS NULL THEN
        RAISE EXCEPTION 'venue ref % could not be resolved at row %', v_venue_ref, v_row_index USING ERRCODE = '23503';
      END IF;
      INSERT INTO public.project_venues (project_id, venue_id) VALUES (v_project_id, v_venue_id)
        ON CONFLICT DO NOTHING;
    END LOOP;

    v_row_index := v_row_index + 1;
  END LOOP;

  -- 6. Finalize the session row.
  UPDATE public.bulk_import_sessions
     SET row_count = coalesce(array_length(v_created_ids, 1), 0) + v_updated_count,
         created_refs = v_created_refs
   WHERE id = v_session_id;

  -- 7. One activity_log row for the session. Per-project rows fire via trigger.
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
  RAISE;
END;
$func$;

COMMIT;
