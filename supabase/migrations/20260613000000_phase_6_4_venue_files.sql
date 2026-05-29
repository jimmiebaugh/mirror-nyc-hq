-- Phase 6.4 (V2): venue_files table for the Files & Assets URL list on
-- VenueDetail + VenueEdit. Mirrors vendor_files' CURRENT state, vendor -> venue:
--   - any URL accepted (no format validation; producers paste Drive,
--     Dropbox, Figma, venue websites, etc.)
--   - title-only clickable display
--   - delete + re-add only (no edit-after-create)
--
-- Created directly in the hardened posture vendor_files reached over time:
--   - created_by FK to public.users(id) carries ON UPDATE CASCADE per the
--     auth-model.md standing rule (vendor_files got this in 5.8.8.1).
--   - RLS gated on is_active_member() (active members only, not pending) to
--     match the 5.16.0 tier hardening that rewrote vendor_files' policies away
--     from the original open-`true` posture.
--   - no UPDATE policy (delete + re-add only).

CREATE TABLE public.venue_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  title text NOT NULL,
  url text NOT NULL,
  created_by uuid REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX venue_files_venue_idx
  ON public.venue_files (venue_id, created_at DESC);

ALTER TABLE public.venue_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY venue_files_select_authenticated ON public.venue_files
  FOR SELECT TO authenticated USING ((select public.is_active_member()));

CREATE POLICY venue_files_insert_authenticated ON public.venue_files
  FOR INSERT TO authenticated WITH CHECK ((select public.is_active_member()));

CREATE POLICY venue_files_delete_authenticated ON public.venue_files
  FOR DELETE TO authenticated USING ((select public.is_active_member()));

-- No UPDATE policy: delete + re-add only (mirrors vendor_files).

GRANT SELECT, INSERT, DELETE ON public.venue_files TO authenticated;
GRANT ALL ON public.venue_files TO service_role;

COMMENT ON TABLE public.venue_files IS
  'Phase 6.4: URL + title list shown in the Files & Assets card on '
  'VenueDetail + VenueEdit. Mirrors vendor_files (current hardened state). '
  'is_active_member() RLS. Any URL accepted (no format validation). Delete + '
  're-add only (no UPDATE policy).';
