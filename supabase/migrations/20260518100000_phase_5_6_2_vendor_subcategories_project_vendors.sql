-- Phase 5.6.2: Vendor Subcategories lookup + project_vendors join + vendors.subcategory_id

-- 1) vendor_subcategories lookup table
CREATE TABLE public.vendor_subcategories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  parent_category_id uuid NOT NULL
    REFERENCES public.vendor_categories(id) ON DELETE CASCADE,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (parent_category_id, name)
);

CREATE INDEX vendor_subcategories_parent_idx
  ON public.vendor_subcategories (parent_category_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vendor_subcategories TO authenticated;
GRANT ALL ON public.vendor_subcategories TO service_role;

ALTER TABLE public.vendor_subcategories ENABLE ROW LEVEL SECURITY;

CREATE POLICY vendor_subcategories_select ON public.vendor_subcategories
  FOR SELECT TO authenticated USING (true);

CREATE POLICY vendor_subcategories_insert ON public.vendor_subcategories
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY vendor_subcategories_update ON public.vendor_subcategories
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY vendor_subcategories_delete ON public.vendor_subcategories
  FOR DELETE TO authenticated USING (is_admin());

-- 2) vendors.subcategory_id column
ALTER TABLE public.vendors
  ADD COLUMN subcategory_id uuid
    REFERENCES public.vendor_subcategories(id) ON DELETE SET NULL;

CREATE INDEX vendors_subcategory_idx
  ON public.vendors (subcategory_id)
  WHERE subcategory_id IS NOT NULL;

-- 3) project_vendors join table
CREATE TABLE public.project_vendors (
  project_id uuid NOT NULL
    REFERENCES public.projects(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL
    REFERENCES public.vendors(id) ON DELETE CASCADE,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, vendor_id)
);

CREATE INDEX project_vendors_vendor_idx ON public.project_vendors (vendor_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_vendors TO authenticated;
GRANT ALL ON public.project_vendors TO service_role;

ALTER TABLE public.project_vendors ENABLE ROW LEVEL SECURITY;

CREATE POLICY project_vendors_select ON public.project_vendors
  FOR SELECT TO authenticated USING (true);

CREATE POLICY project_vendors_insert ON public.project_vendors
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY project_vendors_update ON public.project_vendors
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY project_vendors_delete ON public.project_vendors
  FOR DELETE TO authenticated USING (true);
