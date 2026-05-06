# Edge Functions

Live in `supabase/functions/`. Each function is a directory with `index.ts`. Shared utilities live in `supabase/functions/_shared/`. Per-function settings (especially `verify_jwt`) are in `supabase/config.toml`.

Deploy via `supabase functions deploy <name>`. Don't skip JWT-verification settings — see `docs/auth-model.md` for the self-invocation pattern.

## Talent Scout

### `ts-pull-candidates(role_id, triggered_by)`
Gmail search → attachment download → PDF text extraction → link parsing → portfolio detection → Anthropic scoring. Chunked self-invoking pipeline (`BATCH_SIZE=8`) using `ts_pull_rounds.pending_candidates`. Writes one row per candidate to `ts_candidates` and one row per evaluation to `ts_evaluations`. Persists every attachment to the `candidate_attachments` bucket regardless of size (drift from source — see `docs/decisions.md`). `verify_jwt = false`.

### `ts-evaluate-candidate(candidate_id, overwrite_history?)`
Single-candidate eval/re-eval. Inserts a row into `ts_evaluations` and mirrors the latest fields onto `ts_candidates`. `overwrite_history: true` deletes prior `ts_evaluations` rows for the candidate before inserting — used by bulk re-eval (round-scoped or role-scoped) since prompt/scorecard changes invalidate prior evals.

### `ts-bulk-reevaluate(role_id, status_filter?)`
Re-eval the role's master pool. Chunked self-invoke. Updates `ts_roles.reeval_*` columns as it progresses; `reeval_last_progress_at` is the heartbeat read by the re-eval watchdog. `verify_jwt = false`.

PullDetail's "Re-Evaluate Pool" (round-scoped) uses a different pattern: parallel fan-out of `ts-evaluate-candidate` calls (concurrency=6) with `overwrite_history: true`, driven from the browser, not this function.

### `ts-generate-scorecard(title, job_description, hiring_priorities)`
Drafts a tiered scorecard via Claude. Called from the new-role wizard's step-3 page. One-shot, user-invoked, default `verify_jwt = true`.

### `ts-final-review(role_id, candidate_count_limit?)` — Phase 3.6
Comparative final review across the master pool. Produces a pool summary + `final_rankings` jsonb, writes to `ts_final_reviews`. Will self-invoke for long runs → `verify_jwt = false`.

### `ts-packet-generate(role_id, pull_round_id?, candidate_count?)` — Phase 3.6
Builds packet PDF and emails to hiring manager. Talks to Google Slides + Drive APIs via the service account (template in `_shared/gmailServiceAccount.ts`). **Q5 reminder**: read source's `generate-packet` (832 lines) vs `generate-final-review-packet` (767 lines) before implementing to confirm whether they're two distinct flows or one is dead code.

### `ts-send-pull-notification(role_id, pull_round_id)` — Phase 3.8
Emails the hiring manager when a pull completes. Standalone in 3.8 to ship Talent Scout cleanly; folds into `notifications-dispatch` in Phase 5.

## Venue Scout — Phase 4

- `vs-parse-brief(file_path)`: parse uploaded brief.
- `vs-research-venues(scout_id)`: AI + web research using `global_settings.venue_research_priority_sites` as soft context.
- `vs-parse-sourcing-sheet(file_path, scout_id)`: parse PDF/XLSX/CSV.
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

Email path is currently a console-log stub; Phase 3.8 wires real notifications.

Use 1-hour prompt caching (`cache_control: { type: 'ephemeral', ttl: '1h' }`) on stable system + role-context blocks. Same cache key per role for the bulk re-eval / final-review hot path.

### `internalAuth.ts` — `requireInternalOrUserAuth(req)`
Three-path auth check for self-invoking Edge Functions. See `docs/auth-model.md` § Edge Function self-invocation auth.

### `gmailServiceAccount.ts`
JWT bearer flow against Google's token endpoint with the requested scope (`gmail.readonly`, `gmail.send`, `drive`, `presentations`). Template for any service-account-authenticated Google API call.

### `parseClaudeJson.ts`
Lifted from the source repo. Strips markdown fences and parses the model's JSON response with a fallback for trailing-comma issues.

## Conventions

- New Edge Functions that self-invoke: add `[functions.<name>] verify_jwt = false` to `supabase/config.toml` AND use `requireInternalOrUserAuth` from `_shared/internalAuth.ts`.
- All outbound email from `jobs@mirrornyc.com` via the service account's `gmail.send` scope, not from individual users.
- Anthropic calls go through `callClaude`, never `fetch('https://api.anthropic.com/...')` directly. Per-app keys + spend tracking + caching all flow from there.
- Use 1-hour prompt caching for the role-context block whenever the same role is being processed N times (initial pull batches, bulk re-eval, final review).
