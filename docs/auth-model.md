# Auth model

Identity, permission roles, RLS, storage buckets, the Google service account, and the Edge Function self-invocation auth pattern.

## Identity

- Google OAuth via Supabase Auth, restricted to `@mirrornyc.com`.
- Three reinforcing layers: `hd=mirrornyc.com` OAuth parameter, Supabase allowed domains, app-level email check.
- New signups land in `auth.users` first; the `handle_new_user` trigger mirrors them into `public.users` with `permission_role = 'member'`.

## Permission roles (3 tiers, stacked)

- `member`: full read/write on HQ tables. No Venue Scout, no Talent Scout, no global settings. Default for new signups.
- `producer`: everything member can do, plus full read/write on Venue Scout.
- `admin`: everything producer can do, plus Talent Scout, user role management, global settings.

A user can be assigned to projects (as account manager or designer) regardless of their permission role — assignment ≠ permission tier.

## Per-project assignments (separate from permission role)

- `account_managers` (1+, required) on every project. Any user can be assigned regardless of permission role.
- `designers` (0+, optional). Same.

## RLS policies

- `users`: SELECT any auth user. INSERT blocked from API (only via `handle_new_user` trigger with service role). UPDATE: own row for `avatar_url`, `full_name`, `department_tags`; admin can update anyone's `permission_role`. DELETE admin only.
- HQ tables (`projects`, `clients`, `venues`, `venue_types`, `tasks`, all join tables): SELECT/INSERT/UPDATE any auth user. DELETE: admin only for projects, venues, clients. Tasks: any auth user can DELETE.
- `ts_*`: all operations admin only.
- `vs_*`: SELECT/INSERT/UPDATE producer or admin. DELETE admin only.
- `notifications`: SELECT and UPDATE only by recipient. INSERT via service role only.
- `global_settings`: SELECT any auth user. UPDATE admin only.
- `activity_log`: SELECT any auth user. INSERT via Postgres trigger only.

Admin checks are done via a SECURITY DEFINER function that reads `permission_role` from `public.users` for `auth.uid()`.

## Frontend route gates

- `<ProtectedRoute>`: any signed-in `@mirrornyc.com` user.
- `<AdminRoute>`: wraps `ProtectedRoute`, additionally requires `permission_role = 'admin'`. Used on every `/talent-scout/*` route.
- Producer-only gating for `/venue-scout/*` lands in Phase 4.

## Storage buckets

- `candidate_attachments`: admin only (Talent Scout)
- `packets`: admin only (Talent Scout — round + final-review packet PDFs, Phase 3.6)
- `briefs`, `sourcing_sheets`: producer or admin (Venue Scout)
- `venue_photos`: any auth read; producer or admin write
- `profile_avatars`: any auth read; user writes only to their own folder (`{user_id}/...` path prefix)

All buckets are private. URLs go through `supabase.storage.createSignedUrl` with short TTLs (typical: 60 minutes for inline rendering, 1 hour for download links).

## Google service account

Single Google service account `mirror-ny-hq-backend@mirror-nyc-hq.iam.gserviceaccount.com` with domain-wide delegation, owned by Mirror NYC's Workspace. Scopes:
- `gmail.readonly` (Talent Scout candidate ingestion)
- `gmail.send` (all outbound email from `jobs@mirrornyc.com`)
- `presentations` (Slides deck generation)
- `drive` (Drive saves and template reads)

JSON key stored as a Supabase secret (`GOOGLE_SERVICE_ACCOUNT_JSON`). Used by edge functions only — never reaches the browser.

`scripts/verify-service-account.ts` runs a per-scope JWT bearer flow and smoke-tests `messages.list` and `files.list` to verify delegation; re-run any time scopes are changed in the Workspace Admin Console.

`supabase/functions/_shared/gmailServiceAccount.ts` is the template for service-account auth in any Edge Function — same JWT bearer flow with the right scopes for the API in question.

## Edge Function self-invocation auth

Some Edge Functions (`ts-pull-candidates`, `ts-bulk-reevaluate`; the packet-generate function in 3.6 will join) self-invoke for chunked processing. The Supabase gateway on this project rejects the service-role bearer token at its `verify_jwt` layer (likely a new-format-key vs legacy-JWT mismatch — applies to whatever key Supabase ships in `SUPABASE_SERVICE_ROLE_KEY` for newer projects). To unblock self-invocation:

1. **Per-function `verify_jwt = false`** in `supabase/config.toml`:
   ```toml
   [functions.ts-pull-candidates]
   verify_jwt = false
   ```
   This disables gateway JWT verification for that function only. Other functions stay on the default `verify_jwt = true`.

2. **`INTERNAL_API_SECRET`** is set as a Supabase secret (random 256-bit hex). Self-invocations send it as the `x-internal-secret` header.

3. **Auth enforcement moves into the function** via `supabase/functions/_shared/internalAuth.ts`'s `requireInternalOrUserAuth(req)`. Returns null (allow) for any of:
   - `x-internal-secret` matches `INTERNAL_API_SECRET` (self-invocation, cron callers)
   - Authorization bearer matches `SUPABASE_SERVICE_ROLE_KEY` exactly (direct service-role calls)
   - Authorization bearer is a valid user JWT (frontend `supabase.functions.invoke` from signed-in admin)

   Anything else → 401. Anon callers that slip past the disabled gateway are rejected here.

**When to use this pattern:** any Edge Function that POSTs back to itself (chunked pipelines, batch processing). Use the default `verify_jwt = true` for one-shot user-invoked functions like `ts-generate-scorecard` — they don't need the override.
