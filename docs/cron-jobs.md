# Cron jobs

All scheduled jobs run via `pg_cron` inside Supabase (Postgres extension). Schedule definitions live in migrations; the actual work is done by Edge Functions called via `pg_net` (`net.http_post`). Cron callers send the `x-internal-secret` header so the called functions accept them via the self-invocation auth path (see `docs/auth-model.md`).

## Talent Scout

### `ts-cron-scheduled-pulls` (daily 8am ET)
Fires `ts-pull-candidates(role_id, triggered_by='scheduled')` for every role where:
- `status = 'open'`
- `auto_pull_schedule != 'off'`
- enough time has passed since last pull per the schedule (`daily`, `every_3_days`, `weekly`)

### `ts-cron-pull-watchdog` (every 10 min)
Recovers stalled `ts_pull_rounds` rows. A round is stalled if `status = 'running'` and `updated_at` is more than ~5 minutes old (the chunked pipeline updates the row every batch). Sets status to `stalled`, surfaces in PullDetail UI for manual retry. Does NOT auto-restart pulls.

### `ts-cron-reeval-watchdog` (every 10 min)
Recovers stalled bulk re-evals. Reads `ts_roles.reeval_status = 'running'` AND `reeval_last_progress_at` more than ~5 minutes old. Sets `reeval_status = 'failed'` and surfaces in the role UI for manual retry. The legacy `ts_pull_rounds.reeval_last_progress_at` column from Phase 3.2 is unused here — bulk re-eval state is role-scoped (`ts_roles.reeval_*`), not round-scoped.

### `ts-cron-storage-cleanup` (daily 9am UTC)
Two passes:
1. Purge `ts_candidate_attachments` files for closed-role candidates older than 90 days, and rejected-candidate files older than 30 days. Deletes both the Storage object and the row.
2. Hard-delete `ts_roles` where `closed_at > 60 days ago`. CASCADE drops `ts_pull_rounds`, `ts_candidates`, `ts_evaluations`, `ts_final_reviews`. (Storage cleanup runs first so cascaded candidate rows don't leave orphan files.)

## Cross-cutting (planned, not yet implemented)

### `monthly-spend-reset` (1st of each calendar month, 00:00 UTC)
Resets `global_settings.anthropic_spend_current_month_usd` to 0 and `cap_alert_sent_this_month` to false. Without this, the cap alert never re-arms after the first month it triggers.

## Conventions

- Cron jobs that call Edge Functions send `x-internal-secret: ${INTERNAL_API_SECRET}`. Without it, the function rejects them at `requireInternalOrUserAuth`.
- Watchdog jobs detect-and-flag, never auto-restart. Stalled work surfaces in the UI for the user to decide. Auto-restart loops can mask deeper failures (rate limits, prompt errors, etc.).
- Schedule via migration, not the Supabase Dashboard cron UI — keeps schedules in version control.
- Call Edge Functions from cron via `net.http_post`, not direct SQL — keeps auth, logging, and retry logic in one place (the function).
