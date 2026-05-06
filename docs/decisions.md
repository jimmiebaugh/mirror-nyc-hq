# Decisions

Architectural decisions worth preserving with their rationale. Newest at the top within each section.

## Talent Scout port (Phase 3) — locked Q1–Q6

Resolutions to the six open questions in `docs/talent-scout-port-plan.md` § 8.

### Q1: re-eval history → keep history

`ts_evaluations` is a separate history table. Every single re-eval (CandidateDetail's button, row-level Re-evaluate selected bulk action) INSERTs a new row, preserving prior scores for audit. The latest row's fields are mirrored onto `ts_candidates` for fast list queries.

**Bulk re-evaluate** (role-scoped or round-scoped "Re-Evaluate Pool") is the one exception: it implies the prompt or scorecard changed, so prior evals are no longer meaningful. The `overwrite_history: true` flag on `ts-evaluate-candidate` deletes prior `ts_evaluations` rows for the candidate before inserting.

**Why both modes**: a single re-eval is usually the user fixing one candidate's classification or pulling new info — history matters. A bulk re-eval is the user changing the scoring rules — old scores aren't comparable, keeping them around just clutters the audit trail.

### Q2: pending-candidate parking spot → jsonb on the round

`ts_pull_rounds.pending_candidates` (jsonb, default `[]`) holds Gmail message IDs the chunked pipeline batches in groups of 8 across self-invocations. Matches the source pipeline's existing shape; no separate table.

### Q3: hiring manager identity → block on first sign-in

`ts_roles.hiring_manager_id` FKs to `users`. New-role wizard looks up by email at submit. If no `users` row exists yet, role creation is blocked: "Hiring manager must sign in to HQ at least once first." No auto-creating users from email strings.

### Q4: notification consolidation → standalone first, fold later

Phase 3.8 ships `ts-send-pull-notification` standalone so Talent Scout doesn't block on Phase 5 work. Phase 5 folds it into `notifications-dispatch`.

### Q5: two packet generators → read both, then consolidate

Before writing `ts-packet-generate` in Phase 3.6, do a 30-min read of source's `generate-packet` (832 lines) vs `generate-final-review-packet` (767 lines) to confirm whether they're two distinct flows (candidate-pool packet vs final-review packet) or one is dead code. Consolidate based on that read.

### Q6: anthropic-spend-tracker shape → explicit `callClaude(app, ...)` wrapper

Single helper in `supabase/functions/_shared/anthropic.ts`. Selects key from `ANTHROPIC_API_KEY_TS` / `_VS` / `_HQ` based on the `app` argument. After each successful call, computes cost from the response usage block (incl. prompt-cache discounts) and increments `global_settings.anthropic_spend_current_month_usd`. Emails the admin once per cap crossing, gated by `cap_alert_sent_this_month`. **Does NOT refuse calls when over cap** — graceful degradation, not a hard failure.

## Phase 3.4 (pull pipeline)

### Edge Function self-invocation auth

The Supabase gateway on this project rejects the service-role bearer token at its `verify_jwt` layer (likely a new-format-key vs legacy-JWT mismatch). Solved with per-function `verify_jwt = false` in `supabase/config.toml` + an `INTERNAL_API_SECRET` shared secret + auth enforcement in `_shared/internalAuth.ts` (three accept-paths: internal-secret header, service-role bearer match, valid user JWT). See `docs/auth-model.md` for the full pattern.

Any future self-invoking function uses the same pattern; non-self-invoking functions stay on default `verify_jwt = true`.

### Realtime publication

`supabase_realtime` publication on this project starts empty. `ts_pull_rounds` was added to it via migration with `REPLICA IDENTITY FULL` so PullDetail's `postgres_changes` UPDATE subscription receives the full new row. Any future table the UI subscribes to needs the same.

### All attachments to Storage (drift from source)

Source repo kept small attachments in Gmail and let the dashboard fetch them on demand via a `gmail-attachment` Edge Function. HQ persists every attachment to the `candidate_attachments` bucket regardless of size. Slightly more Storage cost; much simpler download path (`supabase.storage.createSignedUrl`); no separate Edge Function for candidate-detail attachment viewing.

### `ts_pull_rounds` operational columns

`candidates_found`, `processed_count`, `attempt`, `round_number` added so progress and round labels work without joining `ts_candidates` per render. Source's `step_progress` jsonb / `current_step` / `error_log` were dropped — simpler `processed_count / candidates_found` is enough; richer progress UI can be added back later if needed.

## Phase 3.5 (candidate detail + re-eval)

### Re-eval history retention with one bulk-overwrite escape hatch

See Q1 above. Implementation note: the candidate-detail UI shows only the latest fields (mirrored onto `ts_candidates`); history accumulates server-side without a UI surface yet. Future "score history" timeline page can read from `ts_evaluations` when it's needed.

### `promote` → `interview` enum rename

Original schema used `promote` as the "advance" status. Renamed to `interview` in Phase 3.5 — concrete next-stage action that maps to actual hiring workflow language. `ts_candidate_status` is now `(consider, interview, reject, fast_track, auto_rejected)`. Migration verified zero rows used `promote` before renaming.

### Status priority is the primary sort everywhere

`CandidateTable` sorts by status bucket first (Interview → Fast-Track → Consider in active tier; Rejected → Auto-Rejected in collapsible rejected tier), then by user-selectable column. Buckets never interleave regardless of column or direction. The active/rejected divider is collapsible inline, not a separate table.

### Bulk re-eval split: role-scoped uses `ts-bulk-reevaluate`, round-scoped fans out

`ts-bulk-reevaluate` (chunked self-invoke, `verify_jwt = false`) operates on the role's master pool with optional `status_filter`. PullDetail's "Re-Evaluate Pool" is round-scoped and skips the dedicated function — instead, it fans out parallel `ts-evaluate-candidate` calls (concurrency=6) with `overwrite_history: true` from the browser. Floating bottom-right widget shows progress; cancellable mid-run.

### Round-scoped state on `ts_pull_rounds`, role-scoped state on `ts_roles`

Source repo put bulk-reeval state on `pull_rounds`. HQ moved to role-scoped: `reeval_status` / `reeval_total` / `reeval_processed` / `reeval_failed` / `reeval_started_at` / `reeval_completed_at` / `reeval_last_progress_at` columns live on `ts_roles`. The legacy `ts_pull_rounds.reeval_last_progress_at` from Phase 3.2 is dead (drop in a future cleanup migration).

### Status dropdown writes are awaited before parent refetch

`StatusDropdown.onValueChange` awaits the DB UPDATE before calling its `onChange` callback (which triggers parent reload). Calling `onChange` first races the write and leaves the displayed value one click behind. **Future inline-mutation components in HQ follow the same order.**

## Phase 2 (schema + auth)

### `handle_new_user` Postgres trigger replaces `auth-on-signup` Edge Function

Original spec called for an `auth-on-signup` Edge Function. Implemented as a Postgres trigger on `auth.users` instead, running with service-role privileges. Simpler, atomic with the auth.users insert, no cold-start latency. The Edge Function name is reserved in case we need extra signup-time work later (e.g. provisioning Drive folders); for now it doesn't exist.

### Project security defaults: Auto-expose OFF, Auto-RLS ON

Every new table requires explicit `GRANT` to `authenticated` and `service_role`. Forces every new table to be reviewed for which roles can hit the Data API at all, separate from RLS row-level policy. See `docs/conventions.md`.

## Open

Decisions still up in the air; revisit when the relevant phase starts.

- **Project status enum trim.** Current 14 values may consolidate. Defer until Phase 5 polish.
- **`venue_types` lookup values.** Jimmie provides before Venue Scout build (Phase 4).
- **Talent Scout data extraction (Phase 6.2).** Plan: re-create active roles via Gmail re-pull, preserve closed roles as packet PDF archives. If Phase 6 inventory turns up data that doesn't fit, revisit then.
