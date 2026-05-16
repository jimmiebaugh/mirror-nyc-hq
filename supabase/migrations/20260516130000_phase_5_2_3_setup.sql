-- Phase 5.2.3.A: setup.
--
-- Spec: OUTPUTS/phase-5-2-3-spec.md § 3.A. Three things land here, in order:
--   1. Rename `org_capabilities` -> `vendor_capabilities` (terminology
--      cleanup; the lookup only ever served vendor-type orgs).
--   2. Create `vendor_categories` lookup (new dropdown on Vendor Edit).
--   3. Create the fresh `clients` table (slim shape; rebuild from scratch)
--      and migrate existing 'Client' rows from organizations into it,
--      preserving UUIDs so the next migration (5.2.3.C) can flip
--      `projects.organization_id` -> `client_id` without re-mapping.
--
-- All three operations preserve row identity. RLS / GRANT / index renames
-- ride along; policy names keep their original identifiers (OID-stable per
-- Postgres semantics).

BEGIN;

-- ============================================================================
-- Step 1: rename org_capabilities -> vendor_capabilities
-- ============================================================================

ALTER TABLE public.org_capabilities RENAME TO vendor_capabilities;
ALTER INDEX IF EXISTS org_capabilities_name_unique_idx
  RENAME TO vendor_capabilities_name_unique_idx;
-- Policy names stay org_capabilities_*; the rename is OID-stable so they
-- continue enforcing the same posture on the renamed table.

-- ============================================================================
-- Step 2: vendor_categories lookup (drives the Category dropdown on Vendor Edit)
-- ============================================================================

CREATE TABLE public.vendor_categories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  created_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX vendor_categories_name_unique_idx
  ON public.vendor_categories (LOWER(name));

ALTER TABLE public.vendor_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY vendor_categories_select ON public.vendor_categories
  FOR SELECT TO authenticated USING (true);
CREATE POLICY vendor_categories_insert ON public.vendor_categories
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY vendor_categories_update ON public.vendor_categories
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY vendor_categories_delete ON public.vendor_categories
  FOR DELETE TO authenticated USING (public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vendor_categories TO authenticated;
GRANT ALL                            ON public.vendor_categories TO service_role;

-- ============================================================================
-- Step 3: fresh `clients` table (slim shape; rebuild from scratch)
-- ============================================================================

CREATE TABLE public.clients (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  industry        text,
  contact_name    text,
  contact_email   text,
  contact_phone   text,
  primary_address text,
  city            text,
  website_url     text,
  tags            text[] NOT NULL DEFAULT '{}',
  created_by      uuid NOT NULL REFERENCES public.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX clients_city_idx ON public.clients (city) WHERE city IS NOT NULL;
CREATE INDEX clients_name_idx ON public.clients (lower(name));

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY clients_select ON public.clients
  FOR SELECT TO authenticated USING (true);
CREATE POLICY clients_insert ON public.clients
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY clients_update ON public.clients
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY clients_delete ON public.clients
  FOR DELETE TO authenticated USING (public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients TO authenticated;
GRANT ALL                            ON public.clients TO service_role;

CREATE TRIGGER trg_clients_updated_at
  BEFORE UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.updated_at_auto();

CREATE TRIGGER trg_activity_log_clients
  AFTER INSERT OR UPDATE OR DELETE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.activity_log_writer();

-- ============================================================================
-- Step 4: migrate existing 'Client' rows from organizations into clients
-- ============================================================================
-- Preserves UUIDs so `projects.organization_id` -> `client_id` in 5.2.3.C
-- can flip the FK target table without re-mapping any row IDs.

INSERT INTO public.clients (
  id, name, contact_name, contact_email, contact_phone, city, website_url, tags,
  created_by, created_at, updated_at
)
SELECT id, name, contact_name, contact_email, contact_phone, city, website_url, tags,
       created_by, created_at, updated_at
  FROM public.organizations
 WHERE type = 'Client';

COMMIT;
