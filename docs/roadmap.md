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
- **5.13** DONE 2026-05-27 (`9e15841`). Talent Scout review (complete). Nav context parity (BrandTS, TS_TOOL_ITEMS, cross-tool links, IconTalentScout/IconVenueScout), HQFormField global consolidation (VSPageField deleted), full chrome convergence across all 11 TS pages, savebar merged into actionbar HQ-wide, Sonnet design-system accuracy audit (13 findings addressed), eval prompt location rule injection, weekly auto-pull Monday anchoring, pipeline smoke (pull + re-eval + final review packet all clear). 7 sub-phases collapsed into one squash.

### Phase 5.14: Venue photo persistence to HQ Venues DB.

When a Venue Scout deck is generated, the 4 venue photos passed to the deck generator become canonical photos on the corresponding HQ Venue record. Round-trip: existing HQ Venue records auto-surface their 4 stored photos into Final Review deck prep; producer can replace / remove per slot; deck generation persists the producer's final state.

**Scope:**

1. **Schema.**
   - New storage bucket `venue-photos` (service-account writes; authenticated-member reads).
   - Photo links on the `venues` table: either 4 nullable URL columns (`photo_url_1`..`photo_url_4`) or a related `venue_photos` table keyed by `venue_id` + ordinal. Column shape simpler, related-table allows N > 4 later. Decision at spec time.
   - RLS: read for any authenticated member (or freelance-readable per 5.16 access pattern, TBD); write reserved for service account.

2. **Edge function.**
   - `vs-generate-deck`: at the existing dedup-and-supplement step (adds new venues + supplements null fields on existing venues), ALSO upload the 4 deck photos to `venue-photos` and link them to the venue row. Photos are "assumed to be the most recent" -- always write on deck generation when the final photo set differs from what's stored.
   - If the candidate's final photo set matches what's already stored, no-op (no storage write, no row update).
   - If the producer replaced / removed slots in Final Review, the persisted state matches that final shape (replace / delete in storage accordingly).

3. **Frontend.**
   - When a sourced candidate is matched against an existing HQ Venue record during research, surface the linked 4 stored photos as the default photo set for that candidate in Review.
   - VS Final Review (Deck Prep) photo slots: pre-populate from linked HQ Venue photos if present; producer can replace / remove per slot; final state lands at deck generation.
   - HQ Venue detail page: render the 4 linked photos.

4. **Migration considerations.**
   - Existing venues have no linked photos. Either backfill from existing decks' Drive folders (heuristic; needs Drive scope) or accept that pre-5.14 venues stay photo-empty until a producer regenerates a deck involving them.

5. **Open questions for spec time.**
   - Backfill yes/no, and from what source?
   - Storage layout: flat-keyed (`<venue_id>/photo_<n>.jpg`) vs. per-deck-version snapshot?
   - 4 slots permanent, or grow to N if deck templates expand?
   - Freelance-tier visibility (read-only access pattern from 5.16)?

### Phase 5.15: Anthropic per-tool call-log infra.

Queued during Phase 5.12.14.3 R7 § F.2 (VS Settings Anthropic Spend Cap card). The card ships against the existing aggregate columns `global_settings.anthropic_spend_cap_monthly_usd` + `anthropic_spend_current_month_usd`, but the "Per-tool breakdown" surface (Tool / Calls / Spend / Total per edge function) stubs out until the infrastructure ships. Three concerns to land together:

1. **Schema.** New `anthropic_call_log` table (or aggregation view) keyed by `app` (`talent_scout` / `venue_scout` / `hq`) + edge-function name + period (timestamp or month-bucket). Stores token count + USD cost + function name + scout/role id when applicable. Indexed for fast period-rollup queries.

2. **Edge-function wiring.** `_shared/anthropic.ts callClaude()` writes a log row on every Claude call (additive -- happy-path UPDATE of the existing `anthropic_spend_current_month_usd` still fires for the cap-alert email). Cost computed from the Anthropic response's `usage` block + per-model pricing constants.

3. **Frontend.** VS Settings + TS Settings spend-cap cards render the per-tool breakdown table from the log via a server-side aggregation RPC (`anthropic_spend_breakdown(month_iso)` returning rows per tool). Replace the R7 § F.2 placeholder banner ("Per-tool breakdown coming when the call-log infrastructure ships") with the live table.

Sequencing TBD. Could batch into 5.16 (RLS work on the new table aligns with the broader hardening pass) or later.


### Phase 5.16: DB tier hardening + freelance project-contributor access + codebase triage + carry-forwards.

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
