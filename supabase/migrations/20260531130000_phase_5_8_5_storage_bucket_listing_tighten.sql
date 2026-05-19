-- ============================================================================
-- Phase 5.8.5: tighten public storage bucket SELECT policies.
--
-- Audit finding: profile_avatars + venue_photos buckets had broad SELECT
-- policies (`USING (bucket_id = '<bucket>')`) that let anonymous SDK
-- listing enumerate every object key. Public read access is still
-- preserved via direct CDN URLs (which bypass storage.objects RLS), so
-- dropping these policies has zero impact on the existing img-tag /
-- download-link flows. Write paths (INSERT/UPDATE/DELETE policies) keep
-- the per-folder + producer-or-admin scoping.
--
-- The advisor also flagged a `venue_photos_authenticated_all` policy that
-- does not appear in our migration history; guarded with IF EXISTS so the
-- migration succeeds whether or not the policy lives in prod.
-- ============================================================================

DROP POLICY IF EXISTS storage_profile_avatars_select ON storage.objects;
DROP POLICY IF EXISTS storage_venue_photos_select   ON storage.objects;
DROP POLICY IF EXISTS venue_photos_authenticated_all ON storage.objects;
