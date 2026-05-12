# Edge Functions

Live in `supabase/functions/`. Each function is a directory with `index.ts`. Shared utilities live in `supabase/functions/_shared/`. Per-function settings (especially `verify_jwt`) are in `supabase/config.toml`.

Deploy via `supabase functions deploy <name>`. Don't skip JWT-verification settings — see `docs/auth-model.md` for the self-invocation pattern.

## Talent Scout

### `ts-pull-candidates(role_id, triggered_by)`
Gmail search → attachment download → PDF text extraction → link parsing → portfolio detection → Anthropic scoring. Chunked self-invoking pipeline (`BATCH_SIZE=8`) using `ts_pull_rounds.pending_candidates`. Writes one row per candidate to `ts_candidates` and one row per evaluation to `ts_evaluations`. Persists every attachment to the `candidate_attachments` bucket regardless of size (drift from source — see `docs/decisions.md`). `verify_jwt = false`.

**Phase 3.7.7 — referral ingestion.** When the outer Gmail `From:` is `*@mirrornyc.com` (and not `jobs@`), `parseForwardedEmail` walks the body to find the original applicant via `From:` headers and `On <date>... <<email>> wrote:` reply-quote attributions, picking the deepest non-Mirror sender. Handles Gmail forwards, Apple Mail desktop + mobile, and `message/rfc822` forward-as-attachment. The candidate row gets the original applicant's identity; `is_referral=true` and `referrer_email=<manager>` are set. **Phase 3.7.8.16:** `extractManagerNote` walks every `---------- Forwarded message ---------` / `Begin forwarded message:` segment, captures every `@mirrornyc.com` sender's commentary (Mirror sigs stripped), and writes it to `ts_candidates.internal_notes`. The note is also folded into the FIRST evaluation via the `HIRING MANAGER NOTES:` block prepended to the candidate bundle.

### `ts-evaluate-candidate(candidate_id, overwrite_history?)`
Single-candidate eval/re-eval. Inserts a row into `ts_evaluations` and mirrors the latest fields onto `ts_candidates`. `overwrite_history: true` deletes prior `ts_evaluations` rows for the candidate before inserting — used by bulk re-eval (round-scoped or role-scoped) since prompt/scorecard changes invalidate prior evals.

### `ts-bulk-reevaluate(role_id, status_filter?)`
Re-eval the role's master pool. Chunked self-invoke. Updates `ts_roles.reeval_*` columns as it progresses; `reeval_last_progress_at` is the heartbeat read by the re-eval watchdog. `verify_jwt = false`.

PullDetail's "Re-Evaluate Pool" (round-scoped) uses a different pattern: parallel fan-out of `ts-evaluate-candidate` calls (concurrency=6) with `overwrite_history: true`, driven from the browser, not this function.

### `ts-generate-scorecard(title, job_description, hiring_priorities)`
Drafts a tiered scorecard via Claude. Called from the new-role wizard's step-3 page. Phase 3.11: each criterion now carries TWO describer fields — `full_points_rubric` (substantive 1-3 sentences for the per-candidate evaluator) and `summary` (≤ 14-word condensed recap for compact UI surfaces). One-shot, user-invoked, default `verify_jwt = true`.

### `ts-refine-scorecard(role_title, jd, hiring_priorities, criteria, ...)` — Phase 3.10
Refinement pass over a user-edited scorecard. Two call sites: the new-role wizard's step-3 page (when scorecard is "dirty since last AI pass") and the Edit Role page's RoleSettings (when scorecard has unrefined edits). Sends the current criteria + role context through Claude with `scorecardRefinementPrompt`, which preserves every concept/principle the user provided and standardizes `name` (short noun phrase), `full_points_rubric` (1-3 sentences of concrete evaluator-facing signals), and `summary` (≤ 14-word recap for compact UI surfaces; Phase 3.11). Two server-side guarantees: (1) **dead-criterion drop** — entries with `weight=0` OR with both `name` and `full_points_rubric` empty/whitespace are filtered before the prompt ever runs; the response includes a `removed_count` so the UI can surface it; (2) **defense-in-depth merge** — `tier`, `weight`, `is_disqualifier`, and `is_manual` are restored from the user's filtered input regardless of model output, so the model can never silently overwrite scoring decisions. Output count = filtered input count. Frontend re-sorts each tier highest-weight first after the refine. One-shot, user-invoked, default `verify_jwt = true`.

### `ts-final-review(role_id, top_n?, triggered_by?)`
Comparative final review across the master pool. Returns `{ final_review_id }` immediately; AI work runs in the background via `EdgeRuntime.waitUntil` and streams progress through `ts_final_reviews.step_progress` (Realtime — FinalReviewLoading subscribes). Produces `final_rankings` jsonb (`[{candidate_id, final_rank, final_tier, rationale, recruiter_note, final_overview}]`) + `pool_summary` text. Min 3 candidates; HARD_CAP=50 by total_score for context-window safety. Two-attempt JSON parse retry. Hyphen-tolerant candidate_id matching. Uses `callClaude('talent_scout', ...)`. `verify_jwt = false`.

### `ts-packet-generate(pull_round_id, top_n?, include_fast_track?)`
Round-scoped candidate review packet. Renders cover (Pulled / In Pool / Auto-Rejected / Fast-Track stats) + NYC-only top-15 comparison matrix + Fast-Track / Borderline / Other Recommended writeup pages + per-candidate title + email + attachment merge. Uploads merged PDF to the `packets` Storage bucket, updates `ts_pull_rounds.packet_*`, emails the role's hiring manager from `jobs@mirrornyc.com`. Tier subtotals render `—` when `score_breakdown` is empty (Phase 3.6 Q4). `verify_jwt = false`.

### `ts-final-review-packet(final_review_id, top_n?, include_fast_track?, include_all?)`
Review-scoped packet for a completed `ts_final_reviews` row. Renders cover (Pool Size / Top Recs / Strong / Backup) + Pool Summary + full Rankings table + Top / Strong / Backup writeup pages with Not Recommended footnote + per-candidate pages. Uploads to `packets`, updates `ts_final_reviews.packet_*`, emails the hiring manager. Defaults `include_all=true` from the FinalReviewDetail UI; FinalReviewDetail's "Include Fast-Track pages" toggle controls `include_fast_track`. `verify_jwt = false`.

#### Shared infrastructure: `_shared/packetRender.ts`
~50% of source's two packet generators (CloudConvert HTML→PDF / DOCX→PDF, BASE_CSS, htmlDoc, MIRROR_LOGO_SVG, candidate title + email + packet divider renderers, Storage attachment fetcher, pdf-lib upload helper, Gmail send-with-attachment helper) lives here. HQ-specific: attachment bytes come from the `candidate_attachments` Storage bucket (Phase 3.4 persists everything on initial pull) — no Gmail re-fetch at packet time. Email send uses the service account's `gmail.send` scope (added to `gmailServiceAccount.ts` SCOPES list in 3.6).

External dependency: `CLOUDCONVERT_API_KEY` Supabase secret (paid service). Packet volume is low (5-20/month) so the spend is negligible.

### `ts-send-pull-notification(role_id, pull_round_id)` — Phase 3.9
Emails the role's hiring manager when a pull completes. Tallies `ts_candidates` for the round (`fast_track`, `interview`, `consider`, `reject`), composes a plain-text body via `_shared/sendEmail.ts` and sends via the service account's `gmail.send` scope. Called fire-and-forget from `ts-pull-candidates` at every `status='complete'` write (chunked finalize, dedupe-clears-pending-to-zero, and zero-results paths). Failures are logged, not surfaced — a notification outage shouldn't fail the upstream round. Standalone in 3.9; folds into `notifications-dispatch` in Phase 5 alongside in-app bell notifications. `verify_jwt = false`.

## Talent Scout cron + watchdog (Phase 3.8)

All six are scheduled via `pg_cron` in `20260508120000_phase_3_8_cron_extensions_and_schedules.sql`. Each accepts an empty body and is invoked by `public.invoke_edge_function(fn_name, body)` (SECURITY DEFINER, reads `app.supabase_url` + `app.internal_api_secret` GUCs). All use `requireInternalOrUserAuth`. Cadences are in `docs/cron-jobs.md`.

### `ts-cron-scheduled-pulls`
Walks every `ts_roles.status='open'` AND `auto_pull_schedule != 'off'` row, computes hours-since-last-pull from `max(ts_pull_rounds.started_at)`, and self-invokes `ts-pull-candidates` for any role past its interval. Skips roles with an in-flight `running` round. Per-role failure logs but doesn't abort the loop.

### `ts-cron-pull-watchdog`
5-minute stall threshold (Phase 3.11.1, was 60). Reads `ts_pull_rounds` rows with `status='running'` AND `updated_at < now()-5m`, updates to `status='failed'` with a CAS guard (`.eq('status','running')`) so a late completion isn't overwritten. The pipeline's per-candidate row update means `updated_at` = "last candidate completed at"; a single candidate hanging >5 min is always a stall regardless of total pool size. Cron cadence bumped from every 5 min to every 2 min so detection lands within 5-7 min of stall onset.

### `ts-cron-reeval-watchdog`
30-minute stall threshold. Reads `ts_roles` rows with `reeval_status='running'` AND `reeval_last_progress_at < now()-30m`, updates to `reeval_status='failed'`.

### `ts-cron-final-review-watchdog`
20-minute stall threshold. Reads `ts_final_reviews` rows with `status='generating'` AND `generated_at < now()-20m`, updates to `status='failed'` with an `error_message` explaining the watchdog flag.

### `ts-cron-storage-cleanup`
Three-pass cleanup per `docs/cron-jobs.md`. Uses `STORAGE_BUCKET` from `_shared/attachmentStorage.ts`. Storage `.remove()` errors log and continue — a failed Storage delete leaves an orphan file but never blocks the row delete. Cron-only; no UI trigger.

### `ts-cron-monthly-spend-reset`
Resets `global_settings.anthropic_spend_current_month_usd=0` and `cap_alert_sent_this_month=false`. Logs the previous spend value for audit.

## Venue Scout — Phase 4

- `vs-parse-brief({ scout_id, storage_path })` (Phase 4.3-port rebuild): downloads a brief PDF from the `briefs` bucket and parses it via `callClaude('venue_scout', ...)` with a forced `submit_brief` tool call. Returns `{ parsed_fields }` for the Brief page to merge into form state. User-invoked synchronous, `verify_jwt = true`. Replaces the failed-attempt vs-parse-brief in the deployed-function slot; no separate cutover deletion needed.
- `vs-parse-sheet({ scout_id, storage_path })` (Phase 4.4-port rebuild): parse uploaded venue sourcing sheet (XLSX / CSV / PDF) from the `sourcing_sheets` bucket. XLSX / CSV parsed via `npm:xlsx@0.18.5` + a `pick()` fuzzy header matcher. PDF parsing is intentionally naive (returns 0 venues; frontend routes to empty-sheet error). INSERTs matched rows into `vs_candidate_venues` with `source: "sheet"`. Updates `vs_scouts.sheet_storage_path`. User-invoked synchronous, `verify_jwt = true`. Replaces the failed-attempt vs-parse-sheet in the deployed-function slot.
- `vs-research-venues(scout_id)`: AI + web research using `global_settings.venue_research_priority_sites` as soft context.
- `vs-research-single-venue(candidate_venue_id)`: research a manual venue, triggers HQ Venues backfill via the `vs_candidate_venues_shortlist_sync` trigger.
- `vs-generate-deck(scout_id)`: copy Slides template, populate, save to project's Drive folder or `default_drive_folder_for_standalone_vs_decks`.

## Cross-cutting

### `notifications-dispatch(event_type, entity_id, recipient_user_ids)` — Phase 5
Insert `notifications` rows + send email via Gmail API service account (`jobs@mirrornyc.com`). Phase 3.8's `ts-send-pull-notification` folds into this here.

### `auth-on-signup` (deprecated — use `handle_new_user` trigger)
The original spec mentioned an `auth-on-signup` Edge Function. Phase 2 implemented this as a Postgres trigger on `auth.users` instead (`handle_new_user`), running with service-role privileges. No Edge Function needed.

## Shared modules (`_shared/`)

### `anthropic.ts` — `callClaude(app, messages, options)`
Wraps the raw fetch to `api.anthropic.com`. `app` is `'talent_scout' | 'venue_scout' | 'hq'` and selects the per-app secret (`ANTHROPIC_API_KEY_TS` / `_VS` / `_HQ`). After each successful call:
1. Computes cost from the response usage block (incl. cache-read/write discounts).
2. Increments `global_settings.anthropic_spend_current_month_usd`.
3. Emails the admin once per cap crossing (gated by `cap_alert_sent_this_month`).
4. **Does NOT refuse calls when over cap** — graceful degradation, not a hard failure.

Phase 3.8 wires the real cap-alert email path via `_shared/sendEmail.ts`. Recipient lookup: first `users` row with `permission_role='admin'` (oldest by `created_at`), fallback `jobs@mirrornyc.com`. The cap-alert is gated by `cap_alert_sent_this_month` so it fires once per cap crossing; `ts-cron-monthly-spend-reset` re-arms it on the 1st.

Use 1-hour prompt caching (`cache_control: { type: 'ephemeral', ttl: '1h' }`) on stable system + role-context blocks. Same cache key per role for the bulk re-eval / final-review hot path.

### `internalAuth.ts` — `requireInternalOrUserAuth(req)`
Three-path auth check for self-invoking Edge Functions. See `docs/auth-model.md` § Edge Function self-invocation auth.

### `gmailServiceAccount.ts`
JWT bearer flow against Google's token endpoint with the requested scope (`gmail.readonly`, `gmail.send`, `drive`, `presentations`). Template for any service-account-authenticated Google API call.

### `sendEmail.ts` — Phase 3.8
Generic Gmail send helper for transactional notifications outside the packet path. `sendGmail({to, subject, bodyText, bodyHtml?, fromName?})` builds a MIME message (plain or `multipart/alternative`), gets a Gmail token via `gmailServiceAccount.ts`, POSTs to `users/me/messages/send`. Returns `boolean` — never throws. Also exports `getAdminEmail(sb)` which finds the oldest active admin in `public.users`. Used by `_shared/anthropic.ts` (cap alerts) and `ts-send-pull-notification`. The packet-render module keeps its own `sendPacketEmail` since it appends the signed-URL footer.

### `parseClaudeJson.ts`
Lifted from the source repo. Strips markdown fences and parses the model's JSON response with a fallback for trailing-comma issues.

## Conventions

- New Edge Functions that self-invoke: add `[functions.<name>] verify_jwt = false` to `supabase/config.toml` AND use `requireInternalOrUserAuth` from `_shared/internalAuth.ts`.
- All outbound email from `jobs@mirrornyc.com` via the service account's `gmail.send` scope, not from individual users.
- Anthropic calls go through `callClaude`, never `fetch('https://api.anthropic.com/...')` directly. Per-app keys + spend tracking + caching all flow from there.
- Use 1-hour prompt caching for the role-context block whenever the same role is being processed N times (initial pull batches, bulk re-eval, final review).
