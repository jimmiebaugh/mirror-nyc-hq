-- Phase 5.7.11: vendor_files table for the Files & Assets URL list on
-- VendorDetail + VendorEdit. Per plan decision #22:
--   - any URL accepted (no format validation; producers paste Drive,
--     Dropbox, Figma, vendor websites, etc.)
--   - title-only clickable display
--   - delete + re-add only (no edit-after-create)
--
-- RLS posture simplified from plan #22's tier gates per Jimmie 2026-05-18:
-- open-authenticated. Any signed-in user can SELECT, INSERT, DELETE.
-- Tier-gated posture (above-pending INSERT, author + producer/admin DELETE)
-- revives later if cross-tier access becomes a need.

CREATE TABLE public.vendor_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  title text NOT NULL,
  url text NOT NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX vendor_files_vendor_idx
  ON public.vendor_files (vendor_id, created_at DESC);

ALTER TABLE public.vendor_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY vendor_files_select_authenticated ON public.vendor_files
  FOR SELECT TO authenticated USING (true);

CREATE POLICY vendor_files_insert_authenticated ON public.vendor_files
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY vendor_files_delete_authenticated ON public.vendor_files
  FOR DELETE TO authenticated USING (true);

-- No UPDATE policy: per plan §11.D, delete + re-add only.

GRANT SELECT, INSERT, DELETE ON public.vendor_files TO authenticated;
GRANT ALL ON public.vendor_files TO service_role;

COMMENT ON TABLE public.vendor_files IS
  'Phase 5.7.11: URL + title list shown in the Files & Assets card on '
  'VendorDetail + VendorEdit. Open-authenticated RLS (simplified from '
  'plan #22 tier gates per Jimmie 2026-05-18). Any URL accepted (no '
  'format validation). Delete + re-add only (no UPDATE policy).';
