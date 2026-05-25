# Schema

Single source of truth for the Mirror NYC HQ Postgres schema. All timestamp columns use `timestamptz` (timezone-aware). Date-only columns use `date`. UUIDs use `gen_random_uuid()` defaults.

Migrations live in `supabase/migrations/`. The current migration set was applied through Phase 4.10.6-port (cutover 2026-05-13). See `CHECKPOINT.md` § Recent migrations for the live list and `docs/roadmap.md` for the phase timeline.

## HQ Core

### users (synced from auth.users via `handle_new_user` trigger)
- `id` (uuid, PK). Phase 5.4 dropped the FK to `auth.users(id)` so admins can pre-provision Team members before they sign in. `handle_new_user` swaps the placeholder id to the auth uid on first sign-in (id-swap pattern; see `docs/decisions.md` Phase 5.4).
- `email` (text, unique, not null)
- `full_name` (text)
- `avatar_url` (text)
- `permission_role` (enum: `admin`, `standard`, `freelance`, `pending`; default `pending`). Reshaped in Phase 5.1 from the 3-tier model (`member`/`producer`/`admin`) per the locked Phase 5 decisions memo. Backfill: admin -> admin, producer -> admin, member -> standard. New signups land in `pending` until an admin assigns a tier from the Team page.
- `role_title` (text, nullable). Added Phase 5.4. Free-text producer / designer / etc.
- `department_id` (uuid, FK to `departments.id` ON DELETE SET NULL, nullable). Added Phase 5.4. Replaces the Phase-5.1 `department_tags` text[] (dropped). Seeded values: Leadership, Accounts, Creative, Design, Event Production.
- `slack_handle` (text, nullable). Added Phase 5.4. Future Slack-DM notification dispatch reads this.
- `slack_user_id` (text, nullable). Added Phase 5.4. Slack workspace user id (e.g. `U01234ABCD`) for DM addressing.
- `last_active_at` (timestamptz, nullable). Added Phase 5.4. Stamped by `handle_new_user` on sign-in.
- `active` (bool, default true; soft-delete column). `ProtectedRoute` checks this on every authed nav: a row with `active = false` triggers an immediate sign-out + "Account deactivated" screen (Phase 5.4).
- `is_owner` (bool, NOT NULL, default false). Added Phase 5.6.5. Gates the owner-only "Save as default for all users" affordance in `<SavedViewsDropdown>` + the calendar visibility panel, and powers the inline-subquery RLS check that lets owners write `scope='global'` rows on `saved_views`. Backfilled to `true` for `email = 'jimmie@mirrornyc.com'`; every other row is `false`.
- `created_at`, `updated_at`

### departments (Phase 5.4 lookup)
- `id` (uuid, PK), `name` (text, unique, not null)
- `created_by` (uuid, FK to users, nullable), `created_at`
- RLS: open SELECT for authenticated; admin INSERT/UPDATE/DELETE via `is_admin()`.

### wiki_pages (Phase 5.4)
- `id`, `slug` (text, unique), `title`, `body` (text, markdown for prose pages)
- `page_type` (text CHECK in `prose`, `team_directory`, `vendors_glance`, `account_logins`; default `prose`). Special pages (non-prose) render hardcoded components instead of body markdown; they're seeded in the migration and can't be created from the UI.
- `visibility` (text CHECK in `all`, `no_freelance`; default `all`). Filters the wiki nav; `account-logins` ships with `no_freelance`.
- `sort_order` (int, default 0). Drives nav order (asc).
- `created_by`, `updated_by` (uuid FKs to users, nullable), `created_at`, `updated_at`
- Triggers: `updated_at_auto`, `activity_log_writer`.
- RLS: open SELECT for authenticated; admin INSERT/UPDATE/DELETE.

### credentials (Phase 5.4; encrypted Phase 5.8.5)
- `id`, `service_name` (text, not null), `username` (text, nullable), `password_encrypted` (bytea, not null; pgsodium AEAD-deterministic via the 4-arg `crypto_aead_det_encrypt(message, additional, key_uuid, nonce)` overload with NULL nonce; key name `credentials`), `url` (text, nullable)
- `created_by`, `updated_by` (uuid FKs to users, nullable), `created_at`, `updated_at`
- (`related_note` was created in 5.4 then dropped in `20260516170000_phase_5_4_feedback.sql`; never reintroduced.)
- Triggers: `updated_at_auto`, `activity_log_writer`.
- RLS: Freelance blocked entirely. SELECT + INSERT/UPDATE/DELETE for `admin` + `standard` (widened in 5.4 feedback round 2). Policies use the `(select auth.uid())` initplan optimization (Phase 5.8.5).
- Password access flows through three SECURITY DEFINER RPCs: `credentials_create(service_name, username, password, url) -> uuid` (atomic insert with encryption), `credentials_set_password(id, password)` (re-encrypt + bump `updated_at`/`updated_by`), `credentials_reveal_password(id) -> text` (decrypt). All three gate on the same `permission_role IN ('admin', 'standard')` predicate the RLS uses. Non-password column edits stay on the regular PostgREST UPDATE path.

### mirror_holidays (Phase 5.4 — replaces 5.3 hardcoded constant)
- `id`, `name` (text), `date` (date), `created_by` (uuid FK to users, nullable), `created_at`
- Index on `(date asc)`.
- Trigger: `activity_log_writer`.
- RLS: open SELECT for authenticated; admin INSERT/UPDATE/DELETE.
- Seeded from the prior `src/lib/calendar/holidays.ts` `MIRROR_HOLIDAYS` constant; the Calendar now reads via `useMirrorHolidays()` hook.

### vendors (renamed from `organizations` in Phase 5.2.3.B; canonical shape after the 5.2.3 split + 5.6.2 + 5.7.11 + 5.7.13 additions)

Holds rows that were on the unified `organizations` table pre-5.2.3 (with rows of `type = 'Client'` migrated out to the new `clients` table). Table rename preserved policies + indexes + OID-stable identifiers (some constraint names still read as `clients_*`); column-level identifiers are post-5.2.3.

- `id` (uuid, PK, default `gen_random_uuid()`)
- `name` (text, NOT NULL)
- `category_id` (uuid, FK to `vendor_categories.id` ON DELETE SET NULL, nullable). Phase 5.2.3.A.
- `subcategory_id` (uuid, FK to `vendor_subcategories.id` ON DELETE SET NULL, nullable). Phase 5.6.2 (`20260518100000_phase_5_6_2_vendor_subcategories_project_vendors.sql`). Partial btree index `vendors_subcategory_idx WHERE subcategory_id IS NOT NULL`. App-side rule: when `category_id` changes, the UI clears `subcategory_id` since the prior pick may not belong to the new parent.
- `capabilities` (text[], default `{}`). Free-text vendor capability tags. Phase 5.2.2 lineage.
- `city` (text, nullable). Phase 5.2.2.
- `primary_address` (text, nullable). Phase 5.2 cleanup (`20260516140000_phase_5_2_cleanup_primary_address_and_vendor_capabilities_grant.sql`).
- `website_url` (text, nullable). Phase 5.2.2.
- `general_email` (text, nullable). Phase 5.9.3.2 (`20260602160000_phase_5_9_3_2_vendors_general_email.sql`). Company-level general email, distinct from the primary contact's `contact_email`. Surfaced on VendorDetail ("General Email") + VendorEdit ("General Email" in the Details section) + the bulk importer's `general_email` column.
- `tags` (text[], default `{}`). Phase 5.2.2.
- `preferred` (bool, NOT NULL, default false). Phase 5.4 feedback round 2 (`20260516180000_phase_5_4_feedback_round_2.sql`). Partial index `vendors_preferred_idx WHERE preferred = true`. Drives the Wiki "Preferred Vendors" embed.
- `nationwide` (bool, NOT NULL, default false). Phase 5.9.3.1 (`20260602150000_phase_5_9_3_1_vendors_nationwide.sql`). Marks vendors who work nationwide; the VendorsList city filter OR-s in any `nationwide = true` vendor so they surface under every city chip (client-side, via the `applyFilters` `fieldMatchAll` hook). No index (read only by the client-side list filter, never server-side). Editable via the VendorEdit "Nationwide" checkbox + the bulk importer's `nationwide` true/false column.
- `contact_name`, `contact_email`, `contact_phone` (text, nullable). Shipped from initial schema; carried through the rename.
- `legacy_notes` (text, nullable). Renamed from `notes` in Phase 5.2.2. Internal Notes UI uses the polymorphic `notes_log` table instead; `legacy_notes` preserves any pre-rename content for a future backfill into notes_log.
- `bulk_import_session_id` (uuid, FK to `bulk_import_sessions(id)` ON UPDATE CASCADE ON DELETE SET NULL, nullable). Added Phase 5.9.3 (`20260602140000_phase_5_9_3_vendors_importer.sql`). Stamped on every vendor the `bulk_import_commit_vendors` RPC creates or updates. Powers the "Bulk Imported" presence filter chip on `/vendors`. Partial index `vendors_bulk_import_session_idx (bulk_import_session_id) WHERE bulk_import_session_id IS NOT NULL`.
- `created_by` (uuid, FK to `users.id`)
- `created_at`, `updated_at` (timestamptz)
- Indexes: `vendors_city_idx (city) WHERE city IS NOT NULL` (renamed via OID from `organizations_city_idx`); `vendors_subcategory_idx` (5.6.2); `vendors_preferred_idx WHERE preferred = true` (5.4 fb r2); `vendors_bulk_import_session_idx (bulk_import_session_id) WHERE bulk_import_session_id IS NOT NULL` (5.9.3). The legacy `organizations_type_idx (type)` was dropped in 5.2.3.B alongside the `type` column.
- Triggers: `trg_activity_log_vendors` (AFTER INSERT/UPDATE/DELETE → activity_log via `activity_log_writer`; OID-renamed from `trg_activity_log_organizations`); `trg_vendors_updated_at`.
- RLS: SELECT/INSERT/UPDATE open to authenticated; DELETE admin-only via `is_admin()`. Underlying identifiers stay `clients_*` because the rename preserved policies by table OID.
- GRANTs: SELECT/INSERT/UPDATE/DELETE to authenticated; ALL to service_role.
- Internal Notes: surfaced via the shared `notes_log` table with `parent_type = 'vendor'` (renamed from `'organization'` in 5.2.3.D).

**Vendor lookup tables** (Phase 5.2.3.A + 5.6.2):
- `vendor_categories` (5.2.3.A): id, name, created_at. Lookup for the top-level vendor category.
- `vendor_subcategories` (5.6.2): id, name, `parent_category_id` (uuid FK to `vendor_categories` ON DELETE CASCADE), created_by (FK to users ON DELETE SET NULL), created_at. UNIQUE `(parent_category_id, name)`. Index `vendor_subcategories_parent_idx (parent_category_id)`. RLS open SELECT/INSERT/UPDATE for authenticated; admin-only DELETE. Inline-add from VendorEdit Subcategory typeahead writes here with `parent_category_id` set to the current Category selection.
- `vendor_capabilities` (renamed from `org_capabilities` in 5.2.3.A): id, name, created_at. Backs the multi-select `vendors.capabilities` text[] column. Phase 5.2 cleanup extended GRANT to authenticated to include DELETE so the admin-only DELETE RLS policy is reachable.

**Phase 5.11.3 lookup tables** (`20260603120000_phase_5_11_3_project_tags_venue_features_lookups.sql`):
- `project_tags`: id, name, created_by (FK to users), created_at. UNIQUE `LOWER(name)`. Backs the multi-select `projects.tags` text[] column. Same open-authenticated SELECT/INSERT/UPDATE + admin-only DELETE posture as `vendor_capabilities`. Backfilled from distinct existing values across `projects.tags` (lowest-created_at project's created_by as attribution).
- `venue_features`: id, name, created_by (FK to users), created_at. UNIQUE `LOWER(name)`. Backs the multi-select `venues.features` text[] column. Same RLS posture. Backfilled from distinct existing values across `venues.features`.

**Vendor child tables** (auxiliary; no activity-log triggers, all match the `project_vendors` posture):
- `project_vendors` (Phase 5.6.2): PK `(project_id, vendor_id)`, both FKs ON DELETE CASCADE; created_by FK to users ON DELETE SET NULL; created_at. Index `project_vendors_vendor_idx (vendor_id)`. RLS open SELECT/INSERT/UPDATE/DELETE for authenticated. Surfaced read paths: VendorsList Projects column, VendorDetail Projects section, VendorEdit Projects section; write path: ProjectEdit Vendors picker (diff-on-save).
- `vendor_files` (Phase 5.7.11, `20260527100000_phase_5_7_11_vendor_files.sql`): id (uuid, PK), vendor_id (FK ON DELETE CASCADE), title (text NOT NULL), url (text NOT NULL), created_by (FK to users ON DELETE SET NULL), created_at. Index `vendor_files_vendor_idx (vendor_id, created_at DESC)`. RLS: open-authenticated SELECT/INSERT/DELETE; no UPDATE policy (delete + re-add only). Any URL accepted (no format validation; producers paste Drive, Dropbox, Figma, vendor websites). Surfaced: VendorDetail Files & Assets card + VendorEdit Files & Assets section (gated on `!isCreate`).
- `vendor_ratings` (Phase 5.7.13, `20260529100000_phase_5_7_13_vendor_ratings.sql`): vendor_id (FK ON DELETE CASCADE), user_id (FK ON DELETE CASCADE), rating (int, CHECK BETWEEN 1 AND 5), created_at, updated_at. Composite PK `(vendor_id, user_id)`; UPSERT for re-rating. Index `vendor_ratings_vendor_idx`. RLS: open-authenticated SELECT (aggregate needs cross-user reads); self-only INSERT/UPDATE/DELETE via `user_id = auth.uid()`. `trg_vendor_ratings_updated_at` trigger. Replaces the admin-curated `vendors.internal_rating` column dropped in `20260529110000_phase_5_7_13_drop_vendors_internal_rating.sql` (backfill: non-null ratings written to vendor_ratings owned by `vendors.created_by`; rows with NULL `created_by` skipped). Surfaced: VendorDetail Team Rating card (aggregate + viewer's own), VendorsList Rating column (team aggregate, rounded to half-star), Preferred Vendors wiki embed.

### clients (Phase 5.2.3.A, new in this phase)

Created fresh in 5.2.3.A. Holds rows that were `type = 'Client'` on the legacy `organizations` table; UUIDs preserved during the split.

- `id` (uuid, PK, default `gen_random_uuid()`)
- `name` (text, NOT NULL)
- `industry` (text, nullable)
- `contact_name`, `contact_email`, `contact_phone` (text, nullable)
- `primary_address` (text, nullable)
- `city` (text, nullable)
- `website_url` (text, nullable)
- `tags` (text[], default `{}`)
- `created_by` (uuid, FK to `users.id`)
- `created_at`, `updated_at` (timestamptz)
- Triggers: `trg_clients_updated_at`, `trg_activity_log_clients`.
- RLS: SELECT/INSERT/UPDATE open to authenticated; DELETE admin-only.
- Internal Notes: shared `notes_log` with `parent_type = 'client'`.

### organizations table (DROPPED)

The unified `organizations` table that landed in Phase 5.2.2 was split into `vendors` (rename) + `clients` (new) in Phase 5.2.3 (migrations `20260516130000` through `20260516130004`). The `org_type` enum was dropped alongside. Downstream column renames:

- `projects.organization_id` → `projects.client_id` (FK now to clients)
- `people.organization_id` split into `people.client_id` + `people.vendor_id` (mutex CHECK via `people_affiliation_type_mutex_check`; `affiliations` enum array dropped)
- `notes_log.parent_type` CHECK widened from `('organization', 'person')` to `('client', 'vendor', 'person', 'venue', 'outlook_entry', 'task', 'deliverable', 'project')` over Phases 5.2.3.D + 5.2.2 + 5.6.4.1 + 5.7.2 + 5.7.3.followup-13
- `venues.exclusive_vendors_org_ids` renamed to `venues.exclusive_vendor_ids`

The pre-split unified-organizations shape is documented in `OUTPUTS/historical/phase-5-2-2-spec.md` for historical reference.

### projects
- `id` (uuid, PK)
- `name` (text, not null)
- `client_id` (uuid, FK to clients, nullable). Originally `client_id`, renamed to `organization_id` in Phase 5.2.2 alongside the clients -> organizations rename, then renamed back to `client_id` in Phase 5.2.3.B when organizations split into clients + vendors. The btree index follows the column name. `types.ts` is authoritative.
- `status` (enum `project_status`, 14 values, default `Queued`): `Approved`, `In Production`, `In Progress`, `Location Scouting`, `Install`, `Removal`, `Billing`, `Queued`, `Quoting`, `Quote Sent`, `Awaiting Feedback`, `On Hold`, `Complete`, `Cancelled`. Reshaped in Phase 5.2.1 (`20260515130000_phase_5_2_1_project_task_enum_reshape.sql`) from the 14-value shipped enum to the locked 14-value list per `OUTPUTS/phase-5-locked-decisions-2026-05-15.md` § 4. Backfill mapping: `Awaiting FB` -> `Awaiting Feedback`, `Awaiting Files` -> `In Progress` (catch-all), `Awaiting Approval` -> `Awaiting Feedback`, `Event Live` -> `In Production`, `Proof Out` -> `In Production` (catch-all), `In Review` -> `In Progress` (catch-all); other 8 values map to themselves.
- `job_number` (text, nullable). Surface 07 detail coral `#2604` job number. Added Phase 5.2.2 (`20260515140003_phase_5_2_2_project_extensions.sql`). Partial btree index `projects_job_number_idx WHERE job_number IS NOT NULL`.
- `category` (text, nullable). "Pop-Up" / "Window Install" / "Trade Show" etc. Added Phase 5.2.2.
- `city` (text, nullable). Surface 04 List view column. Added Phase 5.2.2.
- `tags` (text[], default `{}`). Surface 07 detail "Summer 2026 / CPG / Outdoor" tag chips. Added Phase 5.2.2.
- `budget` (numeric, nullable). Surface 07 detail + Surface 08 edit. Planning reference figure, NOT an invoice amount; never renders on pipeline-summary surfaces per locked-decisions Q6 + spec § 5.A.7. Added Phase 5.2.2.
- `install_dates_start`, `install_dates_end` (date, nullable). Added Phase 5.3 (`20260516150001_phase_5_3_projects_install_removal_dates.sql`). Drives Calendar Install banners + Project Timeline Install bar + Project Detail "Days Until Install" countdown.
- `live_dates_start`, `live_dates_end` (date, nullable)
- `removal_dates_start`, `removal_dates_end` (date, nullable). Added Phase 5.3. Drives Calendar Removal banners + Project Timeline Removal bar.
- `production_folder_url`, `design_decks_folder_url`, `budget_sheet_url`, `slack_channel_url` (text, all nullable). Surfaced as the Production / Design / Budget / Slack quick-link buttons on ProjectDetail + editable in ProjectEdit. (`latest_creative_deck_url` DROPPED Phase 5.9.2.2, migration `20260602130000_phase_5_9_2_2_drop_latest_creative_deck.sql` — it was never surfaced in any UI.)
- ~~`status_notes` / `client_notes` (text, nullable)~~ DROPPED Phase 5.7.14 (`20260530100000_phase_5_7_14_drop_projects_legacy_notes.sql`). `status_notes` UI was swapped to `notes_log` via shared `<InternalNotesEditor>` in Phase 5.7.3 (the column was kept on disk for a soak; columns were dead-data since); `client_notes` UI was removed in Phase 5.7.7. Status Notes content was backfilled into `notes_log` rows by migration `20260523100000`.
- `archived_at` (timestamptz, nullable; null = active, non-null = archived; default queries filter `archived_at IS NULL`)
- `created_by` (uuid, FK to users)
- `created_at`, `updated_at`
- `bulk_import_session_id` (uuid, FK to `bulk_import_sessions(id)` ON UPDATE CASCADE ON DELETE SET NULL, nullable). Added Phase 5.9.2 (`20260602110000_phase_5_9_2_projects_importer.sql`). Stamped on every project the `bulk_import_commit_projects` RPC creates or updates. Powers the "Bulk Imported" presence filter chip on `/projects`. Partial index `projects_bulk_import_session_idx (bulk_import_session_id) WHERE bulk_import_session_id IS NOT NULL`.
- Realtime: published via `supabase_realtime` publication with `REPLICA IDENTITY FULL` (Phase 5.2.1) so the Projects Board view subscribes to status changes via `postgres_changes`.

### project_account_managers (join, every project must have at least one row)
- `project_id`, `user_id` (PK composite)

### project_designers (join, optional)
- `project_id`, `user_id` (PK composite)

### project_members (join, optional general team bucket)
- `project_id` (FK to projects ON DELETE CASCADE), `user_id` (FK to users ON DELETE CASCADE), `created_by` (FK to users, ON DELETE SET NULL, nullable), `created_at`. PRIMARY KEY `(project_id, user_id)`. Index `project_members_user_idx (user_id)`.
- Added Phase 5.7.7 (`20260525100000_phase_5_7_7_project_members.sql`). Third roster bucket alongside `project_account_managers` + `project_designers` (per plan decision #4). No role column; bucket is "everyone else on the project" (producers, coordinators, etc.).
- RLS: open SELECT/INSERT/UPDATE/DELETE for authenticated. No activity-log trigger (roster join tables stay out of the feed; matches `project_account_managers` / `project_designers` / `project_vendors`).
- Notification routing parity with AM + D per Phase 5.7.7: `notifications_dispatch_writer` projects branch now unions AM + D + members for `project_status_changed`. `hq-cron-event-date-today` + `hq-cron-deliverable-due-3d` also union all three roster buckets.
- Surfaced read paths: ProjectDetail Team card (third loop + inline + Add picker + remove affordance), ProjectsList "Team" filter (key still `leadName` for saved-view back-compat; applyFn remaps to a derived `teamNames` row field across AM + D + members). Write paths: ProjectDetail Team card add/remove; ProjectEdit Team card diff-on-save (third RecordCombobox multi).

### project_venues (join, multi-venue per project)
- `project_id`, `venue_id` (PK composite)
- The Notion-style backlist on a Venue page queries this to show every project that's used or is using the venue.

### venues
- `id` (uuid, PK)
- `name` (text, not null), `address`, `neighborhood` (text). Phase 5.12.9: neighborhood is sourced from the `neighborhoods` lookup (parent-scoped under cities) via `<RecordCombobox source={{ kind: "lookup", table: "neighborhoods", parentScopeId: cityId, ... }}>` on VenueEdit + VenueDetail. Column type stays text per the cities precedent; the lookup is the typeahead + admin curation source, no FK on the consumer column.
- `city` (text, nullable). Added Phase 5.2.2 (`20260515140002_phase_5_2_2_venues_extensions.sql`). Partial btree index `venues_city_idx WHERE city IS NOT NULL`.
- `venue_slide_url` (text, nullable). Google Slides URL surfaced on Surface 09 detail as a "Venue Slide" button next to the Edit button. Added Phase 5.2.2.
- `total_sq_ft` (int, nullable). Added Phase 5.2.2 alongside the shipped `square_footage`; the two coexist for now (total_sq_ft surfaced as "Total Sq Ft" in the wireframe).
- `exclusive_vendor_ids` (uuid[], NOT NULL default `{}`). Vendor references for the "Exclusive Vendors" link list on Surface 09 detail. Added Phase 5.2.2 as `exclusive_vendors_org_ids`, renamed in Phase 5.2.3 (`20260516130004_phase_5_2_3_venues_exclusive_vendor_ids.sql`). Postgres cannot FK array elements; app validates entries reference valid vendors before write. Set only on the manual VenueEdit surface; the 5.9.4 bulk importer deliberately does NOT touch this column (so a dedupe-update can't clobber curated values).
- `capacity`, `square_footage` (int)
- `website_url`, `contact_name`, `contact_email`, `contact_phone` (text)
- `general_email` (text, nullable). Phase 5.9.7 (`20260602210000_phase_5_9_7_venue_event_day_rate_and_general_email.sql`). Company-level general email, distinct from any contact (mirrors `vendors.general_email`). Surfaced on VenueDetail ("General Email" row in Venue Details, hidden when empty) + VenueEdit ("General Email" in the Details section) + the bulk importer's `general_email` column, written through on both the RPC create + update paths.
- `features` (text[])
- `about_venue` (text). Free-form About Venue body on Surface 09 detail. Renamed from `notes` in Phase 5.10.0 (`20260603100000_phase_5_10_0_venue_about_venue_and_generator.sql`) for clarity (the `notes` name collided with the polymorphic `notes_log` Internal Notes table). OID-preserving RENAME COLUMN; the AI "Generate / Regenerate About Paragraph" button (VenueDetail + VenueEdit) writes this column via the `hq-generate-venue-about` edge function.
- `photos` (text[]; Supabase Storage paths)
- `created_by` (uuid, FK)
- `created_at`, `updated_at`
- `bulk_import_session_id` (uuid, FK to `bulk_import_sessions(id)` ON UPDATE CASCADE ON DELETE SET NULL, nullable). Added Phase 5.9.4 (`20260602180000_phase_5_9_4_venues_importer.sql`). Stamped on every venue the `bulk_import_commit_venues` RPC creates or updates. Powers the "Bulk Imported" presence filter chip on `/venues`. Partial index `venues_bulk_import_session_idx (bulk_import_session_id) WHERE bulk_import_session_id IS NOT NULL`.
- Note: the shipped single `venue_type_id` FK was dropped in Phase 5.2.2 in favor of the `venue_venue_types` join table.

### venue_venue_types (Phase 5.2.2)
Multi-select venue-type join table. Replaces the single `venues.venue_type_id` FK.

- `venue_id` (uuid, FK to venues, ON DELETE CASCADE)
- `venue_type_id` (uuid, FK to venue_types, ON DELETE CASCADE)
- Composite PK on `(venue_id, venue_type_id)`.
- Indexes: `venue_venue_types_venue_idx (venue_id)`, `venue_venue_types_type_idx (venue_type_id)`.
- RLS: open-authenticated on SELECT/INSERT/UPDATE/DELETE (matches the shipped join-table convention).
- Backfill: every shipped `venues.venue_type_id` value migrated as a single `(venue_id, venue_type_id)` row before the column drop.

### venue_rate_history (Phase 5.2.2)
Append-only history of Event Day Rate + Prod Day Rate per venue. The Surface 09 detail page reads the most-recent row per `(venue_id, rate_kind)` for the "Event Day Rate $X as of <date>" display.

- `id` (uuid, PK, default `gen_random_uuid()`)
- `venue_id` (uuid, FK to venues, ON DELETE CASCADE)
- `rate_kind` (enum `venue_rate_kind`): `event_day`, `prod_day`.
- `amount_usd` (int). Whole dollars; reference rate for producers, NOT an invoice amount (stays compatible with locked-decisions Q6).
- `effective_from` (date, default `current_date`)
- `created_by` (uuid, FK to users)
- `created_at` (timestamptz, default `now()`)
- Index: `venue_rate_history_lookup_idx (venue_id, rate_kind, effective_from DESC)`.
- RLS: SELECT + INSERT open to authenticated; NO UPDATE policy, NO DELETE policy (append-only history; corrections happen via a new history row).
- Grants: SELECT, INSERT to authenticated; ALL to service_role.
- Phase 5.9.7 (`20260602210000`): the venue bulk importer now seeds an `event_day` row per imported venue (`effective_from = current_date`, `created_by = actor`), but only when the imported amount differs from the venue's current most-recent `event_day` rate. A repeat import with an unchanged rate writes no row (the no-op keeps the append-only history from accumulating duplicates). `prod_day` is not importable. Counted in the session's `created_refs.venue_rates`.

### venue_types (lookup; runtime canonical set, admin-curated)
- `id` (uuid, PK, default `gen_random_uuid()`), `name` (text, not null), `created_at` (timestamptz, default `now()`).
- Case-insensitive unique via `venue_types_name_lower_unique_idx ON LOWER(name)` (Phase 5.12.10; mirrors the cities pattern from Phase 5.2.2; replaces the previous case-sensitive `venue_types_name_key` column-level constraint). The expression index cannot be targeted via supabase-js `onConflict`; race-safe inserts use `ON CONFLICT DO NOTHING` (no target) and re-read case-insensitively on swallowed conflicts.
- Runtime canonical set; admin-curated via Settings -> Lookup Lists. Every VS write path consults `public.venue_types` at request time so producer adds in HQ Settings flow through automatically (Phase 5.12.10). Frontend reads via `useVenueTypes()` (thin wrapper over `useLookup("venue_types")`); five edge functions (`vs-research-venues`, `vs-compile-summaries`, `vs-generate-deck`, `vs-parse-brief`, `vs-research-single-venue`) call `getVenueTypesCanonicalSet(sb, callerPrefix)` once per request to load `{ names, idByName }`.
- The 9 legacy palette keys (Retail, Event Venue, White Box, Industrial, Warehouse, Gallery, Studio, Outdoor, Mobile) are backfilled via Phase 5.12.10's migration to guarantee day-1 coverage of the existing `TYPE_STYLES` palette in the frontend; producer-added types render via `TYPE_FALLBACK_STYLE` (neutral grey) and existing rows in `venue_venue_types` reference them via FK.
- `bulk_import_commit_venues` was rewritten in Phase 5.10.0 then again in Phase 5.12.10 (alongside the constraint swap) to use `ON CONFLICT DO NOTHING` (no target) on the venue_types insert plus a case-insensitive race re-read so a race-loser inserting "retail" while "Retail" wins still resolves the winner's id.

### cities (Phase 5.2.2 lookup)
- `id` (uuid, PK, default `gen_random_uuid()`), `name` (text, NOT NULL), `created_by` (uuid, FK to users, NOT NULL), `created_at` (timestamptz).
- Unique index on `LOWER(name)` (`cities_name_unique_idx`); case-variant duplicates are blocked at the DB level. The expression index cannot be targeted via supabase-js `onConflict` — race-safe inserts catch Postgres 23505 and re-read.
- RLS: open SELECT / INSERT / UPDATE to authenticated; DELETE restricted to admin (`is_admin()`).
- Surfaces: `vendors.city` + `venues.city` + `projects.city` + `vs_scouts.city` + `clients.city` all reference the canonical `name` (text columns, not FKs; the lookup drives the picker and admin Settings curation only).
- Auto-created from: bulk-import RPCs (`bulk_import_commit_projects` / `bulk_import_commit_vendors` / `bulk_import_commit_venues`); `vs-parse-brief` on a novel parsed city in a brief PDF (Phase 5.12.2; ALWAYS uses the state-stripped value so the lookup never accumulates alias-style strings like "City, ST"); producer inline-add via RecordCombobox MiniCreateModal on VenueEdit / ProjectEdit / BriefVenue / BriefReport (Phase 5.12.2 swaps).
- Reads: `vs-parse-brief`'s `resolveOrCreateCity` consults `city_aliases` BEFORE the direct cities lookup so polluting alias-style rows can't short-circuit canonicalization. Frontend `LookupCombobox` surfaces aliases inline via the `useCityAliases` hook when `source.table === 'cities'`.

### city_aliases (Phase 5.12.2 lookup)
- `id` (uuid, PK, default `gen_random_uuid()`), `alias` (text, NOT NULL), `city_id` (uuid, FK to `cities.id` ON DELETE CASCADE, NOT NULL), `created_by` (uuid, FK to `users.id` ON DELETE SET NULL, nullable), `created_at` (timestamptz).
- Unique index on `LOWER(alias)` (`city_aliases_alias_unique_idx`); duplicate aliases across canonical cities are blocked. btree index on `city_id` (`city_aliases_city_id_idx`) for reverse joins.
- RLS: open SELECT / INSERT / UPDATE to authenticated; DELETE restricted to admin (`is_admin()`). GRANT SELECT/INSERT/UPDATE to authenticated, ALL to service_role.
- Seeded (migration `20260603190000`): "Los Angeles" -> LA, "Los Angeles, CA" -> LA, "New York" -> NYC, "New York City" -> NYC. `created_by` NULL on the seed row (no specific producer triggered them).
- Consumers: (a) `vs-parse-brief.resolveOrCreateCity` — alias-first lookup ladder (alias-on-trimmed -> alias-on-stripped -> cities-on-trimmed -> cities-on-stripped -> insert using stripped value); (b) frontend `LookupCombobox` via `useCityAliases` — renders aliases as a read-only "Aliases" CommandGroup below canonical options when `source.table === 'cities'`. Aliases never enter the form value display map, so a `value = "LA"` always renders as "LA" regardless of which alias triggered the selection.
- Admin curation: SQL-only today. A Settings -> Lookup Lists card extension to paired-input (alias, target city) shape is a carry-forward sub-phase.

### neighborhoods (Phase 5.12.9 lookup)
- `id` (uuid, PK, default `gen_random_uuid()`), `name` (text, NOT NULL), `city_id` (uuid, FK to `cities.id` ON DELETE CASCADE, NOT NULL), `created_by` (uuid, FK to `users.id` ON DELETE SET NULL, nullable), `created_at` (timestamptz).
- Unique index on `(city_id, LOWER(name))` (`neighborhoods_city_name_unique_idx`); per-city case-insensitive uniqueness. Same neighborhood name is allowed under different cities. The expression index cannot be targeted via supabase-js `onConflict` — race-safe inserts catch Postgres 23505 and re-read.
- btree index on `city_id` (`neighborhoods_city_id_idx`) for reverse joins from city-scoped reads + ON DELETE CASCADE.
- RLS: open SELECT / INSERT / UPDATE to authenticated; DELETE restricted to admin (`is_admin()`). GRANT SELECT/INSERT/UPDATE/DELETE to authenticated, ALL to service_role.
- Shape mirrors `vendor_subcategories` (Phase 5.6.2) with `city_id` as the parent FK instead of `parent_category_id`. The `useLookup` hook's `PARENT_COLUMN_BY_TABLE` map (extended in 5.12.9) resolves the per-table parent column so a single hook serves both tables.
- Surfaces: `venues.neighborhood` + `vs_candidate_venues.neighborhood` + `vs_scouts.brief_data.target_neighborhoods` all reference the canonical `name` (text columns / text[] array, not FKs; the lookup drives the picker + admin Settings curation only — same posture as cities).
- Backfill (migration `20260606000000`): seeds distinct `(city, neighborhood)` pairs scraped from three sources at apply time — (A) HQ `venues` rows with both city + neighborhood populated, (B) `vs_candidate_venues` rows joined to their parent `vs_scouts.city`, (C) every element of `vs_scouts.brief_data.target_neighborhoods` arrays joined to the parent scout's city. City resolution is case-insensitive against the `cities` lookup; rows missing a resolvable city are skipped. `ON CONFLICT DO NOTHING` makes the backfill idempotent.
- Auto-created from: producer inline-add via RecordCombobox MiniCreateModal on VenueEdit / VenueDetail / BriefVenue / BriefReport / Review / SourcingReport / Shortlist / DeckPrep (Phase 5.12.9 swaps). NOT auto-created by edge functions today (`vs-research-venues` / `vs-research-single-venue` / `vs-compile-summaries` / `vs-parse-brief` still write free-text neighborhood strings; canonicalizing AI-written values against the lookup is a carry-forward to 5.12.13 prompt audit).
- Admin curation: Settings page renders a dedicated `<NeighborhoodsLookupEditor>` card (parent-scoped, native `<details>` per city; doesn't fit the flat `OTHER_LOOKUPS` row table that `LookupListEditor` drives).

### people (Phase 5.2.2)
External humans (Client / Vendor / Internal partners / Venue contacts). Internal Mirror staff stay in `public.users` and surface on the Team page (Surface 12, lands 5.4).

- `id` (uuid, PK, default `gen_random_uuid()`)
- `full_name` (text, not null)
- `affiliations` (enum array `person_affiliation[]`, default `{}`): `Client`, `Vendor`, `Internal`, `Venue`. Multi-affiliation per build notes Surface 11 (e.g. "Dana Whitfield" can carry Client + Venue tags). GIN-indexed for the Affiliation filter chip. **DROPPED in Phase 5.2.3.C** alongside the `person_affiliation` enum (locked Q4: at most one org type per person; FK presence resolves type).
- `affiliation_type` (enum `person_affiliation_type`, NOT NULL, default `'Unaffiliated'`): `Client`, `Vendor`, `Venue`, `Unaffiliated`. **Added in Phase 5.6.3** (`20260518110000_phase_5_6_3_people_affiliation_type.sql`) so inline edit on PersonDetail can clear an Organization FK without flipping the displayed type. Backfilled from FK presence + `venue_contact_people` rows. Mutex CHECK `people_affiliation_type_mutex_check`: Client→vendor_id null, Vendor→client_id null, Venue/Unaffiliated→both FKs null. `personType()` helper in `src/lib/people/queries.ts` reads this column (with FK-derivation fallback for safety). PersonEdit writes `affiliation_type` explicitly on save.
- `organization_id` (uuid, FK to organizations, nullable, ON DELETE SET NULL). Not every person ties to an org (Venue contacts may not).
- `venue_id` (uuid, FK to venues, nullable, ON DELETE SET NULL). Nullable per spec Q8 recommendation. Surface 09 Contacts card pulls `WHERE 'Venue' = ANY(affiliations) AND venue_id = ?`. Added in the 5.2.2.C migration alongside the venues extensions so it can reference venues after the table exists.
- `role_title` (text), `email` (text), `phone` (text), `linkedin_url` (text)
- `tags` (text[], default `{}`)
- `created_by` (uuid, FK to users, NOT NULL, default ON DELETE RESTRICT)
- `created_at`, `updated_at`
- Indexes: `people_org_idx (organization_id) WHERE organization_id IS NOT NULL`, `people_affiliation_gin_idx (GIN affiliations)`, `people_full_name_idx (lower(full_name))`, `people_venue_idx (venue_id) WHERE venue_id IS NOT NULL`.
- Triggers: `trg_people_updated_at`, `trg_activity_log_people` (AFTER INSERT/UPDATE/DELETE).
- RLS: open-authenticated on SELECT/INSERT/UPDATE/DELETE (matches HQ Core convention).
- Internal Notes: surfaced via the shared `notes_log` table with `parent_type = 'person'`.

### tasks
- `id` (uuid, PK)
- `title` (text, not null), `description` (text)
- `project_id` (uuid, FK, nullable for personal tasks)
- `assignee_id` (uuid, FK to users, nullable)
- `created_by` (uuid, FK to users, not null)
- `status` (enum `task_status`, 4 values, default `To Do`): `To Do`, `Doing`, `Blocked`, `Done`. Reshaped in Phase 5.2.1 from the lowercase shipped enum (`todo` / `in_progress` / `blocked` / `done`) per `OUTPUTS/phase-5-locked-decisions-2026-05-15.md` § 4. `tasks_completed_at_set` trigger function was `CREATE OR REPLACE`'d in the same migration to compare against the new `Done` literal.
- `priority` (text, default `Normal`, CHECK in `Urgent` / `High` / `Normal` / `Low`). Added in Phase 5.2.1 (`20260515130003_phase_5_2_1_tasks_priority_blocks.sql`) to back the Surface 13 Priority pill.
- `blocked_by` (uuid[] of task ids, default `{}`, GIN-indexed). Added in Phase 5.2.1; surfaces the Surface 13 "Notes / Blocks" cell. Postgres can't FK-enforce array elements; the app validates that entries reference valid task ids before write.
- `due_date` (date, nullable)
- `created_at`, `updated_at`, `completed_at`
- Realtime: published via `supabase_realtime` publication with `REPLICA IDENTITY FULL` (Phase 5.2.1) so the Tasks Board view subscribes to status changes via `postgres_changes`.

## Talent Scout (siloed from HQ)

Source of truth for the user-facing flow is Jimmie's screen-by-screen spec (he can paste on request) and the Phase 3 sub-phase entries in `docs/decisions.md`.

### ts_roles
- `id`, `title`, `location`, `type`, `compensation`, `start_date`, `job_description`, `hiring_priorities`
- `hiring_manager_id` (FK to users; must be admin, enforced in app)
- `scorecard` (jsonb: array of `{criterion, tier, weight, max_points}`)
- `evaluation_prompt` (text, editable per role)
- `competitor_bonus` (jsonb: `{competitors: [], bonus_points: 0}`)
- `email_keywords` (text[]), `email_search_start_date` (date)
- `auto_pull_schedule` (enum: `off`, `daily`, `every_3_days`, `weekly`)
- `auto_rejection_threshold` (int)
- `status` (enum: `open`, `closed`), `closed_at` (timestamptz)
- `reeval_status` (enum: `idle`, `running`, `complete`, `failed`), `reeval_status_filter` (text)
- `reeval_total`, `reeval_processed`, `reeval_failed` (int): per-run counters for `ts-bulk-reevaluate`.
- `reeval_started_at`, `reeval_completed_at`, `reeval_last_progress_at` (timestamptz): bulk re-eval timestamps. `reeval_last_progress_at` is the heartbeat the re-eval watchdog (Phase 3.7) reads to detect stalled runs.
- `created_by` (FK), `created_at`, `updated_at`
- Daily cron purges where `closed_at` > 60 days ago, cascading.

### ts_pull_rounds
- `id`, `role_id` (FK)
- `pulled_from`, `pulled_to` (timestamptz; may be incremental)
- `status` (enum: `running`, `complete`, `failed`, `stalled`)
- `triggered_by` (enum: `manual`, `scheduled`)
- `started_at`, `completed_at`, `created_by` (FK)
- `round_number` (int): `R1`, `R2`, ... per role. Set at insert time as `max(round_number) + 1` for the role.
- `candidates_found`, `processed_count`, `attempt` (int): operational counters used by progress UI and watchdog.
- `pending_candidates` (jsonb, default `[]`): queue of Gmail message IDs the chunked pull pipeline batches in groups of 8 across self-invocations.
- `packet_url` (text, nullable): Storage path for the most recent round packet PDF.
- `packet_top_n` (int), `packet_include_fast_track` (bool), `packet_generated_at` (timestamptz): metadata for the most recent packet generation. Updated by `ts-packet-generate` on success.
- Realtime: published via `supabase_realtime` publication with `REPLICA IDENTITY FULL` so PullDetail's `postgres_changes` UPDATE subscription receives the full new row.

### ts_evaluations (history table; one row per evaluation)
- `id` (uuid, PK)
- `role_id` (FK to ts_roles), `candidate_id` (FK to ts_candidates)
- `scorecard_snapshot` (jsonb, not null): role.scorecard at evaluation time.
- `eval_prompt_snapshot` (text, not null): role.evaluation_prompt at evaluation time.
- `score` (numeric), `score_breakdown` (jsonb)
- `recruiter_overview` (text), `top_strengths` (jsonb), `key_gaps` (jsonb)
- `tier` (text), `internal_notes_at_time` (text)
- `evaluated_at` (timestamptz), `triggered_by` (FK to users)
- Index on `(candidate_id, evaluated_at DESC)` for the candidate-detail timeline.
- INSERT-only by default. Bulk re-eval is the one exception; it deletes prior rows for the candidate before inserting via the `overwrite_history: true` flag on `ts-evaluate-candidate`. See `docs/decisions.md` for why.

### ts_candidates
- `id`, `pull_round_id` (FK), `role_id` (FK; denormalized)
- `name`, `email` (text), `applied_date` (date), `gmail_message_id` (text)
- `location` (text, nullable): extracted by Claude from candidate materials, persisted on initial pull / re-eval.
- `score` (numeric)
- `status` (enum: `consider`, `interview`, `reject`, `fast_track`, `auto_rejected`). `interview` was renamed from the original spec's `promote` in Phase 3.5. `auto_rejected` is **deprecated** since Phase 3.7.2.1 (backfilled to `reject` + `manually_reviewed=false` and never written by new code; the enum value is kept for safety). Admins pick the four manual statuses via `StatusDropdown` or the bulk action bar.
- `manually_reviewed` (bool, default false; Phase 3.7.2): one-way flip from auto → manual. AI eval / re-eval leaves it false; user actions flip it to true (status-dropdown change or re-select-same, click on the AUTO pill, bulk action). When true, single + bulk re-eval update score / breakdown / strengths / gaps / overview but do NOT touch status. Bulk re-eval's default `not_manually_rejected` filter is `status.neq.reject,manually_reviewed.eq.false`.
- `is_referral` (bool, default false; Phase 3.7.7), `referrer_email` (text, nullable; Phase 3.7.7): set by `ts-pull-candidates` when a `*@mirrornyc.com` manager forwards a candidate to jobs@. Identity on the row stays the original applicant's; `referrer_email` captures the outermost forwarder. Eval is blind to referral status.
- `recruiter_overview` (text)
- `top_strengths`, `key_gaps`, `quick_overview` (jsonb arrays)
- `score_breakdown` (jsonb): `{criterion_name: int}`. Sum of values + competitor bonus = total score.
- `tier` (text)
- `internal_notes` (text): hand-edited on CandidateDetail and pre-populated on referral ingestion when a Mirror manager forwarded with commentary. Phase 3.7.8.16's `extractManagerNote` walks every forward-chain segment and captures every `@mirrornyc.com` sender's commentary (Mirror sigs stripped via the bolded-name + brand-marker heuristic; "from-mobile" sigs stripped via signature-only filter). Folded into the FIRST evaluation via the `HIRING MANAGER NOTES:` block, and re-folded on every re-eval.
- `portfolio_type` (enum: `file`, `url`, `none`), `portfolio_path_or_url` (text). `mirrornyc.com` is in `BLOCKED_PORTFOLIO_DOMAINS` (Phase 3.7.8.15) so manager email-signature URLs never become portfolio URLs.
- `detected_links` (jsonb, default `[]`): array of `{url, type}` for every URL extracted from email body + attachments + bare-domain mentions, classified into `vimeo_reel | drive_folder | portfolio_site | other`. Surfaced in CandidateDetail's Files & Materials section.
- `email_body_text` (text, nullable; Phase 3.6): plain-text application email body, trimmed at 30k chars. Populated by `ts-pull-candidates`. Used by `ts-packet-generate` / `ts-final-review-packet` to render each candidate's email page inside the packet PDF; pages are skipped when this column is null (pre-3.6 candidates).
- `last_evaluated_at`, `created_at`, `updated_at`

### ts_candidate_attachments
- `id`, `candidate_id` (FK)
- `attachment_type` (enum: `resume`, `cover_letter`, `portfolio`, `email_pdf`, `other`)
- `file_name`, `file_path` (text; Storage path under `candidate_attachments` bucket), `file_size_bytes` (int), `created_at`
- Daily cron: purge files for closed-role candidates > 90 days, rejected-candidate files > 30 days.

### ts_final_reviews
- `id`, `role_id` (FK), `candidate_count_limit` (int, nullable)
- `status` (enum `ts_final_review_status`: `generating`, `complete`, `failed`; default `generating`)
- `step_progress` (jsonb): drives FinalReviewLoading's 3-step list. Keys: `aggregate`, `build`, `rank`. Each value: `{status: pending|active|done, count?, label?}`.
- `candidate_count` (int): resolved Master Pool size at generation time.
- `pool_summary` (text)
- `final_rankings` (jsonb): `[{candidate_id, final_rank, final_tier, rationale, recruiter_note, final_overview}]` where `final_overview` is a `string[]` of 4-6 short headlines per candidate. See `docs/decisions.md` § Phase 3.6.
- `duration_seconds` (int): wall-clock for the AI call. Surfaced in the history list.
- `error_message` (text), `error_log` (jsonb, default `[]`): set when `status = 'failed'`.
- `claude_raw_response` (jsonb, nullable): kept for debugging.
- `packet_url` (text, nullable), `packet_top_n` (int), `packet_include_fast_track` (bool), `packet_generated_at` (timestamptz): metadata for the most recent final-review packet. Updated by `ts-final-review-packet`.
- `triggered_by` (FK), `generated_at`
- Index on `(role_id, status, generated_at DESC)` for the FinalReviewDetail "load latest complete review" query and the history list.
- Realtime: published via `supabase_realtime` publication with `REPLICA IDENTITY FULL` so FinalReviewLoading's `postgres_changes` UPDATE subscription on `step_progress` receives the full new row.

## Venue Scout (linked to HQ)

Three-table schema landed in Phase 4.1-port (`20260512200000_phase_4_1_port_schema.sql`). Replaces the failed-attempt Phase 4 shape from main with the 1:1 port from `mirror-nyc-venue-scout-pro`. The earlier `vs_briefs`, `vs_sourcing_rounds`, and `vs_pitch_decks` tables were dropped per the Phase 4 port locked decisions (now captured in `docs/decisions.md` under "Phase 4 cutover + port plan locked decisions"):
- Single-round sourcing per scout (no `vs_sourcing_rounds`)
- Brief fields inline on `vs_scouts` (no `vs_briefs`)
- Deck history as `vs_scouts.generated_decks` jsonb array (no `vs_pitch_decks`)
- RLS open to all authenticated users (collaborative agency-wide workflow)

### vs_scouts
- `id` (uuid, PK), `name` (text, NOT NULL)
- Brief fields inline (the Phase 4 brief-inline-on-vs_scouts decision (docs/decisions.md "Phase 4 cutover + port plan locked decisions")):
  - `client_name`, `event_name`, `live_dates`, `city` (text)
  - `budget` (numeric)
  - `brief_data` (jsonb, default `{}`): flexible per-scout extras the producer surfaces from the uploaded brief PDF. Canonical keys (locked Phase 4.3-port): `expected_guest_count` (number; consumed by `vs-generate-deck` slide templating), `notes` (string; dumped verbatim into downstream research / compile prompts), `uploaded_files` (string[]; storage paths under `briefs` bucket, append-only, for audit / re-parse). Phase 4.5-port additional key: `research_started_at` (ISO timestamp string; set by `vs-research-venues` at kickoff for idempotency, see 90-second grace window in `docs/decisions.md`). Phase 4.7.2-port additional key: `compile_started_at` (ISO timestamp string; set by `vs-compile-summaries` at kickoff, same 90-second grace window pattern as research). Phase 4.8.2-port additional key: `deck_generation_started_at` (ISO timestamp string; set by `vs-generate-deck` at kickoff, same 90-second grace window). Phase 4 Revision pass 3 additional key: `overview_source_hash` (string; 16-char SHA-256 prefix over the 15 brief fields that drive the Event Overview prompt, written by `vs-generate-brief-overview` whenever it writes `event_overview`, read by Submit Brief in `BriefVenue.tsx` to decide whether the persisted overview is stale; machine metadata, no form field, rides in the `brief_data` passthrough alongside the `*_started_at` flags). **Phase 4 Revision - Intake** added the form-backed intake keys, all optional, hoisted into dedicated form fields by `src/lib/venue-scout/briefForm.ts`: `install_dates` (string), `strike_dates` (string), `activations_count` (number; slider, null = TBD so the key is dropped), `objectives` (string[]), `target_audience` (string[]; flipped from `string` to `string[]` in Phase 5.12.5, tag-array shape matching `objectives` / `target_neighborhoods` / `venue_types` / `ideal_features`; data backfill migration `20260605000000_phase_5_12_5_brief_data_shape_backfill.sql` normalizes any legacy string row to single-element-array shape), `vibe_aesthetic` (string[]; same Phase 5.12.5 shape flip + same backfill), `target_neighborhoods` (string[]; Phase 5.12.9 sources values from the `neighborhoods` lookup parent-scoped to `vs_scouts.city` via `<RecordCombobox multi>` on BriefVenue + BriefReport — stored values are still option-name strings, the lookup is the typeahead + curation source), `strict_neighborhoods_only` (boolean; always written, false is meaningful), `venue_types` (string[]; arbitrary strings, chip multi-select), `sq_ft_min` / `sq_ft_max` / `sq_ft_minimum` (number; sliders, null = any so the key is dropped), `ideal_features` (string[]), `priority_location` (`'high_foot_traffic' | 'intimate_destination'`), `priority_cost` (`'lower_cost' | 'premium'`). `toUpdate` drops keys whose form field is empty / empty-array / null. The retired `notes` key is no longer written by new scouts but is preserved untouched on existing scouts (backward compat). `vs-research-venues` Phase B + `vs-generate-brief-overview` read these keys; downstream prompts stringify the entire jsonb so any key the producer adds gets seen by the AI.
  - `event_overview` (text): the persisted Event Overview block. **Phase 4 Revision - Intake:** generated by `vs-generate-brief-overview`, then inline-editable. **Pass 3:** the generation trigger is the Submit Brief click in `BriefVenue.tsx`, hash-gated on `brief_data.overview_source_hash` (regenerate only when the overview-driving brief fields changed since the last generation); the report's empty-state Generate button + Regenerate link re-invoke manually. Top-level column (not nested in `brief_data`) because downstream prompts (`vs-research-venues`, `vs-compile-summaries`) stringify it directly.
- `current_step` (text, NOT NULL, default `brief`, CHECK in 10 values: `brief`, `sheet_prompt`, `sheet_upload`, `researching`, `sourcing_report`, `shortlist`, `review_selects`, `compiling`, `deck_prep`, `completed`): workflow state machine per the Phase 4 current_step lock (docs/decisions.md). **Phase 4 Revision - Intake** (migration `20260514110000_phase_4_revision_intake_current_step.sql`) added the `brief` value (the in-flight 3-step intake) and flipped the new-row default from `sheet_prompt` to `brief`; existing rows are untouched. Step 3's Confirm & Continue flips `brief` -> `sheet_prompt`. Drives every page's continue logic via `stepToRoute()` (`src/lib/venue-scout/format.ts`, landed in Phase 4.2-port). Producer-facing label rendered via `currentStepToLabel()` in the same file (`brief` and `sheet_prompt` both render as "Brief" since Phase 4 Revision).
- `status` (text, NOT NULL, default `draft`): VS Pro carries this independent of `current_step`. Phase 4.5-port locks the AI-pipeline values: `draft` (initial) -> `in_progress` (research complete, in the AI funnel through deck generation) -> `complete` (Phase 4.8.2-port deck generated; first sub-phase that writes this value) or `failed` (any AI pipeline error). The Scout Index status pill reads from this column.
- `pipeline_error` (text, nullable, Phase 4.5-port; renamed from `research_error` in Phase 4.10.3-port): persisted error message from the most recent AI-pipeline run. NULL when no failure on the latest run. Originally `vs-research-venues`-only; Phase 4.7.2-port extends the same column to `vs-compile-summaries` failures (single AI-pipeline error channel per `docs/decisions.md` Phase 4.7.2-port). Phase 4.8.2-port extends again to `vs-generate-deck` failures with a structured `<CODE>: <message>` format (`CODE ∈ { AUTH_FAILED, TEMPLATE_COPY_FAILED, SLIDES_API_FAILED, NO_VENUES_INCLUDED, UNKNOWN }`) parsed by the Generating page to route to `/deck/error/<code>`. Phase 4.10.3-port renames the column from `research_error` to `pipeline_error` to match actual usage. The Researching page Realtime-subscribes to `vs_scouts` and on non-null `pipeline_error` with `status='failed'`, navigates to `/sourcing/error/research-timeout`. The Compiling page subscribes the same way and navigates to `/sourcing/error/compile-failed`. The Generating page subscribes the same way and parses the code for `/deck/error/<code>`. All three functions clear it at kickoff so a retry from a prior failure starts clean.
- `sheet_storage_path` (text, nullable): path under `sourcing_sheets` storage bucket
- `derived_columns` (jsonb, default `[]`): array of `{id, label, criteria}` alignment columns the AI selected for the single sourcing pass (collapsed onto the scout per § 8.1).
- `generated_decks` (jsonb, default `[]`, the Phase 4 deck-history-as-jsonb decision (docs/decisions.md)): deck history as array of `{deck_id, deck_name, version, generated_at, venue_count, slide_count, edit_url, embed_url}`. Replaces the separate `vs_pitch_decks` table.
- `deck_order` (jsonb, default `[]`): producer-controlled venue order for deck slides
- HQ-specific operational columns (no VS Pro analog):
  - `project_id` (uuid, FK to `projects`, nullable; standalone scouts allowed)
  - `archived_at` (timestamptz, nullable; null = active, non-null = archived)
  - `created_by`, `updated_by` (uuid, FK to users)
  - `last_touched_at` (timestamptz, NOT NULL, default `now()`): tracks meaningful user activity (sourcing kick-off, brief save, deck generated). Drives the Scout Index sort.
- `created_at`, `updated_at`
- Realtime: published via `supabase_realtime` publication with `REPLICA IDENTITY FULL` (the Phase 4 EdgeRuntime.waitUntil + Realtime decision (docs/decisions.md)) so the Researching / Compiling / Generating loading pages can subscribe to `current_step` changes via `postgres_changes`.

### vs_candidate_venues
Maps to VS Pro `venues` (renamed because HQ already has a `venues` table for the master venue list). VS Pro's `venue_notes` collapsed inline as `notes` per the Phase 4 venue_notes-inline decision (docs/decisions.md).

- `id` (uuid, PK)
- `scout_id` (uuid, FK to `vs_scouts`, ON DELETE CASCADE)
- `linked_venue_id` (uuid, FK to HQ `venues`, ON DELETE SET NULL): set by `vs-generate-deck` at the top of its work block on the Generate Deck click (Phase 5.12.0). The pre-5.12.0 `vs_candidate_venues_shortlist_sync` trigger that ran at shortlist time was retired; rows already linked by it keep their `linked_venue_id` and `vs-generate-deck` short-circuits the match cascade for those rows (still applies the `about_venue` write-when-blank check).
- `name` (text, NOT NULL), `neighborhood`, `address` (text). Phase 5.12.9: neighborhood is sourced from the `neighborhoods` lookup (parent-scoped to the parent scout's `vs_scouts.city`) via `<RecordCombobox source={{ kind: "lookup", table: "neighborhoods", parentScopeId: scoutCityId, ... }}>` on SourcingReport / Shortlist / Review / DeckPrep. Column stays text; lookup is the typeahead + curation source.
- `venue_type` (text): VS Pro stores `type`; renamed because `type` reads as a system word in TS / Postgres tooling
- `key_features` (text[], default `{}`)
- `website_url` (text)
- `size_sq_ft` (int), `capacity` (int)
- `derived_attrs` (jsonb, default `{}`)
- `recommendations`, `considerations` (text[], default `{}`): bullet lists from AI research
- `rank` (int, CHECK 0-100 or NULL): VS Pro stores `ranking_score`; renamed for parity with HQ Talent Scout's score naming
- `source` (text, NOT NULL, default `manual`, CHECK in `sheet`, `research`, `manual`, `hq_pool`): Phase 5.12.1 widened the CHECK to add `'hq_pool'`. Used by `vs-research-venues` for rows seeded from the master HQ `venues` table during the request handler (before Phase B kickoff). hq_pool rows insert with `linked_venue_id` already set + `venue_overview` pre-filled from `venues.about_venue`; `vs-compile-summaries` Pass 1 skips them (canonical HQ data), Pass 2 skips when the overview is non-empty.
- `shortlisted`, `pitched` (bool, default false), `include_in_deck` (bool, default true)
- `venue_overview` (text): AI-generated venue summary written by `vs-compile-summaries` (Phase 4.7-port)
- `notes` (text): inlined from VS Pro `venue_notes`. Free-text matrix notes
- `pitch_notes` (text): pitch-context notes from Shortlist
- `dedupe_meta` (jsonb, nullable). Phase 5.12.3 (migration `20260603220000_phase_5_12_3_vs_candidate_venues_dedupe_meta.sql`). Scoring breakdown captured at `vs-generate-deck.pushVenuesToHq` match time. Shape: `{ matched_venue_id, matched_venue_name, score: { name, address, website, city, total, threshold }, reason, matched_at }`. Read by the matrix `DedupeMetaIndicator` Popover (Shortlist + SourcingReport + DeckPrep) for producer-visible merge explainability. NULL on `hq_pool` rows (linked at insert time; no dedupe round), on pre-linked candidates that skipped the new ladder (else branch in pushVenuesToHq), and on any candidate that never merged (fresh-INSERT no-match path or no match cleared the threshold). No backfill: pre-5.12.3 matches ran the strict cascade and the scoring decomposition isn't reconstructible.
- `created_at`, `updated_at`

**Sync rule (Phase 5.12.0; pre-5.12.0 trigger retired; Phase 5.12.3 points-based ladder + `dedupe_meta` write):** on the Generate Deck click, `vs-generate-deck` loops the pitched + include_in_deck candidates and runs the shared `_shared/venueDedupe.ts` ladder against HQ `venues`. **Phase 5.12.3:** the ladder is now points-based scoring across name (60/25/0) + address (50/20/0) + website (40/20/0) + city (+10 conditional); threshold 60 (`>=` merges); cross-field VETO preserved on name FULL + (city differ OR address differ) when both sides carry those fields. Match: write `linked_venue_id` AND `dedupe_meta` (jsonb scoring breakdown per the column entry above) in a single UPDATE + UPDATE `venues.about_venue` only when blank (producer edits preserved). `dedupe_meta` is written ONLY on a FRESH ladder-resolved match; NOT on pre-linked candidates (else branch skips the ladder), NOT on hq_pool rows (linked at insert time; never reach this path), NOT on fresh-INSERT no-match rows (no match round happened). No match: INSERT a `venues` row carrying name + address + neighborhood + city (from scout) + website_url + features + total_sq_ft + capacity + about_venue (from the producer-reviewed `venue_overview`) + created_by (from scout), plus per-token `venue_venue_types` join inserts. Per-venue link or insert failure fails the deck via the `HQ_PUSH_FAILED` error code; `venue_venue_types` join failures are decorative and warn-and-continue. The pre-5.12.0 `vs_candidate_venues_shortlist_sync` shortlist-time trigger that did the prior simplified version (website-first, then case-insensitive name + neighborhood, carrying only name/address/neighborhood/website/features and never the overview) was dropped in migration `20260603140000_phase_5_12_0_drop_shortlist_sync_trigger.sql`.

### vs_venue_photos
Lifted from VS Pro with HQ rename. ON DELETE CASCADE so a Start Over (which deletes all candidate venues for a scout) cleans photos automatically.

- `id` (uuid, PK)
- `candidate_venue_id` (uuid, FK to `vs_candidate_venues`, ON DELETE CASCADE)
- `slot` (int, NOT NULL, CHECK BETWEEN 1 AND 4): `1 = top_left`, `2 = top_right`, `3 = bottom_left`, `4 = bottom_right` on the deck slide. UNIQUE on `(candidate_venue_id, slot)`.
- `storage_path` (text, NOT NULL): path within the `vs_venue_photos` storage bucket, format `${scout_id}/${candidate_venue_id}/slot-${N}-${timestamp}.${ext}` (lifted from VS Pro; the timestamp cache-busts when a producer re-uploads to a slot whose old object was just deleted)
- `file_name`, `file_size_bytes` (text / int, nullable)
- `created_at`

Storage bucket: `vs_venue_photos` (private, signed URLs 1-hour TTL via `createSignedUrl(path, 3600)`). Storage RLS: single `FOR ALL TO authenticated` policy (USING true / WITH CHECK true), relaxed from the original `is_producer_or_admin()` gate in Phase 4.10.3-port (`20260514000002_phase_4_10_3_port_vs_storage_policies.sql`) to match the open-authenticated `vs_*` table RLS. Bucket created in 4.7.1-port (`20260512240000_phase_4_7_1_port_vs_venue_photos_bucket.sql`). Distinct from the public `venue_photos` bucket reserved for HQ Core's master `venues` table.

## Cross-cutting

### notifications
- `id`, `user_id` (FK; recipient)
- `type` (text: `task_assigned`, `task_due_today`, `task_blocked`, `deliverable_due_3d`, `project_status_changed`, `event_date_today`, `mention`, `user_pending`, `pull_complete`, `final_review_ready`, etc.)
- `title`, `body`, `link_url` (text)
- `read` (bool), `delivered_in_app` (bool), `delivered_email` (bool), `delivered_slack` (bool, Phase 5.5)
- `created_at`, `read_at`
- Realtime: joined `supabase_realtime` publication with `REPLICA IDENTITY FULL` in Phase 5.5 so the bell badge live-updates via `postgres_changes` on INSERT/UPDATE filtered by `user_id=eq.{uid}`.

### user_notification_preferences (Phase 5.5)
Per-user, per-trigger opt-in/out overrides for the in-app + Slack DM
channels. When no row exists for `(user_id, trigger_key)`, the dispatch
function falls back to system defaults (see spec § 2b).

- `id` (uuid, PK, default `gen_random_uuid()`)
- `user_id` (uuid, NOT NULL, FK to `users.id` ON DELETE CASCADE)
- `trigger_key` (text, NOT NULL): one of `deliverable_due_3d`, `task_assigned`, `task_due_today`, `task_blocked`, `project_status_changed`, `mention`, `event_date_today`
- `in_app` (bool, NOT NULL, default true)
- `slack_dm` (bool, NOT NULL, default false)
- `created_at`, `updated_at` (timestamptz)
- UNIQUE `(user_id, trigger_key)`
- Index: `user_notification_preferences_user_idx (user_id)`
- Trigger: `trg_user_notification_preferences_updated_at` (updated_at_auto)
- RLS: per-user (`user_id = auth.uid()`) on every CRUD verb. No cross-user reads.

### global_settings (single row)
- `id` (uuid, PK)
- `anthropic_spend_cap_monthly_usd`, `anthropic_spend_current_month_usd` (numeric)
- `cap_alert_sent_this_month` (bool, default false): paired with `anthropic_spend_current_month_usd` so the spend tracker emails the admin once per cap crossing instead of every API call after the cap is hit.
- `default_drive_folder_for_standalone_vs_decks` (text)
- `venue_research_priority_sites` (text[]; admin-configurable, NOT a hard restriction)
- `talent_scout_packet_default_count` (int, default 15)
- `talent_scout_competitor_list` (text[], Phase 3.7.5): global default competitor company list applied to every Talent Scout role unless overridden per-role on `ts_roles.competitor_bonus`. Seeded with Mirror's canonical 19-entry default; editable from `/talent-scout/settings` (admin only). Postgres `text[]` rather than jsonb because the value is a flat array; per-role `competitor_bonus` stays jsonb because it carries a `bonus_points` scalar alongside the array.
- `email_notifications_enabled`, `in_app_notifications_enabled` (bool)
- `updated_at`

`ts-cron-monthly-spend-reset` (Phase 3.8) resets `anthropic_spend_current_month_usd` to 0 and `cap_alert_sent_this_month` to false on the 1st of each month at 00:01 UTC.

### activity_log
- `id`, `entity_type` (text: `project`, `venue`, `task`, `credential`, etc.)
- `entity_id` (uuid)
- `action` (text: `created`, `updated`, `status_changed`, `assigned`, `credential_revealed`)
- `actor_id` (FK to users)
- `payload` (jsonb)
- `created_at`
- `entity_type` is an open text column (no CHECK constraint). Phase 5.8.7 added `credential` / `credential_revealed` as the audit trail written inside `credentials_reveal_password`. Phase 5.9.1 writes one `entity_type='bulk_import_session'`, `action='bulk_import'` row per committed import (inline INSERT from the `bulk-import` edge function; no trigger).

### bulk_import_sessions (Phase 5.9.1)
Immutable audit trail of every committed bulk import. One row per successful commit; failed-rollback runs also write a row with `status='failed_rollback'` for incident traceability. Read by the 5.9.5 audit page + the per-entity list-page filter chip (`bulk_import_session_id` on the entity table, landing 5.9.2 / .3 / .4). Written only by the `bulk-import` edge function via the service-role client.

- `id` (uuid, PK, default `gen_random_uuid()`)
- `entity_type` (text, NOT NULL, CHECK in `project / vendor / venue`)
- `actor` (uuid, NOT NULL, FK to `users.id` ON UPDATE CASCADE ON DELETE RESTRICT). RESTRICT because deleting an actor mid-history would break the audit narrative; the FK blocks the delete until an admin reassigns.
- `row_count` (integer, NOT NULL, CHECK `>= 0`)
- `created_refs` (jsonb, NOT NULL, default `'{}'`). Per-kind count of references created in the same transaction.
- `column_set` (text[], NOT NULL, default `'{}'`). The column keys the admin imported.
- `status` (text, NOT NULL, default `committed`, CHECK in `committed / failed_rollback`)
- `committed_at` (timestamptz, NOT NULL, default `now()`)
- `imported_record_ids` (uuid[], NOT NULL, default `'{}'`). Added Phase 5.9.6 (`20260602200000_phase_5_9_6_bulk_import_undo.sql`). The undo trail: ids of the records this import CREATED (never the dedupe-`update` targets). Populated by the three commit RPCs from their `v_created_ids`. Consumed by `bulk_import_undo` to delete exactly the created records. Pre-5.9.6 rows backfill to `'{}'` (untracked, non-undoable).
- `imported_person_ids` (uuid[], NOT NULL, default `'{}'`). Added Phase 5.9.6. Ids of the contact People this import CREATED (vendor/venue imports only, and only the freshly-INSERTED ones — a reused/pre-existing contact is never tracked). Empty for project imports (they create no People). `bulk_import_undo` deletes these explicitly before the record delete (the org FK is ON DELETE SET NULL, so they would otherwise orphan).
- Indexes: `bulk_import_sessions_history_idx` on `(entity_type, committed_at DESC)`; `bulk_import_sessions_actor_idx` on `(actor, committed_at DESC)`.
- RLS: SELECT admin only (`public.is_admin()`). INSERT via service role only (no `authenticated` INSERT policy). UPDATE and DELETE blocked entirely (immutable audit table). Phase 5.9.6 undo deletes the session row through the SECURITY DEFINER `bulk_import_undo` RPC (service-role context), never a client DELETE; the no-DELETE-policy posture is unchanged.
- GRANTs: SELECT to `authenticated`; ALL to `service_role`.
- No `updated_at` (immutable), no activity-log trigger (the edge function writes the activity row inline).

### bulk_import_drafts (Phase 5.9.1)
Autosave state for an in-flight bulk import. One row per `(author, entity_type)` (v1 single-draft constraint). `BulkImportPage` loads any existing draft on mount (Resume / Discard banner), autosaves every 20s while dirty, and deletes on commit / discard.

- `id` (uuid, PK, default `gen_random_uuid()`)
- `author` (uuid, NOT NULL, FK to `users.id` ON UPDATE CASCADE ON DELETE CASCADE). CASCADE on delete because a deleted user's drafts have no further value.
- `entity_type` (text, NOT NULL, CHECK in `project / vendor / venue`)
- `payload` (jsonb, NOT NULL). File name, parsed rows, mappings, dedupe decisions, grid edits, column set, current step.
- `created_at`, `updated_at` (timestamptz, NOT NULL, default `now()`)
- `UNIQUE (author, entity_type)`
- Trigger: `trg_bulk_import_drafts_updated_at` (updated_at_auto).
- RLS: SELECT / INSERT / UPDATE / DELETE author-only (`author = auth.uid()`). Intentionally no admin predicate; the admin-only authorization lives at the route gate (AdminRoute on `/settings/bulk-import/:entity`). Non-admins reaching the table directly via SQL have no UI path to commit a draft, so the route gate is sufficient (spec § 11 test #23).
- GRANTs: SELECT, INSERT, UPDATE, DELETE to `authenticated`; ALL to `service_role`.

### deliverables (Phase 5.2.1)
Per-project workflow checkpoints surfaced on Surface 14 (Calendar default view) and on the Project detail (Surface 07).

- `id` (uuid, PK, default `gen_random_uuid()`)
- `project_id` (uuid, NOT NULL, FK to `projects.id` ON DELETE CASCADE)
- `title` (text, NOT NULL)
- `type` (text): free-text Kickoff / Venue Recon / Design Round / Client Approval / Install / Removal etc. Future sub-phase may promote to a lookup.
- `status` (enum `deliverable_status`, 4 values, default `Upcoming`): `Upcoming`, `In Progress`, `Complete`, `Skipped`. Skipped renders with strikethrough + opacity-60 per locked-decisions § 4.
- `due_date` (date, nullable). Calendar view filters out NULL due dates.
- `notes` (text, nullable)
- `assigned_user_ids` (uuid[], NOT NULL, default `{}`, GIN-indexed). Multi-assignee per build notes Surface 14 board card "first-name" stack.
- `created_by` (uuid, NOT NULL, FK to `users.id` default ON DELETE RESTRICT)
- `created_at`, `updated_at`, `completed_at` (timestamptz). `completed_at` is set by the `deliverables_completed_at_set` trigger when status flips to `Complete`; cleared on flip away.
- Triggers: `trg_deliverables_updated_at` (updated_at_auto), `trg_deliverables_completed_at` (completed_at on Complete), `trg_activity_log_deliverables` (INSERT OR UPDATE OR DELETE -> activity_log via the extended `activity_log_writer`; Phase 5.2.1 added the DELETE branch).
- RLS: SELECT/INSERT/UPDATE/DELETE open to authenticated.
- Realtime: published via `supabase_realtime` with `REPLICA IDENTITY FULL` so the Board drag-drop status changes reach peers via `postgres_changes`.

### saved_views (Phase 5.2.1)
Per-user named filter / sort / view-kind snapshots for the HQ Core database list pages.

- `id` (uuid, PK, default `gen_random_uuid()`)
- `user_id` (uuid, NOT NULL, FK to `users.id` ON DELETE CASCADE)
- `entity_type` (text, NOT NULL, CHECK in `project / task / deliverable / organization / vendor / client / person / venue / calendar`). `calendar` added in Phase 5.3 (`20260516150002_phase_5_3_saved_views_calendar_check.sql`) so the unified Calendar page can persist per-user visibility toggles via a single implicit row (`name='__calendar_default'`, `view_kind='calendar'`). `vendor` + `client` added in Phase 5.6.5 (`20260520100000_phase_5_6_5_saved_views_global_scope_users_is_owner.sql`) to match the values list pages have been passing since the 5.2.3 organizations split; `organization` stays in the CHECK as a legacy value (no rows of it in production; will be removed in a future cleanup pass).
- `name` (text, NOT NULL)
- `view_kind` (text, NOT NULL, CHECK in `list / board / timeline / calendar`)
- `filter_state` (jsonb, NOT NULL, default `'{}'::jsonb`). Shape: `{ connector: 'AND'|'OR', chips: [{field, op, value}], sort?: {field, dir}, columns?: [string] }`. For `entity_type='calendar'` the shape is `{ showDeliverables, showHolidays, showSharedOutlook, hiddenProjectIds[] }` instead.
- `is_default` (bool, NOT NULL, default false). One per `(user_id, entity_type)` enforced in app via a transactional "clear then set" upsert; the DB does not carry a unique partial index for it. After 5.6.5 the same clear-then-set pattern applies to global rows (one default per `(scope='global', entity_type)`), enforced in `createSavedView` when `scope='global'`.
- `scope` (text, NOT NULL, default `'user'`, CHECK in `user / global`). Added Phase 5.6.5. `user`-scoped rows belong to the row's `user_id`; `global`-scoped rows are visible to every authenticated user and writeable only by owners (`users.is_owner = true`). The new on-mount default-view resolution in HQ Core list pages resolves per-user default first, then falls back to the global default.
- `created_at`, `updated_at` (timestamptz)
- RLS: SELECT allowed when `user_id = auth.uid() OR scope = 'global'`. INSERT/UPDATE/DELETE branched on scope: `scope='user'` requires `user_id = auth.uid()` (unchanged); `scope='global'` requires `(SELECT is_owner FROM public.users WHERE id = auth.uid()) = true`. Rewritten in Phase 5.6.5 from the pre-5.6.5 per-user-only posture.
- Indexes: `(user_id, entity_type)` btree; `saved_views_scope_default_idx` partial btree on `(scope, entity_type) WHERE scope = 'global' AND is_default = true` (Phase 5.6.5; speeds up the global-default lookup that fires on every list-page mount).

### outlook_entries (Phase 5.3)
Admin-only planning surface for speculative engagements that haven't yet converted into a Project. Drives Surface 16 (Outlook) and the admin Home condensed card. Shared entries (`shared_with_team = true`) surface as gray banners on the unified Calendar for all tiers.

- `id` (uuid, PK, default `gen_random_uuid()`)
- `name` (text, NOT NULL). Event name pre-conversion (e.g. "Office Refresh").
- `client_id` (uuid, FK to `clients.id` ON DELETE SET NULL, nullable)
- `city` (text, nullable)
- `year` (int, NOT NULL)
- `month` (int, NOT NULL, CHECK `BETWEEN 1 AND 12`)
- `week` (int, NOT NULL, CHECK `BETWEEN 1 AND 4`). Week index within the month (1 = days 1-7, 2 = 8-14, etc.). Calendar shared-entry rendering derives a calendar date from `(year, month, week)` as `day = (week - 1) * 7 + 1`.
- `date_text` (text, nullable). Freeform e.g. "Early June" / "Jun 5 - 6". Planning surface; producers rarely have a locked date.
- `budget` (numeric, nullable). Planning estimate; NOT an invoice amount. Coexists with the locked-decisions Q6 budget rule because Outlook is a pre-pipeline planning surface.
- `confidence` (enum `outlook_confidence`, NOT NULL, default `On Radar`): `On Radar`, `Likely`, `Confirmed`, `Complete`. Color mapping per locked-decisions § 4: amber / cyan / green / gray. **This flips the wireframe CSS mapping**; build enforces the locked mapping (see `docs/decisions.md` Phase 5.3).
- `notes` (text, nullable)
- `linked_project_id` (uuid, FK to `projects.id` ON DELETE SET NULL, nullable). Set by the `promote_outlook_to_project` RPC. Unlink action clears it but leaves the Project row untouched per locked-decisions § 1.
- `shared_with_team` (boolean, NOT NULL, default `false`). When true the entry surfaces as a banner on the unified Calendar for all tiers; standard users see the banner but cannot click through (Outlook page is admin-only).
- `created_by` (uuid, NOT NULL, FK to `users.id`)
- `created_at`, `updated_at` (timestamptz)
- Indexes: `outlook_entries_year_month_idx (year, month)`; partial btree on `(client_id)`, `(linked_project_id)`, `(shared_with_team) WHERE shared_with_team = true`.
- Triggers: `trg_outlook_entries_updated_at` (updated_at_auto), `trg_activity_log_outlook_entries` (AFTER INSERT/UPDATE/DELETE -> `activity_log` via `activity_log_writer`).
- RLS: admin full CRUD; standard + freelance SELECT only on rows with `shared_with_team = true`. Pending users blocked at the route gate (`/outlook` is `<AdminRoute>`).
- Realtime: NOT in the `supabase_realtime` publication in 5.3. Single-admin edit pattern; the side panel doesn't need multi-admin live-merge. Add later if multi-admin concurrent editing surfaces as a need.

### notes_log (Phase 5.1; widened Phase 5.2.2 / 5.2.3 / 5.6.4.1 / 5.7.2 / 5.7.3 followup)
Polymorphic Internal Notes log shared by Clients, Vendors, People, Venues, Outlook Entries, Tasks, Deliverables, and Projects. The CHECK constraint was widened in Phase 5.2.2 (`20260515140002_phase_5_2_2_venues_extensions.sql` — adds `'venue'`), Phase 5.2.3.D (`20260516130003_phase_5_2_3_notes_log_check.sql` — splits `'organization'` into `'client'` + `'vendor'`), Phase 5.6.4.1 (`20260519100000_phase_5_6_4_1_notes_log_outlook_entry.sql` — adds `'outlook_entry'`), Phase 5.7.2 (`20260522100000_phase_5_7_2_mentions_and_task_deliverable_notes.sql` — adds `'task'` + `'deliverable'`), and Phase 5.7.3 followup-13 (`20260523100000_phase_5_7_3_followup_notes_log_project.sql` — adds `'project'`, plus a one-time idempotent backfill of `projects.status_notes` into `notes_log` so the swap from InlineEditText to InternalNotesEditor preserves existing content).

- `id` (uuid, PK, default `gen_random_uuid()`)
- `parent_type` (text, NOT NULL, CHECK `IN ('client', 'vendor', 'person', 'venue', 'outlook_entry', 'task', 'deliverable', 'project')`)
- `parent_id` (uuid, NOT NULL): logical FK to the parent record. Not a real FK because the parent table varies. Tightening to per-type split tables can land later if it ever matters. **Phase 5.7.14 (`20260530110000_phase_5_7_14_notes_log_orphan_sweep.sql`)** one-shot DELETEs any orphan rows where the parent record no longer exists (one anti-join DELETE per parent_type, wrapped in a single transaction). No standing AFTER DELETE trigger on the parent tables — future deletes still produce orphans until a polymorphic FK design lands; re-run the sweep periodically if growth becomes an issue.
- `body` (text, NOT NULL)
- `author_id` (uuid, NOT NULL, FK to `users.id`)
- `created_at` (timestamptz, NOT NULL, default `now()`)
- Index: `(parent_type, parent_id, created_at DESC)` for the newest-first per-parent timeline.
- **No `updated_at`. Notes are immutable except for deletion** per locked-decisions § 3.
- RLS: SELECT-all-authenticated, INSERT-self-author, DELETE-author-or-admin. **No UPDATE policy.**

## Postgres triggers

- ~~`vs_candidate_venues_shortlist_sync`~~ **retired in Phase 5.12.0** (migration `20260603140000_phase_5_12_0_drop_shortlist_sync_trigger.sql`). The HQ Venues match-or-insert + `linked_venue_id` wiring moved to the top of `vs-generate-deck`'s work block (fires at Generate Deck click after the producer has reviewed + edited the venue overview on DeckPrep). See `docs/edge-functions.md` § `vs-generate-deck` for the new dedupe ladder + write-when-blank rule.
- `tasks_completed_at_set`: when `tasks.status` flips to `Done`, set `completed_at = now()`. Body `CREATE OR REPLACE`'d in Phase 5.2.1 to compare against the mixed-case enum label after the task_status reshape.
- `deliverables_completed_at_set` (Phase 5.2.1): mirror of `tasks_completed_at_set` for the `deliverables` table; flips `completed_at` on `status -> 'Complete'`.
- `activity_log_writer`: on insert / update / delete / status-change to projects, venues, tasks, deliverables, write an `activity_log` row. Extended in Phase 5.2.1 with a `TG_OP = 'DELETE'` branch (`action = 'deleted'`, payload `{ old: to_jsonb(OLD) }`) so the new `trg_activity_log_deliverables` trigger can fire on AFTER DELETE; existing projects / venues / tasks triggers remain on AFTER INSERT OR UPDATE only.
- `updated_at_auto`: standard updated_at trigger on every table with the column.
- `handle_new_user`: on `auth.users` INSERT, mirror to `public.users` with `permission_role = 'pending'` (Phase 5.1; was `'member'` pre-rewrite). Also inserts one `notifications` row per active admin (`type='user_pending'`). Phase 5.5 rewrite: link_url changed from `/team` to `/users` (Phase 5.4 route rename); calls `notifications-dispatch` with `event_type='user_pending'` instead of `notify-admin-of-pending-user` directly. The legacy admin-notification function stays deployed one phase as a fallback. Inline durable notifications rows remain so the in-app signal lands even if the dispatch edge function 500s. Runs as service role.
- `notifications_dispatch_writer` (Phase 5.5; recipient union widened in Phase 5.7.7): AFTER INSERT OR UPDATE on `tasks`, AFTER UPDATE on `projects`. Fires `task_assigned` (assignee_id newly set or changed), `task_blocked` (status flips to `'Blocked'`), and `project_status_changed` (status changes; recipients = `project_account_managers` ∪ `project_designers` ∪ `project_members` for the project, deduped via DISTINCT) via `public.invoke_edge_function('notifications-dispatch', ...)`. SECURITY DEFINER. Reads `auth.uid()` to set `actor_id` so the dispatch fn can exclude self-notification.

## Postgres functions (RPCs)

- `start_over_scout(target_scout_id uuid) RETURNS jsonb` (Phase 4.9-port, migration `20260513000000_phase_4_9_port_start_over_rpc.sql`; CREATE OR REPLACE in Phase 4.10.3-port migration `20260514000001_phase_4_10_3_port_start_over_scout_pipeline_error.sql` to clear `pipeline_error` instead of `research_error` post-rename): transactional reset of a scout to `current_step='sheet_prompt'`. Cascade-deletes `vs_candidate_venues` (photos cascade via FK ON DELETE CASCADE). Resets `status` to `'draft'`, clears `pipeline_error`, `derived_columns` (-> `[]`), `sheet_storage_path`, `deck_order` (-> `[]`), and strips idempotency timestamps (`research_started_at`, `compile_started_at`, `deck_generation_started_at`) from `brief_data`. Keeps brief fields, `project_id`, `generated_decks` history, `brief_data.uploaded_files`. `SECURITY INVOKER`. `GRANT EXECUTE TO authenticated`.

- `promote_outlook_to_project(target_entry_id uuid) RETURNS uuid` (Phase 5.3, migration `20260516150000_phase_5_3_outlook_entries_table.sql`): atomic promotion of an `outlook_entries` row to a `projects` row. INSERTs into `projects` with `name`, `client_id`, `city` from the entry + `status='Queued'` + `created_by=auth.uid()`; UPDATEs the entry's `linked_project_id` to the new project id; returns the new project id. Pre-checks `public.is_admin()` at the top (raises ERRCODE 42501 on non-admin). Refuses to promote an already-linked entry (raises 23505). `SECURITY DEFINER` so the cross-table writes don't trip RLS mid-flight. `GRANT EXECUTE TO authenticated`.

- `bulk_import_commit_projects(payload jsonb) RETURNS jsonb` (Phase 5.9.2, migration `20260602110000_phase_5_9_2_projects_importer.sql`; people-roster removed in 5.9.2.1, migration `20260602120000_phase_5_9_2_1_importer_drop_people_roster.sql`): the atomic commit for the Projects bulk importer. One in-DB transaction owns the whole cross-table write: queued client/venue inserts (with a `_queued:N` id-translation table), novel `project_categories` / `cities` lookup auto-creates, per-row project insert (create path) or update (dedupe-update path), the `project_venues` join (the only import-owned roster), the `bulk_import_sessions` audit row, and one `bulk_import_session`/`bulk_import` `activity_log` row. **People roster (Account Lead / Designer / Team Members) is NOT imported** (5.9.2.1) — set retroactively on the project edit page; the dedupe-update path replaces only `project_venues` and never touches `project_account_managers` / `project_designers` / `project_members`. Per-project `activity_log` rows fire automatically via `trg_activity_log_projects`. Payload row keys mirror the template headers (date keys are the short form `live_start` etc.; the RPC maps them onto the DB `*_dates_*` columns); multi-value columns arrive as JSON arrays, `account_lead` as a single email string. `actor_id` comes from the payload (the edge function invokes via the service-role client, so `auth.uid()` is NULL inside the function); the body re-checks the actor is `permission_role='admin'` (raises 42501 otherwise) as defense in depth. `SECURITY DEFINER`, `SET search_path = public`, `GRANT EXECUTE TO authenticated`. Helpers: `_bulk_import_resolve_client_ref(text, uuid[])` + `_bulk_import_resolve_venue_ref(text, uuid[])` (both `STABLE`, `GRANT EXECUTE TO authenticated`) resolve a ref string to an existing id, a `_queued:N` slot, or a fuzzy name match. Memory `feedback_postgrest_no_multi_statement_tx`: the RPC exists because a PostgREST chain can't roll the cross-table write back atomically. **Phase 5.9.6 (`20260602200000`):** the final session UPDATE now also persists `imported_record_ids = v_created_ids` (the undo trail) and `imported_person_ids = '{}'` (projects create no People).

- `bulk_import_commit_vendors(payload jsonb) RETURNS jsonb` (Phase 5.9.3, migration `20260602140000_phase_5_9_3_vendors_importer.sql`): the atomic commit for the Vendors bulk importer. Same SECURITY DEFINER posture + admin re-check + `_queued:N` translation as `bulk_import_commit_projects`. One in-DB transaction owns: queued `vendor_categories` inserts, queued `vendor_subcategories` inserts (parent resolved per row), novel `vendor_capabilities` + `cities` lookup auto-creates, per-row vendor insert (create) or update (dedupe-update), the `bulk_import_sessions` audit row, and one `bulk_import_session`/`bulk_import` `activity_log` row. Deltas vs the Project RPC: `category` + `subcategory` are FK columns resolved via the two helpers (not free-text); `capabilities` is a `text[]` of NAMES written through with novel values auto-creating the `vendor_capabilities` lookup row (parallel to Project Category/City); `preferred` + `nationwide` (5.9.3.1) are each coerced from a `"true"`/`"false"`/`""` string (empty => false); `general_email` (5.9.3.2) is written through as nullable text; **(5.9.3.3) each row's `contact_name`/`email`/`phone` now also creates (or vendor-scoped-dedupe-reuses) a `people` row affiliated to the vendor (`affiliation_type='Vendor'`, `vendor_id`, `created_by=actor`) so VendorDetail derives it as the Primary Contact; dedupe is scoped to the same vendor (not global) because the `people` affiliation mutex forbids relinking a person across orgs**; NO project-style staff-roster handling (vendors have no `vendor_account_managers` analog) and the dedupe-update path leaves `project_vendors` untouched. Subcategory parent resolution matches the queued subcategory's `parent_category` text against queued (this-batch) categories first, then existing, case-insensitive; unresolvable raises 23503. Queued `vendor_categories` insert uses `ON CONFLICT (lower(name))` (the unique arbiter is the `LOWER(name)` expression index, not a constraint) with a `SELECT id` fall-back so re-runs recover the existing id. Per-vendor `activity_log` rows fire automatically via `trg_activity_log_vendors`. `actor_id` comes from the payload; the body re-checks `permission_role='admin'` (raises 42501). `SECURITY DEFINER`, `SET search_path = public`, `GRANT EXECUTE TO authenticated`. Helpers: `_bulk_import_resolve_vendor_category_ref(text, uuid[])` + `_bulk_import_resolve_vendor_subcategory_ref(text, uuid[], uuid)` (both `STABLE`, `SET search_path = public`, `GRANT EXECUTE TO authenticated`). **Phase 5.9.6 (`20260602200000`):** the final session UPDATE now also persists `imported_record_ids = v_created_ids` and `imported_person_ids` = the freshly-INSERTED contact-person ids only (a local `v_created_person_ids` appended in the people INSERT branch, NOT the reuse branch) — the undo trail consumed by `bulk_import_undo`.

- `bulk_import_commit_venues(payload jsonb) RETURNS jsonb` (Phase 5.9.4, migration `20260602180000_phase_5_9_4_venues_importer.sql`): the atomic commit for the Venues bulk importer. Same SECURITY DEFINER posture + admin re-check (42501) + `_queued:N` translation + single `bulk_import_sessions` row + one `bulk_import_session`/`bulk_import` `activity_log` row as `bulk_import_commit_vendors`. One in-DB transaction owns: queued `venue_types` creates, novel `cities` auto-creates (with `created_by` stamped), per-row venue insert (create) or update (dedupe-update on `lower(name)|lower(address)`), `venue_venue_types` join writes, and the per-row contact `people` row + `venue_contact_people` join row. Deltas vs the Vendor RPC: (a) **`venue_types` is a JOIN** (`venue_venue_types`), so resolution is two-step (queued create or case-insensitive existing match, then a `(venue_id, venue_type_id)` INSERT `ON CONFLICT DO NOTHING`); the dedupe-update path REPLACES the join (DELETE all rows for the venue, then re-INSERT). Queued `venue_types` use a `LOWER(name)=LOWER(...)` existence probe before INSERT (so admin-typed casing reuses an existing row) then `ON CONFLICT (name) DO NOTHING` (the arbiter is a real UNIQUE constraint, not an expression index); `venue_types` has NO `created_by` column so the INSERT omits it. (b) **`features` is a plain `text[]`** written through with no companion lookup / auto-create. (c) **`exclusive_vendor_ids` is deliberately NOT importable** (Jimmie's call 2026-05-20): the RPC never reads or writes the column, so a dedupe-update can't clobber a venue's manually-curated exclusive vendors (the original 5.9.4 cut did write it; corrected in migration `20260602190000_phase_5_9_4_drop_exclusive_vendor_import.sql`, which also dropped the resolver helper). **Contact-People divergence (critical):** venues link a contact through the `venue_contact_people` JOIN table, NOT the dead legacy `people.venue_id` column. So each row's `contact_name`/`email`/`phone` creates (or venue-scoped-dedupe-reuses) a `people` row (`affiliation_type='Venue'`, `client_id`+`vendor_id` NULL per the affiliation mutex, `venue_id` left NULL) AND inserts a `venue_contact_people (venue_id, person_id)` row `ON CONFLICT DO NOTHING`; that join row is what surfaces the contact on VenueDetail. Venue-scoped dedupe matches existing contacts THROUGH the join, NAME first then email (locked 2026-05-20). The join is ADDITIVE on the update path (never replaced), in contrast to `venue_venue_types`. Per-venue `activity_log` rows fire via `trg_activity_log_venues`; per-people rows via `trg_activity_log_people` (only on newly-created contacts). `actor_id` comes from the payload; the body re-checks `permission_role='admin'` (raises 42501). `SECURITY DEFINER`, `SET search_path = public`, `GRANT EXECUTE TO authenticated`. Helper: `_bulk_import_resolve_venue_type_ref(text, uuid[])` (`STABLE`, `SET search_path = public`, `GRANT EXECUTE TO authenticated`). **Phase 5.9.6 (`20260602200000`):** the final session UPDATE now also persists `imported_record_ids = v_created_ids` and `imported_person_ids` = the freshly-INSERTED contact-person ids only (`v_created_person_ids` appended in the people INSERT branch, NOT the reuse branch) — the undo trail. **Phase 5.9.7 (`20260602210000`):** rebased onto the 5.9.6 body. Two additions: (a) `general_email` is written through as nullable text on both the create + update paths (`NULLIF(v_row->>'general_email','')`); (b) after the contact-People block, the row's `event_day_rate` (defensively stripped of `$`/commas) appends one `venue_rate_history` `event_day` row dated `current_date` ONLY when it differs from the venue's current most-recent `event_day` amount (`IS DISTINCT FROM`) — a repeat import with an unchanged rate is a no-op. The new `created_refs.venue_rates` counter tracks the inserts.

- `bulk_import_undo(p_session_id uuid, p_actor_id uuid, p_dry_run boolean DEFAULT false) RETURNS jsonb` (Phase 5.9.6, migration `20260602200000_phase_5_9_6_bulk_import_undo.sql`): reverts a committed bulk import. Called from the `bulk-import` edge function's `undo` mode via `adminClient.rpc('bulk_import_undo', { p_session_id, p_actor_id, p_dry_run })`. Re-checks `p_actor_id` is an admin (raises 42501) — third gate after AdminRoute + the edge function's server-side re-check; `actor_id` comes from the caller because the service-role invocation makes `auth.uid()` NULL. Gates: session must exist (P0002), `status='committed'` (else 22023), `committed_at >= now() - 7 days` (`v_window_days constant := 7`, keep in sync with the client `BULK_IMPORT_UNDO_WINDOW_DAYS`; else 22023), and `imported_record_ids` non-empty (else 22023 "no undo trail" — pre-5.9.6 untracked sessions). Builds per-entity cascade counts (`deliverables`/`tasks`/`project_*` joins for projects; `vendor_files`/`vendor_ratings`/`project_vendors` for vendors; `venue_venue_types`/`venue_contact_people` for venues). When `p_dry_run`, returns `{ ok, dry_run:true, counts }` WITHOUT writing. Otherwise: DELETEs the tracked `imported_person_ids` from `people` first (the org FK is ON DELETE SET NULL, so they would orphan), then DELETEs the `imported_record_ids` from the entity table (cascades remove deliverables/tasks/joins/ratings/files), DELETEs the original `bulk_import`/`bulk_import_session` activity row, INSERTs one `bulk_import_undo`/`bulk_import_session` activity row with the counts payload (`entity_id` keeps the now-deleted session id; not an FK), and hard-deletes the `bulk_import_sessions` row last. **Never touches shared lookups (`cities`, `vendor_categories`/`vendor_subcategories`/`vendor_capabilities`, `venue_types`) or queued clients/venues a project import created (§14-A)** — only the records + their import-created contacts. Reused/pre-existing contacts survive (they were never tracked). Counts shape: `{ entity_type, records, contacts, cascade:{...} }`. Returns `{ ok, dry_run, counts }`. `SECURITY DEFINER`, `SET search_path = public`, `GRANT EXECUTE TO authenticated`. DESTRUCTIVE (gated).

- `vs_research_try_acquire_kickoff(target_scout_id uuid, grace_seconds int DEFAULT 360) RETURNS boolean` (Phase 5.12.1, migration `20260603160000_phase_5_12_1_hq_pool_source_and_research_kickoff_lock.sql`): atomic kickoff acquisition for `vs-research-venues`. Replaces the pre-5.12.1 inline check-then-write at lines 602-621 that race-condition-failed live (code-observations Edge #1; confirmed token double-spend on concurrent invocations). Uses `pg_try_advisory_xact_lock` over a deterministic 64-bit key derived from `hashtextextended('vs-research:' || target_scout_id::text, 0)`; if another transaction holds the lock, returns false immediately. Otherwise reads `brief_data->>'research_started_at'` and bails (returns false) when the prior kickoff is within `grace_seconds`. On success: updates the scout's `brief_data.research_started_at` to `now()` and clears `pipeline_error` in the same transaction, then returns true. Lock auto-releases at transaction end. `SECURITY DEFINER`, `SET search_path = public`. **GRANTs locked down:** REVOKE EXECUTE FROM PUBLIC + anon + authenticated, GRANT EXECUTE TO `service_role` only — the RPC has no client-side consumer and `vs-research-venues` invokes it via the service-role client; granting authenticated would let any signed-in user reset another scout's kickoff state since the function performs no caller-ownership check. Sibling pattern to `reset_scout_for_deck_regenerate` (SECURITY INVOKER + GRANT TO authenticated) which DOES have a browser caller and relies on RLS for caller scope. See `docs/conventions.md` § Schema migrations for the decision rule.

- `vs_deck_try_acquire_kickoff(target_scout_id uuid, grace_seconds int DEFAULT 90) RETURNS boolean` (Phase 5.12.4.1, migration `20260604120000_phase_5_12_4_1_deck_kickoff_lock.sql`): atomic kickoff acquisition for `vs-generate-deck`. Replaces the pre-5.12.4.1 inline check-then-write of `brief_data.deck_generation_started_at` that was a TOCTOU race surfaced by Codex adversarial review on the 5.12.4 diff — two near-simultaneous invocations (producer double-clicking Generate) could both pass the 90s grace-window check before either committed its timestamp, then both call `pushVenuesToHq` and INSERT duplicate `venues` rows (no UNIQUE constraint on venue identity columns). Same TOCTOU shape `vs-research-venues` had pre-5.12.1 (code-observations Edge #1). Mirrors `vs_research_try_acquire_kickoff` exactly: uses `pg_try_advisory_xact_lock` over a deterministic 64-bit key derived from `hashtextextended('vs-deck:' || target_scout_id::text, 0)` — separate `vs-deck:*` namespace from `vs-research:*` so deck + research kickoffs for the same scout don't collide on the advisory lock space; if another transaction holds the lock, returns false immediately. Otherwise reads `brief_data->>'deck_generation_started_at'` and bails (returns false) when the prior kickoff is within `grace_seconds`. On success: updates the scout's `brief_data.deck_generation_started_at` to `now()` and clears `pipeline_error` in the same transaction, then returns true. Lock auto-releases at transaction end. `SECURITY DEFINER`, `SET search_path = public`. **GRANTs locked down:** REVOKE EXECUTE FROM PUBLIC + anon + authenticated, GRANT EXECUTE TO `service_role` only — `vs-generate-deck` invokes it via the service-role client; the RPC performs no caller-ownership check so granting authenticated would let any signed-in user reset another scout's deck kickoff state. Sibling pattern to `vs_research_try_acquire_kickoff` (same lock-and-grace shape on a different `brief_data` key) and to `reset_scout_for_deck_regenerate` (SECURITY INVOKER + GRANT TO authenticated, browser caller, relies on RLS for scope).

- `reset_scout_for_deck_regenerate(target_scout_id uuid) RETURNS void` (Phase 4.10.6-port, migration `20260514100000_phase_4_10_6_port_reset_scout_for_deck_regenerate.sql`): atomic state-reset RPC for the Deck Prep regenerate flow. Called from DeckPrep.tsx `generate()` when a producer clicks Generate Deck on a scout that already has a successful prior deck. Sets `current_step='deck_prep'` + strips `deck_generation_started_at` from `brief_data` via the `jsonb -` operator + clears `status='in_progress'` + `pipeline_error=null` + bumps `last_touched_at`. Single SQL statement so there's no TOCTOU race between a read and a write (which the prior frontend read-modify-write had). Idempotent: calling on a scout that's never been deck-generated still resets the columns; the `brief_data -` is a no-op for the missing key. `SECURITY INVOKER`. `GRANT EXECUTE TO authenticated`.

## Conventions for future migrations

- **Always include explicit GRANTs** to `authenticated` and `service_role` for new tables. Auto-expose stays off as the project security default. See `supabase/migrations/20260506065157_grant_data_api_access.sql` for the canonical pattern.
- **Always use `timestamptz`** for time-of-event columns, `date` for date-only.
- **Realtime tables** must be added to the `supabase_realtime` publication and have `REPLICA IDENTITY FULL` if the UI subscribes via `postgres_changes`.
- **Storage bucket conventions** in `docs/auth-model.md`.
