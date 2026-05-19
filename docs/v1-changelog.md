# HQ v1 changelog

Mirror NYC HQ shipped its v1 cut on 2026-05-18 at commit `975568f` (annotated tag `v1.0.0`).
This changelog summarizes every sub-phase that landed between Phase 5.1 (foundations) and
Phase 5.7.14 (close-out polish) plus the 5.8.0 kickoff that fired the production deploy.

Format: chronological ship table at the top, feature-area sections below. Commit hashes are
post-history-rewrite (the 2026-05-17 cleanup absorbed 48 prior backfill commits); the
pre-rewrite hashes shown in `docs/roadmap.md` are stale and tracked for 5.8.3 reconciliation.

Cross-references: each row in the chronological table links to its commit hash via the
Mirror NYC HQ GitHub repository.

## Chronological ship table

| Sub-phase | Date | Commit | One-line summary |
|---|---|---|---|
| 5.1 | 2026-05-15 | [`39bdd8c`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/39bdd8c) | HQ Core foundations: permission-tier rewrite (admin / standard / freelance / pending); polymorphic `notes_log` table; AppShell left rail; Home dashboards. |
| 5.2.1 | 2026-05-15 | [`2938aa1`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/2938aa1) | Project workflow trio (Projects / Tasks / Deliverables) plus first-cut DataTable + BoardView + TimelineView + CalendarMonthView primitives. |
| 5.2.1 Revision | 2026-05-16 | [`0ce758f`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/0ce758f) | Wireframe-fidelity rebuild of Projects + Tasks + Deliverables surfaces against the locked Surface 04 / 07 / 13 designs. |
| 5.2.2 | 2026-05-16 | [`6214002`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/6214002) | Organizations + People + Venues entity trio plus four lookup migrations (`cities`, `project_categories`, `org_capabilities`, `venue_types`); `<InternalNotesEditor>` + `<StarRating>` added. |
| 5.2.3 | 2026-05-16 | [`519a46c`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/519a46c) | `organizations` split into `clients` + `vendors` with FK reseat across projects + people + notes_log; six new pages and five migrations. |
| 5.2 cleanup | 2026-05-16 | [`9b63650`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/9b63650) | Six small carry-forwards: `IconClients` glyph, `vendors.primary_address`, `vendor_capabilities` DELETE grant, Tags filter "any-of", DataTable lookup-hydration race fix. |
| 5.3 | 2026-05-16 | [`740ad7e`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/740ad7e) | Calendar + Outlook entries + project install / removal date ranges; per-source visibility panel persisted via implicit `saved_views` row; `promote_outlook_to_project` RPC. |
| 5.4 | 2026-05-16 | [`0e0f0ef`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/0e0f0ef) | Wiki + Account Logins + Users + Settings: four new tables (`departments`, `wiki_pages`, `credentials`, `mirror_holidays`); id-swap signup; 11 seeded wiki pages; admin pre-provisioning. |
| 5.5 | 2026-05-16 | [`82ad5d8`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/82ad5d8) | Notifications + Activity Feed + Search + States polish; bell panel; `user_notification_preferences`; Slack DM dispatch infrastructure; three `pg_cron` schedules for deliverable / task / event reminders. |
| 5.5.1 | 2026-05-16 | [`8e043ff`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/8e043ff) | Sign-in page (Surface 01). |
| 5.6.1 | 2026-05-16 | [`65e45ea`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/65e45ea) | Cross-cutting interaction primitives: `<RecordCombobox>`, `<ClickPillCell>`, phone normalization helper, Project Team card. |
| 5.6.2 | 2026-05-16 | [`04e9588`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/04e9588) | List-table reshapes across HQ Core; new `vendor_subcategories` lookup + `project_vendors` join table; parent-scoped `useLookup`. |
| 5.6.2.1 | 2026-05-16 | [`01d35ac`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/01d35ac) | 5.6.2 follow-on fixes. |
| 5.6.2.2 | 2026-05-16 | [`e1b8713`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/e1b8713) | PostgREST embed-FK disambiguation hotfix + PersonEdit Venue typeahead. |
| 5.6.3 | 2026-05-16 | [`bdae150`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/bdae150) | PersonDetail inline-edit prototype; `people.affiliation_type` enum + mutex CHECK constraint. |
| 5.6.3.1 | 2026-05-16 | [`ba89adb`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/ba89adb) | Inline-edit sweep across six HQ Core detail pages (Client / Vendor / Person / Venue / Task / Deliverable). |
| 5.6.4 | 2026-05-16 | [`2506d9d`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/2506d9d) | Visual polish batch. |
| 5.6.4.1 | 2026-05-17 | [`276df71`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/276df71) | 5.6.4 smoke-test follow-on (16 items); migration widens `notes_log.parent_type` CHECK to `outlook_entry`. |
| 5.6.5 | 2026-05-17 | [`986b953`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/986b953) | Global default views: `users.is_owner` boolean + `saved_views.scope` ('user' / 'global'); owner-only writes on the global scope via scope-aware RLS. |
| 5.6.5.1 | 2026-05-17 | [`b2de061`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/b2de061) | Owner delegation + sort persistence propagation + Team page account-link fixes; `users_protect_admin_columns` gains an is_owner write gate plus self-revoke block. |
| 5.6.5.2 | 2026-05-17 | [`4f47cfd`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/4f47cfd) | `last_active_at` stamping throttled to a 5-minute floor per user via sessionStorage. |
| 5.7.1 | 2026-05-17 | [`b7a5238`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/b7a5238) | Global cleanup + `<RecordCombobox>` polish + Quick-Add wiring across the rail and Home dashboards. |
| 5.7.2 | 2026-05-17 | [`5e63484`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/5e63484) | @-mentions feed + append-only Notes on Tasks and Deliverables; `note_mentions` table; `notes_log.parent_type` widened to `task` + `deliverable`. |
| 5.7.3 | 2026-05-17 | [`2e61571`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/2e61571) | Detail-page polish + fixed-position `<StickySaveBar>` + Status Notes on projects swapped to `<InternalNotesEditor>` (append-only). |
| 5.7.4 | 2026-05-17 | [`aab31b9`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/aab31b9) | List-page polish + TaskEdit hard-delete; combined "Account / Design Leads" column on Projects; new `purple` StatusToken. |
| 5.7.5 | 2026-05-17 | [`43eeb27`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/43eeb27) | Deliverables status reshape: drop `In Progress` (Upcoming / Complete / Skipped final set); auto-task lifecycle helper writes `tasks.source_deliverable_id` with CASCADE FK. |
| 5.7.6 | 2026-05-17 | [`612c8e8`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/612c8e8) | Global FilterBar distinct-values picker; `distinctValuesByField` prop wired across all nine HQ Core list pages. |
| 5.7.7 | 2026-05-17 | [`c8bc789`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/c8bc789) | `project_members` general-team join + ProjectEdit reshape + Dashboard read-only links + Tags chips + Team filter + DataTable inline quick-add prop. |
| 5.7.8 | 2026-05-17 | [`9bf068e`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/9bf068e) | Venues + Vendors filter overhaul; SavedViews moved inline with FilterBar; FilterBar op locked to "is" globally with `allowIsNot` opt-in for Tasks + Deliverables. |
| 5.7.9 | 2026-05-17 | [`3d5f1cc`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/3d5f1cc) | Calendar overhaul: color sweep + pagehead reshape + My Tasks layer + Day / Week / Month view switcher; activeView + showMyTasks persist via `__calendar_default` saved-view jsonb. |
| 5.7.10 | 2026-05-18 | [`367fa0e`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/367fa0e) | Settings Lookup Lists merge + Wiki image upload (private bucket, 1-year signed URLs, diff-on-save cleanup); Integrations card stubbed to "Coming Soon". |
| 5.7.11 | 2026-05-18 | [`d16c4c1`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/d16c4c1) | Vendor Files & Assets URL list (`vendor_files` table + `<VendorFilesEditor>`); VendorDetail title-width fix; Internal Rating caption removal. |
| 5.7.12 | 2026-05-18 | [`60f6ff0`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/60f6ff0) | Profile + Settings split surfaces; extended `users_protect_admin_columns` to gate `is_owner` / `email` / `full_name`; dropped Creative department; 5.7.2 mention-demotion reverts. |
| 5.7.13 | 2026-05-18 | [`8eea759`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/8eea759) | Vendor team rating: per-user `vendor_ratings` table + team aggregate; drop legacy `vendors.internal_rating`; `<StarRating>` extended with `md` size + half-star rendering. VendorDetail subtitle reshape; "Internal" pill inline. |
| 5.7.14 | 2026-05-18 | [`59a5dac`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/59a5dac) | Leftovers cleanup + carry-forward triage: drop projects legacy notes, `notes_log` orphan sweep migration, MyWeekStrip today-forward + pagination, ProjectActivity Realtime + child-entity rollup, coral sweep, PostgREST embed convention documented. |
| 5.8.0 | 2026-05-18 | [`975568f`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/975568f) | HQ v1 kickoff: roadmap rollover; annotated tag `v1.0.0` pinned; fires the deferred Phase 5.7 Netlify deploy that the 5.7.14 squash suppressed. |
| 5.8.8 | 2026-05-19 | `<5.8.8>` | Auth pre-provision sign-in regression hotfix: encode 5.8.5.1's missed GRANTs on `handle_new_user` + `users_protect_admin_columns`; restore the Phase 5.4 swap block in `handle_new_user` (dropped by 5.5 rewrite) and scope new-user email dispatch to active owners only (bell-panel stays admin-wide); add symmetric `trg_users_align_id_to_auth` BEFORE INSERT trigger so pre-provisioning is order-agnostic; one-time data repair on `jobs@mirrornyc.com` mismatched id; OAuth `redirect_uri` sanitization in `useAuth.tsx` + `ProtectedRoute.tsx`. |

## Foundations

Phase 5.1 established the HQ Core spine: the new four-value `permission_role` enum
(admin / standard / freelance / pending) replaced the legacy member / producer / admin
trio, the polymorphic `notes_log` table landed (parent_type + parent_id; insert-self,
delete-author-or-admin, no UPDATE), the AppShell left-rail shipped as the persistent
chrome for every HQ surface, and Home dashboards composed the per-tier landing cards.
Phase 5.5.1 backfilled the public sign-in page (Surface 01) on top of the existing
admin-pre-provisioned signup flow.

- **Tables.** `notes_log`, `permission_role` enum rewrite.
- **Components.** `AppShell`, `LeftRail`, `RailItem`, `RailFooter`, `TopBar`, `HomeAdminDashboard`, `HomeStandardDashboard`, `HomeFreelanceDashboard`, `SignInPage`.
- **Triggers.** `handle_new_user` rewrite (pending tier; admin notification fan-out; id-swap path added later in 5.4).
- **Edge functions.** `notify-admin-of-pending-user` (later wrapped by `notifications-dispatch` in 5.5).
- **Sub-phases.** [`39bdd8c`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/39bdd8c) (5.1), [`8e043ff`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/8e043ff) (5.5.1).

## Database surfaces

Projects, Tasks, Deliverables, Clients, Vendors, People, and Venues each got a list page
(table / board / timeline / calendar views per surface), a detail page (read + inline-edit
on all but ProjectDetail's h1), and an edit page (form-style fallback). Inline-edit
primitives let producers update fields without leaving the detail page; status pills are
click-to-change with optimistic UI + Realtime rollback. Phone numbers normalize on save;
PostgREST embed-FK disambiguation is documented in `docs/conventions.md`.

Highlights by surface:

- **Projects.** ProjectsList table + board + timeline + calendar views; ProjectDetail
  with Status Notes + Activity card + child-entity rollup; ProjectEdit with `project_members`
  general join (5.7.7). Install / Live / Removal date ranges (5.3). Status enum locked at
  14 values (5.2.1). Legacy `status_notes` + `client_notes` columns dropped in 5.7.14
  after the 5.7.3 UI swap to `notes_log` and 5.7.7 removal of client_notes UI.
- **Tasks.** TasksList table + board; in-table quick-add (5.7.7); per-row inline title
  edit; TaskDetail with hard-delete from edit page (5.7.4); auto-task lifecycle linked to
  deliverables via `tasks.source_deliverable_id` (5.7.5).
- **Deliverables.** DeliverablesList table + board + calendar; status enum reshape
  (dropped `In Progress` in 5.7.5; Upcoming / Complete / Skipped final set); auto-task
  helper writes `tasks.source_deliverable_id` with ON DELETE CASCADE (5.7.5 follow-up).
- **Vendors.** VendorsList table; VendorDetail with Internal Rating (replaced by Team
  Rating in 5.7.13); Files & Assets URL list (5.7.11); `vendor_categories` +
  `vendor_subcategories` + `vendor_capabilities` lookup tables; "Internal" pill inline
  with the subtitle (5.7.13).
- **Clients.** ClientsList table; ClientDetail with Primary Contact composite +
  Deliverables + Projects columns; vendors split out of the legacy `organizations` table
  (5.2.3).
- **People.** PeopleList table; PersonDetail inline-edit prototype (5.6.3) became the
  pattern for the rest. Affiliation enum + mutex CHECK on `client_id` / `vendor_id`.
- **Venues.** VenuesList table; VenueDetail with Venue Type pill + subtitle reshape
  (5.7.13); `venue_types` + `venue_venue_types` join; `venue_rate_history` append-only
  table.

Tables shipped: `projects`, `tasks`, `deliverables`, `clients`, `vendors`, `people`,
`venues`, `project_account_managers`, `project_designers`, `project_members`,
`project_vendors`, `project_venues`, `venue_venue_types`, `venue_contact_people`,
`venue_rate_history`, `vendor_files`, `vendor_ratings`, `vendor_categories`,
`vendor_subcategories`, `vendor_capabilities`, `cities`, `project_categories`,
`venue_types`, `departments`, `notes_log`.

Sub-phases: [`2938aa1`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/2938aa1) (5.2.1),
[`0ce758f`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/0ce758f) (5.2.1 Revision),
[`6214002`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/6214002) (5.2.2),
[`519a46c`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/519a46c) (5.2.3),
[`9b63650`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/9b63650) (5.2 cleanup),
[`04e9588`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/04e9588) (5.6.2),
[`01d35ac`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/01d35ac) (5.6.2.1),
[`e1b8713`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/e1b8713) (5.6.2.2),
[`aab31b9`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/aab31b9) (5.7.4),
[`43eeb27`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/43eeb27) (5.7.5),
[`c8bc789`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/c8bc789) (5.7.7),
[`9bf068e`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/9bf068e) (5.7.8),
[`d16c4c1`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/d16c4c1) (5.7.11),
[`8eea759`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/8eea759) (5.7.13).

## Calendar + Outlook

Phase 5.3 shipped the unified `/calendar` route plus the admin-only `/outlook` pipeline
view. CalendarMonthView renders projects + tasks + deliverables + outlook entries on a
shared month grid; per-source visibility persists via an implicit `saved_views` row keyed
`__calendar_default`. The new `outlook_entries` table carries Outlook pipeline rows with
year + month + week + budget + confidence; `promote_outlook_to_project` is a SECURITY
DEFINER RPC that converts an entry to a Queued project atomically. Phase 5.7.9 overhauled
the Calendar surface: pagehead reshape, color sweep, My Tasks personal layer, Day / Week /
Month view switcher, and persisted activeView via the same saved-view jsonb.

- **Tables.** `outlook_entries`, `mirror_holidays` (5.4).
- **Enums.** `outlook_confidence` (On Radar / Likely / Confirmed / Complete).
- **RPCs.** `promote_outlook_to_project`.
- **Routes.** `/calendar` (per-source presets via `?source=projects|tasks|deliverables`), `/outlook`.
- **Sub-phases.** [`740ad7e`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/740ad7e) (5.3), [`3d5f1cc`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/3d5f1cc) (5.7.9).

## Wiki + Settings + Account Logins

Phase 5.4 shipped four new tables (`departments`, `wiki_pages`, `credentials`,
`mirror_holidays`) plus the `/wiki`, `/settings`, `/users`, and `/account-logins` routes.
Eleven wiki pages seeded (Welcome & Mission, Team Directory, How We Work, Preferred
Vendors, Key Partners, Forms & Important Documents, Account Logins, Pricing & Markup
Guide, Design File Prep & Specs, Billing & PO Workflow, Shipping & Messengers).
Credentials table is SELECT-gated to admin + standard (freelance blocked); writes opened
to non-freelance in feedback round 2. `handle_new_user` gained an email-match id-swap
path so admins can pre-provision users by email. Phase 5.7.10 merged Lookup Lists into a
single Settings surface, added the Wiki image upload pipeline (private `wiki_images`
bucket, 1-year signed URLs, diff-on-save cleanup), and stubbed the Integrations card to
"Coming Soon".

- **Tables.** `departments`, `wiki_pages`, `credentials`, `mirror_holidays`.
- **Storage buckets.** `wiki_images` (private; admin-only writes; 1-year signed URLs).
- **Routes.** `/wiki`, `/wiki/:slug`, `/settings`, `/users`, `/users/:id`, `/account-logins`.
- **Sub-phases.** [`0e0f0ef`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/0e0f0ef) (5.4), [`367fa0e`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/367fa0e) (5.7.10).

## Notifications + Activity Feed + Search

Phase 5.5 shipped the notifications spine: durable `notifications` table with `delivered_slack`
column; per-user `user_notification_preferences` (in_app + slack_dm per trigger_key);
`notifications_dispatch_writer` trigger function fanning out to `notifications-dispatch`
edge function; `notifications` added to `supabase_realtime` with REPLICA IDENTITY FULL so
the bell panel re-renders on insert. Three pg_cron schedules cover deliverable-due-3d /
task-due-today / event-date-today reminders. Activity Feed at `/activity` reads the
`activity_log` write-side that the `activity_log_writer` trigger has been populating since
5.1. Search at `/search` matches names + tags across projects + tasks + deliverables +
people + clients + vendors + venues. Phase 5.7.2 added @-mentions: `note_mentions` join
table, parent_title resolved per parent_type, dispatch trigger fires `mention` event_type,
activity_log writer logs one row per mention.

- **Tables.** `notifications`, `user_notification_preferences`, `note_mentions`, `activity_log`.
- **Edge functions.** `notifications-dispatch`.
- **Triggers.** `notifications_dispatch_writer`, `activity_log_writer_note_mention`.
- **Cron jobs.** `hq-cron-deliverable-due-3d`, `hq-cron-task-due-today`, `hq-cron-event-date-today`.
- **Routes.** `/activity`, `/search`, bell panel in TopBar.
- **Sub-phases.** [`82ad5d8`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/82ad5d8) (5.5), [`5e63484`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/5e63484) (5.7.2).

## Profile + Team management

Phase 5.6.5 added the owner concept: `users.is_owner` boolean (single seeded owner) plus
`saved_views.scope` ('user' / 'global') with owner-only writes on the global branch via
scope-aware RLS. Phase 5.6.5.1 extended `users_protect_admin_columns` with an is_owner
write gate plus a self-revoke block so the last-owner-locks-themselves-out failure mode is
structurally impossible. Phase 5.7.12 split Profile + Settings into separate surfaces;
extended the admin-columns trigger to gate `is_owner` / `email` / `full_name`; dropped the
legacy Creative department (merged into Design); and added the choose-only Departments
picker via a new `<RecordCombobox allowCreate={false}>` prop. Slack handle field with `@`
prefix glyph + hint caption; Slack DM dispatch verified end-to-end after `SLACK_BOT_TOKEN`
landed.

- **Tables.** `users` (gains `is_owner`, `role_title`, `department_id`, `slack_handle`, `slack_user_id`, `last_active_at`).
- **Triggers.** `users_protect_admin_columns` (extended).
- **Routes.** `/users`, `/users/:id`, `/settings/profile`, `/settings/notifications`.
- **Sub-phases.** [`986b953`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/986b953) (5.6.5), [`b2de061`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/b2de061) (5.6.5.1), [`60f6ff0`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/60f6ff0) (5.7.12).

## Cross-cutting primitives

The cross-cutting primitives evolved across the 5.6.X and 5.7.X rounds, settling into a
canonical interaction kit by the end of Phase 5.7. DataTable carries table / board /
timeline / calendar variants per surface; FilterBar gained a global distinct-values picker
(5.7.6) and a globally-locked "is" op with `allowIsNot` opt-in (5.7.8); SavedViewsDropdown
moved inline with FilterBar (5.7.8); StickySaveBar switched to fixed positioning (5.7.3);
RecordCombobox absorbed phone normalization (5.6.1), inline quick-add (5.7.7), and
`allowCreate` opt-out (5.7.12); ClickPillCell handles click-to-change status pills with
optimistic UI + Realtime rollback; InlineEditText + InlineTagInput power detail-page
inline-edit; MiniCreateModal handles parent-scoped inline-add; StarRating gained `md` size
+ half-star read-only rendering (5.7.13).

- **Components.** `DataTable`, `FilterBar`, `SavedViewsDropdown`, `BoardView`,
  `TimelineView`, `CalendarMonthView`, `RecordCombobox`, `ClickPillCell`,
  `InlineEditText`, `InlineTagInput`, `MiniCreateModal`, `StickySaveBar`, `StarRating`,
  `EmptyState`, `LoadError`, `PermissionDenied`, `InternalNotesEditor`,
  `VendorFilesEditor`, `MyWeekStrip`, `ProjectActivity`.
- **Sub-phases.** [`65e45ea`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/65e45ea) (5.6.1), [`bdae150`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/bdae150) (5.6.3), [`ba89adb`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/ba89adb) (5.6.3.1), [`2506d9d`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/2506d9d) (5.6.4), [`276df71`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/276df71) (5.6.4.1), [`b7a5238`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/b7a5238) (5.7.1), [`2e61571`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/2e61571) (5.7.3), [`612c8e8`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/612c8e8) (5.7.6), [`59a5dac`](https://github.com/jimmiebaugh/mirror-nyc-hq/commit/59a5dac) (5.7.14).

---

**Phase 5.8 (HQ v1 release pass) is the active phase.** 5.8.1 ships this changelog;
5.8.2 clears the `code-observations.md` backlog; 5.8.3 audits the docs (both repo-side
and Cowork-side); 5.8.4 closes Phase 5.8 with the second batched Netlify deploy.
Post-5.8: Phase 5.9 (Talent Scout review), 5.10 (Venue Scout review), 5.11 (mobile
styling pass). See `docs/roadmap.md` for the full forward plan.
