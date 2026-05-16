-- Phase 5.2.2.F: project_categories lookup table.
--
-- Spec: OUTPUTS/phase-5-2-2-spec.md § 3b. Same shape as cities; backs the
-- inline-add Category dropdown on Project Edit.

BEGIN;

CREATE TABLE public.project_categories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  created_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX project_categories_name_unique_idx
  ON public.project_categories (LOWER(name));

ALTER TABLE public.project_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY project_categories_select ON public.project_categories
  FOR SELECT TO authenticated USING (true);
CREATE POLICY project_categories_insert ON public.project_categories
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY project_categories_update ON public.project_categories
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY project_categories_delete ON public.project_categories
  FOR DELETE TO authenticated USING (public.is_admin());

GRANT SELECT, INSERT, UPDATE ON public.project_categories TO authenticated;
GRANT ALL                    ON public.project_categories TO service_role;

COMMIT;
