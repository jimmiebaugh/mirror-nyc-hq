---
description: Run a read-only production health check across HQ's live systems and report drift, errors, or stalled jobs.
---

Run a production health check across HQ's live systems. Surface drift, errors, or stalled jobs. Read-only — don't fix anything, just report.

## Checks

### 1. Migration drift
```
supabase migration list --linked
```
Local must equal Remote across every entry.

### 2. Cron schedules
```sql
SELECT jobname, schedule FROM cron.job ORDER BY jobname;
```
- All 6 cron jobs present? (`ts-cron-scheduled-pulls`, `ts-cron-pull-watchdog`, `ts-cron-reeval-watchdog`, `ts-cron-final-review-watchdog`, `ts-cron-storage-cleanup`, `ts-cron-monthly-spend-reset`)
- Cadences match `docs/cron-jobs.md`?

### 3. Recent cron run health (last 24h)
```sql
SELECT j.jobname, jrd.status, count(*) AS n,
       max(jrd.start_time) AS most_recent
  FROM cron.job_run_details jrd
  JOIN cron.job j ON j.jobid = jrd.jobid
 WHERE jrd.start_time > now() - interval '24 hours'
 GROUP BY j.jobname, jrd.status
 ORDER BY j.jobname, jrd.status;
```
- Any `failed` rows in the last 24h?
- Any cron that hasn't fired when expected (e.g. watchdog cadence is every 2-5 min, so 12+ runs/hour is healthy)?

### 4. Recent edge function HTTP responses (last 24h)
```sql
SELECT status_code, count(*) AS n,
       max(created) AS most_recent
  FROM net._http_response
 WHERE created > now() - interval '24 hours'
 GROUP BY status_code
 ORDER BY status_code;
```
- Any 4xx or 5xx clusters?
- If 401s appear: check `vault.secrets` for INTERNAL_API_SECRET drift (rotation mismatch between Supabase function env and Vault).

### 5. Stalled work (anything the watchdogs should have caught but didn't)
```sql
SELECT 'pull_round' AS kind, id::text, status::text,
       started_at, updated_at
  FROM ts_pull_rounds WHERE status = 'running'
UNION ALL
SELECT 'role_reeval', id::text, reeval_status::text,
       reeval_started_at, reeval_last_progress_at
  FROM ts_roles WHERE reeval_status = 'running'
UNION ALL
SELECT 'final_review', id::text, status::text,
       generated_at, generated_at
  FROM ts_final_reviews WHERE status = 'generating'
ORDER BY started_at;
```
Flag anything older than its watchdog threshold (pull 5min, reeval 30min, final-review 20min) that the watchdog hasn't flipped to `failed`.

### 6. Anthropic spend tracker
```sql
SELECT anthropic_spend_current_month_usd,
       anthropic_spend_cap_monthly_usd,
       cap_alert_sent_this_month
  FROM global_settings;
```
- Spend tracking incrementing as expected?
- Cap set to a meaningful value?

### 7. Vault state
```sql
SELECT name, created_at FROM vault.secrets ORDER BY name;
```
- `INTERNAL_API_SECRET` present?
- Length sanity check: `SELECT length(decrypted_secret) FROM vault.decrypted_secrets WHERE name = 'INTERNAL_API_SECRET'` — should be 64 hex chars.

### 8. Storage buckets
```sql
SELECT name, public, created_at FROM storage.buckets ORDER BY name;
```
- `candidate_attachments`, `packets`, `briefs`, `sourcing_sheets`, `venue_photos`, `profile_avatars` all present?
- All `public = false`?

## Output format

Per check: ✅ / ⚠ / ❌ with one-line summary. Don't paste raw SQL output unless something's wrong; condense to actionable signal. End with a one-line health summary.
