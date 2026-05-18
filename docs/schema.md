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

### credentials (Phase 5.4)
- `id`, `service_name` (text, not null), `username` (text, nullable), `password` (text, not null, plaintext-at-rest; see `docs/decisions.md` Phase 5.4 for rationale), `url` (text, nullable), `related_note` (text, nullable)
- `created_by`, `updated_by` (uuid FKs to users, nullable), `created_at`, `updated_at`
- Triggers: `updated_at_auto`, `activity_log_writer`.
- RLS: Freelance blocked entirely. SELECT for `admin` + `standard`. Admin-only INSERT/UPDATE/DELETE.

### mirror_holidays (Phase 5.4 — replaces 5.3 hardcoded constant)
- `id`, `name` (text), `date` (date), `created_by` (uuid FK to users, nullable), `created_at`
- Index on `(date asc)`.
- Trigger: `activity_log_writer`.
- RLS: open SELECT for authenticated; admin INSERT/UPDATE/DELETE.
- Seeded from the prior `src/lib/calendar/holidays.ts` `MIRROR_HOLIDAYS` constant; the Calendar now reads via `useMirrorHolidays()` hook.

### organizations (renamed from clients in Phase 5.2.2; split into vendors + clients in Phase 5.2.3)

**Doc drift note:** The section below describes the 5.2.2-era unified `organizations` table. Phase 5.2.3 (migrations `20260516130000` through `20260516130004`) split this into `vendors` (renamed from organizations) + `clients` (new table). Phase 5.2 cleanup adds `vendors.primary_address` (text, nullable) and fixes the `vendor_capabilities` GRANT DELETE for the authenticated role. A full rewrite of this section reflecting the split shape is carried forward as a doc-debt item; canonical column lists live in the migration files and in `src/integrations/supabase/types.ts` until then.

5.2.3 + cleanup deltas (minimum coverage for the migrations applied here):
- `vendors`: renamed from `organizations`. Dropped `type` enum + `org_type` type. Added `category_id` (uuid, FK to `vendor_categories`, nullable, ON DELETE SET NULL). Added `primary_address` (text, nullable) in Phase 5.2 cleanup. Added `subcategory_id` (uuid, FK to `vendor_subcategories`, nullable, ON DELETE SET NULL) in Phase 5.6.2 (`20260518100000_phase_5_6_2_vendor_subcategories_project_vendors.sql`); partial btree index `vendors_subcategory_idx WHERE subcategory_id IS NOT NULL`. App-side rule: when `category_id` changes, the UI clears `subcategory_id` since the prior pick may not belong to the new parent. All other columns from the organizations shape carry through.
- `clients`: new slim table created fresh in 5.2.3.A; columns: id, name, industry, contact_name, contact_email, contact_phone, primary_address, city, website_url, tags[], created_by, created_at, updated_at. Open-auth RLS (SELECT/INSERT/UPDATE) + admin-only DELETE. Existing organizations rows of type=Client migrated preserving UUIDs.
- `vendor_capabilities`: renamed from `org_capabilities` in 5.2.3.A. GRANT to authenticated extended to include DELETE in Phase 5.2 cleanup so the admin-only DELETE RLS policy is reachable.
- `vendor_categories`: new lookup table (same shape as `cities`) added in 5.2.3.A.
- `vendor_subcategories`: new lookup table added in Phase 5.6.2. Columns: id, name, `parent_category_id` (uuid, FK to `vendor_categories` ON DELETE CASCADE), created_by (FK to users, ON DELETE SET NULL), created_at. UNIQUE `(parent_category_id, name)`. Index `vendor_subcategories_parent_idx (parent_category_id)`. RLS: open SELECT/INSERT/UPDATE for authenticated; admin-only DELETE via `is_admin()`. Matches `vendor_capabilities` posture. Inline-add from VendorEdit Subcategory typeahead writes here with `parent_category_id` set to the current Category selection.
- `project_vendors`: new join table added in Phase 5.6.2 (Phase 5.6.2 deck). Columns: project_id (FK to projects ON DELETE CASCADE), vendor_id (FK to vendors ON DELETE CASCADE), created_by (FK to users, ON DELETE SET NULL), created_at. PRIMARY KEY `(project_id, vendor_id)`. Index `project_vendors_vendor_idx (vendor_id)`. RLS: open SELECT/INSERT/UPDATE/DELETE for authenticated. Matches `project_venues` / `venue_contact_people` posture. No activity-log trigger (project-team roster join tables stay out of the activity feed; matches `project_account_managers` / `project_designers`). Surfaced read paths: VendorsList Projects column, VendorDetail Projects section, VendorEdit Projects section; write path: ProjectEdit Vendors picker (diff-on-save: insert added, delete removed pairs).
- `projects.organization_id` renamed to `client_id` (FK -> clients).
- `people.organization_id` split into `client_id` + `vendor_id` (mutex CHECK); `affiliations` enum array dropped.
- `notes_log.parent_type` CHECK widened to `('client', 'vendor', 'person', 'venue')`.
- `venues.exclusive_vendors_org_ids` renamed to `exclusive_vendor_ids`.

The legacy `organizations` entry below is preserved for historical reference; treat the migration files + `types.ts` as authoritative for the live shape.

- `id` (uuid, PK)
- `name` (text, not null)
- `type` (enum `org_type`, default `Client`): `Client`, `Vendor`, `Internal`. Added in Phase 5.2.2 (`20260515140000_phase_5_2_2_organizations.sql`). **DROPPED in Phase 5.2.3.B.** Backfill: every shipped clients row migrated as `type = 'Client'`. Venue Owner is intentionally NOT in the enum per build notes Surface 10 (venues owned by clients live on the venues record).
- `city` (text, nullable). Added Phase 5.2.2.
- `capabilities` (text[], default `{}`). Vendor-side free-text capability tags. Added Phase 5.2.2.
- `website_url` (text, nullable). Added Phase 5.2.2.
- `tags` (text[], default `{}`). Added Phase 5.2.2.
- `internal_rating` (int, CHECK 0-5, nullable). Vendor-only Internal Rating. Visible to all standard+admin users per Surface 10 detail. Admin-write-only RLS gating deferred to 5.4. Added Phase 5.2.2.
- `contact_name`, `contact_email`, `contact_phone` (text). Shipped from initial schema; carried through the rename.
- `primary_address` (text, nullable). Added in Phase 5.2 cleanup (`20260516140000_phase_5_2_cleanup_primary_address_and_vendor_capabilities_grant.sql`) on the renamed vendors table; matches the `clients.primary_address` shape lifted from the 5.2.3 setup migration. Existing vendor rows receive NULL.
- `legacy_notes` (text). Renamed from `notes` in Phase 5.2.2. Internal Notes UI uses the polymorphic `notes_log` table instead; `legacy_notes` preserves any pre-rename content for a future backfill into notes_log.
- `created_by` (uuid, FK to users)
- `created_at`, `updated_at`
- Indexes: `organizations_type_idx (type)` **(dropped in 5.2.3.B alongside type column)**, `organizations_city_idx (city) WHERE city IS NOT NULL` (renamed to track the table rename per OID-stable index naming).
- Triggers: `trg_activity_log_organizations` (AFTER INSERT/UPDATE/DELETE; uses the Phase 5.2.1.B-extended `activity_log_writer`).
- RLS: SELECT/INSERT/UPDATE all-auth, DELETE admin-only (inherited from the shipped clients RLS; rename preserves policies by table OID, identifiers remain `clients_*`).
- Internal Notes: surfaced via the shared `notes_log` table with `parent_type = 'vendor'` (renamed from `'organization'` in 5.2.3.D).

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
- `production_folder_url`, `design_decks_folder_url`, `budget_sheet_url`, `latest_creative_deck_url`, `slack_channel_url` (text, all nullable)
- `status_notes` (text, renamed from `notes` in Phase 5.2.2). Surface 07 detail Status Notes sidebar card body + Surface 08 edit Status Notes textarea.
- `client_notes` (text, nullable). Surface 07 detail Client Notes sidebar card body + Surface 08 edit Client Notes textarea. Added Phase 5.2.2 alongside the `notes` rename.
- `archived_at` (timestamptz, nullable; null = active, non-null = archived; default queries filter `archived_at IS NULL`)
- `created_by` (uuid, FK to users)
- `created_at`, `updated_at`
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
- `name` (text, not null), `address`, `neighborhood` (text)
- `city` (text, nullable). Added Phase 5.2.2 (`20260515140002_phase_5_2_2_venues_extensions.sql`). Partial btree index `venues_city_idx WHERE city IS NOT NULL`.
- `venue_slide_url` (text, nullable). Google Slides URL surfaced on Surface 09 detail as a "Venue Slide" button next to the Edit button. Added Phase 5.2.2.
- `total_sq_ft` (int, nullable). Added Phase 5.2.2 alongside the shipped `square_footage`; the two coexist for now (total_sq_ft surfaced as "Total Sq Ft" in the wireframe).
- `exclusive_vendors_org_ids` (uuid[], default `{}`). Org references for "Exclusive Vendors" link list on Surface 09 detail. Added Phase 5.2.2. Postgres cannot FK array elements; app validates entries reference valid organizations before write.
- `capacity`, `square_footage` (int)
- `website_url`, `contact_name`, `contact_email`, `contact_phone` (text)
- `features` (text[])
- `notes` (text). Free-form About Venue body on Surface 09 detail.
- `photos` (text[]; Supabase Storage paths)
- `created_by` (uuid, FK)
- `created_at`, `updated_at`
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

### venue_types (lookup; free-text canonicalization)
- `id` (uuid, PK), `name` (text, unique, not null), `created_at`
- Free-text canonicalization. Producer's sheet supplies any string; `vs-parse-sheet` maps to the canonical list (Retail, Event Venue, Industrial, Warehouse, Gallery, Studio, Outdoor, Mobile) via substring matching. No lookup table writes needed for Venue Scout. See `docs/templates/venue-scout-sheet-template.md`.

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

Source of truth for the user-facing flow is Jimmie's screen-by-screen spec (he can paste on request) and `docs/talent-scout-port-plan.md`.

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

Three-table schema landed in Phase 4.1-port (`20260512200000_phase_4_1_port_schema.sql`). Replaces the failed-attempt Phase 4 shape from main with the 1:1 port from `mirror-nyc-venue-scout-pro`. The earlier `vs_briefs`, `vs_sourcing_rounds`, and `vs_pitch_decks` tables were dropped per the locked decisions in `docs/venue-scout-port-plan.md`:
- § 8.1 single-round per scout (no `vs_sourcing_rounds`)
- § 8.2 brief inline on `vs_scouts` (no `vs_briefs`)
- § 8.5 deck history as `vs_scouts.generated_decks` jsonb array (no `vs_pitch_decks`)
- § 8.6 RLS open to all authenticated (collaborative agency-wide workflow)

### vs_scouts
- `id` (uuid, PK), `name` (text, NOT NULL)
- Brief fields inline (port plan § 8.2):
  - `client_name`, `event_name`, `live_dates`, `city` (text)
  - `budget` (numeric)
  - `brief_data` (jsonb, default `{}`): flexible per-scout extras the producer surfaces from the uploaded brief PDF. Canonical keys (locked Phase 4.3-port): `expected_guest_count` (number; consumed by `vs-generate-deck` slide templating), `notes` (string; dumped verbatim into downstream research / compile prompts), `uploaded_files` (string[]; storage paths under `briefs` bucket, append-only, for audit / re-parse). Phase 4.5-port additional key: `research_started_at` (ISO timestamp string; set by `vs-research-venues` at kickoff for idempotency, see 90-second grace window in `docs/decisions.md`). Phase 4.7.2-port additional key: `compile_started_at` (ISO timestamp string; set by `vs-compile-summaries` at kickoff, same 90-second grace window pattern as research). Phase 4.8.2-port additional key: `deck_generation_started_at` (ISO timestamp string; set by `vs-generate-deck` at kickoff, same 90-second grace window). Phase 4 Revision pass 3 additional key: `overview_source_hash` (string; 16-char SHA-256 prefix over the 15 brief fields that drive the Event Overview prompt, written by `vs-generate-brief-overview` whenever it writes `event_overview`, read by Submit Brief in `BriefVenue.tsx` to decide whether the persisted overview is stale; machine metadata, no form field, rides in the `brief_data` passthrough alongside the `*_started_at` flags). **Phase 4 Revision - Intake** added the form-backed intake keys, all optional, hoisted into dedicated form fields by `src/lib/venue-scout/briefForm.ts`: `install_dates` (string), `strike_dates` (string), `activations_count` (number; slider, null = TBD so the key is dropped), `objectives` (string[]), `target_audience` (string), `vibe_aesthetic` (string), `target_neighborhoods` (string[]), `strict_neighborhoods_only` (boolean; always written, false is meaningful), `venue_types` (string[]; arbitrary strings, chip multi-select), `sq_ft_min` / `sq_ft_max` / `sq_ft_minimum` (number; sliders, null = any so the key is dropped), `ideal_features` (string[]), `priority_location` (`'high_foot_traffic' | 'intimate_destination'`), `priority_cost` (`'lower_cost' | 'premium'`). `toUpdate` drops keys whose form field is empty / empty-array / null. The retired `notes` key is no longer written by new scouts but is preserved untouched on existing scouts (backward compat). `vs-research-venues` Phase B + `vs-generate-brief-overview` read these keys; downstream prompts stringify the entire jsonb so any key the producer adds gets seen by the AI.
  - `event_overview` (text): the persisted Event Overview block. **Phase 4 Revision - Intake:** generated by `vs-generate-brief-overview`, then inline-editable. **Pass 3:** the generation trigger is the Submit Brief click in `BriefVenue.tsx`, hash-gated on `brief_data.overview_source_hash` (regenerate only when the overview-driving brief fields changed since the last generation); the report's empty-state Generate button + Regenerate link re-invoke manually. Top-level column (not nested in `brief_data`) because downstream prompts (`vs-research-venues`, `vs-compile-summaries`) stringify it directly.
- `current_step` (text, NOT NULL, default `brief`, CHECK in 10 values: `brief`, `sheet_prompt`, `sheet_upload`, `researching`, `sourcing_report`, `shortlist`, `review_selects`, `compiling`, `deck_prep`, `completed`): workflow state machine per port plan § 8.4. **Phase 4 Revision - Intake** (migration `20260514110000_phase_4_revision_intake_current_step.sql`) added the `brief` value (the in-flight 3-step intake) and flipped the new-row default from `sheet_prompt` to `brief`; existing rows are untouched. Step 3's Confirm & Continue flips `brief` -> `sheet_prompt`. Drives every page's continue logic via `stepToRoute()` (`src/lib/venue-scout/format.ts`, landed in Phase 4.2-port). Producer-facing label rendered via `currentStepToLabel()` in the same file (`brief` and `sheet_prompt` both render as "Brief" since Phase 4 Revision).
- `status` (text, NOT NULL, default `draft`): VS Pro carries this independent of `current_step`. Phase 4.5-port locks the AI-pipeline values: `draft` (initial) -> `in_progress` (research complete, in the AI funnel through deck generation) -> `complete` (Phase 4.8.2-port deck generated; first sub-phase that writes this value) or `failed` (any AI pipeline error). The Scout Index status pill reads from this column.
- `pipeline_error` (text, nullable, Phase 4.5-port; renamed from `research_error` in Phase 4.10.3-port): persisted error message from the most recent AI-pipeline run. NULL when no failure on the latest run. Originally `vs-research-venues`-only; Phase 4.7.2-port extends the same column to `vs-compile-summaries` failures (single AI-pipeline error channel per `docs/decisions.md` Phase 4.7.2-port). Phase 4.8.2-port extends again to `vs-generate-deck` failures with a structured `<CODE>: <message>` format (`CODE ∈ { AUTH_FAILED, TEMPLATE_COPY_FAILED, SLIDES_API_FAILED, NO_VENUES_INCLUDED, UNKNOWN }`) parsed by the Generating page to route to `/deck/error/<code>`. Phase 4.10.3-port renames the column from `research_error` to `pipeline_error` to match actual usage. The Researching page Realtime-subscribes to `vs_scouts` and on non-null `pipeline_error` with `status='failed'`, navigates to `/sourcing/error/research-timeout`. The Compiling page subscribes the same way and navigates to `/sourcing/error/compile-failed`. The Generating page subscribes the same way and parses the code for `/deck/error/<code>`. All three functions clear it at kickoff so a retry from a prior failure starts clean.
- `sheet_storage_path` (text, nullable): path under `sourcing_sheets` storage bucket
- `derived_columns` (jsonb, default `[]`): array of `{id, label, criteria}` alignment columns the AI selected for the single sourcing pass (collapsed onto the scout per § 8.1).
- `generated_decks` (jsonb, default `[]`, port plan § 8.5): deck history as array of `{deck_id, deck_name, version, generated_at, venue_count, slide_count, edit_url, embed_url}`. Replaces the separate `vs_pitch_decks` table.
- `deck_order` (jsonb, default `[]`): producer-controlled venue order for deck slides
- HQ-specific operational columns (no VS Pro analog):
  - `project_id` (uuid, FK to `projects`, nullable; standalone scouts allowed)
  - `archived_at` (timestamptz, nullable; null = active, non-null = archived)
  - `created_by`, `updated_by` (uuid, FK to users)
  - `last_touched_at` (timestamptz, NOT NULL, default `now()`): tracks meaningful user activity (sourcing kick-off, brief save, deck generated). Drives the Scout Index sort.
- `created_at`, `updated_at`
- Realtime: published via `supabase_realtime` publication with `REPLICA IDENTITY FULL` (port plan § 8.3) so the Researching / Compiling / Generating loading pages can subscribe to `current_step` changes via `postgres_changes`.

### vs_candidate_venues
Maps to VS Pro `venues` (renamed because HQ already has a `venues` table for the master venue list). VS Pro's `venue_notes` collapsed inline as `notes` per port plan § 2.

- `id` (uuid, PK)
- `scout_id` (uuid, FK to `vs_scouts`, ON DELETE CASCADE)
- `linked_venue_id` (uuid, FK to HQ `venues`, ON DELETE SET NULL): set by the `vs_candidate_venues_shortlist_sync` trigger (re-introduced in Phase 4.6-port) when a candidate flips `shortlisted` false to true. See the trigger entry below for the simplified shape.
- `name` (text, NOT NULL), `neighborhood`, `address` (text)
- `venue_type` (text): VS Pro stores `type`; renamed because `type` reads as a system word in TS / Postgres tooling
- `key_features` (text[], default `{}`)
- `website_url` (text)
- `size_sq_ft` (int), `capacity` (int)
- `derived_attrs` (jsonb, default `{}`)
- `recommendations`, `considerations` (text[], default `{}`): bullet lists from AI research
- `rank` (int, CHECK 0-100 or NULL): VS Pro stores `ranking_score`; renamed for parity with HQ Talent Scout's score naming
- `source` (text, NOT NULL, default `manual`, CHECK in `sheet`, `research`, `manual`)
- `shortlisted`, `pitched` (bool, default false), `include_in_deck` (bool, default true)
- `venue_overview` (text): AI-generated venue summary written by `vs-compile-summaries` (Phase 4.7-port)
- `notes` (text): inlined from VS Pro `venue_notes`. Free-text matrix notes
- `pitch_notes` (text): pitch-context notes from Shortlist
- `created_at`, `updated_at`

**Sync rule** (landed in Phase 4.6-port; see triggers section below): when `shortlisted` flips false to true, the `vs_candidate_venues_shortlist_sync` trigger checks HQ `venues` for a match (by `website_url` first, then by case-insensitive `name + neighborhood`). If no match, INSERT a new row in `venues` and set `linked_venue_id`. If match, just set `linked_venue_id`. Never updates an existing HQ venue row. The simplified version (fires only on the false→true condition) replaces the failed-attempt version dropped in Phase 4.1-port.

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
- `id`, `entity_type` (text: `project`, `venue`, `task`, etc.)
- `entity_id` (uuid)
- `action` (text: `created`, `updated`, `status_changed`, `assigned`)
- `actor_id` (FK to users)
- `payload` (jsonb)
- `created_at`

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
- `parent_id` (uuid, NOT NULL): logical FK to the parent record. Not a real FK because the parent table varies. Tightening to per-type split tables can land later if it ever matters.
- `body` (text, NOT NULL)
- `author_id` (uuid, NOT NULL, FK to `users.id`)
- `created_at` (timestamptz, NOT NULL, default `now()`)
- Index: `(parent_type, parent_id, created_at DESC)` for the newest-first per-parent timeline.
- **No `updated_at`. Notes are immutable except for deletion** per locked-decisions § 3.
- RLS: SELECT-all-authenticated, INSERT-self-author, DELETE-author-or-admin. **No UPDATE policy.**

## Postgres triggers

- `vs_candidate_venues_shortlist_sync`: re-introduced in Phase 4.6-port (migration `20260512230000_phase_4_6_port_shortlist_sync_trigger.sql`) at a simplified shape after being dropped in Phase 4.1-port. BEFORE UPDATE on `vs_candidate_venues`, fires only when `shortlisted` flips false to true. Matches HQ `venues` by `website_url` first, then by case-insensitive `name + neighborhood`; sets `linked_venue_id` on match. If no match, INSERTs a new HQ `venues` row (carrying `name`, `address`, `neighborhood`, `website_url`, `features` from `key_features`, and `created_by` pulled from the parent `vs_scouts` row) and sets `linked_venue_id`. SECURITY DEFINER so the INSERT bypasses RLS on `venues`. Never updates an existing HQ venue row; the master `venues` table is treated as append-only by this trigger.
- `tasks_completed_at_set`: when `tasks.status` flips to `Done`, set `completed_at = now()`. Body `CREATE OR REPLACE`'d in Phase 5.2.1 to compare against the mixed-case enum label after the task_status reshape.
- `deliverables_completed_at_set` (Phase 5.2.1): mirror of `tasks_completed_at_set` for the `deliverables` table; flips `completed_at` on `status -> 'Complete'`.
- `activity_log_writer`: on insert / update / delete / status-change to projects, venues, tasks, deliverables, write an `activity_log` row. Extended in Phase 5.2.1 with a `TG_OP = 'DELETE'` branch (`action = 'deleted'`, payload `{ old: to_jsonb(OLD) }`) so the new `trg_activity_log_deliverables` trigger can fire on AFTER DELETE; existing projects / venues / tasks triggers remain on AFTER INSERT OR UPDATE only.
- `updated_at_auto`: standard updated_at trigger on every table with the column.
- `handle_new_user`: on `auth.users` INSERT, mirror to `public.users` with `permission_role = 'pending'` (Phase 5.1; was `'member'` pre-rewrite). Also inserts one `notifications` row per active admin (`type='user_pending'`). Phase 5.5 rewrite: link_url changed from `/team` to `/users` (Phase 5.4 route rename); calls `notifications-dispatch` with `event_type='user_pending'` instead of `notify-admin-of-pending-user` directly. The legacy admin-notification function stays deployed one phase as a fallback. Inline durable notifications rows remain so the in-app signal lands even if the dispatch edge function 500s. Runs as service role.
- `notifications_dispatch_writer` (Phase 5.5; recipient union widened in Phase 5.7.7): AFTER INSERT OR UPDATE on `tasks`, AFTER UPDATE on `projects`. Fires `task_assigned` (assignee_id newly set or changed), `task_blocked` (status flips to `'Blocked'`), and `project_status_changed` (status changes; recipients = `project_account_managers` ∪ `project_designers` ∪ `project_members` for the project, deduped via DISTINCT) via `public.invoke_edge_function('notifications-dispatch', ...)`. SECURITY DEFINER. Reads `auth.uid()` to set `actor_id` so the dispatch fn can exclude self-notification.

## Postgres functions (RPCs)

- `start_over_scout(target_scout_id uuid) RETURNS jsonb` (Phase 4.9-port, migration `20260513000000_phase_4_9_port_start_over_rpc.sql`; CREATE OR REPLACE in Phase 4.10.3-port migration `20260514000001_phase_4_10_3_port_start_over_scout_pipeline_error.sql` to clear `pipeline_error` instead of `research_error` post-rename): transactional reset of a scout to `current_step='sheet_prompt'`. Cascade-deletes `vs_candidate_venues` (photos cascade via FK ON DELETE CASCADE). Resets `status` to `'draft'`, clears `pipeline_error`, `derived_columns` (-> `[]`), `sheet_storage_path`, `deck_order` (-> `[]`), and strips idempotency timestamps (`research_started_at`, `compile_started_at`, `deck_generation_started_at`) from `brief_data`. Keeps brief fields, `project_id`, `generated_decks` history, `brief_data.uploaded_files`. `SECURITY INVOKER`. `GRANT EXECUTE TO authenticated`.

- `promote_outlook_to_project(target_entry_id uuid) RETURNS uuid` (Phase 5.3, migration `20260516150000_phase_5_3_outlook_entries_table.sql`): atomic promotion of an `outlook_entries` row to a `projects` row. INSERTs into `projects` with `name`, `client_id`, `city` from the entry + `status='Queued'` + `created_by=auth.uid()`; UPDATEs the entry's `linked_project_id` to the new project id; returns the new project id. Pre-checks `public.is_admin()` at the top (raises ERRCODE 42501 on non-admin). Refuses to promote an already-linked entry (raises 23505). `SECURITY DEFINER` so the cross-table writes don't trip RLS mid-flight. `GRANT EXECUTE TO authenticated`.

- `reset_scout_for_deck_regenerate(target_scout_id uuid) RETURNS void` (Phase 4.10.6-port, migration `20260514100000_phase_4_10_6_port_reset_scout_for_deck_regenerate.sql`): atomic state-reset RPC for the Deck Prep regenerate flow. Called from DeckPrep.tsx `generate()` when a producer clicks Generate Deck on a scout that already has a successful prior deck. Sets `current_step='deck_prep'` + strips `deck_generation_started_at` from `brief_data` via the `jsonb -` operator + clears `status='in_progress'` + `pipeline_error=null` + bumps `last_touched_at`. Single SQL statement so there's no TOCTOU race between a read and a write (which the prior frontend read-modify-write had). Idempotent: calling on a scout that's never been deck-generated still resets the columns; the `brief_data -` is a no-op for the missing key. `SECURITY INVOKER`. `GRANT EXECUTE TO authenticated`.

## Conventions for future migrations

- **Always include explicit GRANTs** to `authenticated` and `service_role` for new tables. Auto-expose stays off as the project security default. See `supabase/migrations/20260506065157_grant_data_api_access.sql` for the canonical pattern.
- **Always use `timestamptz`** for time-of-event columns, `date` for date-only.
- **Realtime tables** must be added to the `supabase_realtime` publication and have `REPLICA IDENTITY FULL` if the UI subscribes via `postgres_changes`.
- **Storage bucket conventions** in `docs/auth-model.md`.
