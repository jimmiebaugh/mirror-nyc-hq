-- Phase 5.2.2.E: cities lookup table.
--
-- Spec: OUTPUTS/phase-5-2-2-spec.md § 3a. Backs the inline-add City dropdown
-- on Project Edit + Organization Edit + Venue Edit. Open-authenticated
-- SELECT / INSERT / UPDATE so any signed-in producer can add a city on the
-- fly; admin-only DELETE so a misclick cannot blow away a city referenced
-- by 30 projects (the column on those tables is free-text, but the lookup
-- list still drives the inline-add affordance).

BEGIN;

CREATE TABLE public.cities (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  created_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX cities_name_unique_idx
  ON public.cities (LOWER(name));

ALTER TABLE public.cities ENABLE ROW LEVEL SECURITY;

CREATE POLICY cities_select ON public.cities
  FOR SELECT TO authenticated USING (true);
CREATE POLICY cities_insert ON public.cities
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY cities_update ON public.cities
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY cities_delete ON public.cities
  FOR DELETE TO authenticated USING (public.is_admin());

GRANT SELECT, INSERT, UPDATE ON public.cities TO authenticated;
GRANT ALL                    ON public.cities TO service_role;

COMMIT;
