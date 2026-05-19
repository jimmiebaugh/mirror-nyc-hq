-- Phase 5.8.8.1 hotfix: ON UPDATE CASCADE on every FK pointing at public.users.id.
--
-- Phase 5.4 dropped the public.users.id → auth.users(id) FK so admins could
-- pre-provision users with placeholder uuids before the auth row exists, and
-- added handle_new_user's swap path that UPDATEs public.users.id to the auth
-- uid on first sign-in. What Phase 5.4 missed: every FK pointing AT
-- public.users.id was created with the default ON UPDATE NO ACTION, which
-- blocks the swap UPDATE the moment a pre-provisioned user has any FK-bound
-- attachment (project_members.user_id, tasks.assignee_id, etc.).
--
-- Discovered 2026-05-19 PM during Phase 5.8.8 verification: a transactional
-- simulation of the swap path against riley@mirrornyc.com (who has 3
-- project_members rows from Team-page admin assignment) failed with:
--
--   ERROR: 23503: update or delete on table "users" violates foreign key
--   constraint "project_members_user_id_fkey" on table "project_members"
--   DETAIL: Key (id)=(488058ec-de91-486c-92b8-346b3b110ab4) is still
--   referenced from table "project_members".
--
-- The Phase 5.8.8 spec's "the swap fired correctly" framing was wrong on
-- two grounds: (a) for jobs@mirrornyc.com the fresh-signup path took over
-- because the order was reversed (signed in before pre-provision), so the
-- swap never had a chance to fail at FK enforcement; (b) the swap path
-- actually has never been exercised in production against a pre-provisioned
-- user with project attachments, so the latent FK bug went undetected
-- through 5.4 → 5.8.8.
--
-- Fix: ALTER every FK from NO ACTION to CASCADE on UPDATE. Preserves each
-- FK's existing ON DELETE rule verbatim. Pattern is: DROP CONSTRAINT then
-- ADD CONSTRAINT with the same name, column reference, ON UPDATE CASCADE,
-- and the original ON DELETE clause. Idempotent — re-running this against
-- an already-migrated DB drops constraints that exist and recreates them
-- with identical definitions.
--
-- Verified post-migration: same transactional simulation against riley's
-- row succeeds (UPDATE returns 1 row affected, project_members rows
-- cascade-update to the new uid). When riley signs in via Google, the
-- AFTER INSERT trigger on auth.users will fire handle_new_user, take the
-- swap path, and the UPDATE will cascade through all 42 FKs without
-- violating any constraint.
--
-- Memory: feedback_handle_new_user_swap_path_load_bearing (the swap path
-- contract now includes "must work for users with FK attachments").

BEGIN;

-- 1. activity_log.actor_id (ON DELETE SET NULL)
ALTER TABLE public.activity_log DROP CONSTRAINT activity_log_actor_id_fkey;
ALTER TABLE public.activity_log ADD CONSTRAINT activity_log_actor_id_fkey
  FOREIGN KEY (actor_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

-- 2. cities.created_by (ON DELETE NO ACTION)
ALTER TABLE public.cities DROP CONSTRAINT cities_created_by_fkey;
ALTER TABLE public.cities ADD CONSTRAINT cities_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE NO ACTION;

-- 3. clients.created_by (ON DELETE NO ACTION) — constraint name has trailing "1" from 5.2.3 org→clients split
ALTER TABLE public.clients DROP CONSTRAINT clients_created_by_fkey1;
ALTER TABLE public.clients ADD CONSTRAINT clients_created_by_fkey1
  FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE NO ACTION;

-- 4. credentials.created_by (ON DELETE SET NULL)
ALTER TABLE public.credentials DROP CONSTRAINT credentials_created_by_fkey;
ALTER TABLE public.credentials ADD CONSTRAINT credentials_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

-- 5. credentials.updated_by (ON DELETE SET NULL)
ALTER TABLE public.credentials DROP CONSTRAINT credentials_updated_by_fkey;
ALTER TABLE public.credentials ADD CONSTRAINT credentials_updated_by_fkey
  FOREIGN KEY (updated_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

-- 6. deliverables.created_by (ON DELETE NO ACTION)
ALTER TABLE public.deliverables DROP CONSTRAINT deliverables_created_by_fkey;
ALTER TABLE public.deliverables ADD CONSTRAINT deliverables_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE NO ACTION;

-- 7. departments.created_by (ON DELETE SET NULL)
ALTER TABLE public.departments DROP CONSTRAINT departments_created_by_fkey;
ALTER TABLE public.departments ADD CONSTRAINT departments_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

-- 8. mirror_holidays.created_by (ON DELETE SET NULL)
ALTER TABLE public.mirror_holidays DROP CONSTRAINT mirror_holidays_created_by_fkey;
ALTER TABLE public.mirror_holidays ADD CONSTRAINT mirror_holidays_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

-- 9. note_mentions.mentioned_user_id (ON DELETE CASCADE)
ALTER TABLE public.note_mentions DROP CONSTRAINT note_mentions_mentioned_user_id_fkey;
ALTER TABLE public.note_mentions ADD CONSTRAINT note_mentions_mentioned_user_id_fkey
  FOREIGN KEY (mentioned_user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;

-- 10. notes_log.author_id (ON DELETE NO ACTION)
ALTER TABLE public.notes_log DROP CONSTRAINT notes_log_author_id_fkey;
ALTER TABLE public.notes_log ADD CONSTRAINT notes_log_author_id_fkey
  FOREIGN KEY (author_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE NO ACTION;

-- 11. notifications.user_id (ON DELETE CASCADE)
ALTER TABLE public.notifications DROP CONSTRAINT notifications_user_id_fkey;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;

-- 12. outlook_entries.created_by (ON DELETE RESTRICT)
ALTER TABLE public.outlook_entries DROP CONSTRAINT outlook_entries_created_by_fkey;
ALTER TABLE public.outlook_entries ADD CONSTRAINT outlook_entries_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;

-- 13. people.created_by (ON DELETE NO ACTION)
ALTER TABLE public.people DROP CONSTRAINT people_created_by_fkey;
ALTER TABLE public.people ADD CONSTRAINT people_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE NO ACTION;

-- 14. project_account_managers.user_id (ON DELETE CASCADE)
ALTER TABLE public.project_account_managers DROP CONSTRAINT project_account_managers_user_id_fkey;
ALTER TABLE public.project_account_managers ADD CONSTRAINT project_account_managers_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;

-- 15. project_categories.created_by (ON DELETE NO ACTION)
ALTER TABLE public.project_categories DROP CONSTRAINT project_categories_created_by_fkey;
ALTER TABLE public.project_categories ADD CONSTRAINT project_categories_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE NO ACTION;

-- 16. project_designers.user_id (ON DELETE CASCADE)
ALTER TABLE public.project_designers DROP CONSTRAINT project_designers_user_id_fkey;
ALTER TABLE public.project_designers ADD CONSTRAINT project_designers_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;

-- 17. project_members.created_by (ON DELETE SET NULL)
ALTER TABLE public.project_members DROP CONSTRAINT project_members_created_by_fkey;
ALTER TABLE public.project_members ADD CONSTRAINT project_members_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

-- 18. project_members.user_id (ON DELETE CASCADE) — THE FK that surfaced the bug
ALTER TABLE public.project_members DROP CONSTRAINT project_members_user_id_fkey;
ALTER TABLE public.project_members ADD CONSTRAINT project_members_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;

-- 19. project_vendors.created_by (ON DELETE SET NULL)
ALTER TABLE public.project_vendors DROP CONSTRAINT project_vendors_created_by_fkey;
ALTER TABLE public.project_vendors ADD CONSTRAINT project_vendors_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

-- 20. projects.created_by (ON DELETE SET NULL)
ALTER TABLE public.projects DROP CONSTRAINT projects_created_by_fkey;
ALTER TABLE public.projects ADD CONSTRAINT projects_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

-- 21. saved_views.user_id (ON DELETE CASCADE)
ALTER TABLE public.saved_views DROP CONSTRAINT saved_views_user_id_fkey;
ALTER TABLE public.saved_views ADD CONSTRAINT saved_views_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;

-- 22. tasks.assignee_id (ON DELETE SET NULL)
ALTER TABLE public.tasks DROP CONSTRAINT tasks_assignee_id_fkey;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_assignee_id_fkey
  FOREIGN KEY (assignee_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

-- 23. tasks.created_by (ON DELETE SET NULL)
ALTER TABLE public.tasks DROP CONSTRAINT tasks_created_by_fkey;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

-- 24. tasks.source_user_id (ON DELETE SET NULL)
ALTER TABLE public.tasks DROP CONSTRAINT tasks_source_user_id_fkey;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_source_user_id_fkey
  FOREIGN KEY (source_user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

-- 25. ts_evaluations.triggered_by (ON DELETE SET NULL)
ALTER TABLE public.ts_evaluations DROP CONSTRAINT ts_evaluations_triggered_by_fkey;
ALTER TABLE public.ts_evaluations ADD CONSTRAINT ts_evaluations_triggered_by_fkey
  FOREIGN KEY (triggered_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

-- 26. ts_final_reviews.triggered_by (ON DELETE SET NULL)
ALTER TABLE public.ts_final_reviews DROP CONSTRAINT ts_final_reviews_triggered_by_fkey;
ALTER TABLE public.ts_final_reviews ADD CONSTRAINT ts_final_reviews_triggered_by_fkey
  FOREIGN KEY (triggered_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

-- 27. ts_pull_rounds.created_by (ON DELETE SET NULL)
ALTER TABLE public.ts_pull_rounds DROP CONSTRAINT ts_pull_rounds_created_by_fkey;
ALTER TABLE public.ts_pull_rounds ADD CONSTRAINT ts_pull_rounds_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

-- 28. ts_roles.created_by (ON DELETE SET NULL)
ALTER TABLE public.ts_roles DROP CONSTRAINT ts_roles_created_by_fkey;
ALTER TABLE public.ts_roles ADD CONSTRAINT ts_roles_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

-- 29. ts_roles.hiring_manager_id (ON DELETE SET NULL)
ALTER TABLE public.ts_roles DROP CONSTRAINT ts_roles_hiring_manager_id_fkey;
ALTER TABLE public.ts_roles ADD CONSTRAINT ts_roles_hiring_manager_id_fkey
  FOREIGN KEY (hiring_manager_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

-- 30. user_notification_preferences.user_id (ON DELETE CASCADE)
ALTER TABLE public.user_notification_preferences DROP CONSTRAINT user_notification_preferences_user_id_fkey;
ALTER TABLE public.user_notification_preferences ADD CONSTRAINT user_notification_preferences_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;

-- 31. vendor_capabilities.created_by (ON DELETE NO ACTION) — constraint name "org_capabilities_*" is legacy from 5.2.3 rename
ALTER TABLE public.vendor_capabilities DROP CONSTRAINT org_capabilities_created_by_fkey;
ALTER TABLE public.vendor_capabilities ADD CONSTRAINT org_capabilities_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE NO ACTION;

-- 32. vendor_categories.created_by (ON DELETE NO ACTION)
ALTER TABLE public.vendor_categories DROP CONSTRAINT vendor_categories_created_by_fkey;
ALTER TABLE public.vendor_categories ADD CONSTRAINT vendor_categories_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE NO ACTION;

-- 33. vendor_files.created_by (ON DELETE SET NULL)
ALTER TABLE public.vendor_files DROP CONSTRAINT vendor_files_created_by_fkey;
ALTER TABLE public.vendor_files ADD CONSTRAINT vendor_files_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

-- 34. vendor_ratings.user_id (ON DELETE CASCADE)
ALTER TABLE public.vendor_ratings DROP CONSTRAINT vendor_ratings_user_id_fkey;
ALTER TABLE public.vendor_ratings ADD CONSTRAINT vendor_ratings_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;

-- 35. vendor_subcategories.created_by (ON DELETE SET NULL)
ALTER TABLE public.vendor_subcategories DROP CONSTRAINT vendor_subcategories_created_by_fkey;
ALTER TABLE public.vendor_subcategories ADD CONSTRAINT vendor_subcategories_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

-- 36. vendors.created_by (ON DELETE SET NULL) — constraint name "clients_created_by_fkey" is legacy from 5.2.3 org→vendors split
ALTER TABLE public.vendors DROP CONSTRAINT clients_created_by_fkey;
ALTER TABLE public.vendors ADD CONSTRAINT clients_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

-- 37. venue_rate_history.created_by (ON DELETE NO ACTION)
ALTER TABLE public.venue_rate_history DROP CONSTRAINT venue_rate_history_created_by_fkey;
ALTER TABLE public.venue_rate_history ADD CONSTRAINT venue_rate_history_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE NO ACTION;

-- 38. venues.created_by (ON DELETE SET NULL)
ALTER TABLE public.venues DROP CONSTRAINT venues_created_by_fkey;
ALTER TABLE public.venues ADD CONSTRAINT venues_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

-- 39. vs_scouts.created_by (ON DELETE SET NULL)
ALTER TABLE public.vs_scouts DROP CONSTRAINT vs_scouts_created_by_fkey;
ALTER TABLE public.vs_scouts ADD CONSTRAINT vs_scouts_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

-- 40. vs_scouts.updated_by (ON DELETE SET NULL)
ALTER TABLE public.vs_scouts DROP CONSTRAINT vs_scouts_updated_by_fkey;
ALTER TABLE public.vs_scouts ADD CONSTRAINT vs_scouts_updated_by_fkey
  FOREIGN KEY (updated_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

-- 41. wiki_pages.created_by (ON DELETE SET NULL)
ALTER TABLE public.wiki_pages DROP CONSTRAINT wiki_pages_created_by_fkey;
ALTER TABLE public.wiki_pages ADD CONSTRAINT wiki_pages_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

-- 42. wiki_pages.updated_by (ON DELETE SET NULL)
ALTER TABLE public.wiki_pages DROP CONSTRAINT wiki_pages_updated_by_fkey;
ALTER TABLE public.wiki_pages ADD CONSTRAINT wiki_pages_updated_by_fkey
  FOREIGN KEY (updated_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

COMMIT;
