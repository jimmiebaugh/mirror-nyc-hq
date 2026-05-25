# HQ v1 changelog

Mirror NYC HQ shipped its v1 cut on 2026-05-18 at the `v1.0.0` tag and has continued shipping through Phase 5.11.2 (2026-05-23). This changelog covers every sub-phase from Phase 3 (Talent Scout port) and Phase 4 (Venue Scout port) through Phase 5.11.2 (structural consistency).

Format: chronological ship table at the top, feature-area sections below.

**Commit hashes:** the chronological ship table preserves the original sub-sub-phase hashes for historical fidelity, but git history has since been rebased so each X.X sub-phase is now ONE squashed commit on `main` (Phase 5.1 = `fe04a5d`, 5.2 = `56b0484`, 5.3 = `af59516`, 5.4 = `e528999`, 5.5 = `9c73788`, 5.6 = `b62af98`, 5.7 = `9d2bdc4`, 5.8 = `8a468d2`, 5.9 = `81cdaf2`, 5.10 = `5d57b26`; 5.11.0 = `a2adbaf`, 5.11.1 = `38f5374`, 5.11.2 = `c19b332` — these three retain .Y granularity). The pre-rebase per-sub-sub-phase hashes in the table below are useful as historical labels but no longer resolve in `git log`.

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
| 5.8.5 | 2026-05-18 | post-rebase: `8a468d2` | Security pass + accept-risk docs: 7 migrations (function search_path pinning x5, REVOKE EXECUTE on SECURITY DEFINER fns, RLS init-plan rewrite of 17 policies, storage bucket listing tighten, F001 credentials column encryption via pgsodium AEAD with three SECURITY DEFINER RPCs). Tier 3 docs additions. 18 edge function redeploys. |
| 5.8.5.1 | 2026-05-18 | post-rebase: `8a468d2` | Hotfix re-GRANT EXECUTE on RLS helper functions (`is_admin` / `is_producer_or_admin` / `current_user_role`) after 5.8.5 REVOKE FROM PUBLIC broke RLS predicate evaluation for authenticated callers. Production-restored within minutes via Dashboard SQL; migration encodes the GRANT for future rebuilds. |
| 5.8.6 | 2026-05-18 | post-rebase: `8a468d2` | Tier 2 surface reduction: `npm audit fix` bumps closing HIGH XSS; DOMPurify wrap on WikiProseRenderer; 28 unused shadcn UI deletes + 23 unused deps uninstalled (CSS bundle -26KB); Anthropic redactSecrets + AbortSignal.timeout(60s); 11 mechanical lint fixes; sonner toaster migrated to shadcn; secrets/ relocated outside repo. |
| 5.8.7 | 2026-05-18 | post-rebase: `8a468d2` | Phase 5.8 close + audit v1.1 quick wins (N001 worktrees ignore + sweep, N002 next-themes uninstall, N003 generated-types eslint ignore, N005 credentials RPC predicate refactor via `is_producer_or_admin()`, N006 credentials reveal audit log). `v1.1.0` annotated tag pinned. |
| 5.8.8 | 2026-05-19 | post-rebase: `8a468d2` | Auth pre-provision sign-in regression hotfix: encode 5.8.5.1's missed GRANTs on `handle_new_user` + `users_protect_admin_columns`; restore the Phase 5.4 swap block; scope new-user email dispatch to active owners only (bell-panel stays admin-wide); add symmetric `trg_users_align_id_to_auth` BEFORE INSERT trigger so pre-provisioning is order-agnostic; one-time data repair on `jobs@mirrornyc.com` mismatched id; OAuth `redirect_uri` sanitization in `useAuth.tsx` + `ProtectedRoute.tsx`. |
| 5.8.8.1 | 2026-05-19 | post-rebase: `8a468d2` | ON UPDATE CASCADE on all 42 FKs pointing at `public.users.id`. Phase 5.4 dropped the outbound FK to `auth.users(id)` but missed adding ON UPDATE CASCADE to the inbound side; the swap UPDATE inside `handle_new_user` would FK-violate the moment a pre-provisioned user had any project_members / tasks.assignee_id / etc. attachment. |
| 5.9.1 | 2026-05-19 | post-rebase: `81cdaf2` | Bulk import shared primitive: `bulk_import_sessions` + `bulk_import_drafts` tables; `bulk-import` edge function scaffold (admin-gated, transactional shell); HQ-side sheet parser; shared UI (`BulkImportPage` + `UploadStep` + `MapStep` + `DedupeStep` + `ImportGrid` virtualized); EntityConfig registry; Settings card. |
| 5.9.2 | 2026-05-19 | post-rebase: `81cdaf2` | Projects importer + `bulk_import_commit_projects` SECURITY DEFINER RPC (atomic cross-table commit) + 8 ImportGrid cell editors; MapStep RecordCombobox typeahead; FilterBar `presence` type + "Bulk Imported" chip. |
| 5.9.3 | 2026-05-19 | post-rebase: `81cdaf2` | Vendors importer + `bulk_import_commit_vendors` RPC. Category/subcategory FK refs, capabilities as text[] of names with auto-create, preferred bool coerced from "true"/"false" string. |
| 5.9.3.1 | 2026-05-19 | post-rebase: `81cdaf2` | `vendors.nationwide` bool + generic `applyFilters` `fieldMatchAll` hook so nationwide vendors surface under every city chip. Green "National" pill on VendorsList. |
| 5.9.3.2 | 2026-05-19 | post-rebase: `81cdaf2` | `vendors.general_email` company-level email distinct from primary contact's; VendorDetail relabels "Email"/"Phone" → "Contact Email"/"Contact Phone". |
| 5.9.3.3 | 2026-05-19 | post-rebase: `81cdaf2` | Vendor importer creates a vendor-affiliated `people` row per contact (Primary Contact); vendor-scoped dedupe. |
| 5.9.4 | 2026-05-20 | post-rebase: `81cdaf2` | Venues importer + `bulk_import_commit_venues` RPC. `venue_types` written through the `venue_venue_types` JOIN; per-row contact creates Venue-affiliated `people` row + `venue_contact_people` join. `exclusive_vendor_ids` deliberately NOT importable. |
| 5.9.5 | 2026-05-20 | post-rebase: `81cdaf2` | Bulk-import audit page at `/settings/bulk-import/history`; `_smoke` route + handler + page + union member removed; Phase 5.9 deploy fired. |
| 5.9.6 | 2026-05-21 | post-rebase: `81cdaf2` | Bulk-import undo (7-day window): two `uuid[]` tracking columns on `bulk_import_sessions`; new `bulk_import_undo` SECURITY DEFINER RPC; edge fn `mode: "undo"` + `dry_run`. UI Undo button in audit-page detail rail with cascade-warning AlertDialog. |
| 5.9.7 | 2026-05-21 | post-rebase: `81cdaf2` | Import Event Day Rate (appends one `event_day` `venue_rate_history` row per venue, dated `current_date`, only when amount changed) + `venues.general_email`. VenueDetail Venue Details card reordered; duplicate Venue Slide link removed. |
| 5.10.0 | 2026-05-21 | post-rebase: `5d57b26` | `venues.notes` → `venues.about_venue` rename (OID-preserving) + new `hq-generate-venue-about` edge function (first `callClaude('hq', ...)` consumer). HQ generator is TOOL-LESS with evergreen `ABOUT_VENUE_SYSTEM` prompt + web_search; Generate / Regenerate buttons on VenueDetail + VenueEdit. Breaking-rename coordinated migration + functions + frontend in one push. |
| 5.10.1 | 2026-05-22 | post-rebase: `5d57b26` | VenueEdit + VenueDetail layout refresh: 2-column label-above Details cards, `card-headbar` headers, Master Venue Deck Slide card, Features as tag input. First responsive `@media` breakpoints; `.label-form` coral → grey app-wide. |
| Codebase audit (v1) | 2026-05-22 | `34b32d4` | Slim-down + legibility pass over the HQ frontend, reviewed cold by Codex. Dead Lovable scaffolding removed; superseded components removed; 23 unused deps + the stray `bun.lockb` dropped; ~66 route components converted to `React.lazy` behind Suspense; bulk-import parser dynamic-imports `xlsx`. Initial bundle 2.24MB → ~586KB. `.env` untracked + `.env.example` added. |
| Triage cleanup | 2026-05-22 | (folded into `34b32d4`) | Verified-row cleanup: `VenueTypePill` extracted to shared, `prettyHost` extracted to shared, em-dash sweep on Settings Integrations caption, `CandidateSearch` renamed to `candidateSearch.ts`, dead `poolStatus.ts` deleted. |
| 5.11.0 | 2026-05-22 | `a2adbaf` | UX/design-system audit + implementation pass. Focus rings, mobile shell (off-canvas hamburger drawer below 1024px) + 44px tap targets, `--info` + `--purple` tokens, coral link contrast via `--primary-hover`, `hq-` chrome convergence (dead Phase 5.2.1 block removed, Home + ClickPillCell migrated to unprefixed canonical), shadcn `rounded-sm`/`rounded-md` resolved to `var(--radius)`, edit-page card headers converted to `card-headbar` + `.h-card`. `src/index.css` net -382 lines. |
| 5.11.1 | 2026-05-23 | `38f5374` | Detail-page polish + list-table standardization + managed Project Tags / Venue Features lookups. Plain titles, `.detail-meta`, DField rows; Project/Venue/Vendor/Client/Person/Task/Deliverable polish; Contacts + relationship-card patterns; de-chipped tag styling; list-table standardization; global token + chrome adjustments. |
| 5.11.2 | 2026-05-23 | `c19b332` | Structural consistency. W1: TaskDetail + DeliverableDetail eyebrow / plain h1 / detail-meta / hero `ClickPillCell` status; `.crumb` back links; stacked-identifier `--primary-hover` color. W2: extracted `DField`, `HQFormField`, `ContactsCard`, `WebsiteActionButton`, neutral `prettyHost`, `ListPageChrome`. W3: VendorEdit Tags dropped (Capabilities is vendor tag set); Task/Deliverable/Project edit shell alignment; `RecordCombobox multi` for `blocked_by` + assignees; PersonDetail Associated Venues = standalone relationship card. W4: docs canon recorded. |

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

## Phase 5.8 — HQ v1 release pass + security audit + cleanup

Phase 5.8 closed the HQ v1 release window and ran a full Tier 1 / Tier 2 / Tier 3 audit pass plus an auth-pre-provision hotfix sweep. **Security (5.8.5):** seven migrations covering function search_path pinning, REVOKE EXECUTE on SECURITY DEFINER fns, RLS init-plan rewrite across 17 policies, storage bucket listing tighten, and `credentials` column encryption via pgsodium AEAD with three SECURITY DEFINER RPCs (`credentials_create` / `credentials_set_password` / `credentials_reveal_password`). **Hotfix (5.8.5.1):** re-GRANT EXECUTE on `is_admin` / `is_producer_or_admin` / `current_user_role` after the 5.8.5 REVOKE FROM PUBLIC silently broke RLS predicate evaluation for authenticated callers. **Surface reduction (5.8.6):** CVE bumps closing HIGH XSS GHSA-2w69-qvjg-hvjx, DOMPurify wrap on wiki HTML, 28 shadcn UI deletes + 23 unused deps uninstalled (CSS bundle -26KB), Anthropic timeouts + redaction, sonner → shadcn toast migration, `secrets/` moved out of repo. **Audit v1.1 close (5.8.7):** worktree gitignore + sweep, `next-themes` uninstall, generated-types eslint ignore, credentials RPC predicate refactor via the helper, credentials reveal audit-log row; `v1.1.0` tag pinned. **Auth hotfix (5.8.8 + 5.8.8.1):** restore the Phase 5.4 swap block dropped during the 5.5 notifications rewrite, add the symmetric `trg_users_align_id_to_auth` BEFORE INSERT trigger so pre-provisioning is order-agnostic, scope new-user email dispatch to active owners only (bell-panel stays admin-wide), sanitize the OAuth `redirect_uri` poisoning failure mode, flip all 42 FKs pointing at `public.users.id` to ON UPDATE CASCADE. Now lives under the single squashed commit `8a468d2`.

## Phase 5.9 — Bulk Import (Projects + Vendors + Venues)

Cross-cutting bulk-import primitive plus per-entity wiring. CSV-only across all three entities; map step for unknown refs; admin-only; dedupe defaults to skip with per-row override; configurable column picker; fresh HQ-side parser (`_shared/hqSheetParser.ts`, deliberately separate from `vs-parse-sheet`).

- **Tables.** `bulk_import_sessions`, `bulk_import_drafts`; per-entity `bulk_import_session_id` columns on `projects`, `vendors`, `venues` (partial indexes); `vendors.nationwide`, `vendors.general_email`, `venues.general_email` added during the per-entity rounds.
- **RPCs.** `bulk_import_commit_projects`, `bulk_import_commit_vendors`, `bulk_import_commit_venues`, `bulk_import_undo` — all SECURITY DEFINER, all admin-re-checked, atomic cross-table commits.
- **Edge function.** `bulk-import` (verify_jwt = true; admin re-check; entity-handler registry; `mode: "preview" | "commit" | "undo"`).
- **UI.** Shared `BulkImportPage` orchestrator + `UploadStep` + `MapStep` + `DedupeStep` + virtualized `ImportGrid` + `ColumnPickerDrawer` + audit page at `/settings/bulk-import/history`. "Bulk Imported" `presence` filter chip on each list page.
- **Cross-cutting:** Stepper component moved from `talent-scout/` to `ui/`; FilterBar gains `presence` field type; lookup cache `invalidateLookup` (so import-created lookups appear without reload); generic `applyFilters` `fieldMatchAll` hook (powers `nationwide` vendors auto-passing every city chip).

Squashed under `81cdaf2`.

## Phase 5.10 — Venue work (about_venue rename + AI generator + layout refresh)

**5.10.0:** `venues.notes` renamed to `venues.about_venue` (OID-preserving) — `notes` collided with the polymorphic `notes_log` table. New `hq-generate-venue-about` edge function is the first `callClaude('hq', ...)` consumer; **tool-less by design** (an evergreen `ABOUT_VENUE_SYSTEM` prompt in `_shared/venueOverview.ts` + `web_search` + `tool_choice: auto`; Claude replies as plain text). Removes the `feedback_tool_choice_collapse` failure class outright (no forced custom tool to collapse). Generate / Regenerate About Paragraph buttons on VenueDetail (card header) + VenueEdit (About Venue section header; disabled while the form is dirty). Regenerate gates behind an AlertDialog. Breaking-rename coordination: migration + function deploy + frontend ship as one Jimmie-approved push.

**5.10.1:** VenueEdit + VenueDetail layout refresh — 2-column label-above Details card with `card-headbar` section headers; standalone Venue Types card folded into Details; "Links & References" → "Master Venue Deck Slide" card; Features became a tag input. First responsive `@media` breakpoints (form pairs collapse below 640px). `.label-form` coral → grey app-wide.

Squashed under `5d57b26`. **VS convergence to the shared overview prompt** (relocate generation to deck-prep, drop the brief, cut considerations, add web_search, push to `venues.about_venue` on Generate Deck) is deferred to Phase 5.12 — full plan in `docs/roadmap.md` § 5.12.

## Phase 5.11 — UX and structural consistency

Design-system audit sequence after the 5.10 venue work. Three sub-phases shipped between 2026-05-22 and 2026-05-23; each is a separate commit on `main`.

**5.11.0 (`a2adbaf`) — UX/design-system audit + implementation pass.** Parallel Claude + Codex audits, then combined implementation. Focus rings (shared `:focus-visible` coral ring on `.btn` family + view switcher / tabs / toggle / checkbox / filter chips / saved-views / rail nav / text links / combobox picker / topbar controls). Mobile shell: rail collapses to off-canvas hamburger drawer below 1024px; `.savebar` / `.actionbar` freed from `left:232px`; primary + secondary tap targets ≥44px on mobile. Tokens: `--info` set to canonical `#06B6D4`, new `--purple` `#B57BF5`, both exposed as Tailwind utilities; 16 hardcoded cyan/purple hex literals replaced. Coral link contrast: in-content links switched from `--primary` to `--primary-hover`, clearing AA on `--surface-alt` at 4.50:1. `hq-` chrome convergence: dead Phase 5.2.1 `hq-` block removed; Home + ClickPillCell migrated to the unprefixed canonical `.card` / `.pill .p-<token>` / `.stat` / `.tlink` / `.tbl` / `.activity-row` / `.actdot` / `.block-lbl`; `.hq-pill-lg` renamed to `.pill-hero`; shell-only `.hq-rail` / `.hq-topbar` / `.hq-iconbtn` / `.hq-content` etc. kept as designed. Edit-page card headers converted to `card-headbar` + `.h-card`. Tailwind `rounded-sm` / `rounded-md` now resolve to `var(--radius)`. `src/index.css` net -382 lines. Closes `code-observations.md` Frontend #13 / #21 / #22 / #23 / #24 / #25 + Docs #5; opens Frontend #26 (`--surface-raised` AA borderline, accept-risk).

**5.11.1 (`38f5374`) — Detail-page polish + list-table standardization + managed tag fields.** Follow-on round of UX-audit smoke fixes building on 5.11.0. Detail pages converged around plain titles, `detail-meta`, DField rows. Project / Venue / Vendor / Client / Person / Task / Deliverable polish. Contacts + relationship-card patterns. Managed Project Tags + Venue Features lookups (`project_tags` + `venue_features` tables, backed by the same managed-lookup pattern as `vendor_capabilities`). De-chipped tag styling. List-table standardization. Global token + chrome adjustments. Opened code-observations Frontend #27 + #28 + #29.

**5.11.2 (`c19b332`) — Structural consistency.** Four waves. **W1 (visible chrome):** TaskDetail + DeliverableDetail eyebrow + plain h1 + `detail-meta` + hero `ClickPillCell` status + short due dates + compact Details rows; TaskDetail editable Blocked By. Project / Task / Deliverable detail back links use `.crumb`. List headers `row between list-head`. Stacked identifiers (Projects / Tasks / People) on `hsl(var(--primary-hover))`, 13.5px leads, 12px sublines. Quiet count footers. **W2 (shared lifts):** extracted `DField`, `HQFormField`, `ContactsCard`, `WebsiteActionButton`, neutral `prettyHost` in `src/lib/url.ts`, and `ListPageChrome`. Venues + Vendors share search + chip-radio chrome; PeopleList stays the documented colored-affiliation variant. Removed the venue-scout `prettyHost` export. **W3 (product-call changes):** VendorEdit Tags removed (Capabilities is the visible vendor tag-like set). TaskEdit + DeliverableEdit moved to 880px centered Details shells. ProjectEdit gained the Project eyebrow + Details card grouping while staying wide. Task `blocked_by` + Deliverable `assignees` use `RecordCombobox multi`. PersonDetail Associated Venues moved to its own standalone relationship card; Affiliation field reads "Venue contact." **W4 (docs):** `docs/design-system.md` documents list / detail / multi-record / edit / Venue Slide / extracted-component canon. `docs/decisions.md` records the 5.11.2 decisions. Resolved code-observations rows #30 to #37 + #39; #38 deferred to a separate primary-contact product / data-model round.

---

## Phase 3 — Talent Scout port (siloed reference)

The 11 sub-phases that ported Talent Scout from `mirror-talent-scout` to HQ Core are summarized in `docs/roadmap.md` § Phase 3. Talent Scout itself was originally shipped as a standalone Lovable app; Phase 3.X lifted it into HQ as an admin-only sub-route. Highlights: 3.4 ran the chunked Gmail pull pipeline (`BATCH_SIZE=8`); 3.5 added CandidateDetail + status dropdown + re-eval; 3.6 added the Final Review packet (pdf-lib + signed-URL email); 3.7 added referral ingestion (forward-chain walker); 3.8 added pg_cron + 6 cron jobs (scheduled pulls + 3 watchdogs + storage cleanup + monthly spend reset); 3.10 added scorecard refinement; 3.11 restored substantive describer fields. Per-sub-phase decisions live in `docs/decisions.md` under the Phase 3 sections. The original sub-phase commits were squashed into Phase 3.2 = `9badf38`, Phase 3.3 = `8331a6a`, Phase 3.4 = `2d8dfc7`, Phase 3.5 = `62147f7`, Phase 3.5b = `ef75f15`, Phase 3.6 = `a01cacb`, Phase 3.7 = `7cf213f`, Phase 3.8-3.10 = `d138dbc`, Phase 3.11 = `4f0810c`.

## Phase 4 — Venue Scout port (cutover + revision)

Full 1:1 port from `mirror-nyc-venue-scout-pro` shipped to production 2026-05-13 (`7cd27ed` was the pre-rebase cutover SHA). Producer flow: New Scout → Brief upload (DOCX + AI parse) → Sheet Prompt → Sheet Upload (XLSX/CSV + AI enrichment) OR direct AI venue research → Sourcing Report → Shortlist (matrix + photo upload) → Review → Compiling (per-venue overview generation) → Deck Prep → Generating (Google Slides deck) → deck opens in new tab. AI surface uses `pause_turn` continuation, `writeFailure` CAS guards on all 3 AI edge functions, 180-360s `WORK_TIMEOUT_MS`, URL-fallback helpers. **Phase 4 Revision — Intake** (post-port) rebuilt the Brief as a 3-step stepper (Event → Venue → Review), added venue-side fields the AI sourcing prompt needs, added `vs-generate-brief-overview`, made the Revisit nav always-visible. Per-sub-phase decisions live in `docs/decisions.md` § "Phase 4 cutover + port plan locked decisions" + § "Phase 4 Revision". Squashed under Phase 4.1 = `262d213`, 4.2 = `4faa968`, 4.3 = `477b583`, 4.4 = `d7f6fe0`, 4.5 = `aaabccd`, 4.6 = `f7eb639`, 4.7 = `f54f3cd`, 4.8 = `1e2c8ce`, 4.9 = `f1c127f`, 4.10 = `3a197b0`, Final Review packet = `ad2cb77`, VS cutover sweep = `0f92c62`, Phase 4 Revision = `d9f642d`.

---

For current sub-phase status see `CHECKPOINT.md`. For the forward plan see `docs/roadmap.md`. Decisions per sub-phase live in `docs/decisions.md`.
