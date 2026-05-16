-- Phase 5.2.2.G: org_capabilities lookup table.
--
-- Spec: OUTPUTS/phase-5-2-2-spec.md § 3c. Same shape as cities; backs the
-- inline-add Capabilities multi-tag picker on Organization Edit for
-- Vendor / Internal orgs. The shipped `organizations.capabilities text[]`
-- column stores the per-org selection; this lookup table feeds the option
-- list. Pattern mirrors venue_types lookup + venue_venue_types join, but
-- capabilities stays as a text[] on the parent so a quick org create
-- doesn't need a join-table insert per capability.

BEGIN;

CREATE TABLE public.org_capabilities (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  created_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX org_capabilities_name_unique_idx
  ON public.org_capabilities (LOWER(name));

ALTER TABLE public.org_capabilities ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_capabilities_select ON public.org_capabilities
  FOR SELECT TO authenticated USING (true);
CREATE POLICY org_capabilities_insert ON public.org_capabilities
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY org_capabilities_update ON public.org_capabilities
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY org_capabilities_delete ON public.org_capabilities
  FOR DELETE TO authenticated USING (public.is_admin());

GRANT SELECT, INSERT, UPDATE ON public.org_capabilities TO authenticated;
GRANT ALL                    ON public.org_capabilities TO service_role;

COMMIT;
