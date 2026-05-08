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

### 3.10 Scorecard refinement step — NEXT (in flight on `phase-3-10-scorecard-refine`)
New `ts-refine-scorecard` edge function plus a Process / Save button morph on both scorecard edit surfaces (wizard step-3 AND the Edit Role page). After any user edit (revise existing criterion, add manual, remove manual) the bottom-bar action becomes **Process scorecard**; clicking sends the current criteria + role context through Claude, which standardizes `name` and `full_points_rubric` while preserving every concept the user provided. Two server-side guarantees: (1) dead criteria — `weight=0` OR empty `name`+`full_points_rubric` — are dropped before the prompt runs (the count is surfaced in the success toast); (2) defense-in-depth merge restores `tier`, `weight`, `is_disqualifier`, `is_manual` from the user's input regardless of model output. Each tier is re-sorted highest-weight first after refine. On the wizard, the action flips to **Approve & lock scorecard** once clean. On Edit Role, the action flips back to **Save changes** which runs the existing confirm-and-trigger-bulk-reeval flow.

### 3.X queued for runtime validation
- Verify `ts-final-review-packet` end-to-end after the WORKER_RESOURCE_LIMIT fix; flip `PACKET_FEATURE_ENABLED` to `true` in `PullDetail.tsx` and `FinalReviewDetail.tsx`. Hands-on test, not a code change.
- Real-cron test: trigger a manual `ts-cron-scheduled-pulls` invocation in production, watch the watchdog detect a fake stall.
- Cleanup of deprecated `auto_rejected` enum value requires enum rebuild — not worth it now.

## Phase 4: Venue Scout — TODO

Same approach as Phase 3 (port from cloned repo). Venue Scout draft repo is incomplete; the screen-by-screen spec (Jimmie has it; can paste on request) is the source of truth, not the draft. Edge functions: `vs-parse-brief`, `vs-research-venues`, `vs-parse-sourcing-sheet`, `vs-research-single-venue`, `vs-generate-deck`. `venue_types` lookup values needed from Jimmie before this starts.

Sequential, not parallel — Talent Scout fully working before Venue Scout starts.

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

- `venue_types` lookup values. Jimmie provides before Phase 4.
- Project status enum may be refined and reduced. Current 14 values are fine for now; revisit in Phase 5 polish.
- Talent Scout data extraction details (Phase 6.2). If Phase 6 inventory turns up data that doesn't fit the re-pull plan, revisit.
