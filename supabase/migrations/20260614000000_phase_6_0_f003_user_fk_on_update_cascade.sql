-- Phase 6.0 (F003): add ON UPDATE CASCADE to the four created_by FKs that
-- reference public.users(id) and were created AFTER the 5.8.8.1 standing rule
-- (auth-model.md: "every FK pointing at public.users.id MUST be ON UPDATE
-- CASCADE") but missed it. Without it, the first-sign-in id-swap
-- (handle_new_user / users_align_id_to_auth UPDATE public.users SET id = ...)
-- FK-violates with ERROR 23503 and silently locks out any pre-provisioned user
-- who authored one of these rows -- the exact failure class 5.8.8.1 was written
-- to prevent. venue_files (6.4) correctly carries ON UPDATE CASCADE, so this
-- closes the remaining four. After this lands, the auth-model.md invariant
-- query returns 0 again (F021).
--
-- Each ALTER PRESERVES the table's existing ON DELETE behavior (owner's call:
-- do NOT harmonize tags/features to SET NULL this pass):
--   project_tags.created_by  / venue_features.created_by -> NOT NULL, ON DELETE NO ACTION (default)
--   city_aliases.created_by  / neighborhoods.created_by  -> nullable, ON DELETE SET NULL

ALTER TABLE public.project_tags
  DROP CONSTRAINT project_tags_created_by_fkey,
  ADD CONSTRAINT project_tags_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE;

ALTER TABLE public.venue_features
  DROP CONSTRAINT venue_features_created_by_fkey,
  ADD CONSTRAINT venue_features_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE;

ALTER TABLE public.city_aliases
  DROP CONSTRAINT city_aliases_created_by_fkey,
  ADD CONSTRAINT city_aliases_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE public.neighborhoods
  DROP CONSTRAINT neighborhoods_created_by_fkey,
  ADD CONSTRAINT neighborhoods_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;
