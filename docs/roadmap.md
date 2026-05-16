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
