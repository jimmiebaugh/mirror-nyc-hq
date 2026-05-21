-- Phase 5.9.3: Vendors importer.
--
-- Plugs the Vendor entity into the 5.9.1 bulk-import primitive:
--   1. Stamp column `bulk_import_session_id` on public.vendors + partial index
--      (same shape as 5.9.2 added to public.projects).
--   2. SECURITY DEFINER RPC bulk_import_commit_vendors(payload jsonb) that owns
--      the FULL atomic write (queued category/subcategory creates, novel
--      capability + city lookups, vendor inserts/updates, session row, activity
--      row) in one transaction. PostgREST chains can't roll back together, so the
--      RPC is the source of atomicity (memory: feedback_postgrest_no_multi_statement_tx).
--   3. Two internal ref-resolver helpers (category + subcategory).
--
-- Deltas vs the 5.9.2 Project RPC:
--   - category + subcategory are FK columns (category_id / subcategory_id), not
--     free-text-with-lookup. They resolve via the two helpers.
--   - subcategory resolution depends on its parent category: the queued
--     subcategory's parent_category text matches against queued (this batch)
--     then existing categories, case-insensitively. Unresolvable => 23503.
--   - capabilities is text[] on vendors; the RPC writes capability NAMES, lazily
--     auto-creating any novel vendor_capabilities lookup row (parallel to the
--     Project Category/City pattern).
--   - preferred bool coerced from "true"/"false"/"" string (empty => false).
--   - NO people-roster handling (vendors have no vendor_account_managers analog).
--     project_vendors / vendor_files / vendor_ratings are out of scope.
--
-- Auth: the RPC re-checks the actor is admin as defense-in-depth, matching the
-- 5.9.2 bulk_import_commit_projects posture (docs/auth-model.md). The edge
-- function already gates on admin; the RPC gates again because it's SECURITY
-- DEFINER and bypasses RLS for its writes.
--
-- created_by = v_actor stamped on EVERY novel lookup INSERT (vendor_categories,
-- vendor_subcategories, vendor_capabilities, cities) per memory
-- feedback_security_definer_rpc_sql_verification rule #1.
--
-- REVOKE check (memory: feedback_revoke_execute_check_rls_callers): this
-- migration only adds net-new functions and GRANTs EXECUTE to authenticated.
-- No REVOKE on any existing RLS helper or trigger function.

BEGIN;

-- 1. Stamp column on vendors. FK to bulk_import_sessions (NOT users), so the
-- ON UPDATE CASCADE users-id rule (auth-model.md § 5.8.8) targets the FK's own
-- actor column, not this one. ON DELETE SET NULL so purging a session row
-- doesn't cascade-delete the imported vendors.

ALTER TABLE public.vendors
  ADD COLUMN bulk_import_session_id uuid
    REFERENCES public.bulk_import_sessions(id)
    ON UPDATE CASCADE
    ON DELETE SET NULL;

CREATE INDEX vendors_bulk_import_session_idx
  ON public.vendors (bulk_import_session_id)
  WHERE bulk_import_session_id IS NOT NULL;

-- 2a. Internal helper: resolve a category ref token to a uuid. Token may be:
--   - existing vendor_categories.id (uuid string)
--   - existing category name (case-insensitive match)
--   - "_queued:N" referring to the N-th queued category in this batch
-- Returns NULL on empty / null input; raises when _queued:N is out of bounds.
-- STABLE, not IMMUTABLE: it reads public.vendor_categories.

CREATE OR REPLACE FUNCTION public._bulk_import_resolve_vendor_category_ref(
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
      RAISE EXCEPTION '_queued:% out of bounds for category refs', v_idx USING ERRCODE = '22023';
    END IF;
    RETURN queued[v_idx + 1];
  END IF;
  BEGIN
    v_id := ref::uuid;
    RETURN v_id;
  EXCEPTION WHEN invalid_text_representation THEN
    SELECT id INTO v_id FROM public.vendor_categories
      WHERE lower(name) = lower(ref) LIMIT 1;
    RETURN v_id;  -- may be NULL; caller treats as missing-resolution
  END;
END;
$func$;

-- 2b. Internal helper: resolve a subcategory ref token. Token may be:
--   - existing vendor_subcategories.id (uuid string)
--   - "_queued:N" referring to the N-th queued subcategory in this batch
--   - subcategory name (matched against the resolved parent_category filter)
-- Returns NULL on empty / null input. STABLE: it reads vendor_subcategories.

CREATE OR REPLACE FUNCTION public._bulk_import_resolve_vendor_subcategory_ref(
  ref text,
  queued uuid[],
  parent_category uuid
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
      RAISE EXCEPTION '_queued:% out of bounds for subcategory refs', v_idx USING ERRCODE = '22023';
    END IF;
    RETURN queued[v_idx + 1];
  END IF;
  BEGIN
    v_id := ref::uuid;
    RETURN v_id;
  EXCEPTION WHEN invalid_text_representation THEN
    IF parent_category IS NULL THEN
      RETURN NULL;  -- can't disambiguate by name without a parent
    END IF;
    SELECT id INTO v_id
      FROM public.vendor_subcategories
      WHERE parent_category_id = parent_category
        AND lower(name) = lower(ref)
      LIMIT 1;
    RETURN v_id;
  END;
END;
$func$;

-- 2c. The atomic commit RPC.

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
  v_updated_count  integer := 0;
  v_queued_cats    uuid[] := '{}';
  v_queued_subcats uuid[] := '{}';
  v_created_refs   jsonb  := jsonb_build_object(
    'vendor_categories', 0,
    'vendor_subcategories', 0,
    'vendor_capabilities', 0,
    'cities', 0
  );
  v_cat_id         uuid;
  v_subcat_id      uuid;
  v_parent_id      uuid;
  v_city           text;
  v_cap_text       text;
  v_caps_resolved  text[] := '{}';
  v_preferred_raw  text;
  v_preferred      bool;
  v_qrec           jsonb;
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

  -- 1. Queued vendor_categories first; build id translation. The unique arbiter
  -- is the LOWER(name) expression index (vendor_categories_name_unique_idx), so
  -- ON CONFLICT names the expression, not a constraint. DO UPDATE makes RETURNING
  -- fire on conflict so re-runs recover the existing id; the SELECT fall-back is
  -- belt-and-suspenders.
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

  -- 2. Queued vendor_subcategories; resolve parent_category by name against the
  -- queued cats from THIS batch first, then existing. Case-insensitive.
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

  -- 3. Session row early so per-vendor rows can FK to it. row_count +
  -- created_refs get UPDATED at the end.
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

    -- Resolve category + subcategory (subcategory disambiguated by the resolved
    -- category when matched by name).
    v_cat_id    := public._bulk_import_resolve_vendor_category_ref(v_row->>'category', v_queued_cats);
    v_subcat_id := public._bulk_import_resolve_vendor_subcategory_ref(v_row->>'subcategory', v_queued_subcats, v_cat_id);

    -- Auto-create city lookup if novel.
    v_city := NULLIF(v_row->>'city', '');
    IF v_city IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.cities WHERE lower(name) = lower(v_city)) THEN
      INSERT INTO public.cities (name, created_by) VALUES (v_city, v_actor)
        ON CONFLICT DO NOTHING;
      v_created_refs := jsonb_set(v_created_refs, '{cities}', to_jsonb((v_created_refs->>'cities')::int + 1));
    END IF;

    -- Auto-create capability lookups + build the resolved text[] array of NAMES.
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

    -- Coerce preferred ("true" / "false" / "" -> bool / false default).
    v_preferred_raw := NULLIF(v_row->>'preferred', '');
    v_preferred := COALESCE(lower(v_preferred_raw) = 'true', false);

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
        contact_name = NULLIF(v_row->>'contact_name', ''),
        contact_email = NULLIF(v_row->>'contact_email', ''),
        contact_phone = NULLIF(v_row->>'contact_phone', ''),
        tags = coalesce((SELECT array_agg(t) FROM jsonb_array_elements_text(coalesce(v_row->'tags', '[]'::jsonb)) t), '{}'),
        preferred = v_preferred,
        legacy_notes = NULLIF(v_row->>'legacy_notes', ''),
        bulk_import_session_id = v_session_id,
        updated_at = now()
      WHERE id = v_existing_id;
      v_vendor_id := v_existing_id;
      v_updated_count := v_updated_count + 1;
      -- No people-roster on vendors (no vendor_account_managers analog), so no
      -- roster DELETE here. project_vendors stays untouched (producer-controlled
      -- cross-entity join, not an import-owned join).
    ELSE
      INSERT INTO public.vendors (
        name, category_id, subcategory_id, capabilities, city,
        primary_address, website_url,
        contact_name, contact_email, contact_phone,
        tags, preferred, legacy_notes,
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
        NULLIF(v_row->>'contact_name', ''),
        NULLIF(v_row->>'contact_email', ''),
        NULLIF(v_row->>'contact_phone', ''),
        coalesce((SELECT array_agg(t) FROM jsonb_array_elements_text(coalesce(v_row->'tags', '[]'::jsonb)) t), '{}'),
        v_preferred,
        NULLIF(v_row->>'legacy_notes', ''),
        v_actor,
        v_session_id
      )
      RETURNING id INTO v_vendor_id;
      v_created_ids := array_append(v_created_ids, v_vendor_id);
    END IF;

    v_row_index := v_row_index + 1;
  END LOOP;

  -- 5. Finalize the session row. created_ids counts only fresh inserts; updates
  -- are reflected via the bulk_import_session_id stamp on the row.
  UPDATE public.bulk_import_sessions
     SET row_count = coalesce(array_length(v_created_ids, 1), 0) + v_updated_count,
         created_refs = v_created_refs
   WHERE id = v_session_id;

  -- 6. One activity_log row for the session itself. Per-vendor activity rows
  -- fire automatically via trg_activity_log_vendors on each insert/update.
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
  -- Any RAISE rolls the whole transaction back. Re-raise so the edge function
  -- catches it + writes a failed_rollback audit row.
  RAISE;
END;
$func$;

GRANT EXECUTE ON FUNCTION public.bulk_import_commit_vendors(jsonb)                                TO authenticated;
GRANT EXECUTE ON FUNCTION public._bulk_import_resolve_vendor_category_ref(text, uuid[])           TO authenticated;
GRANT EXECUTE ON FUNCTION public._bulk_import_resolve_vendor_subcategory_ref(text, uuid[], uuid)  TO authenticated;

COMMIT;
