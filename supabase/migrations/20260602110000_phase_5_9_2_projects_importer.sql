-- Phase 5.9.2: Projects importer.
--
-- Plugs the Project entity into the 5.9.1 bulk-import primitive:
--   1. Stamp column `bulk_import_session_id` on public.projects + partial index.
--   2. SECURITY DEFINER RPC bulk_import_commit_projects(payload jsonb) that owns
--      the FULL atomic write (queued client/venue creates, novel category/city
--      lookups, project inserts/updates, roster joins, session row, activity row)
--      in one transaction. PostgREST chains can't roll back together, so the RPC
--      is the source of atomicity (memory: feedback_postgrest_no_multi_statement_tx).
--   3. Two internal ref-resolver helpers (client + venue).
--
-- Auth: the RPC re-checks the actor is admin as defense-in-depth, matching the
-- promote_outlook_to_project precedent (docs/auth-model.md). The edge function
-- already gates on admin; the RPC gates again because it's SECURITY DEFINER and
-- bypasses RLS for its writes.
--
-- Payload row keys mirror the shipped template headers verbatim (the browser
-- passes grid rows straight through). Date keys are the template's short form
-- (live_start / install_start / removal_start ...); the RPC maps them onto the
-- DB's *_dates_* columns. Multi-value columns (tags, designer, team_members,
-- venue) arrive as JSON arrays; account_lead arrives as a single email string.
--
-- REVOKE check (memory: feedback_revoke_execute_check_rls_callers): this
-- migration only adds net-new functions and GRANTs EXECUTE to authenticated.
-- No REVOKE on any existing RLS helper or trigger function.

BEGIN;

-- 1. Stamp column on projects. FK to bulk_import_sessions (NOT users), so the
-- ON UPDATE CASCADE users-id rule (auth-model.md § 5.8.8) doesn't apply here;
-- the FK target's own actor column already follows it. ON DELETE SET NULL so
-- purging a session row doesn't cascade-delete the imported projects.

ALTER TABLE public.projects
  ADD COLUMN bulk_import_session_id uuid
    REFERENCES public.bulk_import_sessions(id)
    ON UPDATE CASCADE
    ON DELETE SET NULL;

CREATE INDEX projects_bulk_import_session_idx
  ON public.projects (bulk_import_session_id)
  WHERE bulk_import_session_id IS NOT NULL;

-- 2a. Internal helper: resolve a client ref. Returns NULL on empty input;
-- resolves "_queued:N" against the just-created queued ids; otherwise treats
-- the ref as an existing id (uuid) or a client name (fuzzy, most-recent match).
-- STABLE, not IMMUTABLE: it reads public.clients.

CREATE OR REPLACE FUNCTION public._bulk_import_resolve_client_ref(
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
    IF queued IS NULL OR array_length(queued, 1) IS NULL
       OR v_idx < 0 OR v_idx >= array_length(queued, 1) THEN
      RAISE EXCEPTION '_queued:% out of bounds for client refs', v_idx USING ERRCODE = '22023';
    END IF;
    RETURN queued[v_idx + 1];
  END IF;
  BEGIN
    v_id := ref::uuid;
    RETURN v_id;
  EXCEPTION WHEN invalid_text_representation THEN
    SELECT id INTO v_id FROM public.clients
      WHERE lower(name) = lower(ref) ORDER BY created_at DESC LIMIT 1;
    RETURN v_id;  -- may be NULL; caller treats as missing-resolution
  END;
END;
$func$;

-- 2b. Internal helper: resolve a venue ref. Same shape against public.venues.

CREATE OR REPLACE FUNCTION public._bulk_import_resolve_venue_ref(
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
    IF queued IS NULL OR array_length(queued, 1) IS NULL
       OR v_idx < 0 OR v_idx >= array_length(queued, 1) THEN
      RAISE EXCEPTION '_queued:% out of bounds for venue refs', v_idx USING ERRCODE = '22023';
    END IF;
    RETURN queued[v_idx + 1];
  END IF;
  BEGIN
    v_id := ref::uuid;
    RETURN v_id;
  EXCEPTION WHEN invalid_text_representation THEN
    SELECT id INTO v_id FROM public.venues
      WHERE lower(name) = lower(ref) ORDER BY created_at DESC LIMIT 1;
    RETURN v_id;
  END;
END;
$func$;

-- 2c. The atomic commit RPC.

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
  UPDATE public.bulk_import_sessions
     SET row_count = coalesce(array_length(v_created_ids, 1), 0) + v_updated_count,
         created_refs = v_created_refs
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

GRANT EXECUTE ON FUNCTION public.bulk_import_commit_projects(jsonb)             TO authenticated;
GRANT EXECUTE ON FUNCTION public._bulk_import_resolve_client_ref(text, uuid[])  TO authenticated;
GRANT EXECUTE ON FUNCTION public._bulk_import_resolve_venue_ref(text, uuid[])   TO authenticated;

COMMIT;
