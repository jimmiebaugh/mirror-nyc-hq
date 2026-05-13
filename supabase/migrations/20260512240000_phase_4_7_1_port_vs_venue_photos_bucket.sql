-- Phase 4.7.1-port: CREATE vs_venue_photos storage bucket (private).
--
-- Per port plan § 2: HQ's vs_venue_photos bucket is private with signed URLs
-- (1-hour TTL for inline rendering). VS Pro's venue-photos bucket is public;
-- the rename + privacy change is the locked port decision.
--
-- The vs_venue_photos TABLE was created in 4.1-port; this migration adds
-- the matching bucket and its RLS policies.
--
-- Tier note: storage policies gate on is_producer_or_admin() (parallel to
-- sourcing_sheets + briefs buckets). The table RLS on vs_venue_photos is
-- open-authenticated; same pre-existing mismatch documented for the other
-- VS buckets, not 4.7.1-port's job to reconcile.

INSERT INTO storage.buckets (id, name, public) VALUES
  ('vs_venue_photos', 'vs_venue_photos', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY storage_vs_venue_photos_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'vs_venue_photos' AND public.is_producer_or_admin());
CREATE POLICY storage_vs_venue_photos_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'vs_venue_photos' AND public.is_producer_or_admin());
CREATE POLICY storage_vs_venue_photos_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'vs_venue_photos' AND public.is_producer_or_admin())
  WITH CHECK (bucket_id = 'vs_venue_photos' AND public.is_producer_or_admin());
CREATE POLICY storage_vs_venue_photos_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'vs_venue_photos' AND public.is_producer_or_admin());
