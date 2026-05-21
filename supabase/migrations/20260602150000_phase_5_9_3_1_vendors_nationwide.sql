-- Phase 5.9.3.1: vendors.nationwide flag.
--
-- Follow-on to 5.9.3 discovered during the Vendors-import smoke: some vendors
-- work nationwide and should surface under every city filter on /vendors. The
-- flag is a real bool column (parallel to vendors.preferred), the VendorsList
-- city filter OR-s in any vendor with nationwide = true (client-side), and the
-- bulk importer can set it via a "true"/"false" column (same coercion as
-- preferred).
--
-- 1. Add the column (NOT NULL DEFAULT false, like preferred).
-- 2. CREATE OR REPLACE bulk_import_commit_vendors to coerce + write nationwide
--    on both the create and update paths.
--
-- No new GRANT (CREATE OR REPLACE preserves the existing EXECUTE grant). No
-- index: nationwide is read only by the client-side list filter, never by a
-- server-side query (unlike preferred, which the Wiki embed queries).

BEGIN;

ALTER TABLE public.vendors
  ADD COLUMN nationwide bool NOT NULL DEFAULT false;

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
  v_nationwide_raw text;
  v_nationwide     bool;
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
        primary_address, website_url,
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

    v_row_index := v_row_index + 1;
  END LOOP;

  -- 5. Finalize the session row.
  UPDATE public.bulk_import_sessions
     SET row_count = coalesce(array_length(v_created_ids, 1), 0) + v_updated_count,
         created_refs = v_created_refs
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

COMMIT;
