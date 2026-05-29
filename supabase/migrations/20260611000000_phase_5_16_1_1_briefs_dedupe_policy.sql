-- Phase 5.16.1.1: collapse the duplicate `briefs` storage policy (Database #1).
--
-- The `briefs` storage bucket carried TWO redundant permissive ALL policies:
--   * `storage_briefs_all`       : version-controlled (initial_schema, re-created
--                                    in Phase 4.10.3 as `USING (bucket_id = 'briefs')`
--                                    FOR ALL TO authenticated).
--   * `briefs_authenticated_all` : a Supabase Studio orphan, never defined in any
--                                    migration; same grant (bucket_id = 'briefs',
--                                    ALL, authenticated).
--
-- Two permissive ALL policies on the same bucket OR together, so they grant the
-- exact same access. Drop the untracked Studio orphan and keep the convention-
-- named, migration-tracked policy. Access behavior is byte-identical post-drop.
--
-- Reversible: re-create `briefs_authenticated_all` to restore the prior (redundant)
-- state if ever needed.

DROP POLICY IF EXISTS briefs_authenticated_all ON storage.objects;
