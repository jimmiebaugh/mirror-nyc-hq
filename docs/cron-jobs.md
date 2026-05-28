# Cron jobs

All scheduled jobs run via `pg_cron` inside Supabase (Postgres extension). Schedule definitions live in migrations; the actual work is done by Edge Functions called via `pg_net` (`net.http_post`). Cron callers send the `x-internal-secret` header so the called functions accept them via the self-invocation auth path (see `docs/auth-model.md`).

Phase 3.8 enables `pg_cron` + `pg_net` and schedules every job below in `20260508120000_phase_3_8_cron_extensions_and_schedules.sql`. Schedules read two database GUCs at fire time:

- `app.supabase_url`: `https://amipjjmphblfxpghjnel.supabase.co`
- `app.internal_api_secret`: same value as the `INTERNAL_API_SECRET` edge-function secret

Set them once via the Supabase SQL editor:

```sql
ALTER DATABASE postgres SET app.supabase_url        = 'https://amipjjmphblfxpghjnel.supabase.co';
ALTER DATABASE postgres SET app.internal_api_secret = '<the secret>';
```

Without the GUCs, the cron job rows still exist but every fire logs a warning and no-ops (the helper bails before calling `net.http_post`).

## Talent Scout

### `ts-cron-scheduled-pulls` (12:00 UTC daily)
Fires `ts-pull-candidates(role_id, triggered_by='scheduled')` for every role where `status='open'` and `auto_pull_schedule != 'off'` if enough time has passed since the role's most recent pull (`daily` ≥ 22h, `every_3_days` ≥ 70h, `weekly` ≥ 166h). 4-hour grace per interval avoids skip-day drift if cron fires a few minutes late. Skips roles that already have a pull in `running` status. 12:00 UTC = 8am ET; accepts EDT/EST drift since this is internal hiring tooling, not customer-facing.

**Weekly Monday anchoring (Phase 5.13.4):** `weekly` roles get an additional day-of-week gate before the grace-window check. If `getUTCDay() !== 1` (not Monday UTC), the role is skipped immediately with `reason: "not Monday"`. Since the cron fires at 12:00 UTC and Monday 8am ET = Monday 12:00 UTC, this pins weekly pulls to Monday 8am ET. The 166h grace window remains as a double-fire guard. `daily` and `every_3_days` schedules are unaffected.

### `ts-cron-pull-watchdog` (every 2 min, Phase 3.11.1 update)
Detects stalled `ts_pull_rounds` and flips `status='running'` rows whose `updated_at` is older than 5 minutes to `status='failed'`. The chunked pipeline updates the row at every per-candidate completion (writes to `processed_count + pending_candidates`, the `updated_at_auto` trigger bumps `updated_at`), so `updated_at` = "last candidate completed at". A single candidate hanging >5 min is always a stall; heartbeats fire per candidate, not per pool, so total pool size doesn't legitimately push the threshold up. Detect-and-flag only; surfaces in PullDetail UI for manual retry. 2-min cadence + 5-min threshold lands detection within 5-7 min of stall onset.

### `ts-cron-reeval-watchdog` (every 5 min)
Detects stalled bulk re-evals. Reads `ts_roles.reeval_status='running'` AND `reeval_last_progress_at` older than 30 minutes; flips `reeval_status='failed'` and surfaces in the role UI for manual retry. The legacy `ts_pull_rounds.reeval_last_progress_at` was dropped in Phase 3.8; bulk re-eval state is role-scoped (`ts_roles.reeval_*`) only.

### `ts-cron-final-review-watchdog` (every 5 min)
Detects stalled `ts_final_reviews` rows in `status='generating'` whose `generated_at` is older than 20 minutes. No separate heartbeat column on this table; `ts-final-review` is one Anthropic call wrapped in `EdgeRuntime.waitUntil`, no chunked progress. 20 minutes is well past the typical wall-clock for the HARD_CAP=50 candidate compare.

### `ts-cron-storage-cleanup` (03:00 UTC daily)
Three passes:
1. `ts_candidate_attachments` for candidates with `status='reject'` whose `created_at` is older than 30 days. Storage object delete then row delete.
2. `ts_candidate_attachments` for candidates whose parent role is `status='closed'` AND `closed_at` is older than 90 days. Same delete order.
3. Hard-delete `ts_roles` where `status='closed'` AND `closed_at` is older than 60 days. Looks up attachment paths via the role → candidates join FIRST so Storage objects clear before the cascade wipes the rows. CASCADE drops `ts_pull_rounds`, `ts_candidates`, `ts_evaluations`, `ts_final_reviews`, and remaining `ts_candidate_attachments`.

Pass order matters: pass 1 + 2 thin out attachments inside roles that pass 3 won't kill yet (still inside the 60-day window). Pass 3's pre-cascade Storage delete prevents orphan files for the roles that are about to disappear.

Cron-only; no UI affordance for manual triggering. The conservative retention windows (30/90/60d) catch garbage on the daily cadence without ever needing intervention.

### `ts-cron-monthly-spend-reset` (1st of each month, 00:01 UTC)
Resets `global_settings.anthropic_spend_current_month_usd` to 0 and `cap_alert_sent_this_month` to false. Without this, the cap alert never re-arms after the first month it fires.

**Phase 5.15:** also prunes `public.anthropic_call_log` rows older than 12 months. Prune runs AFTER the global_settings reset, so a prune failure (RLS gotcha, network blip) cannot block the cap-alert re-arm; failures warn-log and the next month's run catches up. Response summary surfaces `call_log_pruned_count` + `call_log_prune_cutoff` for audit.

## HQ Core

### `hq-cron-deliverable-due-3d` (13:00 UTC daily, Phase 5.5)
Daily 09:00 ET fire. Queries `deliverables WHERE due_date = CURRENT_DATE + 3 AND status NOT IN ('Complete', 'Skipped')`. Per matched deliverable, looks up `project_account_managers` for the deliverable's project and POSTs to `notifications-dispatch` with `event_type='deliverable_due_3d'`. Recipients fall through the user's `user_notification_preferences` + global kill-switch checks at the dispatch layer. No-op rows produce no dispatch calls.

### `hq-cron-task-due-today` (12:00 UTC daily, Phase 5.5)
Daily 08:00 ET fire. Queries `tasks WHERE due_date = CURRENT_DATE AND status <> 'Done' AND assignee_id IS NOT NULL`. POSTs to `notifications-dispatch` per task with the single assignee as recipient (`event_type='task_due_today'`).

### `hq-cron-event-date-today` (11:00 UTC daily, Phase 5.5)
Daily 07:00 ET fire. Three parallel queries on `projects` for rows where `install_dates_start`, `live_dates_start`, or `removal_dates_start` equals today. Recipients per project = union of `project_account_managers` + `project_designers` (deduped). POSTs to `notifications-dispatch` per matched project with `event_type='event_date_today'` and `extra.kind` set to `'Install' | 'Live' | 'Removal'` for the body template.

## Cross-cutting

### `ts-send-pull-notification` (Phase 3.9, not cron)
Not a cron job; listed here for cross-cutting context. Called by `ts-pull-candidates` on round completion via fire-and-forget self-invoke. Emails the role's hiring manager a summary of what landed (total + per-status counts + deep link to PullDetail). Folds into `notifications-dispatch` in Phase 5 alongside in-app bell notifications.

## Conventions

- Cron jobs that call Edge Functions send `x-internal-secret: ${INTERNAL_API_SECRET}` via the `public.invoke_edge_function(fn_name, body)` SECURITY DEFINER helper. Without it, the function rejects them at `requireInternalOrUserAuth`.
- Watchdog jobs detect-and-flag, never auto-restart. Stalled work surfaces in the UI for the user to decide. Auto-restart loops can mask deeper failures (rate limits, prompt errors, etc.).
- Schedule via migration, not the Supabase Dashboard cron UI; keeps schedules in version control.
- Call Edge Functions from cron via `net.http_post`, not direct SQL; keeps auth, logging, and retry logic in one place (the function).
