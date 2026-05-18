-- Phase 5.7.10: wiki_images Supabase Storage bucket.
--
-- PRIVATE bucket. Embedded <img src> URLs in wiki_pages.body HTML render
-- via signed URLs generated at upload time (1-year TTL embedded in body).
-- Storage RLS:
--   SELECT: any authenticated user (so signed URLs work for any wiki reader).
--   INSERT/UPDATE/DELETE: is_admin() only (matches wiki_pages table RLS).
--
-- Depends on public.is_admin() (created in Phase 5.4 migration
-- 20260516160000_phase_5_4_wiki_team_settings.sql). Safe to reference.

INSERT INTO storage.buckets (id, name, public) VALUES
  ('wiki_images', 'wiki_images', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY storage_wiki_images_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'wiki_images');

CREATE POLICY storage_wiki_images_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'wiki_images' AND public.is_admin());

CREATE POLICY storage_wiki_images_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'wiki_images' AND public.is_admin())
  WITH CHECK (bucket_id = 'wiki_images' AND public.is_admin());

CREATE POLICY storage_wiki_images_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'wiki_images' AND public.is_admin());
