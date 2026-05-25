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

Shipped to production 2026-05-13. Full 1:1 port from `mirror-nyc-venue-scout-pro`; sub-phases 4.1 through 4.10 covered Scout Index, Brief, SheetPrompt + Upload, Researching, Sourcing Report + Shortlist, Review + Compiling, Deck Prep + Generating, Scout Settings, and AI enrichment + matrix overhaul. **Phase 4 Revision — Intake** (2026-05-14) rebuilt the Brief into a 3-step stepper, added the venue-side fields the AI sourcing prompt needs, added `vs-generate-brief-overview`, and made the Revisit nav always-visible. Decisions captured in `docs/decisions.md` "Phase 4 cutover + port plan locked decisions" + "Phase 4 Revision".

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
- **5.10** DONE 2026-05-22 (`5d57b26`). `venues.about_venue` rename + AI About Venue generator (`hq-generate-venue-about`, first `callClaude('hq', ...)` consumer, TOOL-LESS evergreen prompt + web_search) + Venue Edit/Detail layout refresh.
- **Codebase audit (v1) + triage cleanup** DONE 2026-05-22 (`34b32d4`). Standalone (not numbered as 5.X). Slim-down + legibility pass over HQ frontend; ~66 routes converted to `React.lazy` behind Suspense; 23 unused deps dropped; initial bundle 2.24 MB → 586 KB.

**Phase 5.11 — UX and structural consistency review.** Design-system audit sequence after the 5.10 venue work. Still tracking at .Y granularity until a future squash combines them.

- **5.11.0 UX/design-system audit + implementation pass.** DONE 2026-05-22 (`a2adbaf`). Focus rings; mobile shell + 44px hit targets; token cleanup; coral link contrast; `hq-` chrome convergence; edit card headers; shadcn radius; docs reconciliation.
- **5.11.1 Detail-page polish + list-table standardization + managed tags.** DONE 2026-05-23 (`38f5374`). Follow-on smoke fixes; managed Project Tags + Venue Features lookups.
- **5.11.2 Structural consistency.** DONE 2026-05-23 (`c19b332`). W1/W2 aligned list headers + stacked identifier colors/sizes + count footers + compact detail-page headers + detail crumbs + extracted `DField` / `HQFormField` / `ContactsCard` / `WebsiteActionButton` / `prettyHost` / `ListPageChrome`. W3 product-call: VendorEdit Tags removed; Task/Deliverable/Project edit shells aligned; native multi-selects replaced with `RecordCombobox multi`; PersonDetail Associated Venues = standalone card; editable Blocked By on TaskDetail. W4: canon documented in `docs/design-system.md` + `docs/decisions.md`. Deploy held for next push (`[skip netlify]`).

### Phase 5.12 — Venue Scout review. NEXT.

Jimmie's notes + active bug hunting + HQ data-flow audit. Verifies `vs_candidate_venues_shortlist_sync` trigger still produces correct rows in the new HQ schema. Verifies deck generation + brief parsing + research pipeline post-HQ changes. Notes-first pattern: subphase split locked when batch arrives.

**Overview standardization carry-forward (locked 2026-05-21, deferred from 5.10.0).** Goal: the "About Venue" / venue overview paragraph is ONE evergreen artifact, generated by the SAME shared prompt (`_shared/venueOverview.ts` `ABOUT_VENUE_SYSTEM`, evergreen since 5.10.0) in both HQ and VS, stored in `venues.about_venue`, and reusable across future decks. 5.10.0 locked the shared evergreen prompt + the HQ generator; the VS-side rework below was deferred here so it can be tested as one coherent change.

**Full VS workflow (as of 2026-05-21):** brief upload (optional) → brief parsed for client/event info + venue parameters entered → event overview generated → venue-research sheet upload (optional, parsed) → venue research (event+venue brief + target city/neighborhood passed to Claude to research venues matching the params; count depends on how many the user uploaded) → sourcing table lists all venues (uploaded + Claude-sourced) with Claude-researched context (address, website, features, recommendations, considerations, etc.) → user shortlists + adds notes → final review (user confirms/edits all venue info, uploads up to 4 photos/venue, notes resurfaced + editable) → deck-preview compile → Generate Deck.

**Changes to make here:**

1. **Move overview generation to the deck-preview-compile stage** (it currently runs in `vs-compile-summaries` Pass 2). At that stage pass name, size, features, Claude's recommendations + considerations, website, and user notes/feedback through the SHARED locked prompt — inputs are then ~the same as the HQ function (VS just carries the extra recs/considerations/notes). Recs/considerations are generated EARLIER (at the research step, surfaced in the sourcing table + final review), NOT at overview time.
2. **Add `web_search` to the VS overview call** (Jimmie's call 2026-05-21). Requires switching that call from forced `tool_choice: { type: tool }` to `tool_choice: auto`, adding the same tool_use → text → stub fallback the HQ function uses, and re-tuning the 180s `WORK_TIMEOUT_MS` (web_search × N venues in the sequential batch loop, on top of Pass 1's search, can blow the ceiling).
3. **Move the VS → HQ venue DB push to the "Generate Deck" click** (currently the `vs_candidate_venues_shortlist_sync` trigger upserts a `venues` row at SHORTLIST time, carrying only name/address/neighborhood/website/features — and NOT the overview). Rework so the push happens on Generate Deck (the user may edit the About paragraph one last time before that), links ALL relevant VS fields to their HQ `venues` columns, AND saves the generated paragraph into `venues.about_venue`.
4. **When VS converges to the shared overview prompt, go tool-less + add a prompt-cache breakpoint.** 5.10.0 made HQ tool-less; VS Pass 2 still uses the forced `write_overview` tool, so converging it means switching to the same tool-less plain-text path. Because VS generates N venues per scout in a sequential loop, add a prompt-cache breakpoint on the shared system prompt so the long evergreen system prompt + few-shot examples are billed once per scout, not once per venue.
5. **Update the `write_overview` tool when VS converges OR retire it.** If VS also goes tool-less, the `write_overview` tool in `_shared/venueOverview.ts` can be deleted entirely.

### Phase 5.13 — Talent Scout review.

Notes-first pass over Talent Scout post-HQ-Core. Same shape as the VS review (5.12): Jimmie's notes + active bug hunting + HQ data-flow audit. Verifies the candidate pool + pull pipeline + Final Review packet still produce correct rows now that the Phase 5.5 notifications-dispatch + Phase 5.6/5.7/5.11 chrome changes have settled. Subphase split locked when the batch arrives.

### Phase 5.14 — DB tier hardening + freelance project-contributor access.

Security + access pass spec'd at `OUTPUTS/phase-5-14-0-spec.md`. Two goals shipped together:

1. **Hardening.** Move tier enforcement into RLS so `pending` and `freelance` can no longer reach core data via the raw PostgREST API. Today most HQ Core tables use `using(true) TO authenticated`, so tier gating is client-side only. Adds `is_active_member()` + `is_project_member()` SECURITY DEFINER helpers; rewrites policies on all core tables to gate on tier + project membership.
2. **Freelance project-contributor access.** Give freelance a real row-scoped capability: read + write the projects they are assigned to (any roster role), including the project record + its tasks / deliverables / notes; read-only access to the CRM (clients / vendors / venues / people) and global Tasks / Deliverables lists.

Emerged from the Phase 5.11.0 data-leak audit. Full spec details migrations, policy DROP/CREATE shape, helper signatures, route-gate changes, nav tier-visibility model, and per-page write-affordance gates.

### Phase 5.15 — Codebase triage + carry-forwards.

Dedicated cleanup pass over the accumulated carry-forwards: `code-observations.md` rows that are still open (Frontend #1-3, #6, #11, #14, #16-17, #19, #20, #26-29, #38; Edge #1-2; Build & Tooling #2-3); the deferred Vite 5 → 8 upgrade (esbuild dev-only SSRF advisory carry-forward); the ~192-problem lint baseline; remaining `any`-typed surfaces. Scope locked when the triage starts (notes-first like 5.12 / 5.13).

### Phase 5.16 — Final smoke test + revisions.

Pre-team-rollout full smoke pass across every HQ surface in every tier (admin / standard / freelance / pending). Catches anything that survived 5.12 / 5.13 / 5.14 / 5.15. Punch list lands as 5.16.1 / 5.16.2 / ... or as one squash depending on volume. Closes the v1 build cycle.

### Post-5.16. TBD.

---

**Convention:** every 5.x sub-phase ship updates `docs/roadmap.md` with its **Status:** DONE line in the same commit. Pair with the existing squash-time `CHECKPOINT.md` touch so finished-sub-phase state stays in two places (roadmap = plan view, CHECKPOINT = live-state view).

Per-sub-phase pattern follows `docs/working-with-claude.md` § standard new-surface workflow: Cowork drafts the spec from the locked wireframe + the relevant docs, Code implements off the spec, code-reviewer subagent on the diff before merge.

### Phase 6: Cutover. DONE.

Executed 2026-05-13 alongside the Phase 4 wrap. Main hard-reset to `vs-port-fresh` HEAD via `git push origin vs-port-fresh:main --force-with-lease`. 42-commit failed-attempt Phase 4 stack intentionally dropped. Two parallel TS commits cherry-picked before the push. Subdomain `hq.mirrornyc.com` was already live pre-cutover.

## Open questions still pending

- Project status enum may be refined and reduced. Current 14 values are fine for now; revisit in a future polish phase.
