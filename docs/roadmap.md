# Roadmap

Phase-by-phase build plan. Finished phases summarize to one line; the next phase has full detail. Update this doc when phases complete.

For granular project state and the latest commit hash, see `CHECKPOINT.md` at the repo root.

## Phase 1: Foundation — DONE

Supabase project, Google Cloud Console OAuth client, service account `mirror-ny-hq-backend@mirror-nyc-hq.iam.gserviceaccount.com` with domain-wide delegation across `gmail.readonly` / `gmail.send` / `drive` / `presentations`, GitHub repo, Netlify import, local toolchain. Service account verification script lives at `scripts/verify-service-account.ts`.

## Phase 2: Schema and auth — DONE

Initial schema migration (`20260506061457_initial_schema.sql`): 22 tables, enums, helper + trigger functions, RLS policies, 5 storage buckets. Jimmie seeded as admin. Sanity test: `/projects` query fixed for new schema, types regenerated, GRANTs migration (`20260506065157_grant_data_api_access.sql`) applied. Cross-user RLS test deferred to Phase 6.4.

## Phase 3: Talent Scout port

Use the cloned `mirror-talent-scout` repo as reference. Bring UI components, Anthropic eval logic, and Gmail integration into the `/talent-scout` route of HQ. Sub-phases driven by the section-9 sequence in `docs/talent-scout-port-plan.md`.

### 3.1 Inventory + port plan — DONE
See `docs/talent-scout-port-plan.md` for the full lift/adapt/rewrite/drop breakdown, schema diff, and sub-phase sequence.

### 3.2 Schema augmentation, edge function shells — DONE
Migration `20260506162543_phase_3_2_schema_augmentation.sql` added `ts_pull_rounds.pending_candidates` + `reeval_last_progress_at`, the `ts_evaluations` history table (admin-only RLS), and `global_settings.cap_alert_sent_this_month`. Stub edge functions `ts-pull-candidates` and `ts-generate-scorecard` deployed (501 responses; real impl in 3.3 / 3.4).

### 3.3 Roles CRUD + wizard — DONE
`/talent-scout/*` route tree mounted, admin-gated. Three-step new-role wizard (`/new/details` → `/new/search` → `/new/scorecard`) with hiring-manager picker over admin users, Claude-driven scorecard generation, single-screen edit + close/reopen at `/roles/:id/settings`. `_shared/anthropic.ts` `callClaude` wrapper landed alongside the real `ts-generate-scorecard`. Lifted from source: `parseClaudeJson`, `wizardStore`, `defaultEvalPrompt`, `poolStatus`, `scoreColor`. Built fresh: `Stepper`, `RoleStatusPill`, `TagInput`.

### 3.4 Pull pipeline — DONE
`ts-pull-candidates` ports source's chunked streaming pipeline (`BATCH_SIZE=8` self-invoke via `pending_candidates` jsonb). Service-account Gmail auth (`_shared/gmailServiceAccount.ts`) replaces per-install OAuth refresh tokens. PullDetail subscribes to `ts_pull_rounds` via Supabase Realtime. Schema renames everywhere; scorecard read from `ts_roles.scorecard`; `callClaude('talent_scout', ...)` for scoring with prompt caching; per-evaluation history written to `ts_evaluations`. End-to-end verified: R3 = 4 candidates pulled, scored, persisted with 9 attachments to Storage, $0.24 Anthropic spend.

### 3.5 Candidate detail + re-eval — DONE
CandidateDetail page (recruiter overview, files & materials, top strengths / key gaps, internal notes auto-save, score breakdown by tier, status dropdown, re-evaluate button). `ts-evaluate-candidate` for single re-eval (history INSERT) and `ts-bulk-reevaluate` for role-scoped pool re-eval; round-scoped re-eval on PullDetail uses parallel fan-out with `overwrite_history: true`. RoleDashboard restructured around master pool: 4 stat tiles, last-pull relative time, pull-round cards, CandidateSearch, CandidateTable. CandidateTable is two-tier (active above, rejected below collapsible) with status-priority sort, shift-click range select, slide-in bulk action bar, inline StatusDropdown. Schema: `promote` → `interview` enum rename, `ts_candidates.location` + `detected_links`, `ts_role_reeval_status` enum + 7 reeval columns on `ts_roles`.

### 3.6 Final review + packet — DONE
Comparative final review (`ts-final-review`) writes ranked `final_rankings` jsonb to `ts_final_reviews`. Per-candidate shape: `{candidate_id, final_rank, final_tier, rationale, recruiter_note}`, where `recruiter_note` is `string[]` (max 3 bullets). Streams `step_progress` via Realtime; FinalReviewLoading + FinalReviewDetail pages render it. Three Talent Scout Claude prompts consolidated in `_shared/prompts.ts`. Packet generation deployed (`ts-packet-generate`, `ts-final-review-packet`, pure pdf-lib in `_shared/packetRender.ts`, signed-URL email body to dodge WORKER_RESOURCE_LIMIT) but UI gated behind `PACKET_FEATURE_ENABLED` flags pending end-to-end verification. OAuth fixed end-of-phase (Phase 3.6.16) by switching to the new `sb_publishable_*` API key.

### 3.7 Candidates UX + referral ingestion — DONE
Squash-merged at `2ab37c3` (2026-05-08). Manual-reviewed flag with auto/manual pill + one-way flip + re-eval gate; CandidateDetail layout reorg with header cluster (Re-evaluate full-height + status stack), Score Breakdown with tier dividers; scorecard 100-point cap normalizer; Global Settings page with editable competitor list (Postgres `text[]`, default 19-entry list seeded); referral ingestion that detects `*@mirrornyc.com` forwards to jobs@, walks every chain segment for original applicant + manager commentary, captures every Mirror manager's commentary along the chain into `internal_notes` (Mirror sigs stripped), feeds it into the FIRST eval via the `HIRING MANAGER NOTES:` block, blocks `mirrornyc.com` from portfolio URL extraction; pull running state shows a 4-step checklist driven by the existing `candidates_found` / `processed_count` signals; brand restyling pass (top nav reduced to Dashboard + Talent Scout, Mirror grey card surfaces, score bar visibility fix on `bg-input` track, coral toasts site-wide). Six migrations applied to remote.

### 3.8 Cron jobs + watchdogs — DONE
`pg_cron` + `pg_net` enabled via `20260508120000_phase_3_8_cron_extensions_and_schedules.sql`. Six new edge functions deployed: `ts-cron-scheduled-pulls` (12:00 UTC daily, fires `ts-pull-candidates` per role schedule), `ts-cron-pull-watchdog` / `ts-cron-reeval-watchdog` / `ts-cron-final-review-watchdog` (every 5 min, detect-and-flag only — `stalled` / `failed` for >30min / >30min / >20min stalls), `ts-cron-storage-cleanup` (03:00 UTC daily, three-pass: rejected-candidate files >30d, closed-role files >90d, hard-delete closed roles >60d), `ts-cron-monthly-spend-reset` (1st of month 00:01 UTC, re-arms cap alert). Cap-alert email path wired in `_shared/anthropic.ts` via new `_shared/sendEmail.ts` (admin lookup with jobs@ fallback). Dead `ts_pull_rounds.reeval_last_progress_at` column dropped.

### 3.9 Pull notification — DONE
`ts-send-pull-notification` standalone deployed; `ts-pull-candidates` fires it fire-and-forget on every `status='complete'` write (chunked finalize, dedupe-clears-pending-to-zero, zero-results paths). Tallies per-status counts and emails the role's hiring manager from `jobs@mirrornyc.com` with a deep link to PullDetail. Folds into `notifications-dispatch` in Phase 5.

### 3.10 Scorecard refinement step — DONE
Squash-merged at `b70f0e9`. New `ts-refine-scorecard` edge function + Process / Save button morph on wizard step-3 and Edit Role. Dead-criterion drop server-side before prompt. Defense-in-depth merge restores tier / weight / is_disqualifier / is_manual from user input regardless of model output. Tier re-sort client-side after refine.

### 3.11 Scorecard substance restoration + summary field — DONE
Squash-merged at `cb038fc`. Reverted Phase 3.7's over-aggressive 12-word cap on `full_points_rubric`. Each criterion now carries two describer fields: `full_points_rubric` (1-3 substantive sentences for the per-candidate evaluator) and `summary` (14-word recap for compact UI surfaces), generated in the same Claude pass.

### 3.X runtime validation (pending, not a code phase)
- Verify `ts-final-review-packet` end-to-end after the WORKER_RESOURCE_LIMIT fix; flip `PACKET_FEATURE_ENABLED` to `true` in `PullDetail.tsx` and `FinalReviewDetail.tsx`. Hands-on test, not a code change.
- Real-cron test: trigger a manual `ts-cron-scheduled-pulls` invocation in production, watch watchdog detect a fake stall. Requires GUCs set in Supabase SQL editor and Phase 3.8 edge functions deployed (see `NEXT_STEPS.md`).
- Cleanup of deprecated `auto_rejected` enum value requires enum rebuild. Not worth it now.

## Phase 4: Venue Scout — IN PROGRESS

Full 12-step sourcing flow from brief upload through Google Slides deck generation. All new surfaces are designed in Cowork (wireframe + spec saved to `OUTPUTS/`) then implemented in Code. No Lovable. Design system foundation is Talent Scout pages per `docs/design-system.md`.

Auth gate: `ProtectedRoute` — all authenticated users (member, producer, admin). RLS is open: any authenticated user can read and write any scout (one `FOR ALL TO authenticated USING (true)` policy per vs_* table).

VS Pro source repo at `/Users/jimmie/Code/mirror-nyc-venue-scout-pro` is reference for functional scope and edge function logic only. All UI/layout comes from HQ design system.

Route tree (18 routes, all under `/venue-scout/scouts/:id`):

| Route | Surface |
|---|---|
| `/venue-scout` | Scout Index — list all scouts |
| `/venue-scout/scouts/:id` | Scout Dashboard (hub) |
| `/venue-scout/scouts/:id/brief-intake` | Brief Intake — upload + AI pre-fill + edit |
| `/venue-scout/scouts/:id/brief-report` | Brief Report — review parsed brief + version history |
| `/venue-scout/scouts/:id/sourcing-prompt` | Sourcing Prompt — neighborhood / focus prompt input |
| `/venue-scout/scouts/:id/sheet-upload` | Sheet Upload — paste/upload sourcing spreadsheet |
| `/venue-scout/scouts/:id/researching` | Researching — live Realtime progress (10-15 venues) |
| `/venue-scout/scouts/:id/matrix` | Candidate Venues Matrix — full-width scored matrix |
| `/venue-scout/scouts/:id/shortlist` | Venue Shortlist — shortlisted venues + deck notes |
| `/venue-scout/scouts/:id/review` | Review Selects — pitched venues confirmation |
| `/venue-scout/scouts/:id/compiling` | Compiling — generates summaries + researches manual adds |
| `/venue-scout/scouts/:id/deck-prep` | Deck Prep — drag reorder, photo slot assignment, slide count |
| `/venue-scout/scouts/:id/generating` | Generating — 1-2 min Google Slides generation progress |
| `/venue-scout/scouts/:id/deck/:version` | Pitch Deck Ready — embedded preview + version history |
| `/venue-scout/scouts/:id/settings` | Scout Settings — rename, danger zone (Start Over) |
| `/venue-scout/scouts/:id/sourcing/:roundId` | Sourcing Round Detail |
| `/venue-scout/scouts/:id/error/:errorCode` | Error States |

Edge functions (new, all `vs-*` prefix):

| Function | When invoked |
|---|---|
| `vs-parse-brief` | Brief Intake submit — parses uploaded PDF/doc, returns structured fields |
| `vs-start-sourcing` | Sourcing Prompt submit — kicks off venue research round |
| `vs-parse-sheet` | Sheet Upload submit — parses pasted/uploaded spreadsheet into candidate rows |
| `vs-compile-summaries` | Compiling page — generates venue overviews + researches manually-added venues |
| `vs-generate-deck` | Generating page — copies Google Slides template via service account, populates slides |

### 4.1 Scout Dashboard — SQUASH-READY (branch `phase-4-1-scout-dashboard`)

First Venue Scout surface. Hub page for a single scout: hero card (name, phase pill, sourcing status pill, stat tiles, CTA state machine), brief summary card, sourcing rounds card, shortlisted venues compact card. Primitives extracted here serve all downstream phases.

Spec: `OUTPUTS/phase-4-1-scout-dashboard-spec.md` | Wireframe: `OUTPUTS/phase-4-1-scout-dashboard-wireframe.html`

| Sub-phase | Status | Commit |
|---|---|---|
| 4.1.1 RLS migration, ideal_features text→text[], vs_sourcing_rounds Realtime, types regen, doc sweep | Done | `209650f` |
| 4.1.2 Field.tsx extraction, venueTypes.ts, ScoutPhasePill / SourcingStatusPill / RankBadge | Done | `b385924` |
| 4.1.3 ScoutDashboard.tsx page + route registration, inDeck stat tightened | Done | `5cdba51` + `f6d1824` |
| 4.1.4 code-reviewer subagent, review fixes, doc sweep, squash-merge prep | Done | `5612e7f` + `6930ca6` |

6 commits total, 17 files, +1256 / -59. tsc + build clean. Awaiting squash-merge approval.

### 4.2 Scout List — TODO

`/venue-scout` index page. List all scouts with last-updated sort, "+ New Scout" CTA, archive / restore. Follows Talent Scout `Index.tsx` pattern.

### 4.3 Wizard + Brief Intake + Brief Report + Settings — TODO

Scout-creation wizard (new scout flow), `/brief-intake` (file upload + `vs-parse-brief` AI parse + editable fields form, first VS edge function), `/brief-report` (review parsed brief, version history, link to start sourcing), `/settings` (rename, danger zone including Start Over). Start Over lives here: deletes candidate venues + sourcing rounds + photos, resets phase to sourcing, keeps brief. New edge function `vs-parse-brief`.

### 4.4 Sourcing Pipeline + Matrix — TODO

`/sourcing-prompt` + `/sheet-upload` + `/researching` (live Realtime progress subscribed to `vs_sourcing_rounds` -- publication already in place from 4.1.1) + full-width matrix at `/matrix` + `/sourcing/:roundId` detail. New columns on `vs_candidate_venues` (`key_features`, `derived_attrs`, `size_sq_ft`, `capacity`, `source`) added in this phase's migration. New edge functions `vs-start-sourcing`, `vs-parse-sheet`, `vs-research-venues`. Likely the most complex single phase in Phase 4.

### 4.5 Shortlist + Review + Compile — TODO

`/shortlist` (shortlisted venues with Deck Notes field, manual venue add, photo upload -- introduces `vs_venue_photos` table and real photos replace the 4.1 IMG placeholders), `/review` (pitched venues confirmation), `/compiling` (Realtime progress while `vs-compile-summaries` generates venue overviews + researches manual adds). New edge function `vs-compile-summaries`. Schema: `vs_venue_photos` table added here.

### 4.6 Deck Prep + Generate + Ready — TODO

`/deck-prep` (drag-to-reorder slots, photo-slot swap up to 4 per venue, slide count preview), `/generating` (progress screen, 1-2 min), `/deck/:version` (embedded Slides preview, version history, "New Version" trigger). New edge function `vs-generate-deck` -- copies Google Slides template via service account, populates slides. Multi-deck versioning via `vs_pitch_decks.version_number`.

### 4.8 Scout Index + Settings + Error States + Nav — TODO

`/venue-scout` Scout Index — list all scouts, "New Scout" CTA, last-updated sort. `/settings` — rename scout, Start Over (deletes candidate venues + sourcing rounds + photos, resets phase to sourcing, keeps brief). `/error/:errorCode` — four named error states (empty sheet, unsupported format, research timeout, deck generation failure). Top nav wired: `VENUES` caption appears when in `/venue-scout/*` routes (matches `TALENT` pattern).

## Phase 5: Cross-cutting — TODO

- Notifications system: `notifications-dispatch` Edge Function + UI bell + per-user prefs + email delivery via service account.
- Activity log feed on Project / Venue / Task pages.
- Admin pages: user role management, global settings UI.
- Polish: HQ Core pages currently stubbed as `<ComingSoon />` (`/projects`, `/venues`, `/clients`, `/tasks`) get real implementations.
- Fold `ts-send-pull-notification` into `notifications-dispatch`.

## Phase 6: Cutover — TODO

- 6.1 Final QA pass against the full spec, every flow as each role.
- 6.2 Talent Scout data preservation. Approach: re-create active/open roles in new HQ (re-pulling candidates from Gmail reproduces the structured data). Manually copy bucket decisions and internal notes for in-flight candidates. Export packet PDFs from Lovable for closed roles, preserve as historical archive in HQ file storage.
- 6.3 Production deploy on Netlify. Launch on `mirrornyc-hq.netlify.app` default URL. Hook up `hq.mirrornyc.com` once Workspace admin grants the subdomain.
- 6.4 Onboard team. Send link, verify accounts created with `member` role, promote producers and admins via admin UI. Run cross-user RLS violation test deferred from Phase 2.4.
- 6.5 Sunset Lovable. Shut down all three Lovable projects, cancel subscription, archive credentials.

## Open questions still pending

- Project status enum may be refined and reduced. Current 14 values are fine for now; revisit in Phase 5 polish.
- Talent Scout data extraction details (Phase 6.2). If Phase 6 inventory turns up data that doesn't fit the re-pull plan, revisit.
- `vs_venue_photos` schema design (deferred to Phase 4.5). Separate table `(candidate_venue_id FK, slot int 1-4, storage_path)` is the working plan.
- Venue type taxonomy: resolved in 4.1.2 via `venueTypes.ts` (CANONICAL_TYPES ported from VS Pro source). No action needed before 4.4.
