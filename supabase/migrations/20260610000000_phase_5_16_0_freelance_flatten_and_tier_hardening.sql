-- ============================================================================
-- Phase 5.16.0: Freelance access flatten + DB tier hardening
--
-- Two coupled changes:
--   1. Freelance is now functionally equal to standard. The `freelance` enum
--      value persists only as a visual badge. (Frontend-only; no enum change.)
--   2. DB tier hardening. Every HQ Core RLS policy that was `USING (true)`
--      (open to ANY authenticated JWT, including `pending` users who hold a
--      valid `authenticated` token) is rewritten to gate on the new
--      `is_active_member()` helper. This closes the raw-PostgREST read/write
--      leak for pending users while leaving admin / standard / freelance
--      behavior unchanged (they all satisfy `is_active_member()`).
--
-- Authoritative policy names below come from a live `pg_policies` snapshot
-- (spec §5 prereq), NOT the migration files (which contain superseded names).
--
-- Rewrite rule: any policy whose predicate was literal `true` -> wrapped
-- `(select public.is_active_member())` (the 5.8.5 init-plan pattern, evaluated
-- once per query). Policies already gated on `is_admin()`, self-scope
-- (`auth.uid()`), the credentials freelance-block, or admin-write lookups are
-- left untouched.
--
-- Scope clarifications surfaced during the snapshot:
--   * `vs_briefs` / `vs_pitch_decks` / `vs_sourcing_rounds` were DROPPED in the
--     4.1 VS port (folded into `vs_scouts`); only `vs_scouts`,
--     `vs_candidate_venues`, `vs_venue_photos` exist live.
--   * `public.wiki_images` is not a table (storage bucket only); skipped.
--   * `activity_log` / `global_settings` / `mirror_holidays` SELECT were
--     `true` (spec listed them "no change" but the label was wrong); hardened
--     here per owner decision since all their readers are member/admin
--     surfaces.
--
-- Rollback: DROP the new policies and recreate the `USING (true)` versions;
-- restore the three `venue_photos` storage policies to `is_producer_or_admin()`;
-- `DROP FUNCTION public.is_active_member()`; drop the two-value visibility
-- CHECK and re-add the three-value `('all','no_freelance','admin_only')`.
-- Mildly destructive (tightens prod RLS the moment it applies); apply
-- out-of-band, no bundled Netlify deploy.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Helper: is_active_member()
--    True for any non-pending, active user. `::text <> 'pending'` keeps it
--    enum-rebuild-safe (matches the is_producer_or_admin precedent). SECURITY
--    DEFINER so it reads public.users from inside an RLS predicate without
--    recursing into the caller's RLS. STABLE because it reads a table.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_active_member()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT permission_role::text <> 'pending' AND active = true
       FROM public.users
      WHERE id = auth.uid()),
    false
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_active_member() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_active_member() TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. Collapse wiki_pages.visibility CHECK constraint (drops `no_freelance`).
--    text column, not an enum -> UPDATE existing rows, DROP + ADD constraint.
-- ----------------------------------------------------------------------------
UPDATE public.wiki_pages SET visibility = 'all' WHERE visibility = 'no_freelance';

ALTER TABLE public.wiki_pages DROP CONSTRAINT IF EXISTS wiki_pages_visibility_check;

ALTER TABLE public.wiki_pages
  ADD CONSTRAINT wiki_pages_visibility_check
  CHECK (visibility IN ('all', 'admin_only'));

-- ----------------------------------------------------------------------------
-- 3. Bucket 1 policy rewrites: every `USING (true)` / `WITH CHECK (true)`
--    HQ Core policy -> `(select public.is_active_member())`. Grouped by table.
--    Admin / self-scoped / admin-write policies on the same table are NOT
--    dropped here.
-- ----------------------------------------------------------------------------

-- activity_log (SELECT was true; hardened per owner decision)
DROP POLICY IF EXISTS activity_log_select ON public.activity_log;
CREATE POLICY activity_log_select ON public.activity_log
  FOR SELECT TO authenticated USING ((select public.is_active_member()));

-- cities (delete stays is_admin)
DROP POLICY IF EXISTS cities_select ON public.cities;
CREATE POLICY cities_select ON public.cities
  FOR SELECT TO authenticated USING ((select public.is_active_member()));
DROP POLICY IF EXISTS cities_insert ON public.cities;
CREATE POLICY cities_insert ON public.cities
  FOR INSERT TO authenticated WITH CHECK ((select public.is_active_member()));
DROP POLICY IF EXISTS cities_update ON public.cities;
CREATE POLICY cities_update ON public.cities
  FOR UPDATE TO authenticated USING ((select public.is_active_member()))
  WITH CHECK ((select public.is_active_member()));

-- city_aliases (delete stays is_admin)
DROP POLICY IF EXISTS city_aliases_select ON public.city_aliases;
CREATE POLICY city_aliases_select ON public.city_aliases
  FOR SELECT TO authenticated USING ((select public.is_active_member()));
DROP POLICY IF EXISTS city_aliases_insert ON public.city_aliases;
CREATE POLICY city_aliases_insert ON public.city_aliases
  FOR INSERT TO authenticated WITH CHECK ((select public.is_active_member()));
DROP POLICY IF EXISTS city_aliases_update ON public.city_aliases;
CREATE POLICY city_aliases_update ON public.city_aliases
  FOR UPDATE TO authenticated USING ((select public.is_active_member()))
  WITH CHECK ((select public.is_active_member()));

-- clients (delete stays is_admin)
DROP POLICY IF EXISTS clients_select ON public.clients;
CREATE POLICY clients_select ON public.clients
  FOR SELECT TO authenticated USING ((select public.is_active_member()));
DROP POLICY IF EXISTS clients_insert ON public.clients;
CREATE POLICY clients_insert ON public.clients
  FOR INSERT TO authenticated WITH CHECK ((select public.is_active_member()));
DROP POLICY IF EXISTS clients_update ON public.clients;
CREATE POLICY clients_update ON public.clients
  FOR UPDATE TO authenticated USING ((select public.is_active_member()))
  WITH CHECK ((select public.is_active_member()));

-- deliverables (all four were true)
DROP POLICY IF EXISTS deliverables_select ON public.deliverables;
CREATE POLICY deliverables_select ON public.deliverables
  FOR SELECT TO authenticated USING ((select public.is_active_member()));
DROP POLICY IF EXISTS deliverables_insert ON public.deliverables;
CREATE POLICY deliverables_insert ON public.deliverables
  FOR INSERT TO authenticated WITH CHECK ((select public.is_active_member()));
DROP POLICY IF EXISTS deliverables_update ON public.deliverables;
CREATE POLICY deliverables_update ON public.deliverables
  FOR UPDATE TO authenticated USING ((select public.is_active_member()))
  WITH CHECK ((select public.is_active_member()));
DROP POLICY IF EXISTS deliverables_delete ON public.deliverables;
CREATE POLICY deliverables_delete ON public.deliverables
  FOR DELETE TO authenticated USING ((select public.is_active_member()));

-- departments (writes stay is_admin; only select_all was true)
DROP POLICY IF EXISTS departments_select_all ON public.departments;
CREATE POLICY departments_select_all ON public.departments
  FOR SELECT TO authenticated USING ((select public.is_active_member()));

-- global_settings (SELECT was true; hardened per owner decision. update=is_admin)
DROP POLICY IF EXISTS global_settings_select ON public.global_settings;
CREATE POLICY global_settings_select ON public.global_settings
  FOR SELECT TO authenticated USING ((select public.is_active_member()));

-- mirror_holidays (SELECT was true; hardened per owner decision. writes=is_admin)
DROP POLICY IF EXISTS mirror_holidays_select_all ON public.mirror_holidays;
CREATE POLICY mirror_holidays_select_all ON public.mirror_holidays
  FOR SELECT TO authenticated USING ((select public.is_active_member()));

-- neighborhoods (delete stays is_admin)
DROP POLICY IF EXISTS neighborhoods_select ON public.neighborhoods;
CREATE POLICY neighborhoods_select ON public.neighborhoods
  FOR SELECT TO authenticated USING ((select public.is_active_member()));
DROP POLICY IF EXISTS neighborhoods_insert ON public.neighborhoods;
CREATE POLICY neighborhoods_insert ON public.neighborhoods
  FOR INSERT TO authenticated WITH CHECK ((select public.is_active_member()));
DROP POLICY IF EXISTS neighborhoods_update ON public.neighborhoods;
CREATE POLICY neighborhoods_update ON public.neighborhoods
  FOR UPDATE TO authenticated USING ((select public.is_active_member()))
  WITH CHECK ((select public.is_active_member()));

-- note_mentions (insert_author stays author-scoped; only select_all was true)
DROP POLICY IF EXISTS note_mentions_select_all ON public.note_mentions;
CREATE POLICY note_mentions_select_all ON public.note_mentions
  FOR SELECT TO authenticated USING ((select public.is_active_member()));

-- notes_log (insert/delete stay author-scoped; only select was true)
DROP POLICY IF EXISTS notes_log_select ON public.notes_log;
CREATE POLICY notes_log_select ON public.notes_log
  FOR SELECT TO authenticated USING ((select public.is_active_member()));

-- people (all four were true)
DROP POLICY IF EXISTS people_select ON public.people;
CREATE POLICY people_select ON public.people
  FOR SELECT TO authenticated USING ((select public.is_active_member()));
DROP POLICY IF EXISTS people_insert ON public.people;
CREATE POLICY people_insert ON public.people
  FOR INSERT TO authenticated WITH CHECK ((select public.is_active_member()));
DROP POLICY IF EXISTS people_update ON public.people;
CREATE POLICY people_update ON public.people
  FOR UPDATE TO authenticated USING ((select public.is_active_member()))
  WITH CHECK ((select public.is_active_member()));
DROP POLICY IF EXISTS people_delete ON public.people;
CREATE POLICY people_delete ON public.people
  FOR DELETE TO authenticated USING ((select public.is_active_member()));

-- project_account_managers (pam_*; all four were true)
DROP POLICY IF EXISTS pam_select ON public.project_account_managers;
CREATE POLICY pam_select ON public.project_account_managers
  FOR SELECT TO authenticated USING ((select public.is_active_member()));
DROP POLICY IF EXISTS pam_insert ON public.project_account_managers;
CREATE POLICY pam_insert ON public.project_account_managers
  FOR INSERT TO authenticated WITH CHECK ((select public.is_active_member()));
DROP POLICY IF EXISTS pam_update ON public.project_account_managers;
CREATE POLICY pam_update ON public.project_account_managers
  FOR UPDATE TO authenticated USING ((select public.is_active_member()))
  WITH CHECK ((select public.is_active_member()));
DROP POLICY IF EXISTS pam_delete ON public.project_account_managers;
CREATE POLICY pam_delete ON public.project_account_managers
  FOR DELETE TO authenticated USING ((select public.is_active_member()));

-- project_categories (delete stays is_admin)
DROP POLICY IF EXISTS project_categories_select ON public.project_categories;
CREATE POLICY project_categories_select ON public.project_categories
  FOR SELECT TO authenticated USING ((select public.is_active_member()));
DROP POLICY IF EXISTS project_categories_insert ON public.project_categories;
CREATE POLICY project_categories_insert ON public.project_categories
  FOR INSERT TO authenticated WITH CHECK ((select public.is_active_member()));
DROP POLICY IF EXISTS project_categories_update ON public.project_categories;
CREATE POLICY project_categories_update ON public.project_categories
  FOR UPDATE TO authenticated USING ((select public.is_active_member()))
  WITH CHECK ((select public.is_active_member()));

-- project_designers (pd_*; all four were true)
DROP POLICY IF EXISTS pd_select ON public.project_designers;
CREATE POLICY pd_select ON public.project_designers
  FOR SELECT TO authenticated USING ((select public.is_active_member()));
DROP POLICY IF EXISTS pd_insert ON public.project_designers;
CREATE POLICY pd_insert ON public.project_designers
  FOR INSERT TO authenticated WITH CHECK ((select public.is_active_member()));
DROP POLICY IF EXISTS pd_update ON public.project_designers;
CREATE POLICY pd_update ON public.project_designers
  FOR UPDATE TO authenticated USING ((select public.is_active_member()))
  WITH CHECK ((select public.is_active_member()));
DROP POLICY IF EXISTS pd_delete ON public.project_designers;
CREATE POLICY pd_delete ON public.project_designers
  FOR DELETE TO authenticated USING ((select public.is_active_member()));

-- project_members (all four were true)
DROP POLICY IF EXISTS project_members_select ON public.project_members;
CREATE POLICY project_members_select ON public.project_members
  FOR SELECT TO authenticated USING ((select public.is_active_member()));
DROP POLICY IF EXISTS project_members_insert ON public.project_members;
CREATE POLICY project_members_insert ON public.project_members
  FOR INSERT TO authenticated WITH CHECK ((select public.is_active_member()));
DROP POLICY IF EXISTS project_members_update ON public.project_members;
CREATE POLICY project_members_update ON public.project_members
  FOR UPDATE TO authenticated USING ((select public.is_active_member()))
  WITH CHECK ((select public.is_active_member()));
DROP POLICY IF EXISTS project_members_delete ON public.project_members;
CREATE POLICY project_members_delete ON public.project_members
  FOR DELETE TO authenticated USING ((select public.is_active_member()));

-- project_tags (delete stays is_admin)
DROP POLICY IF EXISTS project_tags_select ON public.project_tags;
CREATE POLICY project_tags_select ON public.project_tags
  FOR SELECT TO authenticated USING ((select public.is_active_member()));
DROP POLICY IF EXISTS project_tags_insert ON public.project_tags;
CREATE POLICY project_tags_insert ON public.project_tags
  FOR INSERT TO authenticated WITH CHECK ((select public.is_active_member()));
DROP POLICY IF EXISTS project_tags_update ON public.project_tags;
CREATE POLICY project_tags_update ON public.project_tags
  FOR UPDATE TO authenticated USING ((select public.is_active_member()))
  WITH CHECK ((select public.is_active_member()));

-- project_vendors (all four were true)
DROP POLICY IF EXISTS project_vendors_select ON public.project_vendors;
CREATE POLICY project_vendors_select ON public.project_vendors
  FOR SELECT TO authenticated USING ((select public.is_active_member()));
DROP POLICY IF EXISTS project_vendors_insert ON public.project_vendors;
CREATE POLICY project_vendors_insert ON public.project_vendors
  FOR INSERT TO authenticated WITH CHECK ((select public.is_active_member()));
DROP POLICY IF EXISTS project_vendors_update ON public.project_vendors;
CREATE POLICY project_vendors_update ON public.project_vendors
  FOR UPDATE TO authenticated USING ((select public.is_active_member()))
  WITH CHECK ((select public.is_active_member()));
DROP POLICY IF EXISTS project_vendors_delete ON public.project_vendors;
CREATE POLICY project_vendors_delete ON public.project_vendors
  FOR DELETE TO authenticated USING ((select public.is_active_member()));

-- project_venues (pv_*; all four were true)
DROP POLICY IF EXISTS pv_select ON public.project_venues;
CREATE POLICY pv_select ON public.project_venues
  FOR SELECT TO authenticated USING ((select public.is_active_member()));
DROP POLICY IF EXISTS pv_insert ON public.project_venues;
CREATE POLICY pv_insert ON public.project_venues
  FOR INSERT TO authenticated WITH CHECK ((select public.is_active_member()));
DROP POLICY IF EXISTS pv_update ON public.project_venues;
CREATE POLICY pv_update ON public.project_venues
  FOR UPDATE TO authenticated USING ((select public.is_active_member()))
  WITH CHECK ((select public.is_active_member()));
DROP POLICY IF EXISTS pv_delete ON public.project_venues;
CREATE POLICY pv_delete ON public.project_venues
  FOR DELETE TO authenticated USING ((select public.is_active_member()));

-- projects (delete stays is_admin)
DROP POLICY IF EXISTS projects_select ON public.projects;
CREATE POLICY projects_select ON public.projects
  FOR SELECT TO authenticated USING ((select public.is_active_member()));
DROP POLICY IF EXISTS projects_insert ON public.projects;
CREATE POLICY projects_insert ON public.projects
  FOR INSERT TO authenticated WITH CHECK ((select public.is_active_member()));
DROP POLICY IF EXISTS projects_update ON public.projects;
CREATE POLICY projects_update ON public.projects
  FOR UPDATE TO authenticated USING ((select public.is_active_member()))
  WITH CHECK ((select public.is_active_member()));

-- tasks (all four were true)
DROP POLICY IF EXISTS tasks_select ON public.tasks;
CREATE POLICY tasks_select ON public.tasks
  FOR SELECT TO authenticated USING ((select public.is_active_member()));
DROP POLICY IF EXISTS tasks_insert ON public.tasks;
CREATE POLICY tasks_insert ON public.tasks
  FOR INSERT TO authenticated WITH CHECK ((select public.is_active_member()));
DROP POLICY IF EXISTS tasks_update ON public.tasks;
CREATE POLICY tasks_update ON public.tasks
  FOR UPDATE TO authenticated USING ((select public.is_active_member()))
  WITH CHECK ((select public.is_active_member()));
DROP POLICY IF EXISTS tasks_delete ON public.tasks;
CREATE POLICY tasks_delete ON public.tasks
  FOR DELETE TO authenticated USING ((select public.is_active_member()));

-- users (SELECT only; insert/update/delete stay admin / self+admin)
-- The `OR id = auth.uid()` self-read clause is REQUIRED: useUserRole +
-- ProtectedRoute resolve the caller's own row to drive the pending redirect
-- and the deactivation sign-out. A bare is_active_member() gate would return
-- null for pending/deactivated users reading their own row, breaking both
-- flows. Pending still cannot read OTHER users' rows (the directory stays
-- member-gated).
DROP POLICY IF EXISTS users_select ON public.users;
CREATE POLICY users_select ON public.users
  FOR SELECT TO authenticated
  USING ((select public.is_active_member()) OR id = (select auth.uid()));

-- vendor_capabilities (policy names are org_capabilities_*; delete stays is_admin)
DROP POLICY IF EXISTS org_capabilities_select ON public.vendor_capabilities;
CREATE POLICY org_capabilities_select ON public.vendor_capabilities
  FOR SELECT TO authenticated USING ((select public.is_active_member()));
DROP POLICY IF EXISTS org_capabilities_insert ON public.vendor_capabilities;
CREATE POLICY org_capabilities_insert ON public.vendor_capabilities
  FOR INSERT TO authenticated WITH CHECK ((select public.is_active_member()));
DROP POLICY IF EXISTS org_capabilities_update ON public.vendor_capabilities;
CREATE POLICY org_capabilities_update ON public.vendor_capabilities
  FOR UPDATE TO authenticated USING ((select public.is_active_member()))
  WITH CHECK ((select public.is_active_member()));

-- vendor_categories (delete stays is_admin)
DROP POLICY IF EXISTS vendor_categories_select ON public.vendor_categories;
CREATE POLICY vendor_categories_select ON public.vendor_categories
  FOR SELECT TO authenticated USING ((select public.is_active_member()));
DROP POLICY IF EXISTS vendor_categories_insert ON public.vendor_categories;
CREATE POLICY vendor_categories_insert ON public.vendor_categories
  FOR INSERT TO authenticated WITH CHECK ((select public.is_active_member()));
DROP POLICY IF EXISTS vendor_categories_update ON public.vendor_categories;
CREATE POLICY vendor_categories_update ON public.vendor_categories
  FOR UPDATE TO authenticated USING ((select public.is_active_member()))
  WITH CHECK ((select public.is_active_member()));

-- vendor_files (all three were true; *_authenticated names)
DROP POLICY IF EXISTS vendor_files_select_authenticated ON public.vendor_files;
CREATE POLICY vendor_files_select_authenticated ON public.vendor_files
  FOR SELECT TO authenticated USING ((select public.is_active_member()));
DROP POLICY IF EXISTS vendor_files_insert_authenticated ON public.vendor_files;
CREATE POLICY vendor_files_insert_authenticated ON public.vendor_files
  FOR INSERT TO authenticated WITH CHECK ((select public.is_active_member()));
DROP POLICY IF EXISTS vendor_files_delete_authenticated ON public.vendor_files;
CREATE POLICY vendor_files_delete_authenticated ON public.vendor_files
  FOR DELETE TO authenticated USING ((select public.is_active_member()));

-- vendor_ratings (only select_authenticated was true; insert/update/delete self-scoped)
DROP POLICY IF EXISTS vendor_ratings_select_authenticated ON public.vendor_ratings;
CREATE POLICY vendor_ratings_select_authenticated ON public.vendor_ratings
  FOR SELECT TO authenticated USING ((select public.is_active_member()));

-- vendor_subcategories (delete stays is_admin)
DROP POLICY IF EXISTS vendor_subcategories_select ON public.vendor_subcategories;
CREATE POLICY vendor_subcategories_select ON public.vendor_subcategories
  FOR SELECT TO authenticated USING ((select public.is_active_member()));
DROP POLICY IF EXISTS vendor_subcategories_insert ON public.vendor_subcategories;
CREATE POLICY vendor_subcategories_insert ON public.vendor_subcategories
  FOR INSERT TO authenticated WITH CHECK ((select public.is_active_member()));
DROP POLICY IF EXISTS vendor_subcategories_update ON public.vendor_subcategories;
CREATE POLICY vendor_subcategories_update ON public.vendor_subcategories
  FOR UPDATE TO authenticated USING ((select public.is_active_member()))
  WITH CHECK ((select public.is_active_member()));

-- vendors (policy names are clients_* from the clients->organizations->vendors
--          OID-preserving rename chain; clients_delete stays is_admin)
DROP POLICY IF EXISTS clients_select ON public.vendors;
CREATE POLICY clients_select ON public.vendors
  FOR SELECT TO authenticated USING ((select public.is_active_member()));
DROP POLICY IF EXISTS clients_insert ON public.vendors;
CREATE POLICY clients_insert ON public.vendors
  FOR INSERT TO authenticated WITH CHECK ((select public.is_active_member()));
DROP POLICY IF EXISTS clients_update ON public.vendors;
CREATE POLICY clients_update ON public.vendors
  FOR UPDATE TO authenticated USING ((select public.is_active_member()))
  WITH CHECK ((select public.is_active_member()));

-- venue_contact_people (select/insert/delete were true; no update policy exists)
DROP POLICY IF EXISTS venue_contact_people_select ON public.venue_contact_people;
CREATE POLICY venue_contact_people_select ON public.venue_contact_people
  FOR SELECT TO authenticated USING ((select public.is_active_member()));
DROP POLICY IF EXISTS venue_contact_people_insert ON public.venue_contact_people;
CREATE POLICY venue_contact_people_insert ON public.venue_contact_people
  FOR INSERT TO authenticated WITH CHECK ((select public.is_active_member()));
DROP POLICY IF EXISTS venue_contact_people_delete ON public.venue_contact_people;
CREATE POLICY venue_contact_people_delete ON public.venue_contact_people
  FOR DELETE TO authenticated USING ((select public.is_active_member()));

-- venue_features (delete stays is_admin)
DROP POLICY IF EXISTS venue_features_select ON public.venue_features;
CREATE POLICY venue_features_select ON public.venue_features
  FOR SELECT TO authenticated USING ((select public.is_active_member()));
DROP POLICY IF EXISTS venue_features_insert ON public.venue_features;
CREATE POLICY venue_features_insert ON public.venue_features
  FOR INSERT TO authenticated WITH CHECK ((select public.is_active_member()));
DROP POLICY IF EXISTS venue_features_update ON public.venue_features;
CREATE POLICY venue_features_update ON public.venue_features
  FOR UPDATE TO authenticated USING ((select public.is_active_member()))
  WITH CHECK ((select public.is_active_member()));

-- venue_rate_history (select/insert were true)
DROP POLICY IF EXISTS venue_rate_history_select ON public.venue_rate_history;
CREATE POLICY venue_rate_history_select ON public.venue_rate_history
  FOR SELECT TO authenticated USING ((select public.is_active_member()));
DROP POLICY IF EXISTS venue_rate_history_insert ON public.venue_rate_history;
CREATE POLICY venue_rate_history_insert ON public.venue_rate_history
  FOR INSERT TO authenticated WITH CHECK ((select public.is_active_member()));

-- venue_types (delete stays is_admin)
DROP POLICY IF EXISTS venue_types_select ON public.venue_types;
CREATE POLICY venue_types_select ON public.venue_types
  FOR SELECT TO authenticated USING ((select public.is_active_member()));
DROP POLICY IF EXISTS venue_types_insert ON public.venue_types;
CREATE POLICY venue_types_insert ON public.venue_types
  FOR INSERT TO authenticated WITH CHECK ((select public.is_active_member()));
DROP POLICY IF EXISTS venue_types_update ON public.venue_types;
CREATE POLICY venue_types_update ON public.venue_types
  FOR UPDATE TO authenticated USING ((select public.is_active_member()))
  WITH CHECK ((select public.is_active_member()));

-- venue_venue_types (all four were true)
DROP POLICY IF EXISTS venue_venue_types_select ON public.venue_venue_types;
CREATE POLICY venue_venue_types_select ON public.venue_venue_types
  FOR SELECT TO authenticated USING ((select public.is_active_member()));
DROP POLICY IF EXISTS venue_venue_types_insert ON public.venue_venue_types;
CREATE POLICY venue_venue_types_insert ON public.venue_venue_types
  FOR INSERT TO authenticated WITH CHECK ((select public.is_active_member()));
DROP POLICY IF EXISTS venue_venue_types_update ON public.venue_venue_types;
CREATE POLICY venue_venue_types_update ON public.venue_venue_types
  FOR UPDATE TO authenticated USING ((select public.is_active_member()))
  WITH CHECK ((select public.is_active_member()));
DROP POLICY IF EXISTS venue_venue_types_delete ON public.venue_venue_types;
CREATE POLICY venue_venue_types_delete ON public.venue_venue_types
  FOR DELETE TO authenticated USING ((select public.is_active_member()));

-- venues (includes the photos text[] col 5.14 writes via vs-generate-deck;
--         delete stays is_admin)
DROP POLICY IF EXISTS venues_select ON public.venues;
CREATE POLICY venues_select ON public.venues
  FOR SELECT TO authenticated USING ((select public.is_active_member()));
DROP POLICY IF EXISTS venues_insert ON public.venues;
CREATE POLICY venues_insert ON public.venues
  FOR INSERT TO authenticated WITH CHECK ((select public.is_active_member()));
DROP POLICY IF EXISTS venues_update ON public.venues;
CREATE POLICY venues_update ON public.venues
  FOR UPDATE TO authenticated USING ((select public.is_active_member()))
  WITH CHECK ((select public.is_active_member()));

-- wiki_pages (SELECT only; insert/update/delete stay admin via existing policies)
DROP POLICY IF EXISTS wiki_pages_select_all ON public.wiki_pages;
CREATE POLICY wiki_pages_select_all ON public.wiki_pages
  FOR SELECT TO authenticated USING ((select public.is_active_member()));

-- ----------------------------------------------------------------------------
-- 4. vs_* tables: open-authenticated per port plan § 8.6, now "any ACTIVE
--    authenticated user." Single permissive ALL policy per table preserved;
--    only the live tables (vs_scouts / vs_candidate_venues / vs_venue_photos)
--    exist (briefs / pitch_decks / sourcing_rounds were dropped in the 4.1 port).
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS vs_scouts_all_authenticated ON public.vs_scouts;
CREATE POLICY vs_scouts_all_authenticated ON public.vs_scouts
  FOR ALL TO authenticated USING ((select public.is_active_member()))
  WITH CHECK ((select public.is_active_member()));

DROP POLICY IF EXISTS vs_candidate_venues_all_authenticated ON public.vs_candidate_venues;
CREATE POLICY vs_candidate_venues_all_authenticated ON public.vs_candidate_venues
  FOR ALL TO authenticated USING ((select public.is_active_member()))
  WITH CHECK ((select public.is_active_member()));

DROP POLICY IF EXISTS vs_venue_photos_all_authenticated ON public.vs_venue_photos;
CREATE POLICY vs_venue_photos_all_authenticated ON public.vs_venue_photos
  FOR ALL TO authenticated USING ((select public.is_active_member()))
  WITH CHECK ((select public.is_active_member()));

-- ----------------------------------------------------------------------------
-- 5. Storage: venue_photos bucket. Three write policies were gated on
--    is_producer_or_admin(); rewrite to is_active_member() (fresh CREATE
--    rebinds to the new function). No _select policy exists (dropped in 5.8.5;
--    public bucket, CDN reads bypass storage RLS) so none is recreated.
--    is_producer_or_admin() itself stays (other buckets still reference it).
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS storage_venue_photos_insert ON storage.objects;
CREATE POLICY storage_venue_photos_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK ((bucket_id = 'venue_photos'::text) AND (select public.is_active_member()));

DROP POLICY IF EXISTS storage_venue_photos_update ON storage.objects;
CREATE POLICY storage_venue_photos_update ON storage.objects
  FOR UPDATE TO authenticated
  USING ((bucket_id = 'venue_photos'::text) AND (select public.is_active_member()))
  WITH CHECK ((bucket_id = 'venue_photos'::text) AND (select public.is_active_member()));

DROP POLICY IF EXISTS storage_venue_photos_delete ON storage.objects;
CREATE POLICY storage_venue_photos_delete ON storage.objects
  FOR DELETE TO authenticated
  USING ((bucket_id = 'venue_photos'::text) AND (select public.is_active_member()));
