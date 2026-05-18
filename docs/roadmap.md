# Roadmap

Phase-by-phase build plan. Finished phases summarize to one line; the next phase has full detail. Update this doc when phases complete.

For granular project state and the latest commit hash, see `CHECKPOINT.md` at the repo root.

## Phase 1: Foundation. DONE.

Supabase project, Google Cloud Console OAuth client, service account `mirror-ny-hq-backend@mirror-nyc-hq.iam.gserviceaccount.com` with domain-wide delegation across `gmail.readonly` / `gmail.send` / `drive` / `presentations`, GitHub repo, Netlify import, local toolchain. Service account verification script lives at `scripts/verify-service-account.ts`.

## Phase 2: Schema and auth. DONE.

Initial schema migration (`20260506061457_initial_schema.sql`): 22 tables, enums, helper + trigger functions, RLS policies, 5 storage buckets. Jimmie seeded as admin. Sanity test: `/projects` query fixed for new schema, types regenerated, GRANTs migration (`20260506065157_grant_data_api_access.sql`) applied.

## Phase 3: Talent Scout port. DONE.

Lifted from `mirror-talent-scout`. Full pipeline ported and deployed. Sub-phase summary:

| Sub-phase | Summary |
|---|---|
| 3.1 | Inventory + port plan (`docs/talent-scout-port-plan.md`). |
| 3.2 | Schema augmentation (`ts_evaluations`, `ts_pull_rounds` extensions, `cap_alert_sent_this_month`); edge function shells. |
| 3.3 | Roles CRUD + 3-step new-role wizard; `_shared/anthropic.ts callClaude` wrapper. |
| 3.4 | `ts-pull-candidates` (chunked self-invoke, BATCH_SIZE=8); service-account Gmail; Realtime on pull rounds. |
| 3.5 | CandidateDetail + status dropdown + re-eval (single + round + role-scoped); `promote` to `interview` enum rename. |
| 3.6 | Final review (`ts-final-review`) + packet generation (`ts-final-review-packet` via pure pdf-lib + signed URL email). OAuth pivot to `sb_publishable_*` keys. |
| 3.7 | Manual-reviewed flag, CandidateDetail layout reorg, Global Settings + competitor list, referral ingestion (Gmail forward chain walker). |
| 3.8 | pg_cron + 6 cron jobs (scheduled pulls, 3 watchdogs, storage cleanup, monthly spend reset); cap-alert email path. |
| 3.9 | `ts-send-pull-notification` (fires from pull complete; folds into `notifications-dispatch` in Phase 5). |
| 3.10 | `ts-refine-scorecard` + wizard step-3 Process/Save morph. |
| 3.11 | Scorecard `full_points_rubric` + `summary` two-field design (restore substantive describers). |

**Final Review packet feature flag (`PACKET_FEATURE_ENABLED`)** was removed from `FinalReviewDetail.tsx` in the TS Final Review packet restore (commit `6775429`); the Generate Packet button on the Final Review page is always live. The round-scoped flag in `PullDetail.tsx` still defaults `false` pending the WORKER_RESOURCE_LIMIT smoke.

### Phase 4: Venue Scout port. DONE.

Shipped to production 2026-05-13 (main at `7cd27ed`). Full 1:1 port from `mirror-nyc-venue-scout-pro`; 4.1-port through 4.10.6-port. Details in `docs/venue-scout-port-plan.md` and `CHECKPOINT.md`.

**Phase 4 Revision - Intake.** Follow-on revision (2026-05-14): rebuilt the single-page Brief into a 3-step stepper (Event -> Venue -> Review), added the venue-side fields the AI sourcing prompt needs, added the `vs-generate-brief-overview` edge function + the `brief` `current_step` value, and made the Revisit nav always-visible. Spec: `OUTPUTS/phase-4-revision-intake-spec.md`. Phase 4 stays DONE; this is a correction, not a new phase.

### Phase 5: HQ Core (cross-cutting). ACTIVE.

The cross-cutting HQ Core layer that ties Talent Scout and Venue Scout into a
single relational backbone for the agency. No source repo to port from; each
sub-phase ships from a Cowork-drafted spec built off the locked Phase 5
wireframe (`OUTPUTS/phase-5-hq-wireframe-v1-LOCKED.html`) + the locked
decisions memo (`OUTPUTS/phase-5-locked-decisions-2026-05-15.md`).

**Sub-phases:**

- **5.1 Schema + auth foundations + left rail shell + Home.** Tier model
  rewrite (Admin / Standard / Freelance / Pending), notes_log table for
  Internal Notes parity on Organizations + People, pending-state flow, new
  left rail AppShell replacing the shipped top-nav, Surface 02 Standard
  Dashboard and Surface 03 Admin Dashboard.
  - **Status:** DONE 2026-05-15. Commit: `665a311`. Spec:
    `OUTPUTS/phase-5-1-spec.md`.
- **5.2 Projects + Tasks + Deliverables + Organizations + People + Venues
  databases.** The canonical database-list pattern (list, board, timeline,
  calendar views) plus detail + edit, applied across all six surfaces. Split
  into multiple commits as the work unfolded:
  - **5.2.1** Project workflow trio (Projects + Tasks + Deliverables) +
    cross-cutting components (`<DataTable />`, `<ViewSwitch />`, `<FilterBar />`,
    `<SavedViewsDropdown />`, `<BoardView />`, `<TimelineView />`,
    `<CalendarMonthView />`) + the rail amendment from
    `OUTPUTS/phase-5-2-rail-amendment.md`.
    **Status:** DONE 2026-05-15. Commit: `15511af`. Spec:
    `OUTPUTS/phase-5-2-spec.md` §§ 0 to 5.B + 5.C + 7 + 11 to 14.
  - **5.2.1 Revision** Wireframe-fidelity rebuild of the seven 5.2.1
    surfaces against the locked Phase 5 wireframe. UNPREFIXED canonical
    CSS lift block in `src/index.css`.
    **Status:** DONE 2026-05-16. Commit: `62f610e`. Spec:
    `OUTPUTS/phase-5-2-1-revision-spec.md`.
  - **5.2.2** Entity trio (Organizations + People + Venues) using the
    cross-cutting components landed in 5.2.1, plus
    `<InternalNotesEditor />` + `<StarRating />` + 4 lookup migrations.
    **Status:** DONE 2026-05-16. Commit: `0356a85`. Spec:
    `OUTPUTS/phase-5-2-2-spec.md`.
  - **5.2.3** Clients + vendors table split (5 migrations) + 6 new page
    files + LeftRail order flip.
    **Status:** DONE 2026-05-16. Commit: `59c81ba`. Spec:
    `OUTPUTS/phase-5-2-3-spec.md`.
  - **5.2 cleanup** Six small carry-forwards (People Org relabel,
    FilterBar lookup field type, `IconClients` glyph,
    `vendors.primary_address`, `vendor_capabilities` GRANT DELETE,
    workflow doc amendments § 4.1.a + § 4.5 step 5e).
    **Status:** DONE 2026-05-16. Commit: `65159a2`. Spec:
    `OUTPUTS/phase-5-2-cleanup-spec.md`.
- **5.3 Calendar + Outlook.** Unified Calendar surface (Surface 15) and
  admin-only Outlook 12-month grid (Surface 16).
  - **Calendar (`/calendar`, all tiers).** Reuses `<CalendarMonthView />`.
    Pulls Install / Live / Removal date ranges from `projects` and due
    dates from `deliverables`. Color-coded per `docs/design-system.md`
    § 5b (Install cyan, Live coral, Removal amber, Deliverable green).
    232px right rail with per-project visibility toggles, master
    Deliverables toggle, Mirror Holidays toggle (hardcoded list from the
    official Mirror NYC Holiday Calendar 2026 PDF; Settings-editable in
    5.4). Filter chips for Lead + Category. Per-user visibility
    persisted via `saved_views` (`entity_type = 'calendar'`).
  - **Outlook (`/outlook`, admin-only).** New `outlook_entries` table
    with `outlook_confidence` enum. 12-month grid
    (`Month / Week 1-4`) + year tabs. Color per locked-decisions § 4
    (On Radar amber, Likely cyan, Confirmed green, Complete gray; flips
    the wireframe CSS). 277px side panel for detail + edit with Promote
    to Project / Unlink / Delete actions. Shared w/ Team toggle adds the
    entry to the unified Calendar visible to all tiers.
  - **Schema additions.** `outlook_entries` table + enum + RLS + GRANTs;
    four new `projects` date columns (`install_dates_start/end`,
    `removal_dates_start/end`); `saved_views.entity_type` CHECK widened
    to include `'calendar'`. One new Postgres RPC
    (`promote_outlook_to_project`).
  - **Carry-forwards.** ProjectEdit gets two new date-range pickers
    (Install + Removal). ProjectDetail Dates kv splits Install / Live /
    Removal. ProjectsList Timeline view extends to render all three bar
    kinds (was Live only). OutlookCondensedCard on Home flips from
    placeholder text to real `outlook_entries` data.
  - **Status:** DONE 2026-05-16. Commit: `1c21ea9`. Spec:
    `OUTPUTS/phase-5-3-spec.md`.
- **5.4 Wiki + Account Logins + Settings + Team.** Wiki pages with admin-
  gated Edit, Account Logins page with reveal-and-copy credential field
  and silent 30-second idle re-redact, global Settings page, Team page
  (admin-only, user-management directory; ties to Settings for the
  user-management read path). Adds `mirror_holidays` table + Settings
  CRUD editor (replaces the static `MIRROR_HOLIDAYS` constant shipped in
  5.3).
- **5.5 Notifications + Activity Feed + Search + states polish.**
  - **Bell panel (Surface 21).** TopBar bell stub replaced with the
    `<NotificationBellPanel />` popover (392px wide, Radix Popover anchored
    to the bell icon). Coral badge on the bell with unread count (caps at
    "9+"). Realtime: `postgres_changes` on `public.notifications` filtered
    to `user_id=eq.{uid}` lights up new rows live + bumps the badge.
    Mark all read + per-row mark-read + click-to-navigate to `link_url`.
    Footer tlinks to `/activity` and `/notifications/preferences`.
  - **Notification Preferences (`/notifications/preferences`).** 7 trigger
    rows x 2 channels (In-App / Slack DM). Auto-save upsert per toggle.
    Slack status footer reflects `users.slack_user_id` presence. New
    table: `user_notification_preferences` (per-user, per-trigger rows;
    fall back to system defaults when no row exists). All-tier route.
  - **Activity Feed (`/activity`, Surface 22).** Full `activity_log`
    feed with cursor-based "Load more" pagination, day-bucket headers,
    `FilterBar` chips for Record type / Person / Date range. Sentence
    builder pattern-matches on payload to surface created/updated/
    status_changed/assigned/deleted templates with field-change detail
    when available. Wireframe-canonical `.activity-row` + `.actdot`
    classes reused from Project Detail's activity sidebar.
  - **Search (`/search?q=`).** Cross-entity ilike against
    projects/tasks/deliverables/venues/vendors/clients/people/wiki_pages,
    grouped by section, ranked starts-with > contains > alpha. Page-level
    autofocus input + 300ms debounce; TopBar submit + on-page input both
    update the URL ?q= param.
  - **States polish (Surface 23).** Three shared components:
    `<EmptyState>` / `<LoadError>` / `<PermissionDenied>` in
    `src/components/ui/`. `<AdminRoute>` swapped from silent redirect to
    rendering `<PermissionDenied>` in-place with route-aware title +
    tier-specific description.
  - **Dispatch infrastructure.** New `notifications-dispatch` edge
    function (internal-only via `requireInternalSecret`; receives event
    payloads from Postgres triggers + crons; per-user preference +
    global kill-switch checks before writing rows + sending Slack DMs).
    New shared module `_shared/slackDm.ts`. `handle_new_user` rewired
    to call dispatch with `event_type='user_pending'`; legacy
    `notify-admin-of-pending-user` stays deployed one phase as fallback.
    New `notifications_dispatch_writer` trigger on tasks + projects
    fires `task_assigned` / `task_blocked` / `project_status_changed`
    automatically. Three new pg_cron jobs + edge functions:
    `hq-cron-deliverable-due-3d` (13:00 UTC),
    `hq-cron-task-due-today` (12:00 UTC), `hq-cron-event-date-today`
    (11:00 UTC).
  - **Schema additions.** `user_notification_preferences` table +
    `notifications.delivered_slack` column + `notifications` joins
    `supabase_realtime` publication with `REPLICA IDENTITY FULL`.
  - **Status:** DONE 2026-05-16. Spec: `OUTPUTS/phase-5-5-spec.md`.
- **5.5.1 Sign-in page (Surface 01 part 1).** Replaces the Phase 5.1
  stealth coming-soon Landing (hidden "STRATEGY / DESIGN / PRODUCTION"
  trigger at the bottom) with the wireframe Surface 01 sign-in page:
  centered Montserrat ExtraBold "MIRROR NYC HQ" wordmark (HQ in coral)
  + visible 48px white Google Sign-In button with the 4-color G icon on
  a full-viewport dark background. Optimistic `signingIn` flag prevents
  double-clicks during the OAuth round-trip; already-authed mounts
  redirect to `/home`. White button color is intentional (the one HQ
  surface where coral does NOT win the primary CTA, since Google brand
  guidelines win on the sign-in button). Pending state (Surface 01
  part 2) was already shipped in Phase 5.1 at `/pending` via
  `PendingState.tsx`. Two files: `src/pages/Landing.tsx` (rewrite),
  `src/components/icons/GoogleColorIcon.tsx` (new). No migration, no
  edge function changes, no schema impact. Slug retention plumbing
  already complete pre-spec (`ProtectedRoute` writes, `useAuth` reads
  + clears the sessionStorage key; every route including VS/TS nests
  inside the parent `<ProtectedRoute>` group, so deep links survive
  the OAuth round trip without additional gate code).
  - **Status:** DONE 2026-05-16. Commit: `0f122c1`. Spec:
    `OUTPUTS/phase-5-5-1-signin-spec.md`.
- **5.6 Smoke Test Pass 1.** Jimmie's first batch of end-to-end smoke
  notes parsed into five subphases (originally four; the locked carry-
  forward from 5.6.1 became the new 5.6.3 detail-page inline edit, which
  bumped the prior 5.6.3 / 4 down a slot). Heaviest functional
  primitives land first so downstream column rewrites + polish can
  consume them. Plan doc: `OUTPUTS/phase-5-6-plan.md` (locked 2026-05-16
  from a five-round clarifying Q&A; renumbered 2026-05-16 in the 5.6.3
  squash; spec drafter for each subphase reads the plan instead of
  re-asking Jimmie).
  - **Phase 5.6 status:** WRAPPED 2026-05-17. All five subphases plus
    two follow-on micro-phases (5.6.5.1 owner delegation + sort
    propagation + Team page fixes; 5.6.5.2 `last_active_at` throttle)
    shipped. Last commit on main from the 5.6 stream: `1a953f1`.
  - **5.6.1 Cross-cutting interaction primitives.** New
    `<RecordCombobox />` component (Notion-style typeahead + inline-add
    with mini-create modal per entity: Person name+email, Client
    name+industry, Vendor name+category, Venue
    name+neighborhood+type+address). Unifies lookup-table and FK-record
    pickers into one component. Click-pill-to-change on tables:
    Project Status / Task Status / Task Priority / Deliverable Status /
    Outlook Confidence pills are interactive in DataTable cells with
    optimistic + Realtime rollback, instant save (no confirm dialog).
    People Affiliation and Vendor Internal Partner stay form-only.
    Phone-number normalization: `formatPhone()` utility canonicalizes
    `people.phone` + `vendors.contact_phone` + `clients.contact_phone`
    to `(XXX) XXX-XXXX` on save + a one-shot migration backfills
    existing rows.
  - **Status:** DONE 2026-05-16. Commit: `f278da7`. Spec:
    `OUTPUTS/phase-5-6-1-spec.md`.
  - **5.6.2 Table reshapes + schema.** New `vendor_subcategories`
    lookup table with `parent_category_id` (parent-scoped, optional) +
    `vendors.subcategory_id` column. New `project_vendors` join table
    (PK + audit cols; editable from both ProjectEdit and VendorDetail).
    Projects + Tasks tables: client name (muted, hyperlinked to
    `/clients/{id}`) stacked above project title; shrink Status column;
    expand Account + Designers columns. Clients table column order:
    Client (no stacked city) / Contacts (hyperlinked person list) /
    Deliverables (hyperlinked future-due list) / Projects (active-only
    hyperlinked names + overflow count). Vendors table column order:
    Vendor (with inline Internal pill replacing the column) / Category /
    Subcategory / City / Capabilities (first 3 tags + "+N more") /
    Rating (5-star) / Projects (recent 3 hyperlinked + overflow).
    People table column order: Name / Affiliation (renamed from Type) /
    Organization (muted-coral link) / Role-Title / Email (mailto) /
    Phone (normalized). "Venue Contact" pill renamed to "Venue" through
    the table AND PersonEdit Type radio. "Unaffiliated" renders as
    blank cell. Default Client filter dropped; inline radio filter
    buttons (All / Client / Vendor / Venue) added next to All People
    dropdown, colored to match Affiliation pills.
  - **Status:** DONE 2026-05-16. Commits: `f2062cc` (main ship),
    `00997c0` (5.6.2.1 follow-on: ProjectDetail Vendors sidebar,
    editable VendorEdit Projects, MiniCreateModal `lookup` field type,
    Affiliation filter button recolor, OverflowList bullet separator,
    `useBackHref` cross-cutting), `41811b5` (5.6.2.2: PostgREST
    constraint-named FK fix for client-name cell + PersonEdit Venue
    picker as RecordCombobox multi). Spec: `OUTPUTS/phase-5-6-2-spec.md`.
  - **5.6.3 Detail-page inline edit.** Click-to-edit on h1, pills,
    lookup/record fields, and text fields across all seven HQ Core
    detail pages (PersonDetail / ClientDetail / VendorDetail /
    ProjectDetail / TaskDetail / DeliverableDetail / VenueDetail).
    New primitives: `<InlineEditText>` (blur/Enter saves, Esc reverts,
    optimistic + rollback, required-empty blocks), `<InlineTagInput>`
    (chips + Enter-to-add; lighter than MultiTagInput, free-text only).
    Schema: new `people.affiliation_type` column + `person_affiliation_type`
    enum + mutex CHECK so clearing the FK doesn't change Type.
    Architecture: `useLookup` refactored to a module-level subscriber
    cache (`Map<key, {options, loading, subscribers}>`) so inline-add
    auto-select handoffs work across components; `getLookupCached()`
    sync accessor exposed for parent `onChange` closure-lag fallback.
    RecordCombobox single-mode: re-clicking selected option deselects.
    MiniCreateModal: new `context: { label, value }[]` prop for
    parent-scope read-only kv rows above editable fields. ProjectDetail
    h1 stays non-editable (Title moves to its own kv row); 70/30 grid.
    VenueDetail Event/Prod Day Rate cells open `<AddRateModal>` for
    append-only `venue_rate_history` inserts. ClientDetail Primary
    Contact is a click-to-edit composite (NAME · TITLE display →
    combobox scoped to the client's people; contact email becomes
    read-only autofill). Edit-page `/edit` routes survive as power-
    user fallback. Detail-page Edit button reduced to pencil-icon only.
  - **Status:** DONE 2026-05-16. Commits: `c29c8bd` (PersonDetail
    prototype + affiliation_type schema), `a0c28e3` (sweep across
    remaining six detail pages + polish round: `.label-section` 13px,
    `.tag` 12px, `.kv` row-gap 22px, `.kv dt` 12px, new `.kv--pair`
    helper, `.fchip--btn`/`.fchip--active` toggle pair).
  - **5.6.4 Visual polish batch.** Internal Notes editor "Append-only"
    caption removed globally. Date-picker calendar icons render in
    coral (icon only, not field border). Rail nav text to 13px + Mirror
    wordmark 1.5x + "Mirror HQ" text 1.5x + RailFooter scales
    proportionally. Home: My Week cards show deliverable title (not
    the literal "Deliverable"); all admin-only cards above My Week
    hidden behind a `HOME_ADMIN_STATS_ENABLED` feature flag for easy
    restoration. Project edit: "Lead" label renamed to "Account"; if
    only start date entered, only start renders + saves (all three
    date pairs: Install / Live / Removal). Calendar visibility panel:
    project titles wrap to second line; "Shared Outlook" toggle label
    renamed to "Tentative". Outlook: entry card background tinted at
    15% opacity of the matching pill color; "Likely" pill rendered
    cyan (root-cause investigated; currently renders black).
  - **Status:** DONE 2026-05-17. Commits: `4b884bc` (main ship),
    `03d69f3` (5.6.4.1 follow-on: 16 items + 1 migration). Spec:
    `OUTPUTS/phase-5-6-4-spec.md`.
  - **5.6.5 Global default views (owner admin feature).**
    `saved_views.scope text CHECK IN ('user','global')` column +
    `users.is_owner boolean` column (Jimmie's row set true; delegable
    later via a second admin if needed). RLS widened so non-owner
    users can READ global rows; writes to `scope='global'` require
    `is_owner = true`. SavedViewsDropdown gains "Save as default for
    all users" option visible only to owners + "Reset to global"
    option visible to every user with a divergent per-user default.
    Default-view resolution per entity: per-user → global → unfiltered.
    Applies to all list/board/timeline surfaces (Projects, Tasks,
    Deliverables, Venues, Vendors, Clients, People) AND the Calendar
    visibility panel (the `__calendar_default` saved_views row also
    supports `scope='global'`).
  - **Status:** DONE 2026-05-17. Commit: `069895d`. Spec:
    `OUTPUTS/phase-5-6-5-spec.md`.
  - **5.6.5.1 Owner delegation + sort persistence propagation +
    Team page account-link fixes.** Owner becomes delegable (trigger
    requires caller `is_owner = true` AND blocks self-revoke;
    TeamMemberEdit Access card grows an owner-only Owner checkbox
    disabled on your own row). 5.6.5's sort-persistence pattern
    propagates from Projects to the remaining six list pages
    (Tasks / Deliverables / Venues / Vendors / Clients / People);
    column sort now round-trips through saved views everywhere. Four
    bug fixes folded in: user-create id NULL violation in
    TeamMemberEdit (`crypto.randomUUID()` in insert payload); Account
    Status "Linked" false positive on edit page (derive from
    `last_active_at !== null`, not `permission_role !== 'pending'`);
    `last_active_at` never updated post-signup (one-shot effect in
    AuthProvider stamps it once per provider lifecycle); TeamList
    accountPill same false positive (switch keying to nullability).
  - **Status:** DONE 2026-05-17. Commit: `b51d62a`. Spec:
    `OUTPUTS/phase-5-6-5-1-spec.md`.
  - **5.6.5.2 `last_active_at` throttle (micro-phase).** AuthProvider
    reads sessionStorage `last_active_stamped:${userId}` before issuing
    the UPDATE; if the stored timestamp is within 5 minutes, the
    effect skips entirely. Two-layer guard: the prior `useRef` (one
    fire per provider lifecycle per user.id; covers StrictMode and
    tab-focus re-renders) plus the new sessionStorage check (5-min
    floor across mounts within the same tab; covers manual reloads
    and route changes that remount the provider tree). No schema, no
    migration, no spec.
  - **Status:** DONE 2026-05-17. Commit: `d36b516`.
- **5.7 Smoke Test Pass 2.** Jimmie's second batch of smoke-test notes
  after the full 5.6 end-to-end re-test. Subphases plus deliberate
  new-surface work (mentions, deliverables reshape, calendar overhaul,
  vendor files, profile + settings). Full subphase plan in
  `OUTPUTS/phase-5-7-plan.md`.
  - **Carry-forward into the Deliverables refactor sub-phase:** ClientsList
    Deliverables column should append "in X days" after each Deliverable
    title (parse `due_date` via the existing `relativeDay` helper in
    `src/lib/hq/dates.ts`). Deferred from 5.7.4 smoke round 1 per Jimmie's
    request so the same "in X days" treatment can apply consistently
    across every surface that surfaces a deliverable due date.
  - **Carry-forward into 5.7.7:** ProjectsList "Account" filter rename
    to "Team" with scope = any user in the planned `project_members`
    table. Deferred from 5.7.4 smoke round 1 because renaming the
    filter today would either mislead (still scoped to leadName only)
    or orphan the rename when `project_members` ships in 5.7.7.
  - **5.7.12 Profile + Settings split surfaces.** Originally CUT in
    plan decision #20 (2026-05-17); un-cut 2026-05-17 PM during 5.7.2
    when the activity-feed user-link demotion surfaced that the dead-end
    `/users` link target was hurting the experience. Two split routes:
    `/users/:id` (read-only Profile view, accessible to every signed-in
    tier — backfills mention spans, activity-feed actor links, and
    mention-row record links to a real destination) + `/settings/profile`
    (self-only Settings; collects avatar, slack_user_id, profile copy;
    links out to the existing `/notifications/preferences`). `/users`
    (Team list) stays admin-only. Self-mention dispatch behavior stays
    on by design — not in scope for 5.7.12. Slot before HQ v1 checkpoint
    so the Phase 5.7.2 link-demotions can be reverted to real links
    inside the v1 cut.
  - **Status:** DONE 2026-05-18. Commit: `60f6ff0`. Spec:
    `OUTPUTS/phase-5-7-12-spec.md`. Slack DM dispatch verified
    end-to-end the same day (Slack app created, `SLACK_BOT_TOKEN`
    secret set, self-mention DM delivered).
- **HQ v1 checkpoint.** After 5.7 wraps: tag the squash commit, write
  `docs/v1-changelog.md` summarizing 5.1 through 5.7. Not a sub-phase;
  a release milestone.
- **5.8 Audit and Review (Full Codebase).** Three-pass audit cycle
  before the sub-app reviews kick off.
  - **5.8.0 Clear `code-observations.md` backlog.** Fix every
    unresolved entry from the existing observations log before any
    new audit work. Marks rows as ✓ Verified / ✓ Resolved with commit
    hash references.
  - **5.8.1 Audit + triage.** Read-only blind pass across `src/` +
    `supabase/functions/` + `docs/` for new findings beyond the
    cleared log. Parses the Supabase security advisor report + any
    other references Jimmie brings in. Produces a prioritized
    findings doc (MUST FIX / SHOULD FIX / CONSIDER) without applying
    any fixes.
  - **5.8.2 Audit fixes.** Applies MUST FIX + SHOULD FIX items from
    triage. CONSIDER items log to a fresh `code-observations.md`.
- **5.9 Talent Scout review.** Jimmie's notes + active bug hunting
  drive the split. Verifies TS still works correctly after the HQ
  Core schema reshape (5.2.x users-table rewrite, vendors split,
  clients table rebuild). Notes-first pattern: subphase split locked
  when batch arrives.
- **5.10 Venue Scout review.** Jimmie's notes + active bug hunting +
  HQ data-flow audit. Verifies `vs_candidate_venues_shortlist_sync`
  trigger still produces correct rows in the new HQ schema. Verifies
  deck generation + brief parsing + research pipeline post-HQ
  changes. Notes-first pattern: subphase split locked when batch
  arrives.
- **5.11 Mobile styling pass.** Cross-cutting responsive sweep
  across every HQ surface. Scope locked when phase opens.
- **Post-5.11.** TBD.

**Convention:** every 5.x sub-phase ship updates `docs/roadmap.md` with
its **Status:** DONE line in the same commit. Pair with the existing
squash-time `CHECKPOINT.md` touch so finished-sub-phase state stays in
two places (roadmap = plan view, CHECKPOINT = live-state view).

**Order matters:** 5.1 is the foundation; every later sub-phase depends on
the shell, the tier model, and the notes_log table. After 5.1, 5.2 and 5.3
parallelize cleanly. 5.4 depends on the user-management work in 5.1 for the
Team page; Wiki, Account Logins, and Settings are otherwise independent. 5.5
absorbs whatever notification scaffolding 5.1 stubbed and ships the polish.

Per-sub-phase pattern follows `docs/working-with-claude.md` § standard
new-surface workflow: Cowork drafts the spec from the locked wireframe + the
relevant docs, Code implements off the spec, code-reviewer subagent on the
diff before merge.

### Phase 6: Cutover. DONE.

Executed 2026-05-13 alongside the Phase 4 wrap. Main hard-reset to `vs-port-fresh` HEAD via `git push origin vs-port-fresh:main --force-with-lease`. 42-commit failed-attempt Phase 4 stack intentionally dropped. Two parallel TS commits (`6775429`, `f24d3f5`) cherry-picked before the push. Subdomain `hq.mirrornyc.com` was already live pre-cutover.

## Open questions still pending

- Project status enum may be refined and reduced. Current 14 values are fine for now; revisit in Phase 5 polish.
