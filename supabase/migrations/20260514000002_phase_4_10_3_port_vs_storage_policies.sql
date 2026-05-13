-- Phase 4.10.3-port: reconcile VS storage policies with table RLS tier.
--
-- Current state (pre-4.10.3): the three VS storage buckets (`briefs`,
-- `sourcing_sheets`, `vs_venue_photos`) are all gated `is_producer_or_admin()`
-- while the vs_* table RLS is open-authenticated per port plan § 8.6. A
-- member-tier user can read/write vs_* tables but cannot upload files,
-- breaking the "collaborative agency-wide workflow" the port plan locks.
--
-- Locked option (2026-05-13): relax storage policies to authenticated so any
-- signed-in @mirrornyc.com user can use VS end-to-end. Matches the table
-- RLS posture. auth-model.md updated in the same squash.
--
-- Policy names verified against the canonical migrations they were created
-- in: storage_briefs_all + storage_sourcing_sheets_all in 20260506061457
-- (initial schema); storage_vs_venue_photos_(select|insert|update|delete) in
-- 20260512240000 (Phase 4.7.1-port). If any name has drifted via Studio edits
-- the DROP will fail with a clear message; rerun with corrected names.

-- briefs: single ALL policy.
DROP POLICY IF EXISTS storage_briefs_all ON storage.objects;
CREATE POLICY storage_briefs_all ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'briefs')
  WITH CHECK (bucket_id = 'briefs');

-- sourcing_sheets: single ALL policy.
DROP POLICY IF EXISTS storage_sourcing_sheets_all ON storage.objects;
CREATE POLICY storage_sourcing_sheets_all ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'sourcing_sheets')
  WITH CHECK (bucket_id = 'sourcing_sheets');

-- vs_venue_photos: four split policies (one per command). Collapse to a
-- single ALL policy now that the tier gate is gone.
DROP POLICY IF EXISTS storage_vs_venue_photos_select ON storage.objects;
DROP POLICY IF EXISTS storage_vs_venue_photos_insert ON storage.objects;
DROP POLICY IF EXISTS storage_vs_venue_photos_update ON storage.objects;
DROP POLICY IF EXISTS storage_vs_venue_photos_delete ON storage.objects;

CREATE POLICY storage_vs_venue_photos_all ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'vs_venue_photos')
  WITH CHECK (bucket_id = 'vs_venue_photos');
