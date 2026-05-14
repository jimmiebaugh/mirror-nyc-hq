# Operations

How to run, deploy, and debug the app. Day-to-day commands and troubleshooting.

## Local toolchain

- Node 25.9.0
- Supabase CLI 2.98.1
- psql 18.3
- Git

`npm install` once, then `npm run dev` for the Vite dev server.

## Local dev

```bash
npm run dev          # Vite dev server on localhost:8080 (or whatever Vite picks)
npm run build        # production build to dist/
npm run lint         # eslint
```

The local app talks to the **production** Supabase project; there's no separate local Supabase stack. Jimmie's seeded admin row works for local sign-in. Be deliberate about destructive operations against the DB.

## Supabase

### Migrations

Authoritative schema is the migration set in `supabase/migrations/`. To apply a new migration:

```bash
supabase db push                 # applies any pending local migrations to the linked project
supabase gen types typescript --linked > src/integrations/supabase/types.ts
```

The second command regenerates `src/integrations/supabase/types.ts` so the client gains the new column/table types. Re-run any time the schema changes.

`supabase migration new <name>` to scaffold a new migration file with a timestamp prefix.

**Always include explicit GRANTs** for new tables; auto-expose stays off. See `docs/conventions.md`.

### Edge Functions

```bash
supabase functions deploy <name>           # deploys the function
supabase functions deploy --no-verify-jwt  # rare; use config.toml per-function override instead
supabase secrets set KEY=value             # sets a function-side secret
supabase secrets list
```

Per-function `verify_jwt` is in `supabase/config.toml`, not on the deploy command.

`supabase functions invoke <name> --body '{"...": "..."}'` runs the function locally with the linked project's secrets; handy for one-shot debug.

### Logs

`supabase functions logs <name> --tail` for live tailing. Or via Dashboard → Edge Functions → Logs (better for filtering and timestamps).

### DB connection

Pooler URL for direct psql access (read-only investigations):
```
psql "postgresql://postgres.<ref>:<password>@aws-...pooler.supabase.com:6543/postgres"
```

Service-role connection from edge functions uses `SUPABASE_SERVICE_ROLE_KEY` automatically (set by Supabase runtime). User-context calls from the frontend use the publishable key + the user's JWT.

## Netlify

Auto-deploys on push to `main`. Build status visible in Netlify Dashboard → Deploys. Preview URLs are auto-generated per branch (`https://<branch>--<site>.netlify.app`).

If a deploy fails:
1. Check Netlify Deploys page for the failed build's logs.
2. Common causes:
   - Missing env var (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`) in the Site → Environment settings. Note: `client.ts` carries the same values as a hardcoded fallback (Phase 3.6.18), so a missing env var won't break the app; but if the env var is set to a stale value (e.g. the legacy JWT anon key), Vite inlines that and overrides the fallback. The legacy JWT anon key returns 401 against `/auth/v1`.
   - GitHub deploy key expired (`Host key verification failed` in the prep stage). Fix by re-linking the repo in Netlify Dashboard → Site settings → Build & deploy → Repository.
   - TypeScript errors. Run `npm run build` locally to reproduce.

If sign-in is broken on a deploy that built clean:
1. Open DevTools → Console on the production site, attempt to sign in.
2. If you see `Invalid API key` from a `setSession` or `/auth/v1/token` call, the publishable key in the bundle is wrong or the legacy JWT is being used. Verify with curl:
   ```
   curl -s -o /dev/null -w "%{http_code}\n" \
     -H "apikey: <key>" https://amipjjmphblfxpghjnel.supabase.co/auth/v1/settings
   ```
   New `sb_publishable_*` returns 200; legacy JWT anon key now returns 401.
3. If keys aren't the issue, see Phase 3.6.14 to 3.6.16 commits for the full diagnosis path.

## Service account

Run `tsx scripts/verify-service-account.ts` (or equivalent) any time scopes are changed in the Workspace Admin Console. The script does a per-scope JWT bearer flow and smoke-tests `messages.list` and `files.list`. Reports the exact scope string to add if any check fails.

JSON key lives in `secrets/` (gitignored) and is also set as the `GOOGLE_SERVICE_ACCOUNT_JSON` Supabase secret for the Edge Functions.

## Anthropic spend tracking

`global_settings.anthropic_spend_current_month_usd` is incremented inside `callClaude` after every successful call. Cap is `anthropic_spend_cap_monthly_usd`. When current crosses cap, `cap_alert_sent_this_month` flips true and an admin email goes out (real email delivery via `_shared/sendEmail.ts`, shipped Phase 3.8).

To **reset spend** mid-month (e.g. after fixing a runaway loop):
```sql
update global_settings
set anthropic_spend_current_month_usd = 0,
    cap_alert_sent_this_month = false;
```

Monthly auto-reset cron `ts-cron-monthly-spend-reset` runs on the 1st of every month. See `docs/cron-jobs.md`.

## Common debugging

### "Pull round stuck on running"
Check `ts-cron-pull-watchdog` log for the last run. If it didn't flag the round, look at `processed_count` vs `candidates_found`: a stuck batch usually means `pending_candidates` has IDs that errored. Tail `ts-pull-candidates` logs for that round_id.

### "Bulk re-eval never finishes"
`ts_roles.reeval_last_progress_at` is the heartbeat. If it's older than 30 minutes (the `STALL_MINUTES` constant in `ts-cron-reeval-watchdog/index.ts`), the watchdog should flag it on next run. To force-cancel: `update ts_roles set reeval_status='failed' where id='...'`.

### "Function returns 401 even with service role bearer"
You hit the gateway `verify_jwt` mismatch (see `docs/auth-model.md` § Edge Function self-invocation auth). Either send the `x-internal-secret` header or set `verify_jwt = false` for that function.

### "RLS denies the query I'm sure should pass"
Check the `permission_role` on your `public.users` row, not `auth.users`. New signups land in `auth.users` immediately but `public.users` is populated by the `handle_new_user` trigger; if that trigger ever fails silently (it shouldn't, but), the user has no `permission_role` and every RLS check fails.

### "Realtime subscription fires but new row missing fields"
Table needs `REPLICA IDENTITY FULL`. The default (`DEFAULT`, primary key only) means UPDATE events ship the PK, not the full new row; your `postgres_changes` callback gets a half-empty payload.
