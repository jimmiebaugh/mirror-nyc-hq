# Roadmap

Phase-by-phase build plan. Finished phases summarize to one line; the next phase has full detail. Update this doc when phases complete.

For granular project state and the latest commit hash, see `CHECKPOINT.md` at the repo root. For per-phase ship narrative see `docs/v1-changelog.md`.

## Phase 1: Foundation. DONE.

Supabase project, Google Cloud Console OAuth client, service account `mirror-ny-hq-backend@mirror-nyc-hq.iam.gserviceaccount.com` with domain-wide delegation across `gmail.readonly` / `gmail.send` / `drive` / `presentations`, GitHub repo, Netlify import, local toolchain. Service account verification script lives at `scripts/verify-service-account.ts`.

## Phase 2: Schema and auth. DONE.

Initial schema migration (`20260506061457_initial_schema.sql`): 22 tables, enums, helper + trigger functions, RLS policies, 5 storage buckets. Jimmie seeded as admin. GRANTs migration (`20260506065157_grant_data_api_access.sql`) applied.

## Phase 3: Talent Scout port. DONE.

Lifted from `mirror-talent-scout`. Full pipeline ported and deployed. Sub-phases 3.1 through 3.11 covered schema augmentation, roles CRUD + wizard, the chunked Gmail pull pipeline, CandidateDetail + re-eval, the Final Review packet, manual-review + referral ingestion, pg_cron + 6 cron jobs, and scorecard refinement. Per-sub-phase summaries in `docs/v1-changelog.md` § Phase 3. Decisions in `docs/decisions.md` Phase 3 sections.

## Phase 4: Venue Scout port. DONE.

Shipped to production 2026-05-13. Full 1:1 port from `mirror-nyc-venue-scout-pro`; sub-phases 4.1 through 4.10 covered Scout Index, Brief, SheetPrompt + Upload, Researching, Sourcing Report + Shortlist, Review + Compiling, Deck Prep + Generating, Scout Settings, and AI enrichment + matrix overhaul. **Phase 4 Revision: Intake** (2026-05-14) rebuilt the Brief into a 3-step stepper, added the venue-side fields the AI sourcing prompt needs, added `vs-generate-brief-overview`, and made the Revisit nav always-visible. Decisions captured in `docs/decisions.md` "Phase 4 cutover + port plan locked decisions" + "Phase 4 Revision".

### Phase 5: HQ Core (cross-cutting). DONE.

The cross-cutting HQ Core layer that ties Talent Scout and Venue Scout into a single relational backbone for the agency. No source repo to port from; each sub-phase ships from a Cowork-drafted spec.

**Shipped sub-phases** (per-sub-phase summaries in `docs/v1-changelog.md`):

- **5.1** DONE 2026-05-15 (`fe04a5d`). HQ Core foundations: tier rewrite (admin / standard / freelance / pending), polymorphic `notes_log`, AppShell + left rail, Home dashboards.
- **5.2** DONE 2026-05-16 (`56b0484`). Projects / Tasks / Deliverables + Organizations / People / Venues entities; clients-vendors split; lookup tables; `DataTable` + `BoardView` + `TimelineView` + `CalendarMonthView` primitives.
- **5.3** DONE 2026-05-16 (`af59516`). Calendar + Outlook surfaces; install / live / removal date ranges on projects; `promote_outlook_to_project` RPC; per-source visibility persistence via implicit `saved_views` row.
- **5.4** DONE 2026-05-16 (`e528999`). Wiki + Account Logins + Users + Settings; four new tables (`departments`, `wiki_pages`, `credentials`, `mirror_holidays`); admin pre-provisioning + id-swap; 11 seeded wiki pages.
- **5.5** DONE 2026-05-16 (`9c73788`). Notifications + Activity Feed + Search + Sign-in page; bell-panel popover; `user_notification_preferences`; Slack DM dispatch; three pg_cron schedules (deliverable / task / event reminders).
- **5.6** DONE 2026-05-17 (`b62af98`). Interaction primitives + table reshapes + detail-page inline edit + global default views; `<RecordCombobox>`, `<ClickPillCell>`, `<InlineEditText>`, `<InlineTagInput>`, `<MiniCreateModal>`; `users.is_owner` + `saved_views.scope`; phone normalization; `last_active_at` throttle.
- **5.7** DONE 2026-05-18 (`9d2bdc4`). HQ Core UI overhaul: Quick-Add wiring; @-mentions feed (note_mentions); fixed-position StickySaveBar; deliverables status reshape (drop In Progress); global FilterBar distinct-values picker; `project_members` general-team join; Calendar overhaul (Day/Week/Month + My Tasks); Settings Lookup Lists merge + Wiki image upload; Vendor Files & Assets URL list; Profile + Settings split; per-user vendor_ratings.
- **5.8** DONE 2026-05-19 (`8a468d2`). HQ v1 release + security audit + cleanup + auth hotfixes. v1 changelog written; tech-debt audit closed; security pass (function search_path, RLS init-plan rewrite, credentials column encryption via pgsodium); surface reduction (28 shadcn UI deletes + 23 unused deps); auth pre-provision hotfix; ON UPDATE CASCADE on all 42 FKs pointing at `public.users.id`. `v1.0.0` + `v1.1.0` tags pinned.
- **5.9** DONE 2026-05-21 (`81cdaf2`). Bulk Import (Projects / Vendors / Venues) shared cross-cutting primitive + per-entity wiring + audit page at `/settings/bulk-import/history` + bulk-import undo (7-day window) + Event Day Rate import + `vendors.nationwide` + `general_email` columns.
- **5.10** DONE 2026-05-22 (`55bfee1`). `venues.about_venue` rename + AI About Venue generator (`hq-generate-venue-about`, first `callClaude('hq', ...)` consumer, TOOL-LESS evergreen prompt + web_search) + Venue Edit/Detail layout refresh + v1 codebase triage cleanup (66 routes converted to `React.lazy`, 23 unused deps dropped, initial bundle 2.24 MB → 586 KB).
- **5.11** DONE 2026-05-23 (`fee051e`). UX/design-system audit + structural consistency + docs reorg. Focus rings; mobile shell + 44px hit targets; token cleanup; coral link contrast; `hq-` chrome convergence; managed Project Tags + Venue Features lookups; aligned list headers + stacked identifier colors + count footers + compact detail-page headers + detail crumbs; extracted `DField` / `HQFormField` / `ContactsCard` / `WebsiteActionButton` / `prettyHost` / `ListPageChrome`. Deferred 5.11.0/5.11.1/5.11.2 sub-phases collapsed into one squash.
- **5.12** DONE 2026-05-27 (`ed81c38`). Venue Scout full review: 28 sub-phases collapsed; schema reshapes + the kickoff-RPC / CAS-guard edge patterns + prompt audit + matrix/chrome convergence. 10 migrations + 9 edge functions.
- **5.13** DONE 2026-05-27 (`2393840`). Talent Scout full review: nav-context parity, HQFormField global consolidation (VSPageField deleted), chrome convergence across the 11 TS pages, `.savebar` merged into `.actionbar`, eval-prompt location-rule injection. 7 sub-phases collapsed.
- **5.14** DONE 2026-05-28 (`4e67f12`). Venue photo persistence (backend-only): `vs-generate-deck` + `vs-research-venues` persist/seed `venue_photos`. No migration, no frontend.
- **5.15** DONE 2026-05-28 (`1814867`). Anthropic per-tool call-log infra + spend breakdown surface: `anthropic_call_log` table + windowed `anthropic_spend_breakdown` RPC, cap-edit consolidated to HQ Admin Settings, Month/Year toggle, `.scout-list-tbl` -> `.tbl-list` rename. 4 sub-phases collapsed.
- **5.16** DONE 2026-05-28 (`f138c23`). v1 wind-down cycle, 4 sub-phases collapsed into one consolidation squash: freelance flattened to standard + `is_active_member()` DB tier hardening (5.16.0); Vite 5 -> 8 + tooling (5.16.1.0); lint 191 -> 0 full repo (5.16.1.1); Supabase advisor focused + xlsx vendoring (5.16.1.2). Per-sub-phase rationale in `docs/decisions.md` § Phase 5.16.


### Phase 6.0: Post-v1 smoke punch-list. IN PROGRESS (single squash at cycle close).

The v1 build cycle closed with the Phase 5.16 consolidation (`f138c23`). Phase 6.0 is the pre-team-rollout pass across every HQ surface in every tier (admin / standard / freelance / pending), catching anything that survived 5.12 / 5.13 / 5.14 / 5.15 / 5.16. It shipped as five frontend/UX **capability clusters** (6.1 table system: `.tbl-list` HQ-wide + alignment + `.tbl-done`; 6.2 card chrome + calendar/outlook grid canon; 6.3 `DateField` ISO date primitive; 6.4 per-surface forms / detail / Home / Settings + N3 input-contrast pivot + `venue_files`; 6.5 global behaviors + actionbar / combobox / VenueType polish) plus a **T1 tech-debt pass** (Top-5 + quick-wins; deferred findings tracked in `code-observations.md`, see the post-v1.0 backlog below). Clusters 6.1-6.5 are locked/implemented and T1 is closed. The model is **one 6.0 squash to `main` at cycle close**: every per-cluster and per-finding feature-branch commit (plus this doc sweep) folds into that single squash, not standalone ships. Deployed out-of-band ahead of the squash (prod leads `main`): F001 admin gate on the 7 `ts-*` functions, the F003 (ON UPDATE CASCADE) + F004 (atomic spend RPC) + `venue_files` migrations, and 18 edge-fn redeploys. The 5.16 self-SHA backfill (the consolidation placeholder → `f138c23` across `CHECKPOINT.md` / `docs/v1-changelog.md` / `docs/roadmap.md` / `docs/decisions.md`) landed in the first 6.0 doc sweep; this M2(b) doc sweep folds into the same squash. Cluster + finding rationale in `docs/decisions.md` § Phase 6.0.


### Post-v1.0 backlog

**Deferred tech-debt (Phase 6.0 T1 pass).** The audit report is a session-local artifact (gitignored); its unresolved findings live as discrete actionable rows in `code-observations.md` (Frontend #56-#81 + Edge Functions #22-#34): VS concurrency/atomicity (F007/F008/F009), untested load-bearing logic (F010/F031/F049), cross-surface duplication + god-file splits (F012/F014-F016/F026/F028/F029/F033), search-punctuation escaping (F020), the type/error-handling papercuts (F023/F025/F030/F040-F048/F050/F051/F060-F062), and the VS-internal `venue_type` slash-split (Edge #34: a `/`-containing canonical type name still splits in the VS matrix / sanitize paths until the VS type pipeline is realigned to pipe end-to-end). No dedicated cleanup phase is scheduled; pull from those rows as capacity allows.

---

**Convention:** every 5.x sub-phase ship updates `docs/roadmap.md` with its **Status:** DONE line in the same commit. Pair with the existing squash-time `CHECKPOINT.md` touch so finished-sub-phase state stays in two places (roadmap = plan view, CHECKPOINT = live-state view).

Per-sub-phase pattern follows `docs/working-with-claude.md` § standard new-surface workflow: Cowork drafts the spec from the locked wireframe + the relevant docs, Code implements off the spec, code-reviewer subagent on the diff before merge.

### Phase 6: Cutover. DONE.

Executed 2026-05-13 alongside the Phase 4 wrap. Main hard-reset to `vs-port-fresh` HEAD via `git push origin vs-port-fresh:main --force-with-lease`. 42-commit failed-attempt Phase 4 stack intentionally dropped. Two parallel TS commits cherry-picked before the push. Subdomain `hq.mirrornyc.com` was already live pre-cutover.

## Open questions still pending

- Project status enum may be refined and reduced. Current 14 values are fine for now; revisit in a future polish phase.
