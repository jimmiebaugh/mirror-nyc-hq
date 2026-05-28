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

### Phase 5: HQ Core (cross-cutting). ACTIVE.

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
- **5.12** DONE 2026-05-27 (`ed81c38`). Venue Scout review (complete). 28 sub-phases collapsed into one squash. Per-phase narrative in `docs/v1-changelog.md` § Phase 5.12. Architectural decisions in `docs/decisions.md` § Phase 5.12. 10 migrations + 9 edge functions touched cumulatively. Closes the VS review cycle.
- **5.13** DONE 2026-05-27 (`2393840`). Talent Scout review (complete). Nav context parity (BrandTS, TS_TOOL_ITEMS, cross-tool links, IconTalentScout/IconVenueScout), HQFormField global consolidation (VSPageField deleted), full chrome convergence across all 11 TS pages, savebar merged into actionbar HQ-wide, Sonnet design-system accuracy audit (13 findings addressed), eval prompt location rule injection, weekly auto-pull Monday anchoring, pipeline smoke (pull + re-eval + final review packet all clear). 7 sub-phases collapsed into one squash.
- **5.14** DONE 2026-05-28. Venue photo persistence (backend-only). `vs-generate-deck`: `persistVenuePhotosToHq` at deck-gen persists finalized `vs_venue_photos` to HQ `venue_photos` bucket + updates `venues.photos`. `vs-research-venues`: all three hq_pool INSERT paths (`loadHqVenuesIntoPool` deterministic-keep, Phase B seed-then-drop, `rescueHqPoolFitVetoedVenues`) seed `vs_venue_photos` from stored HQ photos with `path=`-qualified `[hqPoolPhotoSeed]` telemetry. No migration; no frontend; two edge functions.
- **5.15** DONE 2026-05-28. Anthropic per-tool call-log infra + spend breakdown surface — 4 sub-phases collapsed into one squash. New `anthropic_call_log` table (one row per successful `callClaude`, 12-month retention pruned by `ts-cron-monthly-spend-reset`) + `public.anthropic_spend_breakdown(window_kind text default 'month', window_iso text default null)` SECURITY DEFINER RPC supporting both calendar-month and calendar-year windows. `callClaude` wrapper writes a log row after `trackSpendAndAlert` (non-fatal on failure); `CallClaudeOptions` gains optional `scout_id` + `role_id`; caller sweep threads ids at every VS + TS call site. Cap-control consolidation: HQ Admin Settings becomes the canonical cap-edit surface; TS + VS Settings flip to read-only spend displays. UX: new `<AnthropicSpendBreakdownTable>` with `appFilter` + `window` props (HQ = grouped HQ/TS/VS view, TS + VS = filtered to that app). Month / Year `.viewswitch` toggle in the breakdown header row on all three consumers; HQ Cap-card "Current Period Spend" scales ("of $Y cap" under Month, "of $Y annualized" = monthly cap × 12 under Year). CSS: `.scout-list-tbl` renamed globally to `.tbl-list` (canonical list-table wrapper, three consumers); `.tbl-divider` repainted to muted coral with wrapper-aware selector so the chrome wins inside lifted-cells context. Monthly cron `ts-cron-monthly-spend-reset` gains a 12-month log prune. Per-phase narrative in `docs/v1-changelog.md`.

### Phase 5.16: DB tier hardening + freelance project-contributor access + codebase triage + carry-forwards. ACTIVE.

Security + access pass spec'd at `OUTPUTS/phase-5-16-0-spec.md` (originally drafted under the old 5.14 numbering, renamed at the 2026-05-27 roadmap renumbering) + dedicated cleanup pass over the accumulated carry-forwards: `code-observations.md` rows that are still open; the deferred Vite 5 to 8 upgrade (esbuild dev-only SSRF advisory carry-forward); the ~192-problem lint baseline; remaining `any`-typed surfaces. Scope locked when the triage starts (notes-first like 5.12 / 5.13). Recommend squashing hardening and triage as separate sub-phases (5.16.0 / 5.16.1) so regression forensics stay clean. Three goals:

1. **Hardening.** Move tier enforcement into RLS so `pending` and `freelance` can no longer reach core data via the raw PostgREST API. Today most HQ Core tables use `using(true) TO authenticated`, so tier gating is client-side only. Adds `is_active_member()` + `is_project_member()` SECURITY DEFINER helpers; rewrites policies on all core tables to gate on tier + project membership.
2. **Freelance project-contributor access.** Give freelance a real row-scoped capability: read + write the projects they are assigned to (any roster role), including the project record + its tasks / deliverables / notes; read-only access to the CRM (clients / vendors / venues / people) and global Tasks / Deliverables lists.
3. **Fix code-observations and site tech debt accumulated.**

Emerged from the Phase 5.11.0 data-leak audit. Full spec details migrations, policy DROP/CREATE shape, helper signatures, route-gate changes, nav tier-visibility model, and per-page write-affordance gates.


### Phase 5.17: Final smoke test + revisions.

Pre-team-rollout full smoke pass across every HQ surface in every tier (admin / standard / freelance / pending). Catches anything that survived 5.12 / 5.13 / 5.14 / 5.15 / 5.16. Punch list lands as 5.17.1 / 5.17.2 / ... or as one squash depending on volume. Closes the v1 build cycle.


### Post-5.17. TBD.

---

**Convention:** every 5.x sub-phase ship updates `docs/roadmap.md` with its **Status:** DONE line in the same commit. Pair with the existing squash-time `CHECKPOINT.md` touch so finished-sub-phase state stays in two places (roadmap = plan view, CHECKPOINT = live-state view).

Per-sub-phase pattern follows `docs/working-with-claude.md` § standard new-surface workflow: Cowork drafts the spec from the locked wireframe + the relevant docs, Code implements off the spec, code-reviewer subagent on the diff before merge.

### Phase 6: Cutover. DONE.

Executed 2026-05-13 alongside the Phase 4 wrap. Main hard-reset to `vs-port-fresh` HEAD via `git push origin vs-port-fresh:main --force-with-lease`. 42-commit failed-attempt Phase 4 stack intentionally dropped. Two parallel TS commits cherry-picked before the push. Subdomain `hq.mirrornyc.com` was already live pre-cutover.

## Open questions still pending

- Project status enum may be refined and reduced. Current 14 values are fine for now; revisit in a future polish phase.
