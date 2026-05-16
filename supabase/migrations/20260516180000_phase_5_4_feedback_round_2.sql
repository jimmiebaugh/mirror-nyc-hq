-- ============================================================================
-- Phase 5.4 feedback round 2 (2026-05-16).
-- ============================================================================
-- Two changes after Jimmie's second smoke-pass:
--   1. credentials writes (INSERT/UPDATE/DELETE) open up to standard + admin
--      (was admin-only). Freelance still blocked from SELECT entirely.
--   2. vendors.preferred boolean flag. The Wiki "Preferred Vendors" page
--      filters where preferred = true and gives admins a multi-select picker
--      to toggle the flag inline.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. credentials: widen INSERT/UPDATE/DELETE from admin-only to admin+standard.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "credentials_insert_admin" ON public.credentials;
DROP POLICY IF EXISTS "credentials_update_admin" ON public.credentials;
DROP POLICY IF EXISTS "credentials_delete_admin" ON public.credentials;

CREATE POLICY "credentials_insert_non_freelance" ON public.credentials
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND permission_role IN ('admin', 'standard')
  ));

CREATE POLICY "credentials_update_non_freelance" ON public.credentials
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND permission_role IN ('admin', 'standard')
  ));

CREATE POLICY "credentials_delete_non_freelance" ON public.credentials
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND permission_role IN ('admin', 'standard')
  ));

-- ----------------------------------------------------------------------------
-- 2. vendors.preferred flag for the Wiki "Preferred Vendors" curated list.
-- ----------------------------------------------------------------------------
ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS preferred boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS vendors_preferred_idx
  ON public.vendors (preferred)
  WHERE preferred = true;
