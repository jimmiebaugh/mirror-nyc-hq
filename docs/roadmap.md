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

### 3.6 Final review + packet — NEXT (you're picking up here)

Build the comparative-final-review flow + packet PDF generation. Per port plan section 9 + the disabled placeholders already wired into RoleDashboard (Generate Final Review + Top-N input) and PullDetail (Generate Packet + Top-N input):

- **`ts-final-review(role_id, candidate_count_limit?)`**: compares the master pool comparatively (not per-candidate), produces a pool summary + final rankings jsonb, writes to `ts_final_reviews`. Updates `ts_roles` (or final-review-aware status pill) so the "Final Report" indicator on `RoleStatusPill` lights up.
- **`ts-packet-generate(role_id, pull_round_id?, candidate_count?)`**: build packet PDF and email to hiring manager. **Q5 follow-up first**: read source's `generate-packet` (832 lines) vs `generate-final-review-packet` (767 lines) to confirm whether they're two distinct flows or one is dead code; consolidate into one HQ function based on that read.
- **Pages**: `FinalReviewLoading` (realtime sub on a generation status field), `FinalReviewDetail` (renders pool summary + ranked list with rationale per candidate). Wire the disabled buttons + Top-N inputs on RoleDashboard / PullDetail.

Heads up:
- Final review consumes the entire master pool's structured data → likely large prompt. Anthropic prompt caching with the role context block earns its keep here (1-hour TTL, same cache key per role).
- Packet generation talks to Google Slides + Drive APIs (already proven via service account; scopes confirmed). Use `_shared/gmailServiceAccount.ts` as the template.
- Both functions self-invoke for long runs → add `[functions.<name>] verify_jwt = false` per `docs/auth-model.md`.
- New tables: explicit GRANTs to `authenticated` and `service_role`. See `docs/conventions.md`.

### 3.7 Cron jobs + watchdogs — TODO
Wire `ts-cron-scheduled-pulls`, `ts-cron-pull-watchdog`, `ts-cron-reeval-watchdog`, `ts-cron-storage-cleanup` via `pg_cron` migrations. Watchdogs detect-and-flag (set status to `stalled` / `failed`); never auto-restart.

### 3.8 Notifications + spend alerts — TODO
`ts-send-pull-notification` standalone (folds into `notifications-dispatch` in Phase 5). Wire real-email path on `callClaude` cap alert (currently a console-log stub). Verify packet email path uses the service account's `gmail.send` from `jobs@mirrornyc.com`.

## Phase 4: Venue Scout — TODO

Same approach as Phase 3 (port from cloned repo). Venue Scout draft repo is incomplete; the screen-by-screen spec (Jimmie has it; can paste on request) is the source of truth, not the draft. Edge functions: `vs-parse-brief`, `vs-research-venues`, `vs-parse-sourcing-sheet`, `vs-research-single-venue`, `vs-generate-deck`. `venue_types` lookup values needed from Jimmie before this starts.

Sequential, not parallel — Talent Scout fully working before Venue Scout starts.

## Phase 5: Cross-cutting — TODO

- Notifications system: `notifications-dispatch` Edge Function + UI bell + per-user prefs + email delivery via service account.
- Activity log feed on Project / Venue / Task pages.
- Admin pages: user role management, global settings UI.
- Polish: HQ Core pages currently stubbed as `<ComingSoon />` (`/projects`, `/venues`, `/clients`, `/tasks`) get real implementations.
- Fold `ts-send-pull-notification` into `notifications-dispatch`.
- Implement `monthly-spend-reset` cron.

## Phase 6: Cutover — TODO

- 6.1 Final QA pass against the full spec, every flow as each role.
- 6.2 Talent Scout data preservation. Approach: re-create active/open roles in new HQ (re-pulling candidates from Gmail reproduces the structured data). Manually copy bucket decisions and internal notes for in-flight candidates. Export packet PDFs from Lovable for closed roles, preserve as historical archive in HQ file storage.
- 6.3 Production deploy on Netlify. Launch on `mirrornyc-hq.netlify.app` default URL. Hook up `hq.mirrornyc.com` once Workspace admin grants the subdomain.
- 6.4 Onboard team. Send link, verify accounts created with `member` role, promote producers and admins via admin UI. Run cross-user RLS violation test deferred from Phase 2.4.
- 6.5 Sunset Lovable. Shut down all three Lovable projects, cancel subscription, archive credentials.

## Open questions still pending

- `venue_types` lookup values. Jimmie provides before Phase 4.
- Project status enum may be refined and reduced. Current 14 values are fine for now; revisit in Phase 5 polish.
- Talent Scout data extraction details (Phase 6.2). If Phase 6 inventory turns up data that doesn't fit the re-pull plan, revisit.
