> **STATUS: Historical (Phase 3 complete). Kept as a Phase 4 port template.**

# Talent Scout port plan

Inventory of `~/Code/mirror-nyc/mirror-talent-scout` and a port plan into the `/talent-scout` route of Mirror NYC HQ. No port code yet; this doc is the blueprint Jimmie reviews before drafting Phase 3.2.

## 1. What the source repo is

Same Vite/React/TS/Tailwind/shadcn foundation as HQ. The only stack-level differences:

- `@lovable.dev/cloud-auth-js` for an app-password gate (Setup flow). **Drops**: HQ uses Supabase Google OAuth.
- 19 Supabase Edge Functions in `supabase/functions/` covering Gmail OAuth, the Claude pipeline, packet generation, and crons.
- 28 incremental SQL migrations producing 8 tables. None will be applied to HQ; HQ already has `ts_*` tables in `20260506061457_initial_schema.sql`.
- Edge functions pull `unpdf@0.12.1` (PDF text extract) and `fflate@0.8.2` (ZIP for DOCX/Pages) via esm.sh URL imports, Deno-style.
- Custom Anthropic wiring: raw fetch, two prompt-caching breakpoints (system + role context), model `claude-sonnet-4-6`. Cost tracked by an in-process `logClaudeUsage` helper.

Frontend uses `react-router-dom` v6, `react-hook-form` + `zod`, `@tanstack/react-query`, `sonner` for toasts, `cmdk` for command palette, `recharts` for the spend graph. All already in HQ's tree.

## 2. Schema diff

| Talent Scout (source) | HQ (`ts_*`) | Action |
|---|---|---|
| `roles` | `ts_roles` | Field rename map below. |
| `scorecards` (separate table, FK to roles) | `ts_roles.scorecard jsonb` | Collapse into role row. Wizard's step-3 criteria array goes into the jsonb. |
| `evaluations` (history, multiple rows per candidate) | flattened onto `ts_candidates` | **Lossy.** HQ keeps only the latest evaluation; re-eval overwrites. Decision needed (Q1 below). |
| `pull_rounds` | `ts_pull_rounds` | Plus columns missing in HQ: see "Schema additions needed" below. |
| `candidates` | `ts_candidates` | Field rename map below. Pipeline's "pending" state needs a home (Q2). |
| `final_reviews` | `ts_final_reviews` | Direct map. |
| `global_settings` | `public.global_settings` | TS columns (`monthly_anthropic_budget_usd`, `current_month_spend_usd`, `competitor_list`) overlap HQ's. Map onto HQ fields. |
| `private_secrets` (Gmail refresh token) | n/a | **Drop.** Service account replaces the per-install OAuth grant. |
| `cleanup_log` | n/a | Optional: nice for ops visibility. Suggest add as `ts_cleanup_log` if Phase 3 grows long; skip for v1. |

### Field rename map (selected, non-exhaustive)

```
roles.title                           → ts_roles.title
roles.jd_full_text                    → ts_roles.job_description
roles.location                        → ts_roles.location
roles.employment_type                 → ts_roles.type
roles.comp                            → ts_roles.compensation
roles.start_date                      → ts_roles.start_date
roles.hiring_priorities               → ts_roles.hiring_priorities
roles.hiring_manager_name+email       → ts_roles.hiring_manager_id (FK to users; lookup by email)
roles.subject_line_keywords           → ts_roles.email_keywords
roles.start_pulling_from              → ts_roles.email_search_start_date
roles.scheduled_pull_frequency        → ts_roles.auto_pull_schedule (enum)
roles.auto_rejection_threshold        → ts_roles.auto_rejection_threshold
roles.competitor_bonus_*              → ts_roles.competitor_bonus jsonb
scorecards.criteria                   → ts_roles.scorecard jsonb
candidates.score / tier / rationale   → ts_candidates.score / tier / score_breakdown
candidates.recruiter_overview         → ts_candidates.recruiter_overview
candidates.top_strengths / key_gaps   → ts_candidates.top_strengths / key_gaps (jsonb arrays already)
candidates.attachment paths           → ts_candidate_attachments rows
```

### Schema additions HQ needs (Phase 3.2 migration)

The streaming pull pipeline depends on two operational columns that HQ's spec didn't anticipate:

- `ts_pull_rounds.pending_candidates jsonb DEFAULT '[]'`: queue of message IDs that the pipeline batches in groups of 8 across self-invocations. Without this column, the chunked architecture breaks and we'd need a different approach (full-blocking pull = 5+ minute Edge Function timeouts).
- `ts_pull_rounds.reeval_last_progress_at timestamptz`: heartbeat the re-eval watchdog reads to decide whether to mark a round stalled.

Both are operational, internal-only fields. Add via a small migration in Phase 3.2 alongside the function deploys.

## 3. Frontend pages: port classification

All routes mount under `/talent-scout/*` in HQ. Auth/layout drops because HQ provides those.

| Source page | Action | Notes |
|---|---|---|
| `pages/Index.tsx` | **Adapt** | Rebuild list shell using HQ's AppShell. Query stays the same; remove Layout import. |
| `pages/Login.tsx` | **Drop** | HQ has its own. |
| `pages/Setup.tsx` | **Drop** | App-password gate is Lovable-era. |
| `pages/Settings.tsx` | **Adapt** | Most fields fold into HQ admin settings. The Gmail-connect/disconnect UI deletes; competitor list and budget UI move to a per-role section (competitors are role-scoped) or HQ admin. |
| `pages/NewRoleDetails.tsx` | **Lift** | Field renames only (jd → job_description, etc.). |
| `pages/NewRoleSearch.tsx` | **Lift** | Subject keywords + start-pull date + cadence wizard. |
| `pages/NewRoleScorecard.tsx` | **Adapt** | Existing flow saves to `scorecards` table; rewire to write the criteria array into `ts_roles.scorecard` jsonb directly. Calls `generate-scorecard` edge fn: keep that. |
| `pages/RoleDashboard.tsx` | **Lift** | Per-role dashboard with candidate table + status pills. Renames only. |
| `pages/RoleSettings.tsx` | **Lift** | Same flow as the wizard but in edit mode. |
| `pages/PullRoundDetail.tsx` | **Lift** | Per-round candidate list. |
| `pages/PullLoading.tsx` | **Lift** | Realtime pull status. May simplify to a Realtime subscription on `ts_pull_rounds.status`. |
| `pages/FinalReviewLoading.tsx` | **Lift** | Same pattern as PullLoading. |
| `pages/FinalReviewDetail.tsx` | **Lift** | Renders pool summary + final rankings. |
| `pages/CandidateDetail.tsx` | **Lift** | Recruiter overview, score breakdown, internal notes, re-evaluate button. |
| `pages/Placeholders.tsx` | **Drop** | Stale `PullResults` placeholder. |

`lib/wizardStore.ts` (in-memory wizard state) ports as-is.

## 4. Components

**Lift as-is (rename imports only):** `CandidateSearch`, `CandidateTable`, `ScoreBar`, `ScorecardModal`, `StatusDropdown`, `RoleStatusPill`, `Stepper`, `FloatingPullStatus`, `ErrorBoundary`.

**Drop (HQ has equivalents):** `Layout`, `Topnav`, `NavLink`, `AuthGate`, `SetupGate`.

**`components/ui/`:** mostly already in HQ. Diff and copy any missing primitives over.

## 5. lib/ helpers

| File | Action | Notes |
|---|---|---|
| `defaultEvalPrompt.ts` | **Lift** | The default Anthropic eval prompt. Used as fallback when `ts_roles.evaluation_prompt` is null. |
| `scoreColor.ts` | **Lift** | Score → tier color mapping. |
| `unwrapUrl.ts` | **Lift** | URL classification + portfolio detection. Same module exists in `_shared/` for edge functions; mirror keeps both in sync. |
| `signedUrls.ts` | **Adapt** | Bucket name changes (`candidate-attachments` → `candidate_attachments` per HQ schema). |
| `wizardStore.ts` | **Lift** | In-memory new-role wizard. |
| `openGmailAttachmentUrl.ts` | **Adapt** | Currently calls `gmail-attachment` edge fn (OAuth-token-based). Replace with a service-account-based attachment fetch. |
| `poolStatus.ts` | **Lift** | Pull round status helpers. |
| `utils.ts` | **Lift** | shadcn-standard `cn()` helper; merge with HQ's. |

## 6. Edge functions

HQ spec names from CLAUDE.md in **bold**.

| Source function (lines) | Target | Action |
|---|---|---|
| `pull-candidates/index.ts` (1129) | **`ts-pull-candidates`** | **Adapt: biggest port.** Replace Gmail OAuth refresh-token flow with service-account JWT impersonating `jobs@mirrornyc.com`. Keep the chunked self-invoke architecture, attachment storage logic, Claude eval flow. Wire `logClaudeUsage` into HQ's `anthropic-spend-tracker`. |
| `reevaluate-candidate/index.ts` (277) | **`ts-evaluate-candidate`** | **Lift.** Schema field renames + spend wrapper. |
| `reevaluate-round/index.ts` (268) | **`ts-bulk-reevaluate`** | **Lift.** Same notes. |
| `generate-final-review/index.ts` (288) | **`ts-final-review`** | **Lift.** |
| `generate-final-review-packet/index.ts` (767) + `generate-packet/index.ts` (832) | **`ts-packet-generate`** | **Adapt.** Consolidate the two packet generators into one. Inspect first to confirm they aren't doing different things: likely one is the candidate-pool packet, the other the final-review packet. If so, keep both code paths but unify entry point. |
| `generate-scorecard/index.ts` (135) | `ts-generate-scorecard` (not in CLAUDE.md spec; add) | **Lift.** Wizard step 3 calls this. |
| `send-pull-notification/index.ts` (282) | folds into **`notifications-dispatch`** | **Adapt.** Cross-cutting notify lands here per Phase 5; port now keeps the email template but routes through the shared dispatcher. Add a `notify_when_done` boolean to roles or just always notify the hiring manager. |
| `pull-watchdog/index.ts` (118) | **`ts-cron-pull-watchdog`** | **Lift.** |
| `cleanup-attachments/index.ts` (144) | **`ts-cron-storage-cleanup`** | **Lift.** Update bucket name. |
| `scheduled-pulls/index.ts` (85) | **`ts-cron-scheduled-pulls`** | **Lift.** |
| `delete-role/index.ts` (81) | inline cascade DELETE | **Drop.** With proper FK cascades in HQ schema and admin RLS, the React UI can issue a plain DELETE and the DB handles cascade. |
| `retry-failed-candidates/index.ts` (160) | folds into **`ts-bulk-reevaluate`** | **Adapt.** Add a `?status_filter=auto_rejected` query param. |
| `get-attachment-url/index.ts` (71) | client-side via supabase-js | **Drop.** `supabase.storage.from('candidate_attachments').createSignedUrl(path, 60)` from the browser is sufficient given admin-only RLS. |
| `verify-app-password/index.ts` (66) | n/a | **Drop.** Setup flow is gone. |
| `gmail-oauth-start/index.ts` (43) | n/a | **Drop.** |
| `gmail-oauth-callback/index.ts` (106) | n/a | **Drop.** |
| `gmail-disconnect/index.ts` (36) | n/a | **Drop.** |
| `gmail-attachment/index.ts` (91) | absorbed by `ts-pull-candidates` and a new helper | **Drop the Edge fn**, keep the Gmail attachment download logic and run it inside `ts-pull-candidates` and (if needed) a small `ts-attachment-fetch` for re-download cases. |

**New function HQ spec calls for that TS doesn't have:** `ts-cron-reeval-watchdog` (every 10 min). Trivial to write: clones `pull-watchdog` and watches `reeval_last_progress_at` instead. Add in Phase 3.x once `ts-bulk-reevaluate` is in.

**Shared modules (`supabase/functions/_shared/`):** all lift, with the Gmail token module replaced by a service-account JWT module.

| Source `_shared` module | Target | Notes |
|---|---|---|
| `evalPrompt.ts` | lift | Default prompt text. |
| `parseClaudeJson.ts` | lift | Tolerant JSON parser for Claude's responses. |
| `buildClaudeEvalRequest.ts` | lift | Request builder, prompt caching breakpoints. Update model constant if needed (Claude 4.6 → 4.7). |
| `attachmentStorage.ts` | lift, rename bucket | |
| `internalAuth.ts` | adapt | Currently gates internal-secret + user JWT. Keep the internal-secret path; user JWT check now uses Supabase auth from HQ. |
| `gmailToken.ts` | **replace** | New `gmailServiceAccount.ts` builds a JWT impersonating `jobs@mirrornyc.com`. Reuses the same logic as `scripts/verify-service-account.ts` but stores the service-account key as a Supabase secret instead of reading from disk. |
| `unwrapUrl.ts` | lift | URL classification helpers. |

## 7. External dependencies

**Already in HQ (no add):** `@radix-ui/*`, `@hookform/resolvers`, `react-hook-form`, `zod`, `@tanstack/react-query`, `date-fns`, `lucide-react`, `cmdk`, `react-router-dom`, `sonner`, `class-variance-authority`, `clsx`, `tailwind-merge`, `tailwindcss-animate`.

**Need to add to HQ `package.json`:** `embla-carousel-react`, `input-otp`, `next-themes`, `react-day-picker`, `react-resizable-panels`, `recharts`, `vaul` (one-line `npm install`; some already may be present, verify before adding).

**Edge function dependencies** (Deno URL imports, no npm changes): `unpdf@0.12.1`, `fflate@0.8.2`, `@supabase/supabase-js@2.45.0`. Keep versions pinned to match the source.

**Anthropic SDK:** the source repo uses raw `fetch` against `https://api.anthropic.com/v1/messages`: no SDK. Port keeps the raw approach for control over caching headers and streaming.

**Drop entirely:** `@lovable.dev/cloud-auth-js`. Lovable-era auth.

## 8. Open questions before Phase 3.2

> All questions below were resolved during Phase 3 implementation. See `docs/decisions.md` Phase 3 Q1 through Q6 entries for landed answers.

1. **Re-evaluation history.** TS keeps an `evaluations` table with one row per re-eval. HQ flattens to `ts_candidates` columns and overwrites on re-eval. **Recommend:** add a small `ts_evaluations` history table to HQ before Phase 3.2 starts. Cost is one extra table; benefit is being able to see "scored 72 on May 6 with prompt v2, then 81 on May 12 with prompt v3": useful when the eval prompt evolves. Cheap insurance.
2. **Where the pipeline parks pending candidates.** Recommend the `pull_rounds.pending_candidates jsonb` column TS already uses; add to HQ schema. Alternative is a `ts_pending_candidates` table, but jsonb on the round is simpler and matches the existing pipeline shape.
3. **Hiring-manager identity.** TS stores hiring manager as freeform name + email on the role row. HQ schema FKs `hiring_manager_id` to `users`. **Recommend:** lookup by email at role create time; if no `users` row exists yet (manager hasn't signed in to HQ), block role creation with "Hiring manager must sign in to HQ at least once first." Sharper than auto-creating users from email strings.
4. **Send-pull-notification consolidation.** Port now (folded into `notifications-dispatch`) or port standalone first and consolidate during Phase 5? **Recommend:** port standalone as `ts-send-pull-notification` to ship Phase 3 cleanly, fold into the cross-cutting dispatcher in Phase 5. Avoids blocking on Phase 5 work.
5. **Two packet generators.** Need a 30-minute read of `generate-final-review-packet` vs `generate-packet` to confirm they're not actually doing the same thing and one is dead code. Easier to consolidate after that read.
6. **Anthropic spend tracker shape.** HQ spec calls for `anthropic-spend-tracker` as a wrapper helper. TS has `logClaudeUsage` doing it inline. Need to decide the helper's shape (decorator wrapping `fetch`? Explicit start/end calls? Middleware?) before writing the first Claude-calling function.

## 9. Suggested port sequence

Port slimmest-to-thickest so each step compiles and runs end-to-end before the next:

1. **3.2 Schema augmentation.** Migration adding `pending_candidates`, `reeval_last_progress_at`, optional `ts_evaluations` history table. Plus the `ts-generate-scorecard` and `ts-pull-candidates` Edge Function shells (deployed but not yet wired). One commit.
2. **3.3 Roles CRUD + wizard.** Pages: `Index`, `NewRoleDetails`, `NewRoleSearch`, `NewRoleScorecard`, `RoleDashboard` (read-only), `RoleSettings`. Edge functions: `ts-generate-scorecard`. Lets Jimmie create a role and see it persisted; no candidates yet.
3. **3.4 Pull pipeline.** Edge function: `ts-pull-candidates` with service-account Gmail auth. Pages: `PullLoading`, `PullRoundDetail`. Confirms the chunked architecture works against the real schema. Smallest possible role + smallest test inbox subset to keep iteration fast.
4. **3.5 Candidate detail + re-eval.** Pages: `CandidateDetail`. Edge functions: `ts-evaluate-candidate`, `ts-bulk-reevaluate`.
5. **3.6 Final review + packet.** Pages: `FinalReviewLoading`, `FinalReviewDetail`. Edge functions: `ts-final-review`, `ts-packet-generate` (consolidated).
6. **3.7 Watchdogs + cleanup + scheduled pulls.** Edge functions: three crons. `ts-cron-reeval-watchdog` (new) included.
7. **3.8 Notifications.** Edge function: `ts-send-pull-notification` standalone. Phase 5 will fold it into `notifications-dispatch`.

End of Phase 3 should ship a fully working `/talent-scout` route. Phase 4 (Venue Scout) starts next per CLAUDE.md.
