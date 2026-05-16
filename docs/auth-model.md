# Auth model

Identity, permission roles, RLS, storage buckets, the Google service account, and the Edge Function self-invocation auth pattern.

## Identity

- Google OAuth via Supabase Auth, restricted to `@mirrornyc.com`.
- Three reinforcing layers: `hd=mirrornyc.com` OAuth parameter, Supabase allowed domains, app-level email check.
- New signups land in `auth.users` first; the `handle_new_user` trigger mirrors them into `public.users` with `permission_role = 'pending'` (Phase 5.1). The trigger also writes one `notifications` row per active admin and fires the `notify-admin-of-pending-user` edge function so admins know to assign a tier from the Team page (lands 5.4).

## Permission roles (Phase 5.1 four-tier model)

Reshaped in Phase 5.1 from the original 3-tier model (`member`/`producer`/`admin`) per the locked Phase 5 decisions memo (`OUTPUTS/phase-5-locked-decisions-2026-05-15.md` § 2). Backfill: admin -> admin, producer -> admin, member -> standard.

- `pending`: default for new signups. Cannot access any HQ surface beyond `/pending`. `<ProtectedRoute>` redirects to `/pending` for any authed route. An admin assigns one of the other three tiers from the Team page (Phase 5.4).
- `standard`: full read/write on HQ Core tables (Projects, Tasks, Deliverables, Venues, Organizations, People, etc. as they land in 5.2). Full Venue Scout access (port plan § 8.6 collaborative agency-wide workflow; storage policies relaxed in Phase 4.10.3-port). No Talent Scout. No global settings. No Team / Outlook / Settings rail entries.
- `freelance`: read-only HQ access tier. Phase 5.1 renders the Standard rail variant minus Account Logins (Account Logins lands 5.4 with the tier-specific gate). Spec § 6c: 5.1 ships Freelance with the Standard rail until the dedicated gates land.
- `admin`: everything Standard can do, plus Talent Scout, Team / Outlook / Settings rail entries, user role management, global settings.

A user can be assigned to projects (as account manager or designer) regardless of their permission role; assignment != permission tier.

## Per-project assignments (separate from permission role)

- `account_managers` (1+, required) on every project. Any user can be assigned regardless of permission role.
- `designers` (0+, optional). Same.

## RLS policies

- `users`: SELECT any auth user. INSERT: admin only (Phase 5.4 `users_insert_admin` policy + GRANT INSERT) for pre-provisioning Team members; otherwise the `handle_new_user` SECURITY DEFINER trigger inserts on first sign-in. UPDATE: own row OR admin (`id = auth.uid() OR is_admin()`) for any column. DELETE admin only. Phase 5.4 also dropped the `users.id` FK to `auth.users(id)` so pre-provisioned rows can exist with placeholder UUIDs; `handle_new_user` swaps the id to the auth uid on first sign-in (id-swap pattern; see `docs/decisions.md` Phase 5.4).
- HQ tables (`projects`, `clients`, `venues`, `venue_types`, `tasks`, all join tables): SELECT/INSERT/UPDATE any auth user. DELETE: admin only for projects, venues, clients. Tasks: any auth user can DELETE. Phase 5.4 also fixed missing GRANT DELETE on `cities` + `project_categories` so the admin-only DELETE RLS policy is reachable for Settings admin deletes.
- `wiki_pages` (Phase 5.4): SELECT any auth user. INSERT/UPDATE/DELETE admin only.
- `credentials` (Phase 5.4): SELECT `admin` + `standard` only (freelance blocked). INSERT/UPDATE/DELETE admin only.
- `mirror_holidays` (Phase 5.4): SELECT any auth user. INSERT/UPDATE/DELETE admin only.
- `departments` (Phase 5.4): SELECT any auth user. INSERT/UPDATE/DELETE admin only.
- `ts_*`: all operations admin only.
- `vs_*`: all operations open to all authenticated users (no role gating, no admin DELETE restriction). Single permissive `FOR ALL TO authenticated USING (true) WITH CHECK (true)` policy per table. Locked in port plan § 8.6 as the collaborative agency-wide model: any authenticated `@mirrornyc.com` user can read or write any scout, candidate venue, or photo.
- `notifications`: SELECT and UPDATE only by recipient. INSERT via service role only.
- `global_settings`: SELECT any auth user. UPDATE admin only.
- `activity_log`: SELECT any auth user. INSERT via Postgres trigger only.

Admin checks are done via a SECURITY DEFINER function that reads `permission_role` from `public.users` for `auth.uid()`.

## Frontend route gates

- `<ProtectedRoute>`: any signed-in `@mirrornyc.com` user. **Phase 5.1 behavior change:** when `permission_role = 'pending'`, redirects to `/pending`. The `/pending` route itself wraps in `<ProtectedRoute bypassPending>` so the pending screen renders rather than looping. **Phase 5.4 amendment:** when `active = false`, signs the user out and shows an "Account deactivated" screen instead of rendering the shell.
- `<StandardOrAdminRoute>` (Phase 5.1): wraps `ProtectedRoute`, additionally requires `permission_role IN ('admin', 'standard')`. Used on `/home` and every HQ Core surface beyond `/pending`. Freelance users see a friendly "access restricted" empty state with a Sign Out button.
- `<AdminRoute>`: wraps `ProtectedRoute`, additionally requires `permission_role = 'admin'`. Used on every `/talent-scout/*` route plus `/team`, `/outlook`, `/settings`, `/wiki/new`, `/wiki/:slug/edit`, `/team/new`, `/team/:id/edit`. The Wiki read routes (`/wiki`, `/wiki/:slug`) use `<ProtectedRoute>` directly (all tiers including Freelance); component-level + RLS gating handles the Account Logins exclusion.
- All `/venue-scout/*` routes wrap in `<ProtectedRoute>` only (port plan § 8.6 RLS open-authenticated; Phase 4.2-port landed Scout Index + New Scout with this posture).

## Storage buckets

- `candidate_attachments`: admin only (Talent Scout)
- `packets`: admin only (Talent Scout; round + final-review packet PDFs, Phase 3.6)
- `briefs`, `sourcing_sheets`: any auth user (Venue Scout; relaxed from producer-or-admin in Phase 4.10.3-port to match the open-authenticated vs_* table RLS).
- `venue_photos`: any auth read; producer or admin write (HQ Core master `venues` table photos)
- `vs_venue_photos`: any auth user (Venue Scout deck photos, private; signed URLs at render time, 1-hour TTL). Distinct from the public `venue_photos` bucket; the two coexist because Venue Scout decks need private upload/render while HQ Core's master-venues bucket stays public for downstream usage. Created in Phase 4.7.1-port; producer-or-admin gate relaxed to authenticated in Phase 4.10.3-port.
- `profile_avatars`: any auth read; user writes only to their own folder (`{user_id}/...` path prefix)

All buckets are private. URLs go through `supabase.storage.createSignedUrl` with short TTLs (typical: 60 minutes for inline rendering, 1 hour for download links).

## Google service account

Single Google service account `mirror-ny-hq-backend@mirror-nyc-hq.iam.gserviceaccount.com` with domain-wide delegation, owned by Mirror NYC's Workspace. Scopes:
- `gmail.readonly` (Talent Scout candidate ingestion)
- `gmail.send` (all outbound email from `jobs@mirrornyc.com`)
- `presentations` (Slides deck generation)
- `drive` (Drive saves and template reads)

JSON key stored as a Supabase secret (`GOOGLE_SERVICE_ACCOUNT_KEY`; read by `_shared/googleServiceAccount.ts`). Used by edge functions only; never reaches the browser.

`scripts/verify-service-account.ts` runs a per-scope JWT bearer flow and smoke-tests `messages.list` and `files.list` to verify delegation; re-run any time scopes are changed in the Workspace Admin Console.

`supabase/functions/_shared/googleServiceAccount.ts` (Phase 4.8.1-port) is the generic JWT-bearer helper: `getGoogleAccessToken(scopes, { impersonateUser? })` supports both impersonation flows (Gmail) and non-impersonation flows (Drive + Slides). `supabase/functions/_shared/gmailServiceAccount.ts` is a thin Gmail-scoped wrapper that delegates to it and impersonates `jobs@mirrornyc.com`.

Drive + Slides API access (used by `vs-generate-deck`, landed in 4.8.2-port) calls `getGoogleAccessToken` with scopes `presentations` + `drive` and no impersonation. The service account itself owns those API calls; deck files land in a Mirror Shared Drive folder the service account is a member of.

**Two Supabase secrets required for `vs-generate-deck` to succeed:**
- `GOOGLE_TEMPLATE_FILE_ID`: Drive file ID of the Mirror deck Slides template. The service account must be an Editor (or higher) on the file.
- `GOOGLE_OUTPUT_FOLDER_ID`: Drive folder ID where generated decks land. The service account must be an Editor (or higher) on the folder.

Missing or misconfigured: `vs-generate-deck` fails fast with `TEMPLATE_COPY_FAILED` (or `AUTH_FAILED` if the service-account key itself can't mint a token). The Generating page parses the code and routes to `/deck/error/<code>`.

## Edge Function self-invocation auth

Some Edge Functions (`ts-pull-candidates`, `ts-bulk-reevaluate`; the packet-generate function in 3.6 will join) self-invoke for chunked processing. The Supabase gateway on this project rejects the service-role bearer token at its `verify_jwt` layer (likely a new-format-key vs legacy-JWT mismatch; applies to whatever key Supabase ships in `SUPABASE_SERVICE_ROLE_KEY` for newer projects). To unblock self-invocation:

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

**When to use this pattern:** any Edge Function that POSTs back to itself (chunked pipelines, batch processing). Use the default `verify_jwt = true` for one-shot user-invoked functions like `ts-generate-scorecard`; they don't need the override.
