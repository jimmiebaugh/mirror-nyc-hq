# Next Steps

Ordered most-immediate first. On `main`. Working tree clean. Phase 3.7 shipped.

## 1. Cut the Phase 3.8 branch

```
git checkout -b phase-3-8-cron-watchdogs
```

Per the deploy policy: no commits / no origin pushes without `[skip netlify]` in HEAD. Squash-merge to main is the single Netlify-deploy event for the phase.

## 2. Phase 3.8 scope (cron + watchdogs)

Per `docs/roadmap.md` 3.8 + 3.9. Suggested ordering:

### 2a. `pg_cron` enable + scheduled-pulls cron
- Migration: ensure `pg_cron` extension is enabled in remote.
- `ts-cron-scheduled-pulls`: reads `ts_roles.auto_pull_schedule` (already-existing column), invokes `ts-pull-candidates` for any role whose schedule fires now. Likely 15-min granularity.
- Schedule via `cron.schedule` in a migration, not in code.

### 2b. Pull / re-eval / final-review watchdogs
- `ts-cron-pull-watchdog`: detects `ts_pull_rounds` rows in `running` for > N minutes with no `processed_count` heartbeat → flip status to `stalled`. **No auto-restart.**
- `ts-cron-reeval-watchdog`: same pattern for `ts_roles.reeval_status='running'` with no `reeval_last_progress_at` heartbeat → flip to `failed`.
- `ts-cron-final-review-watchdog`: same for `ts_final_reviews` stuck in `generating`.
- Detect-and-flag only. Restarts are a manual decision.

### 2c. Storage-cleanup cron
- `ts-cron-storage-cleanup`: daily purge per the schema-doc rule (closed-role candidate files > 90 days, rejected-candidate files > 30 days). Drop both Storage objects and `ts_candidate_attachments` rows.

### 2d. Spend reset cron + cap-alert email path
- `monthly-spend-reset`: 1st-of-month cron. Resets `global_settings.anthropic_spend_current_month_usd` to 0 and `cap_alert_sent_this_month` to false.
- Wire real email delivery on the `callClaude` cap alert. Currently a console.log stub in `_shared/anthropic.ts`. Use the same `gmailServiceAccount.ts` send path that packets already use.

### 2e. Cleanup queued behind 3.8
- Drop `ts_pull_rounds.reeval_last_progress_at` (dead since Phase 3.5).
- Verify `ts-final-review-packet` end-to-end after the WORKER_RESOURCE_LIMIT fix, then flip `PACKET_FEATURE_ENABLED` to `true` in `PullDetail.tsx` and `FinalReviewDetail.tsx`.

## 3. Pre-merge checklist (when 3.8 is done)

Same as 3.7:
- `npx tsc --noEmit` clean
- `npm run build` clean
- `supabase migration list --linked` (Local = Remote across the board)
- All edge functions deployed at latest
- Real-cron test: trigger a scheduled pull manually, watch the watchdog detect a fake stall
- `CHECKPOINT.md` updated reflecting Phase 3.8 going live

## 4. Phase 3.9 (after 3.8)

`ts-send-pull-notification` standalone. Real-email packet path verification. Notification UI (in-app bell) deferred to Phase 5.

## Gotchas to carry forward

- `[skip netlify]` MUST be on the HEAD commit at push time (Netlify checks the latest commit's message). Empty marker commit + push is the safe pattern.
- Don't pipe `supabase gen types --linked` directly into `src/integrations/supabase/types.ts`. Use `/tmp` + `test -s` + `mv`.
- Local dev runs at `http://127.0.0.1:8080/`, not `localhost:8080`.
- Edge function deploys + DB migrations are out-of-band — fine during feature work, no Netlify cost.
