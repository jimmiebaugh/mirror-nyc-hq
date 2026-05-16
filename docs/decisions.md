# Decisions

Architectural decisions worth preserving with their rationale. Newest at the top within each section.

## Phase 5.5 (2026-05-16)

### `notifications-dispatch` is internal-only (no user-JWT path)

First instinct was the standard `requireInternalOrUserAuth` pattern most edge functions use. Security audit caught it as a MUST FIX: any signed-in Standard or Freelance user could POST with a crafted `recipient_user_ids` array to spoof in-app notifications + trigger Slack DMs to admins. The function reads with the service role, so authorization is replaced by the internal-secret gate at the entry point.

Switched to `requireInternalSecret` only. All legitimate callers (the `notifications_dispatch_writer` trigger, `handle_new_user`, the three `hq-cron-*` functions) already send `x-internal-secret` via `public.invoke_edge_function`. No browser path needs direct dispatch access. If a future UI feature ever needs to trigger a notification directly, gate it behind an admin-role check at that call site rather than weakening dispatch.

### `user_pending` in-app row stays inline, dispatch only handles email + Slack

`handle_new_user` writes the durable `notifications` row for every active admin BEFORE invoking dispatch. Dispatch then receives the same `recipient_user_ids` and would normally insert a second row per recipient. To avoid the duplicate, dispatch special-cases `event_type='user_pending'` and skips the in-app insert (the trigger's inline write covers it). The email + Slack paths still run.

Rationale: the in-app signal is the most important guarantee, and putting it inline in the trigger means it lands even if the dispatch edge function 500s. The duplicate-prevention has no unique-constraint backstop on `notifications`, so the simpler "skip in dispatch" is robust without a schema change.

### `auth.uid()` for trigger actor, fallback to `created_by`

`notifications_dispatch_writer` reads `auth.uid()` to set `actor_id` so dispatch can exclude self-notification. When a user updates a task from the UI (RLS-scoped client carries the JWT), `auth.uid()` resolves to the acting user. When the trigger fires from a service-role write (cron, edge function chain), `auth.uid()` returns null. For `task_assigned` the COALESCE uses `NEW.created_by` as fallback so we still have some "who" to attribute. For `task_blocked` and `project_status_changed` we let `actor_id` be null when there's no JWT (dispatch then doesn't filter anyone out — better to notify everyone than skip silently).

### CSS reuse: `.activity-row` + `.actdot` already lived in `src/index.css`

Project Detail's activity sidebar shipped these classes in Phase 5.1/5.2. The Activity Feed page reuses them verbatim — the spec called for lifting them again but they were already canonical. Only `.notif` block (bell-panel rows) was net-new from the wireframe lift.

### Cron naming: `hq-cron-*` not `cron-*`

`docs/conventions.md` § Naming requires `<module>-cron-<purpose>`. The three new daily crons cross multiple HQ Core tables (`deliverables`, `tasks`, `projects`) so no single-module prefix fits cleanly. Used `hq-cron-*` to keep the convention's spirit (the HQ Core surface area) without inventing a fake module per cron.

### States polish: kept DataTable's centralized empty render

DataTable already routes every list-page empty state through a single `<div className="empty">` render with the canonical CSS class. Swapping it for the shared `<EmptyState>` would require threading an icon prop through 7+ call sites and accept zero visual change (same DOM, same class). Spec § 7 verification (3+ list pages, 2+ LoadError uses) is satisfied organically by the new pages (NotificationBellPanel, ActivityFeed, SearchPage, NotificationPreferences) + WikiPage's two `PermissionDenied` swaps. DataTable stays as-is until a future deviation justifies the cost.

## Phase 5.4 feedback round 2 (2026-05-16)

Third pass on `claude/zen-mestorf-940d7f`, after Jimmie's follow-up smoke. New migration: `20260516180000_phase_5_4_feedback_round_2.sql`.

### Wiki Delete surfaced from the read view

The Delete Page button still lives at the bottom of the edit form, but it was easy to miss. Added a second Delete button to the wiki read-view header, right next to "Edit Page". Same `isSpecialPageType` guard (special pages can't be deleted). Same `AlertDialog` confirmation. Both buttons hit the same supabase `.delete()` and navigate back to `/wiki`.

### Account Logins writes open to Standard

Original 5.4 spec gated INSERT/UPDATE/DELETE on credentials to admin only. Jimmie's smoke pass clarified the intent: writes should be available to everyone except Freelance, matching the SELECT posture. Migration drops the three admin-only policies and replaces them with non-freelance variants (admin + standard can write; freelance still blocked from SELECT entirely). The AccountLoginsPage component prop swapped from `isAdmin` to `canWrite` (always true at the call site, since WikiPage already blocks freelance from reaching it).

### Preferred Vendors curated via `vendors.preferred` flag

Original 5.4 spec rendered ALL vendors grouped by capability on the Wiki "Vendors at a Glance" page. Feedback round 1 renamed the page to "Preferred Vendors". Round 2 makes the list actually curated.

- Migration adds `vendors.preferred boolean NOT NULL DEFAULT false` + a partial index where `preferred = true`.
- `VendorsGlanceEmbed` filters to `preferred = true` rows. The file + component name stay because the wiki `page_type` enum value is still `vendors_glance`; renaming the enum would be a separate migration with no visible benefit.
- Admin gets a "Manage Preferred List" button (top right of the embed) that opens a `<ManagePreferredDialog />` with a search input + scrollable list of every vendor in the DB. Each row is a checkbox toggle bound to the desired-set. Save diffs against the initial-set and only writes the rows that flipped — minimizes the bulk UPDATE size.
- Empty state ("No preferred vendors selected yet.") includes the same Manage CTA so first-time setup is one click away.
- Rejected alternatives: a dedicated `preferred_vendors(vendor_id)` junction table (overkill for a single curated list) and managing the flag from the Vendor detail page (the wiki page is the discovery surface, so the toggle belongs there).

## Phase 5.4 feedback round (2026-05-16)

Live-smoke feedback from Jimmie after the spec-implementation cut. Wrapped into a second migration (`20260516170000_phase_5_4_feedback.sql`) plus app-side updates. All on the same `claude/zen-mestorf-940d7f` branch.

### Wiki editor switched from markdown to rich-text (TipTap)

The spec shipped a markdown textarea + Preview toggle. Jimmie wanted a WYSIWYG visual editor with bold / italic / underline / headings / lists / link. Picked TipTap (`@tiptap/react` + `@tiptap/starter-kit` + `@tiptap/extension-underline` + `@tiptap/extension-link`) as the standard React rich-text choice. Storage shifts from markdown to HTML.

The 11 seeded prose pages were rewritten to HTML in the feedback migration so the renderer doesn't see literal markdown characters in the new HTML world. The renderer changed from `react-markdown` to `dangerouslySetInnerHTML` (admin-authored, trusted-source content). The `react-markdown` dep stays in `package.json` for now — not referenced anywhere — and can be pruned in a polish pass.

### Wiki visibility gained `admin_only`

The original CHECK was `('all', 'no_freelance')`. Widened to add `'admin_only'`. The wiki nav filters admin_only pages from non-admins (lock glyph reused, same as no_freelance); component-level visibility gate in `WikiPage` blocks direct slug nav. RLS on `wiki_pages` is still open-SELECT (no DB-level visibility enforcement); the user-facing block is the component check + the nav filter.

### `credentials.related_note` dropped

Jimmie wanted the Related column gone entirely. Migration drops the column. UI + dialog updated to remove it. AccountLogins Updated column also gained the day component (`MMM D, YYYY` instead of `MMM YYYY`) and the trailing "admins add new ones inline" caption was removed.

### Vendors at a Glance -> Preferred Vendors

Updated the seeded `wiki_pages` row: slug `vendors-at-a-glance` -> `preferred-vendors`, title `Vendors at a Glance` -> `Preferred Vendors`. The page component (`<VendorsGlanceEmbed />`) was not renamed; its docstring still references "Vendors at a Glance" because it's keyed to `page_type = 'vendors_glance'` which is the DB-level enum value. Renaming the enum would be a bigger migration.

### `/team` route renamed to `/users`

Page label + URL slug. LeftRail says "Users", page heading is "USERS", primary button is "Add User", toasts say "User added / deactivated / not found", Back link says "Back to Users". `/team*` URLs redirect to `/users*` (Navigate components) so pre-feedback notification links (`link_url = '/team'`) and any bookmarks still land. `handle_new_user` was rewritten to emit `link_url = '/users'` going forward.

The page file paths stayed at `src/pages/team/*.tsx` to limit churn; only the route + UI labels moved. Future polish pass can rename the directory + queries lib.

### Settings reorder + Mirror Holidays collapsible

Integrations card moved above Mirror Holidays. Mirror Holidays card is now collapsed by default with a chevron in the headbar; click to expand. Rows lazy-load on first expand (no `mirror_holidays` query fires until the user opens the section).

### Calendar holidays render yellow

`.cal-ev.hol` now uses an amber/yellow background tinted with the existing `--warn` token (`rgba(245,158,11,.22)` + warn-colored italic text), replacing the prior gray. Distinct from `.cal-ev.rem` (Removal, same color family but normal-weight foreground), distinct from `.cal-ev.olk` (Outlook, gray).

## Phase 5.4 (Wiki + Account Logins + Team + Settings)

Spec: `OUTPUTS/phase-5-4-spec.md` (drafted 2026-05-16). Four surfaces lifted from Wireframe Surfaces 12, 17, 18, 20. One feature branch, one squash. One migration (`20260516160000_phase_5_4_wiki_team_settings.sql`) that adds four tables + extends `public.users` + amends `handle_new_user` + drops the auth FK + drops `department_tags`.

### ID-swap on pre-provisioned users

The Team Add form needs to insert a `public.users` row for a teammate who hasn't signed in yet. The shipped FK `users.id REFERENCES auth.users(id)` blocked that (no auth user, no row). Three options were considered:

- **A. Drop the FK; keep id-swap.** Pre-provisioned rows get random UUIDs. On first sign-in, `handle_new_user` checks for a `public.users` row matching the auth user's email and, if found, swaps that row's `id` to the auth uid. Safe because pre-provisioned users have no FK references yet (created_by / updated_by / etc.).
- **B. Add `auth_user_id` column.** Bigger refactor; every RLS policy comparing against `auth.uid()` would need updating.
- **C. Skip pre-provisioning.** Team Add becomes a stub until the person signs in.

Locked **A** (Jimmie's call on 2026-05-16). Trade-off accepted: the FK to `auth.users` is gone, so a hard delete in `auth.users` no longer cascades to `public.users` automatically. Mirror rarely hard-deletes auth users; if it ever does, a manual cleanup function can be added later. The Phase 5.4 migration drops the FK + amends `handle_new_user` to perform the id-swap (idempotent: matching id is treated as a no-op stamp; matching email with different id triggers the swap; no match triggers the fresh-pending insert + admin notification flow).

### department_tags dropped in favor of departments lookup + single FK

Phase 5.1 shipped `public.users.department_tags text[]` with four hardcoded values (`Account Manager`, `Production`, `Design`, `Creative`). The wireframe Surface 12 surfaces ONE department per person from a richer list (Leadership, Accounts, Creative, Design, Event Production). The four old values were never surfaced in any current UI (zero usages in `src/` outside `types.ts`).

Phase 5.4 drops `department_tags` + its CHECK constraint and adds `department_id uuid REFERENCES departments(id) ON DELETE SET NULL`. The `departments` lookup table seeds with the five wireframe-matching values. Inline-add from the Team Edit form goes through the existing `useLookup` hook (extended to know about `departments`).

### Credentials stored plaintext-at-rest

The `credentials` table stores `password text NOT NULL` plaintext. This is intentional:

- Access control is RLS-enforced: Freelance blocked entirely, only admins write, only standard + admin read.
- Supabase provides encryption at rest at the storage layer.
- The reveal-and-copy UX (eye toggle + 30-second idle re-mask) is a convenience pattern for shoulder-surfing protection, not a security boundary.
- The data is operational team credentials (shipping accounts, vendor portals), not user secrets. Hash-and-compare doesn't apply because admins need to read the cleartext to populate forms on external sites.

Application-level encryption was considered and rejected: it would require either client-side keys (a fresh key-management problem on each session) or a server-side decryption endpoint (latency + RLS duplication). The current shape matches industry baseline for an internal team password vault and keeps the surface simple.

### Wiki page_type enum + special pages

The `wiki_pages.page_type` column carries one of four values: `prose`, `team_directory`, `vendors_glance`, `account_logins`. Prose pages store markdown in `body` and render via `react-markdown`. The three special types render hardcoded components (TeamDirectoryEmbed, VendorsGlanceEmbed, AccountLoginsPage) and ignore `body`.

The three special pages are seeded by the migration and cannot be created from the UI (create mode is locked to `page_type = 'prose'`). They also cannot be deleted from the UI (the Edit form hides the Delete button when `page_type != 'prose'`). This keeps the special-page surface tightly coupled to the migration so the Calendar / Account Logins / Vendors pages can rely on their slugs existing.

### Wiki accessible to Freelance (except Account Logins)

`/wiki` and `/wiki/:slug` use `<ProtectedRoute>` (all tiers including Freelance) rather than `<StandardOrAdminRoute>`. Operational docs (How We Work, Shipping & Messengers, Pricing, etc.) are useful for freelance contractors who also need to know how Mirror runs jobs. Account Logins is the only exclusion: the wiki page row carries `visibility = 'no_freelance'` (filtered from nav), the wiki page component shows an access-restricted state if Freelance navigates directly, and the underlying `credentials` RLS rejects the SELECT.

### mirror_holidays replaces hardcoded constant

The `MIRROR_HOLIDAYS` array in `src/lib/calendar/holidays.ts` (shipped Phase 5.3) is replaced with a `mirror_holidays` table + `useMirrorHolidays()` hook. The migration seeds the table with the previous constant values exactly so Calendar behavior is unchanged on deploy. The Settings page exposes a CRUD editor (`<MirrorHolidaysEditor />`) so admins can add 2027+ holidays without a code change.

### Integrations card display-only for 5.4

The Settings Integrations card renders three toggles (Google Calendar push, Slack DM notifications, Google Drive link integration) in the "on" state but they are `disabled` and non-interactive. No backend config table backs them in 5.4. They become functional when the corresponding features ship in a later phase (notification dispatch + Google Calendar push are tracked for 5.5+).

### GRANT fixes (cleanup carried in this migration)

Three GRANT gaps blocked Phase 5.4 functionality and got fixed alongside the new tables:

- `GRANT INSERT ON public.users TO authenticated`: required for admin pre-provisioning. RLS still gates to admin via the new `users_insert_admin` policy.
- `GRANT DELETE ON public.cities TO authenticated`: the admin-only DELETE RLS was unreachable for authenticated. Settings needs the path. Same posture fix as the Phase 5.2 cleanup that did this for `vendor_capabilities`.
- `GRANT DELETE ON public.project_categories TO authenticated`: same as cities.

### Team "Cards" view deferred

The wireframe Surface 12 ViewSwitch shows List + Cards. 5.4 ships List only; the Cards button is rendered but disabled. The shipped list table with inline tier dropdown + active toggle covers the operational need (assign tiers, deactivate, find the pending users) without the Cards view. Cards lands as a polish item in a later pass.

## Phase 5.3 (Calendar + Outlook)

Spec: `OUTPUTS/phase-5-3-spec.md`. Surfaces 15 (unified Calendar) + 16 (admin-only Outlook). One feature branch, one squash. Three migrations: `outlook_entries` + RPC, projects install/removal date columns, saved_views.entity_type CHECK widen.

### Outlook Confidence color override (locked-decisions § 4)

The locked wireframe HTML (`OUTPUTS/phase-5-hq-wireframe-v1-LOCKED.html`) defined the `.ol-rad` / `.ol-like` / `.ol-conf` / `.ol-comp` CSS classes with colors that disagree with the locked confidence-color mapping in `OUTPUTS/phase-5-locked-decisions-2026-05-15.md` § 4 (and `docs/design-system.md` § 5b). The locked mapping is the source of truth:

- `On Radar` -> amber (`--warn`) -> `.ol-rad`
- `Likely` -> cyan (`--info`) -> `.ol-like`
- `Confirmed` -> green (`--success`) -> `.ol-conf`
- `Complete` -> gray (`--border-strong`) -> `.ol-comp`

Reads as a step-up ladder: speculative -> looking good -> locked -> done.

**The CSS block lifted into `src/index.css` flips the four color rules in place** so the class names match their semantic meaning. Spec § 12 + § 11.9 (brand rule) call this out. The alternative (lift verbatim + let JS assign the "wrong" class name for the right color) was rejected because it produced "Confirmed gets `.ol-conf` which renders amber" cognitive dissonance for any reader of the wireframe vs the shipped code.

### Outlook entries: shared toggle drives Calendar visibility, not Outlook page visibility

`outlook_entries.shared_with_team` is the gate for whether an entry surfaces on the unified Calendar for non-admins. The Outlook page itself is admin-only via the `<AdminRoute>` gate; standard / freelance users never see it. Their only path to an Outlook entry is the shared banner on the Calendar, which is non-clickable (cursor default, no hover, no-op on click). Admins see the same banner clickable, with click routing to `/outlook?year=YYYY&month=MM#entry=<uuid>` with the panel pre-opened.

Locked-decisions § 3 explicitly chose non-clickable over hide-from-standard so producers can see "the team has a planning event in that week" without being able to drill into the admin-only Outlook page.

### Promote vs Unlink vs Delete (locked-decisions § 1)

Three distinct actions on an Outlook entry:

- **Promote to Project:** runs `promote_outlook_to_project(target_entry_id)` RPC. Creates a `projects` row from the entry's name + client + city + `status='Queued'` + caller as `created_by`. Sets `outlook_entries.linked_project_id` to the new project id. Atomic; SECURITY DEFINER; admin-gated.
- **Unlink Project:** clears `outlook_entries.linked_project_id` only. The Project row stays untouched and visible to the team.
- **Delete entry:** removes the `outlook_entries` row. The linked Project (if any) stays in the system, just unlinked. The FK is `ON DELETE SET NULL` from the entry's side; `projects` has no FK back to `outlook_entries` so deleting the entry can't cascade to the project.

These are intentionally separate so the producer flow can detach a speculative entry from a real project (e.g. project repurposed) without nuking either record.

### Mirror Holidays seeded as a static constant (5.4 Settings editor lands later)

`MIRROR_HOLIDAYS` is a hardcoded array in `src/lib/calendar/holidays.ts`, sourced from Mirror's official 2026 Holiday Calendar PDF. Multi-day windows (Christmas / New Year's: Thu Dec 24 - Fri Jan 1) expanded into one entry per non-weekend closed day so the Calendar renders a banner on every closed day.

5.4 will ship a Settings-page CRUD editor against a `mirror_holidays` table. The static-constant approach is intentional 5.3 scope: a real CRUD editor without a Settings page surface to host it would be premature.

### Per-user Calendar visibility persists via saved_views (locked-decisions § 6)

The four toggles on the Calendar right rail (Deliverables / Mirror Holidays / Shared Outlook / per-project) persist per-user via a single implicit `saved_views` row (`entity_type='calendar'`, `name='__calendar_default'`, `view_kind='calendar'`, `is_default=true`). One row per user; no naming UI (Calendar has exactly one persisted preference state, unlike Projects / Tasks / etc. which support multiple named views).

The migration extends `saved_views.entity_type` CHECK to include `'calendar'`. The `useCalendarVisibility` hook handles the lazy-INSERT on first visit + debounced UPDATE on toggle change.

`?source=projects` / `?source=tasks` first-visit defaults (Deliverables + Holidays + Outlook-shared off, per-project on) only apply when no saved row exists yet. Saved state wins on subsequent visits.

### Filter chips stay component-local (not persisted)

Lead + Category filter chips on the Calendar reset each visit. Same convention as `<FilterBar />` everywhere else in HQ: chip state is per-session, saved views capture chip state only when explicitly saved. The Calendar doesn't ship a saved-views dropdown in 5.3, so chip state has nowhere to persist to.

### Branch name cosmetic deviation

Spec called for `claude/phase-5-3-calendar-outlook`. The worktree was created as `claude/priceless-jang-b6de74` (auto-generated). Since the branch squash-merges to main, the branch label has no shipping impact; the worktree branch name was not renamed.

## Phase 5.2.1 Revision (wireframe-fidelity rebuild)

Spec: `OUTPUTS/phase-5-2-1-revision-spec.md`. Forward-fix pass on top of the shipped 5.2.1 squash (`15511af`). Schema + routes + queries stay intact; the visual layer rebinds to the locked wireframe (`OUTPUTS/phase-5-hq-wireframe-v1-LOCKED.html`) as the binding source.

### Why the revision

The original 5.2.1 surfaces shipped with parallel Tailwind utility groups (`bg-surface-alt border border-border-strong rounded px-3 py-2 text-xs font-mono`) instead of consuming the wireframe's canonical CSS class names (`.input`, `.viewswitch`, `.fchip`, `.tbl`, `.bcol`, `.tl`, `.calgrid`, `.kv`, `.savebar`, `.stat`, `.pill p-<token>`). The result looked close-but-off against the wireframe across the board (view-switcher rendered as pills instead of the icon-segmented button group; filter bar missed the `.fchip` structure; tables missed the `.tbl thead` mono header; board cards reinvented layout; save bar used inline classes instead of `.savebar`). This pass rebuilds the visual layer against the wireframe DOM byte-for-byte.

### DB reconciliation as a prereq (Step 0)

A halted Phase 5.2.2 attempt left the live linked Supabase DB at the 5.2.2 schema state (organizations rename + people + venues extensions + projects extensions + types regenerated mid-flight) but the worktree was deleted before the .sql files made it onto a branch. Step 0 recreates the four 5.2.2 .sql files locally matching the canonical SQL in `phase-5-2-spec.md` § 4e-4h, uses `supabase migration repair --status applied` to register them as matching the already-applied remote without rerunning, regenerates types, and flips every `clients` / `client_id` / `client:clients` reference in src/ to the renamed `organizations` / `organization_id` / `organization:organizations`. Same commit flips `projects.notes` -> `projects.status_notes` and adds the new `projects.client_notes` body to ProjectDetail + ProjectEdit. This unblocks the live app (which was broken on main while shipping queries pointed at the renamed table) before the visual rebuild.

### CSS lift block (revision spec § 1)

A new "Phase 5.2 HQ Core surfaces" block at the bottom of `@layer components` in `src/index.css`, lifted byte-for-byte from the wireframe's `<style>` section. UNPREFIXED class names so components can be authored against the wireframe markup and DOM-diff for parity. Coexists with the 5.1 chrome classes (`.hq-rail`, `.hq-card`, `.hq-pill`, etc.) which keep the `hq-` prefix; no class collisions by design.

### Data component DOM rewrites (revision spec § 2)

Seven components rewritten:
- `<ViewSwitch />` -> `.viewswitch > button[.on]` icon-segmented group (was: shadcn-like pill bar).
- `<FilterBar />` -> `.filterbar > .fchip > .k/.op/.v/.x` chip pattern with `.andor` connector + `.fchip--add` trailing chip.
- `<SavedViewsDropdown />` -> `.savedviews` chip trigger. Also gains an `onNavigate?: (viewKind) => void` prop fired alongside `onPick` so picking a saved view lands on the right view variant (closes original-5.2.1 code-reviewer C1).
- `<DataTable />` -> `.tbl-wrap > .tbl[.tbl--flat] > thead/tbody > tr.rb-<token>` shape. Added `flat?: boolean` prop (top-level list pages pass it to strip the row left-border; detail-page inner tables omit it so per-row status colors show).
- `<BoardView />` -> two layouts via `layout: "horizontal" | "stacked"` prop. Stacked = `.board-stack > .board-rowhead + .board-row > .bcol` (Projects 4-row layout). Horizontal = `.board > .bcol` flex scroll (Tasks; Deliverables one-col-per-project).
- `<TimelineView />` -> `.tl > .tl-head + .tl-row > .tl-name + .tl-track > .tl-bar` 8-month gantt.
- `<CalendarMonthView />` -> `.calgrid > .caldow + .calcell > .cal-ev.<kind>` month grid; 140px cell min-height; banner kinds `.in / .live / .rem / .del / plain`.

`<StickySaveBar />` updated to render the wireframe-canonical `.savebar` class instead of the inline `sticky bottom-0 ...` pattern from original 5.2.1.

### Deliverables Board: one column per project (revision spec § 4.C.2)

Build notes Surface 14 says "one column per project (horizontal scroll)." The original 5.2.1 shipped a rows-per-project layout with status columns inside each row, which code-reviewer C2 flagged as a divergence. This revision flips to the build-notes layout: `<BoardView layout="horizontal">` with columns grouped by `project_id`. Drag-drop is intentionally NOT wired on this view -- moving a card between columns would imply re-parenting the deliverable, which is a heavier intent than drag-drop conveys. Status changes happen via the deliverable detail page (or via the future inline status pill on each card).

### Inline-style allowance

The revision uses inline `style={{ ... }}` props in spots where the wireframe HTML uses inline styles and the lifted CSS doesn't cover them (status-color border-left on `.tl-name`, percentage `left/width` on `.tl-bar`, the right-stack 172px width in ProjectDetail header). Acceptable per revision spec § 0d ("when in doubt, copy the wireframe").

### What did NOT change

Schema, routes, queries (beyond the rename flips), edge functions, 5.1 chrome (`AppShell`, `LeftRail`, `TopBar`, `Home`, `home/*` components, `RailFooter`), rail amendment, sticky-rail hot fix. The Phase 5.2.1 squash's data-loading shape, hooks, and lifecycle stay intact; only the JSX they emit gets rewritten.

## Phase 5.2.2 (entity trio: Organizations + People + Venues)

Spec: `OUTPUTS/phase-5-2-spec.md` §§ 4e-4h + § 13 Q3 + Q8 + Q9 + Q10. The four migrations applied to the linked Supabase project during a halted worktree attempt and were re-registered locally during the 5.2.1 Revision (`supabase migration repair --status applied`). Frontend surfaces (Org / People / Venue list / detail / edit) + `<InternalNotesEditor />` + `<StarRating />` are still pending; they land in a later sub-phase.

### Clients -> Organizations rename (locked Q3)

`ALTER TABLE clients RENAME TO organizations` + `ALTER TABLE projects RENAME COLUMN client_id TO organization_id` + index rename `idx_projects_client_id -> idx_projects_organization_id`. RLS / GRANTs / triggers carry through by table OID; policy identifiers stay `clients_*` (Postgres doesn't auto-rename them) but the access posture is preserved. Existing rows backfill as `type = 'Client'` (the new `org_type` enum default). The shipped `notes` column was renamed to `legacy_notes` so any existing client-row notes survive while Internal Notes flips to the polymorphic `notes_log` table.

### org_type enum (Client / Vendor / Internal)

Venue Owner intentionally dropped per build notes Surface 10. Venues owned by clients live directly on the venues record without a separate org-type.

### internal_rating: Vendor-only field, admin-write-only RLS deferred to 5.4

`internal_rating int CHECK (BETWEEN 0 AND 5)` on organizations. Visible to all standard+admin users per Surface 10 detail. Admin-write-only RLS gating deferred to 5.4 when the Team / Settings tier polish lands. Until then any authenticated user can set the rating via the open-authenticated UPDATE policy inherited from the clients RLS.

### people table

External humans only. Internal Mirror staff stay in `public.users` and surface on the Team page (Surface 12, lands 5.4). Multi-affiliation via `affiliations person_affiliation[]` (GIN-indexed); a single person can be both a Client and a Venue contact (build notes Surface 11 "Dana Whitfield" example). `created_by NOT NULL` with default ON DELETE RESTRICT matches the deliverables created_by posture from 5.2.1.B.

### venues: multi-select venue type + new columns + rate history

The single `venues.venue_type_id` FK is dropped in favor of the `venue_venue_types` join table (existing rows backfilled before drop). New venue columns: `city`, `venue_slide_url`, `total_sq_ft`, `exclusive_vendors_org_ids` (uuid[]). New `venue_rate_history` append-only table (SELECT + INSERT only for authenticated; no UPDATE / no DELETE) drives the "Event Day Rate $X as of <date>" display via the most-recent row per `(venue_id, rate_kind)`. The shipped `square_footage` column coexists with the new `total_sq_ft` per spec § 4g.

### notes_log CHECK widened to include 'venue' (Q9)

`ALTER TABLE notes_log DROP CONSTRAINT notes_log_parent_type_check; ADD CONSTRAINT ... CHECK (parent_type IN ('organization', 'person', 'venue'))`. Lets the shared `<InternalNotesEditor />` component serve Venue detail too.

### people.venue_id (Q8)

Nullable FK to venues for venue-contact attribution. Simpler than a `venue_contact_people` join table; venue contacts typically tie to one venue. Added in the 5.2.2.C migration so it can reference venues after that table exists.

### projects.status_notes / client_notes rename + add (Q10)

`projects.notes` renamed to `status_notes` (Surface 07 detail Status Notes sidebar card body). New `client_notes text` column added for the parallel Surface 07 Client Notes card. Two distinct fields per the wireframe; the single shipped `notes` column was carrying the Status Notes role in 5.2.1 and gets the cleaner identifier in 5.2.2.

### projects.job_number / category / city / tags / budget

Added in the 5.2.2.D migration. Surface 04 List view columns + Surface 07 detail title row (coral `#2604` job number, "Pop-Up · LA" meta row, "Summer 2026 / CPG / Outdoor" tag chips, `$185,000` budget reference). Budget rule: planning reference figure, NOT an invoice amount; never renders on pipeline-summary surfaces (Pipeline counts, Billing tile, List view columns, board cards, timeline labels, calendar event banners). Stays compatible with locked-decisions Q6.

## Phase 5.2.1 (HQ Core databases: Projects + Tasks + Deliverables + cross-cutting components + rail amendment)

Spec: `OUTPUTS/phase-5-2-spec.md` §§ 0-5.B + 5.C + 7 + 11 + 12 (5.2.1 row) + 13 (Q1-Q4 LOCKED, Q5-Q10 RECOMMENDED) + 14. Rail amendment: `OUTPUTS/phase-5-2-rail-amendment.md`. Locked Phase 5 decisions: `OUTPUTS/phase-5-locked-decisions-2026-05-15.md`.

### Project + Task status enum reshape (locked Q2)

Both Postgres enums were rebuilt to match the locked-decisions canonical labels rather than label-mapping in the UI. `project_status` went from 14 legacy values to 14 locked values with six dropped (`Awaiting FB`, `Awaiting Files`, `Awaiting Approval`, `Event Live`, `Proof Out`, `In Review`) and six added (`Approved`, `Install`, `Removal`, `Queued`, `Awaiting Feedback`, `Cancelled`); the rename `Awaiting FB -> Awaiting Feedback` is the obvious one. Catch-all backfills: `Awaiting Files -> In Progress`, `Proof Out -> In Production`, `In Review -> In Progress`; spot-check rows that came from those legacy values if the catch-all is wrong for a specific project. `task_status` went from lowercase `(todo, in_progress, blocked, done)` to mixed case `(To Do, Doing, Blocked, Done)`; the `tasks_completed_at_set` trigger function was `CREATE OR REPLACE`'d in the same migration so its literal `'done'` comparison flipped to `'Done'`. Index dependents (`idx_projects_status`, `idx_tasks_status`) auto-rebuild during `ALTER COLUMN TYPE ... USING (...)`. `taskStatusLabel()` is gone.

### Deliverables table (locked Q1)

New 4-value `deliverable_status` enum (`Upcoming`, `In Progress`, `Complete`, `Skipped`) per locked-decisions § 4. Skipped renders strikethrough + opacity-60. Multi-assignee via `assigned_user_ids uuid[]` rather than a join table (matches the wireframe Surface 14 first-name stack on board cards). `completed_at` set by a parallel trigger to `tasks_completed_at_set`. RLS open-authenticated to match HQ Core posture. Added to `supabase_realtime` for Board drag-drop.

### activity_log_writer extended to handle DELETE

Pre-Phase 5.2.1 the function initialized `action_val` + `payload_val` inside the INSERT / UPDATE branches only; a DELETE invocation would have left both NULL and violated `activity_log.action NOT NULL`. The existing projects / venues / tasks triggers fired only on INSERT OR UPDATE so the gap was invisible. The 5.2.1 `deliverables` trigger fires on INSERT OR UPDATE OR DELETE per spec § 4b, so the function was `CREATE OR REPLACE`'d (same OID, existing triggers keep resolving unchanged) with a DELETE branch: `action_val := 'deleted'`, `payload_val := jsonb_build_object('old', to_jsonb(OLD))`. The DELETE branch logs `actor_id = auth.uid()` which is NULL in a server-context / cascade-delete write. This is correct: `activity_log.actor_id` is nullable (FK with ON DELETE SET NULL), and a server-initiated delete is the right thing to attribute to a null actor.

### saved_views per-user table (recommended Q5 -> built)

Persisted per-user filter / sort / view-kind snapshots for every HQ Core database list page. Per-user RLS scoped to `user_id = auth.uid()` (the only HQ Core table that doesn't follow the shared open-authenticated posture; saved views are personal preferences, not team state). `is_default` per `(user_id, entity_type)` is enforced in app via a transactional "clear then set" upsert (`createSavedView` in `src/lib/hq/savedViews.ts`); the DB carries no unique partial index for it because a single multi-row write would have to dodge a constraint mid-flight.

### tasks priority + blocked_by (recommended Q7 -> built)

`tasks.priority text NOT NULL DEFAULT 'Normal' CHECK IN ('Urgent', 'High', 'Normal', 'Low')` and `tasks.blocked_by uuid[] NOT NULL DEFAULT '{}'` with a GIN index. uuid[] beats a join table for simplicity; downside is Postgres can't FK-enforce array elements, so the app validates that entries reference valid task ids before write. The Surface 13 "Notes / Blocks" cell renders `description` + `blocked_by` together; the migration kept them as distinct columns so future surfaces can split them.

### tasks_completed_at_set rewrite

`CREATE OR REPLACE` rather than `DROP FUNCTION` + recreate. Same lesson as the Phase 5.1 `is_producer_or_admin` rewrite (memory `feedback_enum_storage_policy_dep.md`): plpgsql function bodies defer name resolution to first execution, so the safest swap is to keep the OID, rewrite the body, and let next-execution pick up the new literal `'Done'`. No CASCADE drops; no trigger re-attaches.

### Rail amendment: single Tools group + tool-app variant

`OUTPUTS/phase-5-2-rail-amendment.md`. The shipped split between Tools (Standard + Admin) and admin-only items collapsed into a single ordered list with per-item `adminOnly?: boolean`. Locked ordering: Wiki, Talent Scout, Venue Scout, Team, Outlook, Settings. Tool-app variant detected via `pathname.startsWith('/talent-scout') || pathname.startsWith('/venue-scout')` swaps the Primary group for `[HQ Home, Activity Feed]`. Route-based, not state-based: clicking a non-tool-app rail item flips the route and the rail returns to default on next render. `/pending` still renders no rail.

### Out of scope for 5.2.1 (lands 5.2.2 or later)

Organizations / People / Venues surfaces (5.2.2). `<InternalNotesEditor />` (5.2.2, since it's the Org / Person / Venue Internal Notes pattern). `<StarRating />` (5.2.2). Quick-add cluster on `/home` flipping placeholders to real "+ New Project / Task / Deliverable" routes (deferred until 5.2.2 lands the People route). Project Detail attachments (storage; future sub-phase). Status Notes uses existing `projects.notes`; Client Notes is rendered as a "lands in 5.2.2" empty-state placeholder. The `notes_log` Realtime publication stays deferred until simultaneous-author UX surfaces. Per-surface Calendar tabs (Projects / Tasks) route to the unified `/calendar?source=...` stub; the unified Calendar surface lands in 5.3.

## Phase 4 Revision - Intake (3-step brief stepper)

Follow-on revision correcting the Phase 4.3-port + 4.9-port surfaces. Phase 4 stays DONE; this rebuilt the single-page Brief into a 3-step stepper (Event -> Venue -> Review) and gathered the venue-side fields the AI sourcing prompt needs. Spec: `OUTPUTS/phase-4-revision-intake-spec.md`. The five decision points below were resolved by Jimmie on 2026-05-14 and are binding.

### A. Generated Decks section on the Brief report -> INCLUDE

The Step 3 Brief report renders a Generated Decks section (newest-first, primary styling on the most recent, "Open in Google Slides" per entry, hidden when empty). `vs_scouts.generated_decks` already persists every field needed (`deck_name`, `version`, `generated_at`, `venue_count`, `slide_count`, `edit_url`); no schema change.

### B. New `brief` current_step value + default -> APPLY

Migration `20260514110000` adds `brief` to the `vs_scouts_current_step_check` constraint and flips the new-row default from `sheet_prompt` to `brief`. `brief` is the in-flight intake step; Step 3 Confirm & Continue flips it to `sheet_prompt`. The rest of the state machine is unchanged. Existing scouts on `sheet_prompt` are treated as post-intake (they passed the old single-page Brief) and the `/brief` redirect index sends them straight to the report view.

### C. `city` is required -> REQUIRED

Step 2's Submit Brief is disabled until `city` is non-empty, same blocking treatment as `client_name` / `event_name` on Step 1. Downstream sourcing needs the city; the old single-page Brief left it optional. Existing scouts with an empty city block on Step 2 the first time the brief is reopened.

### D. Client logo on the hero band -> INITIALS PLACEHOLDER

The Step 3 hero band shows the first two letters of `client_name` in a white logo block. Web-search-for-logo is a post-revision follow-up, not built here.

### E. One "Brief" label everywhere -> RENAME

`currentStepToLabel("brief")` and `currentStepToLabel("sheet_prompt")` both return "Brief". The Revisit chip, the Scout Index Phase column, and the canonical surface all read "Brief". The old "Brief & Setup" (`sheet_prompt`) and "Brief Report" wordings are gone. `sourcing_report` relabeled "Sourcing Report" -> "Sourcing" for chip parity; `Shortlist.tsx` breadcrumb updated to match.

### briefForm.ts strips the 16 form-backed keys from the brief_data passthrough

`fromScout` pulls the form-backed jsonb keys into dedicated form fields and keeps only the non-form keys (`uploaded_files`, the `*_started_at` idempotency flags, the legacy `notes`) in the `brief_data` passthrough; `toUpdate` rebuilds the form-backed keys from the form fields. This keeps `fromScout(toUpdate(state)) === state` a clean round-trip regardless of how `state` is constructed. The retired `notes` key is NOT stripped (it has no form field) so `toUpdate` preserves it on existing scouts.

### Cross-step form state lives in a module store, not per-page DB reloads

`src/lib/venue-scout/briefIntakeStore.ts` is a plain module-object store (same pattern as `src/lib/talent-scout/wizardStore.ts`), keyed by `scoutId`. Step 1's Continue persists to the DB before navigating, but Step 2's Back must "preserve form state in memory" -- so a producer who edits Step 2, clicks Back, then Continue doesn't lose the Step-2 edits. The store carries the working form + the dirty-tracking baseline across the three page mounts. The spec didn't enumerate this file; it's the conventions.md-mandated wizard-state mechanism the architecture required.

### Stepper / TagInput / ChipMultiSelect built VS-side, not generalized

`src/components/venue-scout/Stepper.tsx` is a 1:1 visual lift of the Talent Scout Stepper, parameterized to a 3-element steps array but kept VS-side. `TagInput.tsx` and `ChipMultiSelect.tsx` are new VS components. Generalizing the Stepper into a shared cross-surface component is deferred until a third surface needs it (spec § 2 out-of-scope).

### Event Overview is generated, with a deterministic stub fallback

`vs-generate-brief-overview` is a new `verify_jwt = true` edge function. It fires on first arrival at the Brief report (when `event_overview` is empty) and is re-invokable via a Regenerate link. On a Claude failure or empty response it writes a deterministic stub so the producer always lands on a non-empty, editable overview. The producer-facing intake form dropped the old Event Overview input and the Additional Notes input entirely; the overview is now produced + edited on Step 3.

### Report-card editing uses explicit Save / Cancel, not pure blur-commit

The Step 3 report cards flip to edit mode on click. The spec described "commits on blur or Enter," but the editor types are mixed (text input, textarea, TagInput, ChipMultiSelect, Slider, ToggleGroup) and blur doesn't map cleanly across all of them, so every card's edit mode uses an explicit Save / Cancel button pair plus Escape-to-cancel. The Event Overview block (a single textarea) keeps the spec's blur-or-explicit-Save behavior.

### Pass 2: chip restructure, objectives tightening, Stepper hidden on the report

Three corrections to what pass 1 shipped (`OUTPUTS/phase-4-revision-2-spec.md`, 2026-05-14). **Chip restructure:** the Brief chip now routes into the intake stepper at `/brief/event` ("edit brief" mode -- `briefIntakeStore` carries unsaved state across mounts), and a new Overview chip pinned last routes to the canonical Brief report at `/brief/report` (reachable once `current_step >= sheet_prompt`). The redundant trailing "Generated Deck" link is gone -- the deck is already linked from the report's Generated Decks section. Active-chip resolution flipped from step-based (furthest-reached) to route-based (`useLocation` prefix match): the highlight reflects where the producer is looking right now, not how far the scout has progressed, so a producer editing the Brief on a Shortlist-stage scout sees Brief highlighted, not Shortlist. **Objectives tightening:** `vs-parse-brief` (deployed v16) was returning narrative paragraphs instead of the tag-style phrases the report's `TagInput` expects; fixed via the tool schema description + a dedicated system-prompt rule + a `sanitizeObjectives` post-parse pass (split joined items on `; ` / ` and `, drop >60-char paragraph items, trim/dedupe). The lever stays on schema description + post-emission sanitization per `feedback_tool_choice_collapse`. **Stepper hidden on the report:** `BriefReport.tsx` dropped the `<Stepper active={3} />` line; the stepper belongs to the intake walkthrough (Steps 1-2 on `BriefEvent` / `BriefVenue`), and the report is now reached via the Overview chip / direct URL / post-Submit confirm, not as a visible "step 3 of 3."

### Pass 3: Event Overview generation moves to Submit Brief, hash-gated

`OUTPUTS/phase-4-revision-3-spec.md`, 2026-05-14. Pass 1/2 auto-fired `vs-generate-brief-overview` from a `BriefReport.tsx` first-render `useEffect` whenever `event_overview` was empty. Two failure modes against what the producer actually wants: (1) a producer who edited the AI-parsed objectives / target audience / aesthetic and then reached the report via the Brief chip never got a regenerated overview, because the report only fired on *empty*; (2) report entry could burn a Claude call on every fresh mount. The rule: generate on Submit Brief, regenerate only when the brief fields that drive the overview changed since the last generation.

**Hash-gated regen.** `computeOverviewSourceHash` (a 16-char SHA-256 prefix over the 15 overview-driving brief fields, arrays sorted, empty-to-null normalized) lives in `src/lib/venue-scout/briefForm.ts` and is recomputed identically server-side in `vs-generate-brief-overview` (v2). The hash is stored in `brief_data.overview_source_hash`. Submit Brief (`BriefVenue.tsx`) persists the form, then invokes the function only when the overview is empty, the stored hash is missing, or the stored hash != a freshly-computed one. Two-stage spinner ("Submitting..." -> "Generating overview...") when a regen runs; single-stage when it's skipped. The function writes `event_overview` + `brief_data.overview_source_hash` in one atomic UPDATE and returns both so the caller's local state stays in sync.

**Why a content hash, not a dirty flag.** A boolean "brief changed" flag would need every brief-field write path (the 3-step stepper, the report's inline cards, `vs-parse-brief` apply) to remember to set it, and would drift the first time one forgot. A content hash is derived state: it can't drift. The 15-field set matches exactly what the overview prompt consumes; the hash inputs and the prompt inputs must move in lockstep, and the client + server hash implementations must stay byte-for-byte reproducible (same field set, same canonical form, same object key order).

**Trigger model after pass 3.** `BriefReport.tsx` dropped the auto-fire `useEffect` entirely. The Overview block renders an empty-state "Generate overview" button when `event_overview` is empty (manual fallback for legacy scouts or function failures); the Regenerate link on a populated overview is unchanged (unconditional re-invoke). Inline edits to the overview text do NOT touch the hash -- a producer can polish wording without the next Submit Brief treating it as stale; conversely, resubmitting after a field change overwrites an inline edit by intent.

**`overview_source_hash` is a `brief_data` passthrough key, not a hoisted form field.** It is machine-written metadata with no producer-facing form field, the same shape as the `*_started_at` idempotency flags, so it rides in the `brief_data` passthrough untouched by `fromScout` / `toUpdate`. (Spec § 7 was ambiguous between "extend `BriefFormState`" and "passthrough"; Jimmie confirmed pure passthrough on 2026-05-14.)

**No backfill migration.** Scouts that shipped under pass 1/2 carry no hash; their first post-pass-3 Submit Brief sees a missing hash and regenerates once. One Claude call per in-flight scout at cutover, bounded, documented.

## Phase 4.10.6-port (URL acquisition fallbacks + deck flow polish)

### URL extraction fallback layered onto Claude's tool output

Producer-visible problem: every Phase B-sourced venue was landing in `vs_candidate_venues` with `website_url=NULL`, even for well-known venues whose URLs were clearly in Claude's `web_search_tool_result` blocks. Root cause: `FILL_SYSTEM` / research SYSTEM instructs Claude not to use listing-database URLs as the website_url output field, so Claude was conservatively returning null on the tool call even when usable URLs were visible in the search results.

Two-stage fix, both as post-emission layers (per `feedback_tool_choice_collapse` memory rule; schema descriptions + post-emission sanitization are the levers, not SYSTEM):

1. **`extractWebSearchResults(content)` in `_shared/anthropic.ts`** walks the response content blocks and pulls every `{ url, title }` from `web_search_tool_result` blocks.

2. **`findVenueWebsite(app, { name, address, city })` in `_shared/anthropic.ts`** runs a fresh, focused Claude call per venue with `web_search` + a tight "find the official website URL for {name} at {address}" prompt. Returns the first non-listing-database URL via `sanitizeWebsiteUrl` validation. Used as Phase B's URL fallback after the initial `validateWebsiteUrls` returns null.

Phase A (per-row enrichSheetVenue) and `vs-compile-summaries` Pass 1 use the cheaper `findBestSearchResultUrl(venueName, results)` heuristic that scores results by token overlap with the venue name; these calls are already venue-scoped per-row so the broad-match risk is lower. Phase B uses the more expensive targeted approach because its batch `submit_research` returns a single mixed pool of search results.

### Schema tightening on `submit_research.name`

Producers were seeing venue names polluted with descriptive suffixes ("Vacant Ground-Floor Retail - 10250 Santa Monica Blvd", "Platform - West Hollywood Flagship Storefront"). Tightened the `name` field description to explicitly forbid descriptive suffixes with concrete BAD examples, telling Claude to use the venue's brand / property name and fall back to address-only for unbranded vacancies. Those descriptive bits belong in `venue_type` / `key_features`.

### `address` + `neighborhood` added to `FILL_TOOL`

Phase A wasn't filling addresses for sheet rows where the producer left address blank; because `FILL_TOOL` didn't have an `address` field at all (only `venue_type`, `website_url`, `size_sq_ft`, `capacity`, `key_features`, etc.). Common case: producer enters an address-style venue name like "238 N Canon Drive" and leaves the address column blank. Added `address` + `neighborhood` to FILL_TOOL with descriptions that explicitly call out the address-as-name case + the brief's city as context. Patch guards in Phase A + Pass 1 only fill when the existing row value is null/empty so producer-entered values remain authoritative.

### Post-deck-generation flow: open in new tab, return to Deck Prep

Previously: success on Generating navigated to /brief (the completed-scout landing). Changed to: open the just-generated deck's `edit_url` in a new tab via `window.open(..., "_blank", "noopener,noreferrer")`, then navigate back to /deck/prep. Producer can immediately review the deck in Drive AND has the Deck Prep matrix in front of them to regenerate / tweak. `handledTerminalRef` guards against duplicate Realtime / polling deliveries. `initialDeckCountRef` snapshot prevents a regenerate from re-opening the prior deck when the deck count is unchanged.

### Regenerate-from-Deck-Prep fix: atomic state reset via RPC

Previously clicking Generate Deck on a scout with `current_step='completed'` silently no-opped vs-generate-deck's idempotency guard and Generating.tsx then reopened the prior deck. Frontend reset was a read-then-write on `brief_data` which has a TOCTOU race. Replaced with new `reset_scout_for_deck_regenerate(target_scout_id)` Postgres RPC (migration `20260514100000`) that does `brief_data - 'deck_generation_started_at'` atomically in a single SQL statement, alongside `current_step='deck_prep'` + clear failure state. SECURITY INVOKER; GRANT EXECUTE TO authenticated.

### `updateSlidesPosition` per-slide moves for venue slide ordering

Slides API rejected a single `updateSlidesPosition` request with all duplicates listed in desired-final order: "The slides should be in presentation order, with no duplicates." The parameter requires `slideObjectIds` to match current presentation order; it relocates a contiguous already-ordered block, it doesn't reorder. Fixed by emitting one `updateSlidesPosition` per slide (a single-element list is trivially in order). `insertionIndex = FRONT_MATTER_SLIDES + K` for each slide's target final position. Slides API processes batchUpdate requests sequentially, so cumulative result = canonical interleaved-forward layout `[V1_detail, V1_fp, V2_detail, V2_fp, ...]`.

### Slide 2 ALL CAPS via scoped pre-pass

`{{client_name}}`, `{{event_name}}`, `{{event_live_date}}`, `{{event_location}}` need to appear UPPERCASE on slide 2 specifically (producer's deck-design preference) but keep original casing on other front-matter slides. Did this by inserting scoped `replaceAllText` requests with `pageObjectIds: [slide2Id]` at the head of `globalReqs`, with uppercased values. They run BEFORE the case-preserving global pass; once slide 2's tokens are replaced, the global pass can't find them there anymore but still touches the other slides.

### Photo dnd: `rectSortingStrategy` (was `verticalListSortingStrategy`)

Photos render in a `grid grid-cols-4` layout, not a vertical list. The vertical-only sort strategy was suppressing neighbor animations on horizontal drags, making the interaction feel broken even though the underlying `swapPhotoSlots` persistence was working. `rectSortingStrategy` handles arbitrary grid arrangements.

### "Contact the team" button removed from deck error states

The four deck-side error configs (`TEMPLATE_COPY_FAILED`, `SLIDES_API_FAILED`, `NO_VENUES_INCLUDED`, `UNKNOWN`) rendered a "Contact the team" ghost button that routed back to `/deck/prep`; same destination as the primary "← Back to Deck Prep" button. Misleading affordance; the label promised a contact path that didn't exist. `Cfg.secondaryLabel` + `secondaryHref` are now optional; help-text bullets mentioning team contact remain as informational guidance.

### vs-generate-deck success path CAS guard

Mirror of the `writeFailure` CAS pattern from 4.10.5-port. Two parallel invocations that both succeed would otherwise both append to `generated_decks` with a TOCTOU window on the `freshExisting` re-read. The success UPDATE now uses `.eq("current_step", "deck_prep")` so only the first-to-complete wins the append. CAS-loss path logs warn + leaves the orphaned in-Drive deck behind (not fatal; producer sees a working deck either way).

### Carry-forward debt: duplicate-invocation race in vs-research-venues

Smoke testing revealed that vs-research-venues can be invoked twice in quick succession (likely React 18 strict-mode dev double-mount or Realtime hiccup) and both invocations execute Phase A + Phase B independently. The 4.10.5-port `writeFailure` CAS guards mask the symptom (failure-overwrites-success) and 4.10.6-port's success CAS on vs-generate-deck masks success-overwrites-success; but both invocations still burn Claude credits. Proper fix is a Postgres advisory lock or a kickoff CAS on `brief_data.research_started_at`. Deferred to cutover follow-up.

### Carry-forward debt: pause_turn continuation cap is conservative

`MAX_PAUSE_CONTINUATIONS = 1` in `callClaude` keeps long-running calls bounded but means some legitimate multi-turn workloads will fail with "no structured output" if they need more than one continuation. If we see this in prod logs, the next move is to raise the cap to 2-3 with a per-call wall-clock budget rather than a continuation-count cap.

## Phase 4.10.5-port (AI surface stabilization)

### Model + web_search pivot: `claude-sonnet-4-6` + `web_search_20250305`

Smoke testing 2026-05-13 surfaced `server_tool_uses=0` across every Phase A enrichment + Phase B sourcing call on the prior `claude-sonnet-4-5 + web_search_20250305` combo. Anthropic docs confirm the newer `web_search_20260209` tool (with dynamic filtering) lists Claude Sonnet 4.6, Opus 4.6+, and Mythos as supported models; 4.5 isn't on the list. Combined with web_search being enabled at the org level (Anthropic Console), pivoting to **4.6 restored web_search invocation**.

Settled on the OLDER `web_search_20250305` tool version with the NEW model (4.6) after smoke showed the newer `20260209` dynamic-filter tool was billing 80k+ tokens per Phase A call (each web_search invocation runs a code_execution sandbox internally and bills cumulative context across multi-turn rounds). The simpler 20250305 tool with 4.6 invokes web_search reliably AND keeps per-turn token bloat bounded.

### `pause_turn` continuation in `callClaude`

Anthropic's server-tool loop (web_search, web_fetch, code_execution) can return `stop_reason=pause_turn` when a long-running turn hits an internal pause point. The caller is expected to send another request with the prior assistant content appended as a message; Claude continues the turn. Without this, callers that emit a custom tool after multi-step web_search research saw "no structured output" failures because the tool_use block hadn't emitted yet.

`_shared/anthropic.ts callClaude` now wraps a continuation loop. On `stop_reason="pause_turn"`, the wrapper appends the assistant's content blocks as the next message and re-calls. Accumulates content + usage across cycles. Capped at `MAX_PAUSE_CONTINUATIONS = 1` to keep total latency bounded under the app-level WORK_TIMEOUT_MS.

### `writeFailure` CAS guards prevent failure-overwrites-success

Smoke testing surfaced a race: two parallel invocations of vs-research-venues (e.g., from React 18 strict-mode dev double-mount) both run Phase A + Phase B; first succeeds (writes `current_step='sourcing_report'`), second hits a different code path and fails (was writing `status='failed' + pipeline_error=...`, overwriting the first's success state).

All three AI edge functions now CAS via `.eq("current_step", <expected_pre_success_step>)` on the failure UPDATE:
- `vs-research-venues.writeFailure`: `.eq("current_step", "researching")`
- `vs-compile-summaries.writeFailure`: `.eq("current_step", "compiling")`
- `vs-generate-deck.failWithCode`: `.eq("current_step", "deck_prep")`

Failure no-ops when another invocation has already advanced past the pre-success step.

### Timeout sizing for Supabase Pro plan

Supabase Edge Function wall clock is plan-level (150s Free, 400s Pro) and is NOT settable via `config.toml`. After the project upgraded to Pro, settled on:

- `WORK_TIMEOUT_MS = 360_000` (40s buffer under Pro's 400s cap so `writeFailure` UPDATE lands before any platform kill)
- `IN_FLIGHT_GRACE_MS = 360_000` (matched so re-invoke idempotency window covers the upper bound of in-progress work)
- Phase B `web_search max_uses = 4`
- Phase A + Pass 1 `web_search max_uses = 2`
- `MAX_PAUSE_CONTINUATIONS = 1`

`supabase/config.toml` documents the plan-level setting + the Free-plan fallback sizing recipe.

### Trim `brief_data` JSON dump from Claude user messages

`Brief: ${JSON.stringify(scout.brief_data ?? {})}` was dumping the entire `brief_data` JSONB into every Claude call, including internal state flags (`research_started_at`, `compile_started_at`, `deck_generation_started_at`, `uploaded_files`). Pure noise to the model and inflated input token count.

Replaced with selective field extraction in three call sites (`buildFillUserMsg`, vs-research-venues Phase B, vs-compile-summaries briefBlock): `expected_guest_count` + `brief_data.notes` as named fields, rest of brief_data dropped. ~30-70% input token reduction per call.

### Placeholder string sanitizer

After tightening FILL_TOOL schema to make `key_features` + `recommendations` + `considerations` required with minItems, Claude started filling arrays with literal `<UNKNOWN>` / `TBD` / `N/A` / `None` / `TODO` placeholder tokens when it didn't have real data; satisfying the schema structurally while signaling "I don't know."

Two-layer fix:
1. **Schema-description layer** (primary, per `feedback_tool_choice_collapse` rule): tool descriptions + per-field descriptions + user-message trailer all explicitly forbid placeholder tokens with a list of common offenders.
2. **Post-emission sanitizer** (defense): new `isPlaceholderString` + `stripPlaceholders` in `_shared/venueTypes.ts`. Pattern: strip whitespace + punctuation, lowercase, compare against a set of placeholder tokens (unknown, tbd, na, none, null, notavailable, notprovided, todo, pending, etc.). 32-char length cap so real short observations don't accidentally match. Wired into Phase A patch builder, Phase B venue sanitize, and vs-compile-summaries Pass 1 patch builder.

If the cleaned array is empty post-strip, skip the write so the row keeps its null state rather than getting a junk-filled column.

### Drop forced `tool_choice` on Phase A

Smoke testing showed Phase A `fill_venue` calls collapsing to out=94-115 minimal payloads under the schema description hardening + forced `tool_choice: { type: "tool", name: "fill_venue" }`. Same pattern Phase B saw (4.10.3 retrospective). Mirror Phase B's fix: changed Phase A's `tool_choice` to `{ type: "auto" }`. `FILL_SYSTEM` still says "fill structured fields" (strong directive); auto mode lets Claude use web_search freely before committing to the tool with real findings.

## Phase 4.10.4-port (pre-cutover smoke polish)

### Rank hidden in UI; column stays in DB

Smoke walk 2026-05-13 surfaced rank as visual noise (producer doesn't trust the 0-100 number day-to-day; the source pill + sort tier already conveys the relevant grouping). Decision: hide rank from the matrix render but keep the DB column + the tool emission paths (FILL_TOOL, SUBMIT_RESEARCH) + the patch-write paths (vs-compile-summaries, vs-research-venues, vs-parse-sheet). Reversible by adding the prop back to `VenueIdentityStack` and dropping `<RankDisplay />` back into the stack. Locked 2026-05-13.

### Secondary sort flipped to alphabetical-by-name

With rank no longer the visible signal, the rank-desc tiebreaker after `SOURCE_PRIORITY` tier had no anchor to the producer's mental model. Flipped to `name.localeCompare` with `sensitivity: "base"` (case-insensitive) + `numeric: true` (so "Studio 10" sorts after "Studio 2", not before). Within-tier ordering is now stable and producer-readable.

### Photo upload column removed from Shortlist; photos live on Review only

Producer-flow simplification: photos are a deck-prep concern, not a shortlist concern. The Shortlist column added affordance noise + made the matrix wider (1740 -> 1580 in 4.10.2 -> 1450 in 4.10.4). Drop the column, drop the modal, drop the photoCounts state. Review.tsx keeps the full photo grid + PhotoUploadModal per 4.7.1-port. VS Pro divergence: VS Pro kept both surfaces; HQ collapses to one.

### Notes/Feedback editor added to Review Selects

VS Pro never surfaced `vs_candidate_venues.notes` for producer edit (notes always landed via the SourcingReport / Shortlist NotesModal). Phase 4.10.4 adds a per-row textarea on Review bound to the same column via debounceSave. Already factored into the venue_overview prompt as `Producer notes: ${v.notes ?? "(none)"}` on vs-compile-summaries:452 (so the producer's last-minute context shapes Pass 2 output without ever landing on the deck itself). Coral descriptor + a title-descriptor sentence make the contract explicit ("not displayed on the deck but is considered in generating the Overview paragraph").

### Confirm + Compile flush widened to include `notes`

`confirmCompile` already flushes pending debounce timers before navigating to /compiling. The flush payload's column list now includes `notes` so a producer who types into the textarea, hits Confirm immediately, and races the 600ms debounce doesn't lose the edit (the optimistic state already updated, but the DB UPDATE hadn't fired yet). Matches the pattern for the other inline-edit fields on Review.

### Venue Overview prompt tuned via schema descriptions; OVERVIEW_SYSTEM untouched

Per memory rule `feedback_tool_choice_collapse`, system prompts on the venue-scout AI surfaces stay frozen. Tuning levers are (1) `OVERVIEW_TOOL.description`, (2) `OVERVIEW_TOOL.input_schema.properties.venue_overview.description`, (3) `maxLength`. Phase 4.10.4 swaps the description from "5-8 sentences" to "3-4 sentences, ~80 words" and embeds positive examples from Jimmie's reference set (standout-features snippets + three full overview paragraphs). `maxLength: 600` is a soft signal but Claude generally honors it. If smoke output stays too long, the next lever is dropping maxLength to 500/450 OR adding more concrete examples; NOT editing the system prompt.

### Compiling + Generating loading copy refined

Compiling: "~ 60 seconds" replaces "30 to 60 seconds" (real-world variance from smoke testing closes around the 60s mark; the producer reads the lower end as a commitment, not an estimate). Generating: "2-5 minutes" replaces "1 to 2 minutes" (Google Slides API + photo-insert latency runs longer than the VS Pro source's optimistic estimate). Both updates also resolve copy ambiguities surfaced during smoke.

### Deck Prep bottom nav: venue-name list replaces slide count

The "X slides will be generated" string was redundant with the in-page slide tally above the matrix. Replaced with a bulleted list of each INCLUDED venue's name (in pitched/order sequence) underneath a bumped "X Venues" count. The list scrolls internally (max-h-40 + overflow-y-auto) when long, so the floating-nav footprint stays predictable. Producer can now confirm at-a-glance which venues are going into the deck without scrolling the matrix.

### Deck Prep notes consolidated above the table

The four asterisk-prefixed amber pills below the table required scrolling past the matrix to read. Consolidated into a single bulleted card above the table (white text on bg-input, coral bullet markers). Copy preserved verbatim; the visual restructure is the only change. Below-table block deleted.

### Deck Prep cell line-breaks for neighborhood / size / capacity

VS Pro rendered these three meta fields inline with `·` separators in the venue summary cell. Producer feedback during smoke: hard to scan, harder to edit because the contenteditable spans bleed into each other on narrow widths. Switched to flex-col with explicit `Field:` labels. Null fields skip their row entirely (no orphan "Neighborhood:" line); when all three are null, the stack container itself doesn't render. VS Pro divergence. Editing surfaces stay (Review owns the canonical input path; DeckPrep allows on-the-fly tweaks).

## Phase 4.10.3-port (URL validation + Recs/Considerations tuning + 3-tier sort + venue_type popover + pipeline_error rename + storage reconciliation + AI surface consolidation)

### AI surface consolidation: sheet enrichment moves into vs-research-venues

Smoke testing 2026-05-13 surfaced a structural collapse pattern: forced `tool_choice: {type: "tool", name: "fill_venue"}` combined with server-side `web_search_20250305` caused Claude (both 4-6 and the 4-5 pivot) to emit empty tool calls (out=113-139 tokens, server_tool_uses=0) on every per-row sheet enrichment. Same shape collapse on vs-research-venues' submit_research call: out=2304-2610 but server_tool_uses=0, returning venues with null URLs from training knowledge.

Locked option (2026-05-13, Path B): consolidate all AI venue work into `vs-research-venues`. New shape:

- **vs-parse-sheet** becomes parse-only. Strips the per-row Claude fill pass. Returns `{ count }`. Sub-second response. Producer sees Sheet Upload -> Done immediately.
- **vs-research-venues** runs two phases inside the existing `EdgeRuntime.waitUntil`:
  - **Phase A (parallel):** SELECT `vs_candidate_venues WHERE scout_id=? AND source='sheet'`. For each row, `callClaude(fill_venue + web_search, model=claude-sonnet-4-5)`. Per-row patch guards prevent overwriting producer values. Per-row failures tolerated.
  - **Phase B (parallel):** Existing sourcing pattern -- `callClaude(submit_research + web_search)` for net-new venues.
  - Both kick off inside `work()`; Phase A awaits its loop, Phase B awaits its Claude call + INSERT, then the function awaits Phase A before the final scout state flip.
- **vs-compile-summaries Pass 1** unchanged. Stays as the backstop for any rows that miss Phase A (compile is always a second AI surface that produces overviews).

Why this fixes the collapse: per-row enrichment is no longer a synchronous parse-blocker. The sheet upload returns instantly. The "Researching" page handles both new-venue sourcing AND existing-row enrichment under a single producer wait state. Phase A's per-row calls are still subject to the same forced-tool + web_search collapse risk, but they at least live in `EdgeRuntime.waitUntil` (not blocking the user-visible upload) and the failures fall through to vs-compile-summaries Pass 1 backfill. The architectural win is one Claude surface for AI venue work, one web_search budget posture, one validation layer. SheetUpload's "Enriching N/M" UI was dropped (no Claude work happening at upload time now).

Cost / latency tradeoffs: Sheet upload is now sub-second (was 30-90s for 5-15 rows). Researching is longer (was ~60-90s for sourcing alone; now ~60-120s for parallel sourcing + sheet enrich at N/5 chunks). Net producer wall-time unchanged or slightly faster (sheet wait moved to research wait).

### Sheet parser fills website_url + capacity (was dropping both)

Pre-4.10.3 the VS Pro `parse-sheet` pick chain extracted name + neighborhood + address + venue_type + size_sq_ft + key_features. `website_url` and `capacity` columns were dropped at parse time even when the producer entered them, then re-derived by the AI enrichment pass. Fix: add both to the pick chain. URL passes through `sanitizeWebsiteUrl` (catches search pages + listing-DB bare homepages) but no HEAD check at parse time (producer input is trusted; HEAD-checking hundreds of rows would slow parse to a crawl). Keyword lists also expanded for natural producer header variants -- `borough`, `hood`, `web`, `homepage`, `pax`, `headcount`, `seats`, `square footage`, `feet`, `amenities`, `highlights`, `description`, etc.



### Final pre-cutover polish phase

11 items bundled because every one is small (under 50 lines) and they all share validation surface (smoke testing 2026-05-13 + carry-forward debt from 4.5 / 4.7.2 / 4.10.2). Shipping as one squash keeps the rename pass (`research_error` -> `pipeline_error`, 7 file edits) atomic so no commit in the history compiles with a half-renamed column.

### `research_error` -> `pipeline_error` column rename

The column was added at 4.5-port for `vs-research-venues` failures. 4.7.2-port (`vs-compile-summaries`) and 4.8.2-port (`vs-generate-deck`) reused the same column for compile + deck errors without renaming. Name has been misleading since 4.7.2; this rename brings it in line with actual usage as the single AI-pipeline error channel. Plain `ALTER ... RENAME COLUMN` preserves all existing values. Two migrations: (1) the column rename; (2) `CREATE OR REPLACE FUNCTION start_over_scout` to clear `pipeline_error` instead of `research_error`. Cross-cutting rename touches 3 edge functions + 4 page files; all done in the same squash so the build stays green.

### URL HEAD validation (post-emission gate against AI fabrication)

Smoke testing 2026-05-13 surfaced URL fabrication: Claude returns LoopNet / Crexi listing URLs with invented path segments that 4xx or soft-404 to a homepage. The existing `sanitizeWebsiteUrl` catches search pages + listing-DB bare-homepage URLs but not fabricated URLs that match the syntax pattern. Locked option: new `_shared/urlValidation.ts` wraps `sanitizeWebsiteUrl` with a HEAD-request check + redirect-host + redirect-path comparison. 4xx -> reject. 5xx + network errors -> keep (transient; producer can edit). Host mismatch -> reject (soft 404). Final path significantly shorter than request path -> reject (listing-gone redirect to root). 5s timeout per URL. Parallel via `Promise.all` inside vs-research-venues (~2-3s additional latency for 15-20 URLs); per-row sequential inside vs-parse-sheet enrichOne + vs-compile-summaries Pass 1 (already chunked-parallel at the venue level, so per-chunk latency stays bounded). Memory rule `feedback_tool_choice_collapse`: AI output quality lives on schema descriptions + post-emission validation. This is the post-emission layer.

### Recommendations + Considerations schema tuning (length cap + positive examples)

Carry-forward from continued smoke testing: bullets too long. Tuning lives on schema descriptions in both `FILL_TOOL` (`_shared/venueFill.ts`) and `SUBMIT_RESEARCH` (`vs-research-venues/index.ts`). Added: per-array description ("2-4 short venue-specific observations ... 10-15 words"), per-item description with concrete examples lifted from Jimmie's reference set, `maxLength: 150` on recommendations / `maxLength: 200` on considerations. `maxLength` is a soft signal in JSON Schema; Claude generally honors but doesn't strictly enforce, so set generously. Memory rule `feedback_tool_choice_collapse` reaffirmed: no system-prompt edits. The two tool definitions stay independent (vs-research-venues has unique fields like `derived_columns`); inline duplication is fine over a full extraction at this stage.

### Website_url schema description tuning (lifted from URL-quality hot patch lesson)

Companion to HEAD validation. Updated `website_url` description in both `FILL_TOOL` and `SUBMIT_RESEARCH` to "Must be a verbatim URL from a web search result. Examples: ... Do NOT fabricate URLs or guess listing IDs." The "Do NOT fabricate" phrasing is a positive-only redirect framed against the verbatim-from-search-results positive lever (no forbidden-URL list; same posture as the URL-quality hot patch).

### 3-tier source priority sort (manual -> sheet -> research)

Carry-forward extension of the 4.10.2-port 2-tier (manual top / rest mixed) sort. Smoke testing surfaced that the producer wanted uploaded sheet rows visually separated from AI-research rows. New `SOURCE_PRIORITY` constant in `src/lib/venue-scout/format.ts` (single source of truth shared by SourcingReport + Shortlist). Within each tier, rank desc with nulls last. Unknown / null source falls back to lowest priority (sorts to the bottom). DeckPrep stays on producer-controlled dnd-kit order (4.6-port lock; producer-controlled order is the entire point of the DeckPrep surface).

### Per-venue enrichment progress (static post-completion count)

Locked option (b): SheetUpload reads `enriched_count` + `count` from the `vs-parse-sheet` response and renders "N / M enriched" when N < M. When all rows enriched (N === M), no ratio shown (redundant). Zero migration cost; ~10 line frontend addition. Realtime sub-progress option (publication add for `vs_candidate_venues` + Realtime subscription) deferred -- not worth the schema bloat for an enrichment pass that typically completes in 30-60s. If sheet sizes routinely run 60s+ in real use, revisit in a future polish phase.

### venue_type inline editing UX (popover with checkboxes)

4.10.2-port collapsed the manual-row `<input>` for type into the shared `<VenueIdentityStack>` and the producer's path to set `venue_type` disappeared on manual rows. Per port-plan locked "all rows editable except recs/considerations": type editing should be available on all rows (manual + sheet + research). UX: click the type-pills cell -> popover with 8 canonical types as toggleable checkboxes; toggle returns a new `CanonicalType[]`; the caller serializes to `${types.join(" / ")}` or null and persists via debounceSave. New `TypeTogglePopover` primitive in `matrix/primitives.tsx` (shadcn `Popover` was already in the repo). Replaces static type-pills in col3 on SourcingReport + Shortlist. DeckPrep doesn't render type pills today; no change.

### VS storage policy reconciliation (open-authenticated, match table RLS)

Pre-4.10.3 state: `briefs` + `sourcing_sheets` + `vs_venue_photos` buckets all gated `is_producer_or_admin()` while the vs_* table RLS is open-authenticated per port plan § 8.6. Member-tier users could read/write vs_* tables but couldn't upload files, breaking the "collaborative agency-wide workflow" the port plan locks. Locked option: relax storage policies to authenticated; matches table RLS posture. `docs/auth-model.md` updated in the same squash so the role-tier definitions reflect "members can use Venue Scout end-to-end." `vs_venue_photos` collapsed from 4 split policies to a single `FOR ALL` policy. `IF EXISTS` on the DROPs handles any Studio-side rename drift.

### design-system § 3 Field label color (text-foreground -> text-primary)

Doc-implementation drift. Doc said `text-foreground`; every implementation (TS NewRoleDetails + RoleSettings + 4.3-port Brief + 4.9-port ScoutSettings) used `text-primary` (coral). Single-line doc fix to match the actual canonical implementation.

### Cutover plan update (cherry-pick before hard reset)

Per port plan § "Done when" rewrite: cherry-pick the must-carry set from main onto `vs-port-fresh` before the hard-reset. Known must-carry: `f24d3f5` (2026-05-13 TS Final Review packet template + layout fixes + email-as-cover-letter fallback). Everything else on main since `dd38577` is the archived failed-Phase-4 stack + URL-quality hot patches, which we DISCARD on cutover. No conflicts expected for must-carry items since TS files are disjoint from VS port files. Verification check is `git show --stat <new-sha>` vs `git show --stat <source-sha>`, not the naive `git log main --not vs-port-fresh --oneline` empty check (which is impossible by design since vs-port-fresh branched from `dd38577`, has archived commits on main below it, and cherry-picks produce new SHAs). Dry-run 2026-05-13 confirmed `git cherry-pick f24d3f5` applies cleanly (2 files, 184+/17-, no conflicts).

### Side-by-side reconciliation pass (small fixes inline, larger items deferred to 4.10.4)

Final pre-cutover walk of VS Pro vs HQ surface-by-surface. Locked option: fold small fixes (5 line change or less) inline as part of 4.10.3 squash; defer larger items to 4.10.4 with logged rationale. Expected intentional divergences (page wrapper widths, Alignment column gone, Source pills present, inline editing extensions, Settings page, ErrorState debug detail) stay as-is per port-plan locks; not regressed. Walk surfaced no unknown divergences that block cutover.

## Phase 4.10.2-port (matrix UX overhaul: inline editing + Source pill + Alignment column removal + manual-at-top sort)

### Three matrix changes bundled

Inline-editing extension + Source pill + column rearrange all edit the same four files (SourcingReport, Shortlist, DeckPrep, matrix/primitives.tsx). Shipping them as one squash keeps the diff coherent and lets the new `<VenueIdentityStack>` primitive land alongside the column-rearrange that needs it. Splitting would require either a placeholder Alignment column on the first ship or staging the primitive twice; both are worse.

### Alignment column removed from UI; `derived_attrs` jsonb stays in DB

Deliberate divergence from VS Pro per Jimmie's 2026-05-12 producer-smoke call. The Alignment column took up ~200px of horizontal real estate for a signal producers don't act on day-to-day; rank already tells them the same thing in less space. `vs_candidate_venues.derived_attrs` jsonb persists in the schema (deck generation may consume it; cleanup deferred to cutover). Both SourcingReport + Shortlist still `select(derived_attrs)` and hold the `columns` state from `vs_scouts.derived_columns`; the data is just no longer rendered. `feedback_port_fidelity` exception applies (port-plan-locked frontend change per § 9 4.10.2 entry, expanded 2026-05-13).

### `EditableVenueName` generalized to `EditableField` with variants

The 4.6-port contenteditable was name-only. 4.10.2 needs the same shape for address + neighborhood across all matrix rows + DeckPrep's full venue summary. Generalized into `EditableField` with `name | address | neighborhood` style variants. `EditableVenueName` kept as a thin backward-compat wrapper so any future import outside the matrix continues to work. `EditableTextarea` added for DeckPrep's `venue_overview` (contenteditable handles single-line poorly for long text; `<textarea>` is right).

### `VenueIdentityStack` (new primitive) replaces the col2 VStack

Four-element vertical stack: name -> divider -> address (+ optional website link) -> divider -> rank -> source pill. Replaces the two-element `VStack` for the Venue|Address cell on SourcingReport + Shortlist. `VStack` stays untouched for the Neighborhood|Type column (still two-element). `RankDisplay` reused as-is inside the new stack (no sizing tweaks; the rank-bar at 50% width of the cell reads cleanly inside the narrower col2 widths 220 / 230).

### `SourcePill` three-label palette with subtle color hints

Three values map to three labels: `sheet -> "Uploaded"` (amber `bg-amber-400/10 text-amber-400`), `research -> "Sourced"` (muted `bg-input text-muted-foreground`), `manual -> "Manual"` (electric blue `bg-blue-400/10 text-blue-300`). Locked option (b) over a single-neutral palette: amber pulls producer attention to sheet rows that may have producer-entered values worth verifying, manual blue matches the ReferralPill convention from Talent Scout (design-system § 12 brand rule 8). Defensive fallback: any non-canonical / null source reads as "Manual". `SourcePill` is NOT rendered on DeckPrep -- producer is past sourcing-origin distinction by then.

### Manual venues pin to the TOP of SourcingReport + Shortlist

VS Pro's 4.6-port lift sorted manual venues to the BOTTOM. Producer's 2026-05-13 call: manual rows are the ones the producer added by hand and most wants to verify / fix; pinning them to the top mirrors the producer's attention order. Within each group (manual / non-manual), rank desc with nulls last. SourcingReport gains a new `useMemo` sort step (was SQL-`.order("rank")`-only); Shortlist's existing client-side sort inverts the manual-vs-rest comparator. Sheet vs research within the non-manual group stay mixed and sorted by rank only; producer disambiguates by Source pill color.

### Features column is editable on ALL rows; Recs + Considerations stay AI-only

Locked: drop `<Bullets>` for the Features column entirely. Use `<EditableTextarea>` with comma / semicolon / pipe / newline split-and-trim across both pages. Manual rows on Shortlist no longer have a special `ghost-input` branch -- one path, all rows. Recommendations + Considerations stay `<Bullets>` everywhere; per Jimmie's 2026-05-13 call: "recommendations and considerations should always be generated by AI." The visual asymmetry IS the affordance signal: Features looks like an input (textarea) so producer knows it's editable; Recs/Considerations look like bullets so producer knows they're AI-generated read-only.

### Type pills stay static (canonical-type editing deferred to 4.10.3)

Manual rows on Shortlist previously had a `<input>` for `venue_type` (free-text). 4.10.2 drops that input -- type column reads as static canonical-type pills for ALL rows, including manual. Manual rows with empty type now read as "-". Producer-edit of canonical types is a 4.10.3 polish item if at all (parseTypes-style multi-select would be the obvious shape, but the matrix's narrow Type subcell isn't a great surface for it).

### DeckPrep gains a `debounceSave` helper + a new editable address field

DeckPrep previously had only the row-order debounce (`orderTimer`); no per-field debounce. Added the same shape as Shortlist's existing `debounceSave` (600ms, optimistic, error -> toast + reload). Address surfaced as a new editable field in the venue summary stack (was hidden previously; producer only saw name + neighborhood + size + cap + website). Size + capacity inputs accept raw strings with unit suffixes ("25,000 sq ft" / "~500 cap") and coerce to int via `parseIntOrNull` at the save boundary so the in-memory Venue keeps its number shape.

### Manual-row autofocus: signal-driven, not query-driven

Shortlist's `addManualRow` previously focused the new row via `setTimeout(50ms) + document.querySelector('input[data-manual-name=...]')`. That only worked when manual rows rendered as `<input>` elements. 4.10.2 collapses manual rows into the same `<VenueIdentityStack>` everyone else uses; the focus path becomes a `lastManualId` state + `autoFocusName` prop -> EditableField's mount-effect calls `ref.current.focus()` once. Same producer outcome, no DOM-queries, no timer.

## Phase 4.10.1-port (sheet upload AI enrichment)

### Sheet upload enrichment is synchronous, not waitUntil

vs-parse-sheet now does parse + insert + AI enrichment in a single call. SheetUpload awaits the full response before navigating. Locked over `EdgeRuntime.waitUntil` because the producer's mental model is "drop sheet -> wait -> ready." Backgrounding the enrichment would let the producer click Continue mid-enrichment and land on SourcingReport with half-enriched rows next to fully-enriched ones. One coherent waiting state on SheetUpload is cleaner than two-stage navigation with a Realtime subscription.

### Parallel-chunked Claude calls, CHUNK_SIZE = 5

15 venues sequentially at ~5s/call would be ~75s. All-parallel risks Anthropic rate-limit and concurrent-connection issues. Chunks of 5 with `Promise.all` inside, sequential across chunks, lands at ~15-20s for a 15-venue sheet and scales linearly to ~50-65s for 50 venues -- well under the Supabase Edge Function ~150s soft cap. Tuning lever in `supabase/functions/vs-parse-sheet/index.ts`: drop to 3 if rate-limit errors show up in logs.

### Per-row Claude failures tolerated; never fail the whole call

Each enrichOne() returns `{ enriched: boolean }`; failures are logged + counted but the loop continues. SourcingReport renders sheet-only data for failed rows next to fully-enriched siblings; no crashes. compile-summaries Pass 1 (extended condition below) catches the orphans at pitch time. Response includes `enriched_count` + `failed_count` for future telemetry / debug UI without grep'ing logs.

### `derived_attrs` filled later, not at parse-sheet time

`vs_scouts.derived_columns` doesn't exist until `vs-research-venues` runs (the next step in the producer flow). vs-parse-sheet has no way to know which derived-attr keys to fill, so the FILL_TOOL output's `derived_attrs` is dropped at parse time. vs-compile-summaries Pass 1 condition extended to fire for `source='sheet' AND derived_attrs IS EMPTY` so the backfill happens at compile time after the producer pitches.

### `FILL_TOOL` + `FILL_SYSTEM` + `buildFillUserMsg` extracted to `_shared/venueFill.ts`

Both vs-parse-sheet (4.10.1) and vs-compile-summaries Pass 1 (4.7.2 + 4.10.1) use the same Pass-1 prompt + schema. Pulling them into a shared module is single-source-of-truth: a future schema-description tweak (the `feedback_tool_choice_collapse` lever) lands once, applies everywhere. `OVERVIEW_TOOL` + `OVERVIEW_SYSTEM` stay local to vs-compile-summaries because only compile uses them.

### Inline `canonicalizeMulti` in vs-parse-sheet (not lifted to venueTypes.ts)

`_shared/venueTypes.ts` already exports a `canonicalizeMultiType` helper, but it returns the trimmed input on no-match (so the frontend matrix can render an unknown-type fallback pill). Server-side enrichment wants null-on-no-match so the patch-guard skips the venue_type write rather than persisting non-canonical strings. Different semantics; kept inline in vs-parse-sheet matching the existing inline copies in vs-compile-summaries and vs-research-venues. Consolidating these three inline copies into a strict `canonicalizeMultiTypeStrict` shared helper is queued for a future cleanup; out of scope for 4.10.1.

### HQ port-side improvement over VS Pro

VS Pro's `parse-sheet` does not enrich. Sheet rows land with sheet-only data and the matrix renders them next to fully-populated research rows. The producer's 2026-05-12 first-run test surfaced the gap; port plan § 9 locked enrichment as part of 4.10.1. Per `feedback_port_fidelity`, this is a port-plan-locked backend improvement, not a fidelity regression -- the exception the memory rule explicitly carves out.

### Frontend `enriching` state is optimistic, not signal-driven

SheetUpload toggles its visible status from "parsing" to "enriching" via a 3-second timer (`PARSING_TO_ENRICHING_MS`), not a Realtime signal from vs-parse-sheet. The function is usually past parse + insert by that point and into the Claude phase, so the producer sees a smooth Parsing -> Enriching -> Done sequence. A real progress channel (per-venue "enriched N/M") would need `vs_candidate_venues` added to `supabase_realtime` publication + a frontend subscription; deferred to 4.10.3 polish if producers ask for it.

## Phase 4.9-port (Scout Settings + full ErrorState + per-scout chrome)

### Settings page is HQ-from-scratch

VS Pro has no Settings analog; it surfaces Start Over inside `PageHeader.tsx` as a per-page button. Port plan § 9 directs an HQ-from-scratch consolidation: rename + project link + Start Over all live in one Settings surface, reached via a persistent gear icon. Same arch decision as 4.3-port Brief (also HQ-from-scratch where VS Pro had a stub). Closest HQ analog used as a layout template: `RoleSettings.tsx` (Talent Scout) for the edit-form + sticky-save-bar + cancel-leave dialog + danger-zone pattern.

### `start_over_scout` is an RPC, not inline supabase calls

A single transactional reset replaces three sequential client-side writes (DELETE candidate venues + UPDATE scout + clear brief_data timestamps). Atomic + cleaner. Pattern matches HQ's other RPCs. `SECURITY INVOKER` so caller RLS applies; no separate grant work.

### Start Over keeps `generated_decks`

History is preserved across resets. If a producer Starts Over after generating a deck, the previous deck row stays in the jsonb array. Re-completion appends another row; the post-completion nav strip surfaces the latest one. Avoids destroying audit trail just because the producer is iterating.

### Storage objects NOT cleaned up inline

Photos in `vs_venue_photos` bucket and sheets in `sourcing_sheets` bucket orphan after the table DELETEs run. Future cron sweep handles cleanup. Same precedent as 4.7.1-port photo storage and TS `candidate_attachments`. Trade-off: simpler RPC + faster Start Over vs slightly delayed reclaim of bucket bytes.

### ErrorState surfaces `research_error` in a `<details>` section (renamed to `pipeline_error` in Phase 4.10.3-port)

Producer can expand the collapsed-by-default summary to see the raw `<CODE>: <message>` from `vs_scouts.pipeline_error` (column renamed from `research_error` in Phase 4.10.3-port). Copy + forward to team for triage. Not auto-expanded; subtle. Replaces the stub's "static message" with the actual error text. Single column carries research / compile / deck errors as of 4.7.2-port.

### Per-scout chrome (gear + step-through nav) on every action page, NOT on loading screens

The shared `<ScoutSettingsLink />` + `<ScoutStepThroughNav />` components land in `src/components/venue-scout/ScoutChrome.tsx` and import into 8 pages: Brief, SheetPrompt, SheetUpload, SourcingReport, Shortlist, Review, DeckPrep, ErrorState. Loading screens (Researching, Compiling, Generating) are excluded by design: producers wait on mid-flight AI work, they can't take Settings or step-through actions during those phases. Producer's read 2026-05-12.

### Step-through nav strip conditional on `current_step === 'completed'`

Always-mounted (the chrome lives on every action page) but only renders when the scout is finished. Pre-completion: silent. Post-completion: 5 step chips + 1 latest-deck chip. The deck chip is an `<a target="_blank">` to the Drive `edit_url`; absent if `generated_decks` is empty or the latest entry has no edit URL.

### Pages without an existing `vs_scouts` query let the chrome self-query

SheetPrompt + SheetUpload don't already read the scout. Rather than forcing them to wire up a meta-fetch they don't otherwise need, the `<ScoutStepThroughNav />` component supports an optional `scout` prop: pages that have the data pass it; pages that don't omit the prop and the component fires its own select(`current_step, generated_decks`). One small extra round-trip on those two pages, but they're navigation surfaces where producers rarely linger.

## Phase 4.8.3-port (deck-output correctness hotfix)

### Slide-index mismatch fix

VS Pro's `generate-deck` was written against a template with 5 front-matter slides (cover, project info, event overview, section title, venue map at slide 5), where slide 6 = per-venue detail and slide 7 = per-venue floor plan. Phase 4.8.2-port lifted the function verbatim per port-fidelity and shipped feature-complete without exercising the deck output against Mirror's actual template until first real producer test 2026-05-12. Mirror's production template (verified via .pptx parse) has 6 front-matter slides with the venue map at slide 6, per-venue detail at slide 7, per-venue floor plan at slide 8. The off-by-one meant the function duplicated slide 6 (venue map) thinking it was per-venue detail, wrote per-venue tokens to those duplicates (silent no-ops because slide 6 doesn't have the body tokens), wrote photo replacements against alt text that doesn't exist on the legend slide, and never duplicated slide 8 at all. Hotfix shifts every slide-index reference by one: `legendSlideId = slides[5]` (venue map), `templateSlide7 = slides[6]` (detail), `templateSlide8 = slides[7]` (floor plan). Legend repText calls scoped to `legendSlideId` while we're touching them, both because that's the correct shape and so the new variable doesn't sit unused.

### `{{venue_name}}` uppercase treatment

Producer feedback at first-run: venue names in deck headers feel weak in mixed case; ALL CAPS reads cleaner against the Mirror brand visual hierarchy. Single `(v.name ?? "").toUpperCase()` call before the `repText` write. Only on `{{venue_name}}`; other tokens (`{{venue_address}}`, `{{venue_neighborhood}}`, `{{venue_overview}}`, etc.) keep their original casing. Applies to both the per-venue detail slide and the per-venue floor plan slide (both share the same `{{venue_name}}` header).

### Loading-page copy refresh

"Compiling Pitch Deck" → "Compiling Deck Preview" (Compiling.tsx); "Generating Pitch Deck" → "Generating Venue Deck" (Generating.tsx). Closer match to what the producer is actually waiting for. The output is a preview deck for internal venue review, not a fully designed pitch deck handed to a client. Description paragraphs underneath unchanged.

## Phase 4.8.2-port (Generating + vs-generate-deck)

### Phase 4 port feature-complete after 4.8.2

The 4.8 split shipped 4.8.1 (Deck Prep + `googleServiceAccount` infra) and 4.8.2 (Generating + `vs-generate-deck` + four new ErrorStateStub keys). End-to-end producer flow now works: Brief → Sheet Prompt → Sheet Upload / Researching → Sourcing Report → Shortlist → Review → Compiling → Deck Prep → Generating → `/brief` landing for completed scouts. Remaining sub-phases (4.9-port Settings + Start Over + full ErrorState, 4.10-port polish + side-by-side reconciliation) are non-blocking for the core workflow.

### `vs-generate-deck` uses `getGoogleAccessToken` without impersonation

VS Pro's inline ~60 lines of JWT-mint + token-exchange code deleted; the function imports `getGoogleAccessToken(["https://www.googleapis.com/auth/presentations", "https://www.googleapis.com/auth/drive"])` from `_shared/googleServiceAccount.ts` (cherry-picked in 4.8.1-port). No `impersonateUser` parameter because the service account itself owns the Drive + Slides calls and is a member of the Mirror Shared Drive that holds the template + output folder. Matches the `googleServiceAccount.ts` header-comment design intent. Cache-keyed by `${impersonateUser ?? ""}|${sortedScopes}` means the Gmail token and the Drive+Slides token coexist in the same module-level cache without collisions.

### Error code surfacing pattern: `research_error` formatted as `<CODE>: <message>`

VS Pro returned `{ error, code }` synchronously to a sync caller. The port uses `EdgeRuntime.waitUntil` so the response is gone before failure surfaces; the only channel back to the page is `vs_scouts.research_error`. Encoding shape: `${ErrCode}: ${message}` where `ErrCode ∈ { AUTH_FAILED, TEMPLATE_COPY_FAILED, SLIDES_API_FAILED, NO_VENUES_INCLUDED, UNKNOWN }`. The Generating page parses with `^([A-Z_]+):` regex and routes to `/deck/error/<code>`. Fall-through is `UNKNOWN`. Simple, no schema change, no separate `research_error_code` column. Alternative considered: a typed jsonb column. Rejected as over-engineering for five error codes; the regex parse is one line and the column is already in place.

### Failure path leaves `current_step='deck_prep'` (matches 4.7.2 pattern)

On any failure, `vs-generate-deck` writes `status='failed'` + `research_error=<CODE>: <message>` but does NOT touch `current_step`. The producer can re-trigger Generate from DeckPrep without manually walking the scout back through the funnel. Same disposition as 4.7.2-port leaving at `compiling` on failure: the loading/error page is a transient state, not a step the producer dwells in.

### `vs_scouts.status='complete'` is the final state

4.8.2-port is the first sub-phase that writes `status='complete'`. The text column already accepts arbitrary values; the documented enum (`draft / in_progress / complete / failed`) gains its third reachable value here. Sticks until Start Over (4.9-port) resets the scout to `draft`. Scout Index status pill (4.2-port) reads from this column and will need a `complete` pill style alongside the existing `draft` / `in_progress` / `failed`.

### `brief_data.deck_generation_started_at` canonical jsonb idempotency key

Joins the canonical `brief_data` jsonb key list alongside `expected_guest_count`, `notes`, `uploaded_files`, `research_started_at`, `compile_started_at`. 90-second grace window matches 4.5 / 4.7.2. Cleared on next successful run (the success write sets `research_error: null` but does NOT delete this key; left in place so a future audit can reconstruct kickoff timing). Schema-flex jsonb means no migration.

### Deck name hyphen, not em dash

VS Pro deck name template used a literal em dash (U+2014) between `event_name` and the static suffix: `${event_name} [em dash] Venue Pitch Deck v${version}`. Voice rule (design-system § 12 rule 1) bans em dashes. Port template: `${event_name} - Venue Pitch Deck v${version}` (hyphen). The deck file itself, named at copy time, carries the hyphen.

### `failWithCode` writes are idempotent on the row

The outer `try { Promise.race(generateWork, timeout) } catch` calls `failWithCode("UNKNOWN", ...)` even if `generateWork` already wrote a more specific code before throwing into the outer scope. The double-write is fine: each call replaces `status` and `research_error` atomically, the latest write wins, and `last_touched_at` advances. No state is lost. Simplifies the error path; no need to thread a "did-we-already-fail" flag.

## Phase 4.8.1-port (Deck Prep + googleServiceAccount infra)

### Phase 4.8-port split into two passes (4.8.1 frontend + infra, 4.8.2 generate flow)

Combined 4.8-port scope was ~1,000 lines of source across DeckPrep + Generating + `vs-generate-deck` (the largest single function in the port). Splitting isolates the Google Slides population logic for its own review cycle, lets the `googleServiceAccount` cherry-pick land independently of slide-template complexity, and lets 4.8.2 wait on secrets verification (`GOOGLE_TEMPLATE_FILE_ID`, `GOOGLE_OUTPUT_FOLDER_ID`) without blocking 4.8.1. 4.8.1-port ships DeckPrep + the shared service-account helper + the gmailServiceAccount delegation refactor. 4.8.2-port ships Generating + `vs-generate-deck` + the four new ErrorStateStub keys.

### `_shared/googleServiceAccount.ts` cherry-picked from failed-attempt main `be30168`

The failed-attempt Phase 4.6 already built the generic Google access-token helper with the exact shape the port needs: module-level cache keyed by `${impersonateUser ?? ""}|${sortedScopes}`, optional `impersonateUser` for domain-wide-delegation flows, supports both Gmail (impersonates `jobs@mirrornyc.com`) and Drive + Slides (no impersonation; service account owns the API call). Rewriting from scratch would produce the same file. Cherry-picked verbatim with header comment refreshed to reference Phase 4.8.1-port and em-dashes swapped to comma per voice rule. No behavioral changes.

### `gmailServiceAccount.ts` refactored to delegate

Pre-4.8.1 file was ~130 lines with its own copy of `loadServiceAccountKey` / `importRsaPrivateKey` / `signJwt` / `base64Url*` helpers and a private token cache. Post-refactor: ~30 lines. Public API (`getGmailAccessToken(): Promise<string>`) preserved exactly; all four callers (`ts-pull-candidates`, `ts-evaluate-candidate`, `_shared/sendEmail.ts`, `_shared/packetRender.ts`) keep their existing import. Internal implementation delegates to `getGoogleAccessToken(SCOPES, { impersonateUser: 'jobs@mirrornyc.com' })`. Smoke-tested against TS pull/evaluate to confirm no regression before squash.

### DeckPrep `current_step` writes deferred to server-side (vs-generate-deck, 4.8.2-port)

VS Pro's DeckPrep has a stub `current_step='deck_generated'` write inside an unreachable `try` block; the live flow already deferred to server-side. Port matches: 4.8.1-port frontend only writes `deck_order` + `include_in_deck` flags. `current_step='completed'` is written by `vs-generate-deck` on success (lands in 4.8.2-port), parallel to 4.5-port and 4.7.2-port EdgeRuntime.waitUntil patterns where server-side state transitions are atomic with the actual work.

## Phase 4.7.2-port (Compiling + vs-compile-summaries)

### Reuse `vs_scouts.research_error` column for compile errors (renamed to `pipeline_error` in Phase 4.10.3-port)

Adding a `compile_error` column would split the AI-pipeline failure channel into two physically-separate state machines for what is conceptually a single producer-facing concern ("something in the AI pipeline went wrong"). Keeping one channel means both Researching and Compiling pages subscribe to the same Realtime payload shape, ErrorStateStub keys (`research-timeout`, `compile-failed`) co-locate, and Scout Index can render a single "had a problem" indicator without joining two columns. The column rename to `pipeline_error` (more accurately describing the dual usage) is deferred to cutover doc sweep or 4.9-port polish; renaming is cheap, splitting later is not.

### Compile timeout raised to 180 seconds (vs 4.5-port research's 120)

Compile arithmetic is per-venue, not per-call. 5 pitched venues with all manual rows triggers up to 10 sequential Claude calls (Pass 1 fill + Pass 2 overview each). At ~15 seconds per call, that's 150s of work; ceiling at 180s gives a 30s buffer. Research is a single Claude call regardless of venue count (the tool returns a batched array), so its 120s ceiling stays appropriate.

### Two-pass compile-summaries through `callClaude` (first multi-tool-choice consumer)

VS Pro's compile-summaries was the first function in the source repo with two distinct `tool_choice`-forced tools in a single function (`fill_venue` for Pass 1, `write_overview` for Pass 2). HQ's port is the first port-side function with that shape; the `callClaude` wrapper already supports per-call `tools` + `tool_choice` so no wrapper changes needed. Pattern documented inline in `vs-compile-summaries/index.ts` for the next multi-tool consumer.

### Notes flow collapsed: inline `vs_candidate_venues.notes` (vs VS Pro's separate `venue_notes` table query)

VS Pro reads `from("venue_notes").select(...)` separately to build a `noteMap`. 4.3-port already inlined producer notes into `vs_candidate_venues.notes`; vs-compile-summaries's venues query selects `notes` directly. Both Pass 1 and Pass 2 user messages substitute `Producer notes: ${v.notes ?? "(none)"}` from the inline field. Saves one round-trip per compile call and avoids the extra `notes_by_venue_id` mapping step.

### `vs-compile-summaries` payload simplified from `{ project_id, venue_ids }` to `{ scout_id }`

VS Pro requires the page to fetch pitched venue IDs first and pass them in. Port flips: the function queries pitched venues itself via `eq("scout_id", scout_id).eq("pitched", true)`. Smaller payload, matches the rest of the port-side functions (`vs-parse-brief`, `vs-research-venues` both take `{ scout_id }` only), and centralizes "which venues to compile" in one place (server-side, atomic with the load) instead of split between page and function. Pitched-venues query is fast (indexed on `(scout_id, pitched)` via the implicit FK + boolean column).

### Testing `claude-sonnet-4-6` on compile-summaries (independent test from 4.5-port research-venues)

Same posture as research-venues: take the wrapper default and watch the diagnostic log for the collapse signature. Different prompts may behave differently; research's `submit_research` with `web_search` had a known May 11 collapse pattern (out<200 + server_tool_uses=0); compile's `fill_venue` and `write_overview` are pure text-tool flows with no server tools, so the signal narrows to `out<200`. Pivot procedure to `claude-sonnet-4-5` is inline in the function. The memory note `project_sourcing_model_pin` covers the failed-attempt `vs-start-sourcing` and does NOT carry over to port-side functions.

## Phase 4.7.1-port (Review + PhotoUploadModal + Shortlist photo unstub)

### Phase 4.7 split into two passes (4.7.1 frontend, 4.7.2 backend)

The combined 4.7-port scope (Review + PhotoUploadModal + storage bucket + Shortlist unstub + Compiling page + `vs-compile-summaries` edge function + `compile-failed` error key) was ~2,000+ lines across 4 artifacts. Splitting into 4.7.1 (frontend + storage) and 4.7.2 (compile flow) gives each pass a 4.6-port-sized scope, isolated code-reviewer cycles, smaller blast radius if the storage bucket migration needs revision, and keeps PhotoUploadModal complexity ("most complex single component in the port" per port plan) in its own pass. After 4.7.1, Review's Confirm + Compile Deck button writes `current_step='compiling'` and navigates to `/sourcing/compiling`, which 404s until 4.7.2-port. Same intentional 404 window pattern as 4.2→4.3, 4.3→4.4, 4.4→4.5, 4.5→4.6, 4.6→4.7.

### `vs_venue_photos` bucket private + signed URLs (renamed from VS Pro `venue-photos` public)

VS Pro's public `venue-photos` bucket would expose deck photos to anyone with the URL. HQ's `vs_venue_photos` bucket is private (`storage.buckets.public = false`) with storage RLS gated on `is_producer_or_admin()`, parallel to `sourcing_sheets` + `briefs`. Display reads go through `supabase.storage.from("vs_venue_photos").createSignedUrl(path, 3600)` (1-hour TTL); URLs regenerate on every Review mount and every PhotoUploadModal open. Privacy + bucket rename is the locked port-plan § 2 decision; HQ Core's existing public `venue_photos` bucket (used by the master `venues` table) stays for HQ Core reads downstream.

### Storage path format `${scoutId}/${candidateVenueId}/slot-${N}-${timestamp}.${ext}`

Lifted from VS Pro verbatim (hyphen + timestamp). The 4.1-port `docs/schema.md` spec read `slot_${N}.${ext}` (underscore, no timestamp) as a placeholder; this sub-phase updates the doc to the landed format. The timestamp cache-busts when a producer re-uploads to a slot whose old storage object was just deleted in the same save (otherwise the CDN can serve the stale image for that path's lifetime). Scout-id and candidate-venue-id segments rename from VS Pro's `${projectId}/${venueId}` per the HQ table rename.

### HQ canonical `Field` created at `src/components/ui/Field.tsx`

VS Pro's Review.tsx defined a small inline `Field` (10px uppercase muted-foreground label above child). The spec locks the inline definition gets dropped in favor of an HQ canonical primitive. Created `src/components/ui/Field.tsx` with that compact shape. Deliberately distinct from the heavier page-form Field shape used inline in `Brief`, `NewScout`, `NewRoleDetails`, `RoleSettings` (13px font-mono `text-primary` Label primitive). Those pages keep their inline definitions; consolidating both into one canonical isn't 4.7.1-port's job and the styles diverge enough that a single component would need a `variant` prop.

### PhotoSlot renders actual signed URL when `hasPhoto`

VS Pro's Review.tsx PhotoSlot at line 272 hardcoded the placeholder for both states (`backgroundImage: hasPhoto ? "url(/mirror-placeholder.jpg)" : "url(/mirror-placeholder.jpg)"`); appears to be a stub awaiting real signed-URL wiring. Port fixes it: when `hasPhoto && photoUrl`, render `url(${photoUrl})`. Producers expect to see their photos at a glance on Review; a placeholder-for-everything makes the page useless for the "confirm photos" task. `photoUrls` state is populated on mount + refreshed via `refreshVenuePhotos(activeVenueId)` after PhotoUploadModal save.

### Shortlist photo column unstub: real query + real modal open

4.6-port stubbed `photoCounts` to always 0 and the click handler to a toast. 4.7.1-port replaces the stub query with a real `select("candidate_venue_id").in(...)` against `vs_venue_photos`, replaces the toast with `setActiveVenue(v) + setPhotosOpen(true)`, and mounts `<PhotoUploadModal />` at the bottom alongside `<NotesModal />`. The button state machine (Locked / + Upload / ✓ Complete) stays verbatim from 4.6-port.

## Phase 4.6-port (Sourcing Report + Shortlist + matrix primitives)

### Frontend `venueTypes.ts` mirror landed; lock-step with `_shared/venueTypes.ts`

Port plan § 6 primed the server-side `_shared/venueTypes.ts` in Phase 4.1-port ahead of consumers (`vs-parse-sheet` at 4.4-port and `vs-research-venues` at 4.5-port). 4.6-port lands the frontend mirror at `src/lib/venue-scout/venueTypes.ts` for the matrix. Same `CANONICAL_TYPES`, `TYPE_STYLES`, `canonicalizeType`, `canonicalizeMultiType`, `parseTypes`, `sanitizeWebsiteUrl` exports; any change touches both files in the same commit. Header comments on both files flag the rule. Drift produces mismatched venue type pills between the matrix UI and the AI / sheet source data.

### Notes table dropped; notes inline on `vs_candidate_venues.notes`

VS Pro carries a separate `venue_notes` table with a row per venue and a separate query at mount. The port collapses it into a single nullable `notes text` column on `vs_candidate_venues` (already on schema as of 4.1-port). Saves a round-trip on the matrix page mount, simplifies the NotesModal save path (single UPDATE instead of an UPSERT against a child table), and matches the inline-on-parent pattern HQ uses for Talent Scout `internal_notes`.

### Photo upload column stubbed for visual parity

VS Pro's `UploadPhotosButton` renders three states (Locked / + Upload / ✓ Complete) gated on `pitched` and a count from `venue_photos`. 4.6-port lifts the button verbatim but always passes `count=0` and routes the click handler to a toast pointing to Phase 4.7-port. Producer sees the full column + state machine so the Shortlist page reads complete; the upload modal + `vs_venue_photos` reads land in 4.7-port. Alternative was to hide the column entirely until 4.7, which would have masked the visual layout and made the column-width audit harder.

### Matrix renders inside AppShell's `max-w-7xl` container with horizontal scroll

VS Pro's matrix wrappers in `max-w-[1860px]` page-level container; the table itself is `min-w-[1740px]` and scrolls horizontally inside its own `overflow-x-auto` wrapper. HQ's AppShell scopes every authenticated route to `max-w-7xl` (1280px), so the matrix scrolls horizontally on most viewports rather than breaking out of the AppShell container. Tradeoff acknowledged: less optimal on wide monitors than VS Pro's layout, but stays inside the AppShell idiom (same as every other HQ surface) and avoids negative-margin escapes. Revisit at the 4.10-port polish pass if it actually bites.

### Inline header pattern (no `PageHeader` component lift)

VS Pro uses a `PageHeader` component with `crumbs`, `label`, `title`, `description`, `actions` props. HQ port has inlined the equivalent pattern on every Venue Scout surface (Phase 4.2 through 4.5). 4.6-port stays consistent: `crumb` link + eyebrow + `h-page` heading + right-aligned counter + optional description, all inline. Extraction to a shared `PageHeader` component is a candidate for a doc-only cleanup commit once enough surfaces have shipped that the pattern is stable.

### Type-pill palette lifted verbatim from VS Pro (no HQ token substitution)

VS Pro's per-type `bg-[rgba(181,133,136,0.18)] text-[#D89BA0]`-style rgba palette is an intentional desaturated brand-context color set with one tone per venue type. HQ design tokens don't define equivalent type-specific accents and substituting `text-foreground / muted-foreground` would lose the at-a-glance type signal. Lift the literal rgba values into `TYPE_STYLES` and keep them out of the HQ token chain. Same rationale applies to the rank-tier hex colors (`#4ade80`, `#f59e0b`, `#ef4444`, `#555`): VS Pro picked them deliberately and they're the same colors HQ uses inline elsewhere (`tier-badge--3` etc.), so leave them as literals in `RANK_TEXT` / `RANK_BAR`.

### Matrix column-header strip uses `bg-surface` (opaque), not `bg-secondary/30`

4.2-port (ScoutIndex) and 4.4-port (SheetUpload) both use `bg-secondary/30` for their list-view header strips because no sticky columns are in play and the translucent backdrop reads cleanly over `bg-background`. The matrix has sticky col1 + col2 headers, so the 30% alpha lets horizontally-scrolled column content bleed THROUGH the sticky cells, producing a visual smear. Surfaced by code-reviewer cold pass on `272a077`. Swapped to opaque `bg-surface` (`0 0% 4%`), which also matches VS Pro `--bg-elevated` (`0 0% 4%`) byte-for-byte. Header strip now reads slightly darker than the matrix body (`bg-surface-alt` = `0 0% 8%`), preserving VS Pro's intended elevation contrast.

### `Shortlist.debounceSave` widens its patch type and splits `key_features` eagerly

The manual-row `<input>` emits a raw delimited string ("warehouse, gallery, …") on each keystroke. The original implementation cast that string into the `key_features: string[] | null` slot via `as unknown as string[]`, leaving a string in the in-memory Venue. Surfaced by code-reviewer as a type-lie that would crash any consumer reading `v.key_features` as an array (`.join` / `.map` on string vs. array). Fix: `debounceSave` now accepts a `VenuePatch` union (`key_features?: string[] | string | null`) and normalizes to an array BEFORE writing state, so the Venue type stays honest and the eventual DB UPDATE writes the array directly (the previous deferred split inside the setTimeout became dead code).

### Alignment pills use Tailwind `green-400` / `amber-400` instead of `--success` / `--warning` tokens

VS Pro reads `bg-[hsl(var(--success))]/15` and `bg-[hsl(var(--warning))]/13` on the Alignment column pills. HQ defines `--success` (matches: 4ade80) but uses `--warn`, not `--warning`. Rather than introduce a `--warning` alias or two-track the pill backgrounds across HQ files, swap both pills to fixed Tailwind palette colors that resolve to the same hex (green-400 = #4ade80, amber-400 = #f59e0b). One-line substitution; no token-naming follow-up needed.

### Shortlist sync trigger simplified to one condition

The failed-attempt trigger fired on `(shortlisted false→true) OR (added_manually=true AND research_status='complete')`. Port schema doesn't carry `added_manually` (collapsed into `source='manual'`) or `research_status`. The 4.6-port re-introduction fires only on `shortlisted false→true`. Manual venues added on Shortlist enter with `shortlisted=false, source='manual'`; the page's `v.shortlisted || v.source==='manual'` filter makes them visible regardless. If a producer pitches a manual venue but never toggles shortlisted, the sync trigger never fires and no HQ `venues` row is created; known gap, acceptable for 4.6-port. A future migration could extend the trigger to also fire on `pitched false→true` or on `source='manual'` INSERT, but that's out of scope here.

### Manual venue add row inserts `shortlisted: false`

VS Pro's behavior. The page filter `v.shortlisted || v.source==='manual'` makes manual rows visible on Shortlist regardless, so auto-shortlisting them wouldn't change visibility; it would just fire the sync trigger on insert before the producer has confirmed details. Keeping `shortlisted=false` matches VS Pro and defers the sync to an explicit producer action (toggling shortlist back on `SourcingReport`, or extending the trigger later per the prior decision).

## Phase 4.5-port (Researching + vs-research-venues)

### `EdgeRuntime.waitUntil` + Realtime replaces VS Pro's sync-await

Port plan § 8.3 calls this out. VS Pro's Researching page awaits a synchronous fetch on `research-venues` for 30 to 90 seconds before navigating. HQ port flips the handshake: `vs-research-venues` returns 200 immediately, the AI work runs inside `EdgeRuntime.waitUntil`, and the Researching page Realtime-subscribes to `vs_scouts` (`REPLICA IDENTITY FULL` was set on the table during 4.1-port) plus 3-second polling fallback. Faster perceived UX, graceful navigation-away (kicking off then closing the tab still completes the research). Same pattern as `ts-final-review` + `FinalReviewLoading`.

### `vs_scouts.research_error text` column added for the EdgeRuntime.waitUntil failure channel

Because the page no longer reads failure off the HTTP response, the function needs a persistent channel to signal "research failed". `status='failed'` alone doesn't carry a message; `research_error text` (nullable) does. Function clears it at kickoff so a retry from a prior failure starts clean, then writes the message on any error path. The Researching page navigates to `/sourcing/error/research-timeout` (the existing 4.4-port stub keyspace) on non-null `research_error` + `status='failed'`.

### Testing `claude-sonnet-4-6` (wrapper default) on `vs-research-venues`

Existing memory note `project_sourcing_model_pin` pins the failed-attempt `vs-start-sourcing` function to `claude-sonnet-4-5` after the 2026-05-11 `web_search` degradation. The port-side `vs-research-venues` is a NEW function name (does not slot-replace anything) and we're starting fresh on `claude-sonnet-4-6`. Diagnostic log line on every call captures `input_tokens`, `output_tokens`, and `server_tool_use` block count: the collapse signature is `out<200 AND server_tool_uses=0`. If the first real round in production reproduces that, the pivot procedure is documented in `supabase/functions/vs-research-venues/index.ts` (single-line `model: "claude-sonnet-4-5"` override on the `callClaude` call) and the memory note gets updated to add `vs-research-venues` alongside `vs-start-sourcing`.

### URL quality lever stays off the SYSTEM prompt

Per memory rule `feedback_tool_choice_collapse`: per-item gating in SYSTEM prompts (or `minItems` constraints on the array under forced `tool_choice`) collapses output. The SYSTEM string is lifted verbatim from VS Pro: the type-constraint paragraph and the listing-DB callout are unchanged. URL quality is enforced by two deterministic post-emission gates: (a) the `website_url` schema description nudge (positive-only with concrete examples; no forbidden-URL list), and (b) `sanitizeWebsiteUrl` from `_shared/venueTypes.ts` rejecting search pages + listing-DB homepages while letting deep links through. Same two-gate chain the failed-attempt URL-quality hot patch settled on.

### Idempotency via `brief_data.research_started_at` 90-second grace window

`EdgeRuntime.waitUntil` runs after the response, which means a page hard-refresh while research is in flight will fire the kickoff invoke again. Without a guard, that doubles the Anthropic spend and INSERTs duplicates. Function checks two conditions before doing work: (a) `current_step !== 'researching'` skips (page already moved on), and (b) `brief_data.research_started_at` less than 90 seconds old skips (kickoff still in flight). Otherwise it stamps `research_started_at = now()` and proceeds. 90 seconds is slightly longer than typical Anthropic response time so a normal completion clears the window naturally.

### 120-second hard ceiling on Claude work

`Promise.race(callClaude, timeout)` inside `work`. If the call hangs (network stall, server-side issue), writes `status='failed' + research_error='timed out after 120s'` instead of leaving the page spinning forever. Defense-in-depth; the AI typically returns in 60 to 90 seconds.

### Empty sanitized result writes failure (does not silently advance)

After `canonicalizeType` + `sanitizeWebsiteUrl` + nameless-row filter, if `cleanVenues.length === 0` we treat it as a research failure (`research_error='AI returned no usable venues. Try again.'`) rather than INSERTing zero rows and flipping to `sourcing_report`. Surfaces the issue to the producer; silent zero-result would leave them on a Sourcing Report with no candidates and no obvious "what now".

### `vs_scouts.status='in_progress'` on research success

VS Pro's `projects.status` semantics were undefined; HQ port locks them down. `draft` (initial) goes to `in_progress` (research complete, in the AI funnel through deck generation), then to `complete` (4.8-port deck generated) or `failed` (any AI pipeline error). The ScoutIndex pill (4.2-port) reads from this column; writing `in_progress` on research success lets the pill distinguish "started" from "researched" at a glance.

### `vs-research-venues` is a NEW function name (does NOT slot-replace `vs-start-sourcing`)

VS Pro's research function was named `research-venues`; the failed-attempt HQ function is named `vs-start-sourcing`. The port plan's renames put the new function at `vs-research-venues`, which is unused. After 4.5-port deploys, `vs-start-sourcing` stays on the cutover deletion list (different from how 4.3-port / 4.4-port slot-replaced existing functions).

## Phase 4.4-port (Sheet Prompt + Sheet Upload + vs-parse-sheet)

### Bucket name `sourcing_sheets` (underscore), not VS Pro's `sourcing-sheets` (hyphen)

VS Pro uses `sourcing-sheets`. HQ uses `sourcing_sheets` per the port plan § 2 storage table and the existing initial-schema bucket name. The port adapts (frontend upload target, edge function download source) but the bucket itself is unchanged.

### `type` column renamed to `venue_type` in `vs_candidate_venues`

VS Pro's `venues.type` reads as a Postgres / TS reserved word. Rename landed in the 4.1-port migration; vs-parse-sheet writes the new column name on every INSERT. Frontend ports (Sourcing Report, Shortlist, etc.) read `venue_type` from the row going forward.

### PDF parse stays intentionally naive (lifted verbatim from VS Pro)

VS Pro's `parse-sheet` returns 0 venues for PDF uploads (the `pdfjs` / `unpdf` parse-the-table path is unreliable). Port plan § 6 marks parse-sheet as Lift, so HQ keeps the same behavior: PDF -> empty rows -> frontend routes to `/sourcing/error/empty-sheet`. Real PDF table extraction is a post-cutover enhancement, not a port-sub-phase fix.

### Error route handled by a 4.4-port stub; full ErrorState lands in 4.9-port

VS Pro `ErrorState.tsx` is in scope for Phase 4.9-port per port plan § 9. To avoid a five-sub-phase 404 window for parse-fail / empty-sheet conditions, 4.4-port ships a ~30-line `ErrorStateStub.tsx` that reads `:errorKey` from the URL and renders a key-keyed message + back-to-Sourcing link. Stub gets replaced (in place at the same route) when 4.9-port ports the full version. Stub-vs-full divergence is contained to the message rendering; the route + nav target stays put.

### `vs-parse-sheet` slot replacement in production

Failed-attempt `vs-parse-sheet` function is still in production. The 4.4-port version deploys to the same slot, same name, different shape (`{ scout_id, storage_path }` payload, INSERT into `vs_candidate_venues` not `venues`, `venue_type` not `type`). After cutover, the cleanup task reduces from "delete vs-parse-sheet" to "verify the port version is the current deployment". Parallel to how 4.3-port handled `vs-parse-brief`.

### `sourcing_sheets` storage policy tier mismatch is pre-existing drift; not 4.4-port's job

Storage policy on `sourcing_sheets` bucket is `is_producer_or_admin()` while the `vs_*` table RLS is open-authenticated (4.1-port). A `member` user could create a scout via the open-RLS table path but couldn't upload a sheet (storage denies). `docs/auth-model.md` line 13-15 also says members get no VS access, contradicting the table RLS. Reconciliation belongs in the cutover doc sweep, not a 4.4-port sub-phase fix.

## Phase 4.3-port (Brief)

### Brief is a single-page form; PDF parse is an affordance on that form

VS Pro had no real brief surface (`/projects/:projectId/brief` was a `ComingNext` placeholder). Port plan § 9 explicitly directs HQ-from-scratch design. We shipped `/venue-scout/scouts/:id/brief` as a single-page form modeled after `RoleSettings.tsx` (dirty-state tracking, sticky save bar, beforeunload guard, cancel-leave AlertDialog). PDF upload + parse lives ABOVE the field stack as an affordance: drop a PDF, `vs-parse-brief` extracts structured fields via a forced `submit_brief` tool call, producer reviews in a preview panel, clicks Apply to merge into the form. No multi-step wizard. The failed-attempt 4.3.1 path tried a wizard and the carry-along cost wasn't worth it when there's only one card.

### NewScout post-create navigation flips from `sheet_prompt` route to `/brief`

4.2-port shipped `NewScout` routing to `stepToRoute(id, 'sheet_prompt')`, an intentional 404 window until the sourcing flow lands. 4.3-port supersedes that: post-create lands on `/venue-scout/scouts/:id/brief`, which is the first per-scout page producers should hit. Brief's Continue button still calls `stepToRoute(id, 'sheet_prompt')` after saving, so the 404 window simply moves one step downstream until 4.4-port lands.

### `brief_data` canonical jsonb keys: `expected_guest_count`, `notes`, `uploaded_files`

Port plan § 8.2 puts every brief field on `vs_scouts`: named columns for the structured ones (`client_name`, `event_name`, `live_dates`, `city`, `budget`, `event_overview`) and `brief_data jsonb` for everything else. We locked three canonical keys for 4.3-port:
- `expected_guest_count` (number): consumed by `vs-generate-deck` slide templating.
- `notes` (string): freeform context that downstream prompts (`vs-research-venues`, `vs-compile-summaries`) stringify wholesale.
- `uploaded_files` (string[]): storage paths under the `briefs` bucket. Append-only; future audit / re-parse can re-read source documents.

Additional keys passed through from parse ride along inside `brief_data` without a dedicated form field, and downstream prompts stringify the entire jsonb so anything the producer manages to add gets seen by the AI.

### `vs-parse-brief` (port version) replaces the failed-attempt function in place

Same name, same deployment slot, different signature (`{ scout_id, storage_path }` vs the failed `{ session_id, storage_paths[] }`) and different output shape (matches port-plan `brief_data` keys, not the failed `vs_briefs` columns). After cutover, the failed-attempt cleanup task reduces from "delete vs-parse-brief" to "verify the port version is current" (it will be). Uses Claude's native PDF reading via a `document` content block (no `unpdf` round-trip); modern HQ pattern for any single-PDF parse.

### `vs-parse-brief` is `verify_jwt = true`: explicit entry in config.toml

Default is true, so the entry is technically optional, but every prior `vs-*` / `ts-*` function in `config.toml` flipped it OFF for self-invocation. `vs-parse-brief` is the first VS function that keeps the default, and the explicit entry advertises that as a deliberate choice rather than a missed config row.

## Phase 4.2-port (Scout Index + New Scout entry)

### `current_step` derives the producer-facing phase label; no schema column

VS Pro carried a `projects.phase` text column maintained in lockstep with `current_step`. The port drops the column and derives the label from `current_step` via `currentStepToLabel()` in `src/lib/venue-scout/format.ts`. One source of truth, no drift, cheaper writes downstream. Label table lives in the helper; tweak in one file when copy needs to shift.

### NewScout post-create navigates to the eventual sheet-prompt route

`/venue-scout/scouts/:id/sourcing/sheet-prompt` doesn't exist yet (lands in Phase 4.4-port). Post-create still navigates there because that's the correct eventual UX -- producer fills brief, then immediately walks into the sheet-prompt flow. The 404 window is short (4.3-port and 4.4-port land soon) and the alternative (bouncing back to `/venue-scout` and forcing a row click) reads as a regression once the sheet-prompt page exists.

## Phase 4.1 (Scout Dashboard; first Venue Scout surface)

### Venue Scout RLS: one permissive FOR ALL policy per vs_* table, no creator or role scoping

All five vs_* tables (`vs_scouts`, `vs_briefs`, `vs_sourcing_rounds`, `vs_candidate_venues`, `vs_pitch_decks`) got their original four-per-table producer/admin-gated policies dropped and replaced with a single `FOR ALL TO authenticated USING (true) WITH CHECK (true)` policy each. Any authenticated HQ user can now read, create, edit, or delete any scout regardless of who created it.

Rationale: Venue Scout is a collaborative, agency-wide workflow -- a scout isn't personal data owned by one producer. Every team member being able to jump into any open scout and make edits is the right operating model. Creator scoping was carried over from the initial schema as a default-safe starting point; this migration is the intentional unlock.

### vs_briefs.ideal_features text → text[]

Column was `text` in the initial schema. Changed to `text[]` in the same 4.1.1 migration to match the sibling `neighborhoods` column's type and the spec's tagging behavior (multiple distinct features, not a prose blob). Folded into the RLS migration since we were already touching vs_* tables and production had zero vs_briefs rows.

### vs_sourcing_rounds added to supabase_realtime in 4.1.1, not deferred

The migration-reviewer subagent caught that the Researching page (4.x) will subscribe to `vs_sourcing_rounds` via `postgres_changes`. Added `REPLICA IDENTITY FULL` + `ALTER PUBLICATION supabase_realtime ADD TABLE` to the 4.1.1 migration rather than deferring to the Researching page's phase -- deferring would have required a follow-up migration and a re-deploy window when that phase lands. Precedent: `ts_pull_rounds` and `ts_final_reviews` both went into Realtime in the same migration that established the table.

### Spec/wireframe conflict resolutions for Scout Dashboard UI

The Code session resolved several places where the spec and wireframe diverged. Final decisions, locked before 4.1.2:

| Element | Decision | Source |
|---|---|---|
| Stat tiles | Total Found / Shortlisted / In Deck / Pitched | Spec |
| Hero meta row | Project / event / dates / last sourcing, no icons | Spec |
| Edit-brief link | Coral "Edit Brief →" | Wireframe |
| Settings button | Icon button in CTA cluster below primary action | Spec |
| Shortlist row | 38px image thumbnail included | Wireframe |
| "+ New Round" affordance | Header link only; no dashed "+ Add Round" tile | Wireframe minus the tile |

### "View All N" shortlist link count uses shortlistedCount, not totalVenues

Initial implementation used `totalVenues` for the count in "View All N →". Fixed in 4.1.4 to use `shortlistedCount` -- the link routes to `/shortlist`, which only shows shortlisted venues, so showing the total candidate count was misleading. Small bug, caught by code-reviewer.

### PrimaryScoutCTA "deck exists" branch is evaluated before funnel branches

The 8-state decision tree checks for an existing deck before checking pitched/shortlisted counts. Rationale: once a deck exists, that's the most valuable thing to surface regardless of where the funnel stands. Burying it below the pitched/shortlisted branches would hide the deck if the producer later goes back and adjusts shortlist state.

### PrimaryScoutCTA "failed" branch is narrow by design

The failed branch only fires when the latest round failed AND no shortlisted venues AND no pitched venues exist. If any prior-round work exists, the producer gets the appropriate resume CTA for where they left off rather than a generic "start over." The code-reviewer flagged that a secondary "Retry sourcing" might be useful when work exists from a prior successful round -- deferred to a later phase once the full sourcing flow is in and the UX can be evaluated with real data.

### inDeck stat uses pitched && include_in_deck, not include_in_deck alone

Spec text said `venues.filter(v => v.include_in_deck)` but `include_in_deck` defaults to `true`, so that would show every candidate venue as "in deck" until DeckPrep ships and the user actually filters. Tightened to `pitched && include_in_deck` so the stat is meaningful from day one: it counts venues the producer has explicitly selected AND flagged for the deck. A code comment documents the deviation from spec text. Can be revisited when DeckPrep lands if the semantics need to change.

### RoundTile uses "AI" / "SHEET" hero label, not "Round N"

Sourcing round tiles on the Scout Dashboard show the round type (AI-researched vs. sheet-uploaded) as the dominant label rather than a sequential number. Round number is still visible in the card as secondary metadata. The type label is more useful at a glance -- "Round 2" tells you nothing about what the round was; "SHEET" tells you it was a manual upload.

### Shortlist card hidden entirely when scout has zero rounds

When `rounds.length === 0`, the shortlisted venues card doesn't render at all. The hero CTA already handles that state ("Start Sourcing" or "Upload Brief"), so a visible-but-empty shortlist card would be redundant noise. Once rounds exist but nothing is shortlisted, the card renders with a dashed-border empty state and a "Review Candidate Venues" CTA pointing to `/matrix`.

### Venue photo thumbnails deferred to Phase 4.5

Shortlisted venue rows show a literal `IMG` placeholder box in 4.1.3. Real photo plumbing (`vs_venue_photos` table + storage reads) is deferred to Phase 4.5 (Shortlist + Review Selects phase), which is the first phase where photo management is actually part of the workflow. A TODO comment is in place.

### Field.tsx extracted to src/components/ui/; canonical design-system form label

Extracted a shared `Field.tsx` rather than letting each area define its own label pattern. Canonical form: 12px Roboto Mono foreground label, coral required asterisk, optional muted hint suffix. Two call sites updated in 4.1.2: `NewRoleDetails.tsx` and `RoleSettings.tsx`.

Side effect: NewRoleDetails labels changed from 13px coral to 12px white. That's the correct design-system form; the old version was non-canonical. Visual change is minor but worth eyeballing in the new-role wizard at 4.1.4 before squash-merge.

Rule: any future form label should use `Field.tsx`, not a local copy.

### venueTypes.ts ported verbatim from VS Pro source; heuristics intentionally unchanged

`CANONICAL_TYPES`, `TYPE_STYLES`, `TYPE_FALLBACK_STYLE`, `canonicalizeType()`, and `parseTypes()` were copied without modification from `mirror-nyc-venue-scout-pro/src/components/sourcing/matrix/primitives.tsx`. The canonicalization heuristics (regex patterns that map raw strings to canonical types) are intentionally preserved byte-for-byte so that AI research output from the existing VS Pro edge functions canonicalizes identically in HQ. Any future change to the heuristics needs to be coordinated across both repos until VS Pro is retired.

### SourcingStatusPill returns null on "complete"; same convention as RoundStatusPill

When a sourcing round's status is `complete`, no pill renders. The assumption is that a complete round's status is conveyed by context (venue counts, CTA state) rather than a redundant "done" badge. `researching` = amber + pulsing dot; `failed` = red static. This matches `RoundStatusPill`'s null-on-complete behavior in Talent Scout.

### RankBadge uses bg-input track, not bg-secondary

The score bar track inside `RankBadge` is `bg-input` (Mirror grey, the correct track surface on dark cards). `bg-secondary` is lighter and visually wrong on `bg-surface-alt` cards. This is the same gotcha that bit us in Talent Scout's score bars and is now codified in `src/components/talent-scout/CLAUDE.md`. Added `showBar={false}` prop for surfaces that only need the numeric digit.

### Optional vs_candidate_venues columns deferred to the consuming phase

Columns `key_features`, `derived_attrs`, `venue_overview`, `size_sq_ft`, `capacity`, `source`, and the `vs_venue_photos` table are not added in Phase 4.1. The Scout Dashboard doesn't render any of them. Adding columns before any code consumes them creates drift between schema and implementation. Each will be migrated in the phase that first reads or writes it.

## Phase 3.11 (Scorecard substance restoration + summary field)

### Restored substantive `full_points_rubric` and added separate `summary` field

The Phase 3.7 squash-merge (`2ab37c3`) added a "≤ 12 words, one sentence" cap to `full_points_rubric` in `scorecardGenerationPrompt`. The intent was good; block tiered point breakdowns inline like "10 pts: 5+ yrs · 5 pts: 2-4 yrs"; but the cap was over-aggressive and stripped concrete-signal evidence the per-candidate evaluator actually relies on. Recently-generated scorecards came back thin and abstract ("Strong portfolio") instead of rich and actionable ("5+ years of professional experience in graphic design with meaningful exposure to environmental, experiential, or spatial design contexts. Portfolio includes spatial graphics, signage systems, or large-scale environmental work.").

Phase 3.11 fixes this additively, the way it should have been done in 3.7:

1. **`full_points_rubric` restored to the substantive form**; 1-3 sentences (typically 25-60 words) of concrete signals: years expected, named tools, types of work / clients, where the signal lives in the candidate's materials. The per-candidate evaluator reads this field. Bad-example block keeps the "no tiered point breakdowns" prohibition since that was a real design constraint.
2. **New `summary` field**; short (≤ 14 words) condensed recap used in compact UI surfaces (candidate detail score breakdown, packet matrix headers, recap views). Generated alongside `full_points_rubric` in the same Claude pass, never replaces it. The evaluator never reads `summary`.

Both fields are stored on the criterion (jsonb scorecard, no migration needed). Existing roles have only `full_points_rubric` populated (the post-3.7 short version); UI surfaces that want compact display fall back to truncating it when `summary` is empty. Re-running scorecard generation OR clicking "Process scorecard" on the wizard / Edit Role page (Phase 3.10) re-populates both fields with the new substantive shape.

The defense-in-depth merge in `ts-refine-scorecard` was extended: model is trusted for `name` / `full_points_rubric` / `summary`; everything else (tier, weight, is_disqualifier, is_manual) is restored from user input regardless of model output.

## Phase 3.10 (Scorecard refinement step)

### Refinement is a separate manual step, not auto-triggered on edit

When the user edits or adds criteria on the wizard step-3 page, the refine pass doesn't fire automatically. The bottom-bar button morphs from **Approve & lock** to **Process scorecard**, and the user has to actively click it. Two reasons:

1. The user is often making one edit in a stream of edits (typing a describer, then adjusting a weight, then adding another criterion). Auto-firing refine on every change would burn Anthropic spend and force a UI redraw mid-edit. A manual step lets them queue up everything they want to revise, then commit to a single Claude pass.
2. The refinement is a non-trivial AI call (a few seconds, a few cents). Making it explicit means the cost is tied to a clear intent ("I'm done editing for now"), not to keystrokes.

### Refinement preserves user scoring decisions via post-Claude merge, not prompt discipline alone

The prompt asks Claude to leave `tier`, `weight`, `is_disqualifier`, and `is_manual` untouched, but the edge function's `mergeRefinedIntoOriginal` re-applies the user's input values for all four fields regardless of what the model returned. Belt + suspenders. The model is only trusted for `name` and `full_points_rubric`. A model that ignores the prompt and tries to "improve" weights (or add/remove criteria) can't break the user's intent; the merge silently restores the user values. Output count is also enforced at the same length as input.

This pattern is worth lifting if we ever build other "refine user input via Claude" features: trust the model for the field you're asking it to refine, mechanically restore the rest from input.

### Dead-criterion drop is server-side, before the prompt

Criteria with `weight=0` OR with both `name` and `full_points_rubric` empty/whitespace get dropped before `scorecardRefinementPrompt` ever sees them. Two reasons:

1. The prompt is told to preserve every entry. Asking it to also "drop dead ones" is conflicting guidance; the model would either silently leave them in or aggressively remove things the user wanted to keep. Better to handle removal mechanically before the model is even asked.
2. Burning tokens to refine an empty entry is waste.

The response includes `removed_count` so the wizard / RoleSettings toast can surface it. If a user has every criterion zeroed or empty, the function returns 400 ("nothing to refine") rather than crashing; the user fixes the input and re-tries.

### Same edge function powers both scorecard surfaces

`ts-refine-scorecard` is called by the wizard step-3 page (`NewRoleScorecard.tsx`) AND the Edit Role page (`RoleSettings.tsx`). Both surfaces share the wizard's "scorecard edited since last refine → Process button" pattern; on the Edit Role page, post-refine the button flips back to the existing **Save changes** flow that fires `ts-bulk-reevaluate`. One function, two call sites; no duplicated prompt or merge logic.

### Tier re-sort happens client-side, not in the prompt

After every refine, the frontend re-sorts each tier highest-weight first. The prompt is told to preserve order, but the visual reorganization is the client's job. Reasoning: the model's order discipline is unreliable and we want a predictable display contract regardless of what came back. Client-side sort is cheap and idempotent (no-op if weights didn't change).

## Phase 3.8 + 3.9 (Cron, watchdogs, pull notification)

### Watchdog stall thresholds

Pull = 5 min (Phase 3.11.1, was 60). Re-eval = 30 min. Final review = 20 min.

The pull pipeline updates `ts_pull_rounds.updated_at` at every per-candidate completion (the `updated_at_auto` trigger fires on each row update). So `updated_at` = "last candidate completed at"; heartbeats fire per candidate, not per pool. A single candidate hanging >5 min is always a stall, regardless of total pool size. The earlier 60-min threshold was set under the misconception that large pools legitimately sit between heartbeats; they don't.

Bulk re-eval and final review keep the looser thresholds. Bulk re-eval writes `ts_roles.reeval_last_progress_at` per chunk completion (a slower cadence than per-candidate), so 30 min is right. Final review is one Anthropic call wrapped in `EdgeRuntime.waitUntil`; at HARD_CAP=50 it lands in 5-10 min, so 20 catches dead workers without false-positives.

Pull-watchdog cadence also bumped from every 5 min to every 2 min so detection lands within 5-7 min of stall onset (vs 5-10 min before). False-positive cost is low because the threshold is the actual signal of trouble; a candidate stuck >5 min won't recover on its own.

Status name aligned with the other two watchdogs: pull-watchdog now flips to `failed` (was `stalled`). The user-facing surface treats both identically (manual retry decision) so the distinction wasn't earning its keep.

### Cron cadences

Watchdogs every 5 minutes. Scheduled pulls daily at 12:00 UTC (8am ET). Storage cleanup daily 03:00 UTC. Spend reset 1st of month 00:01 UTC.

5-minute watchdog cadence is fine; they're cheap (one indexed query each). Faster cadence would catch stalls a few minutes earlier but pg_net call volume scales with cron firings, and the SLA on stalled-pull recovery is "before the user notices and asks", not seconds. The 12:00-UTC schedule for `ts-cron-scheduled-pulls` is intentionally early-morning ET and accepts the EDT/EST-drift hour: this is internal hiring tooling, not customer-facing, so a 1-hour shift twice a year doesn't matter.

### Cap-alert recipient lookup

`getAdminEmail(sb)` returns the oldest active admin in `public.users` (ORDER BY `created_at` ASC LIMIT 1). Falls back to `jobs@mirrornyc.com` if no admin row exists.

Picked oldest-admin over a hardcoded address so the alert routes correctly if Jimmie ever transfers admin ownership without anyone updating env vars. The fallback to `jobs@` means a misconfigured database (no admin user) still notifies *someone* who can act. This is one piece of plumbing that should be self-healing; the cap alert is what tells you something else is wrong.

### Pull-completion notification path: standalone in 3.9, fold into `notifications-dispatch` later

`ts-send-pull-notification` ships as a standalone edge function in 3.9 to unblock Talent Scout's "happy path" (manager forwards a candidate to jobs@ and gets an email back when the round completes). The unified `notifications-dispatch` (in-app bell + email + per-user prefs) is Phase 5 work that depends on the HQ Notifications system landing. Building 3.9 against the future API would gate Talent Scout shipping on Phase 5; building it standalone lets Phase 5 swap the call site later (one-line replacement in `ts-pull-candidates`'s `dispatchPullCompleteNotification`).

The notification is fired fire-and-forget via `EdgeRuntime.waitUntil` so a Gmail outage never fails the upstream pull. The `ts_pull_rounds` row is already at `status='complete'` before the notification dispatch starts.

### Storage cleanup is cron-only, no UI trigger

`ts-cron-storage-cleanup` runs daily at 03:00 UTC with conservative retention windows (rejected attachments >30d, closed-role attachments >90d, hard-delete closed roles >60d). No Settings-page manual trigger; the daily cadence catches garbage well before it becomes a problem, and exposing a button to admins to run an aggressive out-of-cycle purge invites mistakes. If the admin ever needs to force-clean (post-recruiting-cycle Storage cleanup, etc.), the function can be invoked manually from the Supabase Functions dashboard with the cron defaults; no special API surface needed.

### `pg_cron` invocation through a SECURITY DEFINER helper, not inline `net.http_post`

`public.invoke_edge_function(fn_name, body)` reads two GUCs (`app.supabase_url`, `app.internal_api_secret`) at call time and POSTs to `${base_url}/functions/v1/${fn_name}` with the internal-secret header. Cron schedules call this single helper.

Rationale: keeps secrets out of `cron.job` rows (which are queryable by anyone with `pg_cron` permissions). GUC values stick around in the database config but require a separate `ALTER DATABASE` to inspect. Also makes the schedule SQL readable; `SELECT public.invoke_edge_function('ts-cron-pull-watchdog')` reads as "fire pull watchdog", not as a 6-line `net.http_post(url := ..., headers := ..., body := ...)`. Adding a new cron job is one line.

The GUCs are set out-of-band (Supabase SQL editor) before the migration applies in production. Without them, the helper warns and no-ops; the schedule rows still exist; they just don't actually call anything. This means the migration is safe to apply before the GUCs are populated.

## Phase 3.7 (Candidates UX + referral ingestion)

### `manually_reviewed` boolean as one-way flip; `auto_rejected` enum value deprecated

Hiring managers needed a way to lock candidate decisions against future re-evals. Adding a per-candidate `manually_reviewed` (default false) on `ts_candidates` is the cleanest split: AI eval / re-eval leaves it false; user actions (status-dropdown change, re-select-same, AUTO-pill click, bulk action) flip it to true. Re-eval respects the flag; when true, score / strengths / gaps / overview update but status doesn't. Bulk re-eval defaults to `not_manually_rejected` (`status.neq.reject,manually_reviewed.eq.false`) so manually-rejected candidates aren't reconsidered.

The `auto_rejected` enum value (originally distinguishing AI-confirmed rejections from human ones) became redundant once `manually_reviewed=false + status=reject` carries the same semantics. Backfilled all existing `auto_rejected` rows in migration `20260507092912`. Enum value kept in place; dropping it requires a full enum rebuild, not worth it. New writes never use it.

### Referral identity = original applicant; `referrer_email` captures the manager

When a Mirror manager forwards a candidate to jobs@, the candidate row's identity is the **original applicant's** name + email; not the manager's. The manager's email goes on a separate `referrer_email` column, paired with `is_referral=true`. Eval is **blind** to referral status (same prompt). Referrals get a UI affordance (electric-blue ReferralPill) but no scoring lift. This keeps the dashboard's master-pool ordering meaningful regardless of source path.

Tried `referral` as a status enum value first; rejected because referral isn't an outcome state, it's a source flag. A referred candidate can still be in any status.

### Forward parser walks every chain segment, picks deepest non-Mirror

A single regex looking for the FIRST `From:` header would lock onto the manager (who's `@mirrornyc.com`) instead of the original applicant. So the parser collects every `From:` header AND every `On <date> <Name> <<email>> wrote:` reply-quote attribution into a positions-sorted hits list, then walks in reverse to pick the deepest sender whose email isn't `@mirrornyc.com`. When every hit is `@mirrornyc.com`, returns null and the message is skipped (better to skip than misattribute). Apple Mail iPhone forwards (which represent the original applicant as a quoted reply rather than a re-headered forward) covered by the wrote-attribution branch.

### Capture every `@mirrornyc.com` manager's commentary into `internal_notes`

Phase 3.7.8.16: managers often forward with their own context ("strong fit, schedule a call" / "borderline, lmk what you think"). When that commentary lands in jobs@'s body, it's the most reliable signal we have about the candidate. `extractManagerNote` walks every explicit-forward segment in the chain (Gmail's `---------- Forwarded message ---------` and Apple Mail's `Begin forwarded message:`), parses each segment's `From:` header, and for any `@mirrornyc.com` sender captures the body with Mirror signatures stripped (bolded-name + brand-marker heuristic) and "from-mobile" Apple Mail tags filtered. Multi-manager chains attribute each note with `Note from <email>:`. Folded into the FIRST eval via the `HIRING MANAGER NOTES:` block in the candidate bundle (the eval prompt already treats that block as verified context that supersedes resume / cover-letter inferences).

### `mirrornyc.com` blocked from portfolio URL extraction

Manager email signatures embed `http://www.mirrornyc.com/` and `@mirror_nyc`. The portfolio scorer was promoting those as the candidate's portfolio. `mirrornyc.com` added to `BLOCKED_PORTFOLIO_DOMAINS` in `_shared/unwrapUrl.ts` so it's filtered at extraction time; never enters `detected_links`, never becomes `portfolio_path_or_url`.

### Global competitor list as `text[]` on `global_settings`; per-role override on `ts_roles.competitor_bonus`

Mirror has a canonical 19-entry list of competitor agencies that should bonus-credit candidate experience across every role. Stored as Postgres `text[]` on `global_settings` (flat array, simple membership check). Per-role override stays on `ts_roles.competitor_bonus` (jsonb, carries a `bonus_points` scalar alongside the array). Seeded via two migrations (conditional UPDATE + idempotent DO block) so the canonical list is enforceable on existing rows AND new installs.

### Stepped pull-running checklist driven by existing signals, not new step_progress writes

Source repo writes per-step state to a `step_progress` jsonb column on `pull_rounds`. HQ's port intentionally dropped that ornamentation in Phase 3.4 to keep `ts-pull-candidates` simple. For the stepped UI in 3.7.8.6, kept the simpler approach; derived a 4-step checklist (search / dedupe / process / save) from the existing `candidates_found` + `processed_count` + `status` columns. Less granular than the source's 6-step view but covers the practical UX (most of the running window is "processing X of N"), and avoided re-adding per-substep writes across the entire pull pipeline.

### Toasts default to Mirror coral; ReferralPill stays electric blue

Toasts site-wide flipped from black/red destructive variant to solid Mirror coral with white bold text; coral is the brand attention color. ReferralPill briefly tried coral too (3.7.8.8), reverted in 3.7.8.13 because too many other coral surfaces (Master Pool header, primary buttons, toasts) made the referral signal disappear. Back to the original electric blue, which stands cleanly apart from the muted-grey AUTO/MANUAL pill it sits beside.

### Slider track + score bar track use `bg-input` on Mirror-grey card surfaces

Phase 3.7.6 moved many cards to `bg-surface-alt` (#141414, Mirror grey). The shadcn slider track and `ScoreInline` bar track used `bg-secondary` (#141414); same color, invisible against the new card surfaces. Made the empty portion of every slider and the unfilled portion of every score bar disappear. Flipped both to `bg-input` (#292929) so the track always reads against any card surface.

### Top nav reduced to Dashboard + Talent Scout

Projects / Venues / Clients / Tasks reachable by drilling in from the Dashboard tile grid. Top nav's job is high-level orientation, not "every route in HQ". Routes still work; they just don't have nav slots.

## Phase 3.6 (Final review + packet)

### Q5: split into two edge functions, share via `_shared/packetRender.ts`

Source ships two ~800-line packet generators (`generate-packet` round-scoped, `generate-final-review-packet` review-scoped) that share ~50% of their code (CloudConvert helper, Gmail/Storage attachment fetch, candidate title/email pages, packet divider, BASE_CSS, htmlDoc wrapper, helpers). Consolidating into one function would mean a 200-line if/else inside the renderer because the cover, body table (matrix vs rankings), writeup categories, and classification semantics are all different and pull from different DB tables (`ts_pull_rounds` vs `ts_final_reviews`).

Split into `ts-packet-generate` + `ts-final-review-packet`, lift the shared infrastructure into `supabase/functions/_shared/packetRender.ts`. Net: each domain function ~250 lines, shared module ~400 lines, ~44% smaller than source's 1,599 lines combined.

### `final_overview` field on each `ts_final_reviews.final_rankings` entry

Source had no equivalent. Hiring managers reviewing the final pool need a comparative angle that the per-candidate `quick_overview` (generated during pull-time) doesn't provide; quick_overview is "what's in this candidate's materials"; final_overview is "what unique strengths or angles this candidate brings to Mirror NYC that distinguish them within this final pool."

The AI generates 4-6 short headlines per candidate, framed as positives about the candidate (never by direct comparison to others; the comparative reading is what the hiring manager does, not the AI). Stored on the `final_rankings` jsonb entry. Surfaced in `FinalReviewDetail`'s candidate table where the dashboard CandidateTable would otherwise show Quick Overview.

Final entry shape: `{candidate_id, final_rank, final_tier, rationale, recruiter_note, final_overview}`. `final_rank` kept (despite not being in Jimmie's literal spec) because deriving rank from tier + secondary sort is brittle; source's reasoning still applies.

### Field renames vs source: `final_tier` (was `recommendation_tier`), `rationale` (was `narrative`)

HQ's naming is more direct. Source's field names came from an earlier iteration; this rename happens as part of the port and won't ripple back.

### `unwrapSecurityWrapper` ported and applied broadly

Email-security services (Outlook safelinks, Mimecast, Proofpoint URLDefense, Cuda LinkProtect, EdgePilot) wrap outgoing links so clicks route through their redirect first. When candidates send portfolio links from a corporate email account, those wrappers leak into HQ via Gmail ingestion. Source had `lib/unwrapUrl.ts` to strip the wrapper before opening the actual URL.

Phase 3.6 ports the helper to `src/lib/unwrapUrl.ts` and applies it everywhere a portfolio URL is rendered:
- `CandidateTable` (portfolio cell button on the dashboard table)
- `CandidateDetail` (portfolio web link + every detected_links row)
- `FinalReviewDetail` (rankings table portfolio cell)

Cheap insurance; prevents click-through routing through Google/Outlook/Mimecast redirects when the user wants the actual portfolio site.

### `include_fast_track` toggle on FinalReviewDetail

Source had a checkbox; HQ surfaces the same toggle. Default `true` (full coverage; packet includes every fast-tracked candidate's pages even if they're outside the top-N tier). Hiring managers occasionally want a tighter top-tier-only packet; the toggle gives them that escape. Seeded from the review row's `packet_include_fast_track` if a packet has been generated before, so re-generation defaults to the previous preference.

### Tier subtotals in the packet matrix render an em dash (U+2014) instead of `0` when score_breakdown is empty

When a candidate's `score_breakdown` jsonb is empty (legacy candidate, or a candidate where the AI returned no per-criterion breakdown), the matrix used to show T1=0 / T2=0 / T3=0 / Bonus=total. That reads as "candidate scored zero on Tier 1" rather than "we don't have the breakdown." Misleading zeros are worse than honest missing data. Now renders an em dash (U+2014) per missing tier; total still renders correctly (it lives on `ts_candidates.score`).

Applies to the round packet's Top Candidate Comparison Matrix. Per-criterion display in CandidateDetail's score breakdown panel keeps existing "0 / X" behavior since each criterion has its own line item; viewer can tell at a glance whether the breakdown was populated.

### Cron watchdog for stalled `ts_final_reviews` deferred to Phase 3.7

Phase 3.7 is the dedicated cron + watchdog phase (`ts-cron-scheduled-pulls`, `ts-cron-pull-watchdog`, `ts-cron-reeval-watchdog`, `ts-cron-storage-cleanup`). `ts-cron-final-review-watchdog` joins that batch; same pattern as the others (heartbeat detection, status flip to `failed` on stall, no auto-restart). Not bolted onto 3.6.

### HQ-specific: skip Gmail re-fetch at packet time, read attachments from Storage

Source's packet generators re-fetch attachments from Gmail using OAuth refresh tokens. Phase 3.4 already persists every attachment to the `candidate_attachments` Storage bucket on initial pull, so HQ doesn't need that round-trip. `_shared/packetRender.ts` reads bytes from Storage instead. Cleaner code path, no Gmail dependency at packet time, faster (no token mint).

### HQ-specific: email packet to hiring manager via Gmail service account

Source's packet generators return a download URL only; the user manually shares the PDF afterward. HQ adds an email step: after upload, the function sends the packet PDF to the role's hiring manager from `jobs@mirrornyc.com` via the service account's `gmail.send` scope (added to `_shared/gmailServiceAccount.ts` SCOPES list in this phase). Best-effort: failures don't fail the overall request; the user still gets the download URL. Hiring manager email is read from `users` joined on `ts_roles.hiring_manager_id`.

### HQ-specific: PDF coral stays at source's `#ef5b5b`, not deck-canonical `#BE4E44`

The Phase 3.5b brand pass moved HQ's UI coral to `#BE4E44` (deck-canonical). Inside packet PDFs, BASE_CSS keeps `#ef5b5b` because the dustier coral reads dim on paper print and on screen-share PDF previews. Same brand identity, different surface (screen UI vs paper artifact).

### `ts_candidates.email_body_text` column added; packet email page skipped when null

Source's packet shows the candidate's original application email as a white "doc-slot" page inside their per-candidate section. HQ didn't persist email body text in Phase 3.4. This phase adds `email_body_text text` (nullable) and updates `ts-pull-candidates` to populate it (trimmed at 30k chars). The packet renders the email page only when the column is non-null; pre-3.6 candidates won't have it, but their title page + attachments still render correctly.

## Talent Scout port (Phase 3): locked Q1-Q6

Resolutions to the six open questions in `docs/talent-scout-port-plan.md` § 8.

### Q1: re-eval history → keep history

`ts_evaluations` is a separate history table. Every single re-eval (CandidateDetail's button, row-level Re-evaluate selected bulk action) INSERTs a new row, preserving prior scores for audit. The latest row's fields are mirrored onto `ts_candidates` for fast list queries.

**Bulk re-evaluate** (role-scoped or round-scoped "Re-Evaluate Pool") is the one exception: it implies the prompt or scorecard changed, so prior evals are no longer meaningful. The `overwrite_history: true` flag on `ts-evaluate-candidate` deletes prior `ts_evaluations` rows for the candidate before inserting.

**Why both modes**: a single re-eval is usually the user fixing one candidate's classification or pulling new info; history matters. A bulk re-eval is the user changing the scoring rules; old scores aren't comparable, keeping them around just clutters the audit trail.

### Q2: pending-candidate parking spot → jsonb on the round

`ts_pull_rounds.pending_candidates` (jsonb, default `[]`) holds Gmail message IDs the chunked pipeline batches in groups of 8 across self-invocations. Matches the source pipeline's existing shape; no separate table.

### Q3: hiring manager identity → block on first sign-in

`ts_roles.hiring_manager_id` FKs to `users`. New-role wizard looks up by email at submit. If no `users` row exists yet, role creation is blocked: "Hiring manager must sign in to HQ at least once first." No auto-creating users from email strings.

### Q4: notification consolidation → standalone first, fold later

Phase 3.8 ships `ts-send-pull-notification` standalone so Talent Scout doesn't block on Phase 5 work. Phase 5 folds it into `notifications-dispatch`.

### Q5: two packet generators → read both, then consolidate

Before writing `ts-packet-generate` in Phase 3.6, do a 30-min read of source's `generate-packet` (832 lines) vs `generate-final-review-packet` (767 lines) to confirm whether they're two distinct flows (candidate-pool packet vs final-review packet) or one is dead code. Consolidate based on that read.

### Q6: anthropic-spend-tracker shape → explicit `callClaude(app, ...)` wrapper

Single helper in `supabase/functions/_shared/anthropic.ts`. Selects key from `ANTHROPIC_API_KEY_TS` / `_VS` / `_HQ` based on the `app` argument. After each successful call, computes cost from the response usage block (incl. prompt-cache discounts) and increments `global_settings.anthropic_spend_current_month_usd`. Emails the admin once per cap crossing, gated by `cap_alert_sent_this_month`. **Does NOT refuse calls when over cap**; graceful degradation, not a hard failure.

## Phase 3.4 (pull pipeline)

### Edge Function self-invocation auth

The Supabase gateway on this project rejects the service-role bearer token at its `verify_jwt` layer (likely a new-format-key vs legacy-JWT mismatch). Solved with per-function `verify_jwt = false` in `supabase/config.toml` + an `INTERNAL_API_SECRET` shared secret + auth enforcement in `_shared/internalAuth.ts` (three accept-paths: internal-secret header, service-role bearer match, valid user JWT). See `docs/auth-model.md` for the full pattern.

Any future self-invoking function uses the same pattern; non-self-invoking functions stay on default `verify_jwt = true`.

### Realtime publication

`supabase_realtime` publication on this project starts empty. `ts_pull_rounds` was added to it via migration with `REPLICA IDENTITY FULL` so PullDetail's `postgres_changes` UPDATE subscription receives the full new row. Any future table the UI subscribes to needs the same.

### All attachments to Storage (drift from source)

Source repo kept small attachments in Gmail and let the dashboard fetch them on demand via a `gmail-attachment` Edge Function. HQ persists every attachment to the `candidate_attachments` bucket regardless of size. Slightly more Storage cost; much simpler download path (`supabase.storage.createSignedUrl`); no separate Edge Function for candidate-detail attachment viewing.

### `ts_pull_rounds` operational columns

`candidates_found`, `processed_count`, `attempt`, `round_number` added so progress and round labels work without joining `ts_candidates` per render. Source's `step_progress` jsonb / `current_step` / `error_log` were dropped; simpler `processed_count / candidates_found` is enough; richer progress UI can be added back later if needed.

## Phase 3.5 (candidate detail + re-eval)

### Re-eval history retention with one bulk-overwrite escape hatch

See Q1 above. Implementation note: the candidate-detail UI shows only the latest fields (mirrored onto `ts_candidates`); history accumulates server-side without a UI surface yet. Future "score history" timeline page can read from `ts_evaluations` when it's needed.

### `promote` → `interview` enum rename

Original schema used `promote` as the "advance" status. Renamed to `interview` in Phase 3.5; concrete next-stage action that maps to actual hiring workflow language. `ts_candidate_status` is now `(consider, interview, reject, fast_track, auto_rejected)`. Migration verified zero rows used `promote` before renaming.

### Status priority is the primary sort everywhere

`CandidateTable` sorts by status bucket first (Interview → Fast-Track → Consider in active tier; Rejected → Auto-Rejected in collapsible rejected tier), then by user-selectable column. Buckets never interleave regardless of column or direction. The active/rejected divider is collapsible inline, not a separate table.

### Bulk re-eval split: role-scoped uses `ts-bulk-reevaluate`, round-scoped fans out

`ts-bulk-reevaluate` (chunked self-invoke, `verify_jwt = false`) operates on the role's master pool with optional `status_filter`. PullDetail's "Re-Evaluate Pool" is round-scoped and skips the dedicated function; instead, it fans out parallel `ts-evaluate-candidate` calls (concurrency=6) with `overwrite_history: true` from the browser. Floating bottom-right widget shows progress; cancellable mid-run.

### Round-scoped state on `ts_pull_rounds`, role-scoped state on `ts_roles`

Source repo put bulk-reeval state on `pull_rounds`. HQ moved to role-scoped: `reeval_status` / `reeval_total` / `reeval_processed` / `reeval_failed` / `reeval_started_at` / `reeval_completed_at` / `reeval_last_progress_at` columns live on `ts_roles`. The legacy `ts_pull_rounds.reeval_last_progress_at` from Phase 3.2 is dead (drop in a future cleanup migration).

### Status dropdown writes are awaited before parent refetch

`StatusDropdown.onValueChange` awaits the DB UPDATE before calling its `onChange` callback (which triggers parent reload). Calling `onChange` first races the write and leaves the displayed value one click behind. **Future inline-mutation components in HQ follow the same order.**

## Phase 2 (schema + auth)

### `handle_new_user` Postgres trigger replaces `auth-on-signup` Edge Function

Original spec called for an `auth-on-signup` Edge Function. Implemented as a Postgres trigger on `auth.users` instead, running with service-role privileges. Simpler, atomic with the auth.users insert, no cold-start latency. The Edge Function name is reserved in case we need extra signup-time work later (e.g. provisioning Drive folders); for now it doesn't exist.

### Project security defaults: Auto-expose OFF, Auto-RLS ON

Every new table requires explicit `GRANT` to `authenticated` and `service_role`. Forces every new table to be reviewed for which roles can hit the Data API at all, separate from RLS row-level policy. See `docs/conventions.md`.

## Open

Decisions still up in the air; revisit when the relevant phase starts.

- **Project status enum trim.** Current 14 values may consolidate. Defer until Phase 5 polish.
- **`venue_types` lookup values.** **Resolution (2026-05-13, retroactive):** Shipped as a free-text canonicalization layer. The producer's sheet supplies an arbitrary string; the parser maps to the canonical list (Retail, Event Venue, Industrial, Warehouse, Gallery, Studio, Outdoor, Mobile) via substring matching. Lookup table not needed. See `docs/templates/venue-scout-sheet-template.md`.
- **Talent Scout data extraction** (future cross-platform data extraction; not blocking Phase 5). Plan: re-create active roles via Gmail re-pull, preserve closed roles as packet PDF archives. If a future inventory turns up data that doesn't fit, revisit then.
