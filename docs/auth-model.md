# Auth model

Identity, permission roles, RLS, storage buckets, the Google service account, and the Edge Function self-invocation auth pattern.

## Identity

- Google OAuth via Supabase Auth, restricted to `@mirrornyc.com`.
- Three reinforcing layers: `hd=mirrornyc.com` OAuth parameter, Supabase allowed domains, app-level email check.
- New signups land in `auth.users` first; the `handle_new_user` trigger mirrors them into `public.users` with `permission_role = 'pending'` (Phase 5.1). The trigger also writes one `notifications` row per active admin (bell-panel; non-disruptive surface so any admin can assign a tier) and invokes `notifications-dispatch` to email active OWNERS only (`is_owner = true AND active = true`). Two-channel split landed Phase 5.8.8: bell-panel stays admin-wide, email reserved for owner-tier escalation. If the owner list is empty no email fires (graceful degradation); the bell-panel notification still inserts.

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

- `users`: SELECT any auth user. INSERT: admin only (Phase 5.4 `users_insert_admin` policy + GRANT INSERT) for pre-provisioning Team members; otherwise the `handle_new_user` SECURITY DEFINER trigger inserts on first sign-in. UPDATE: own row OR admin (`id = auth.uid() OR is_admin()`) for any column. DELETE admin only. Phase 5.4 also dropped the `users.id` FK to `auth.users(id)` so pre-provisioned rows can exist with placeholder UUIDs; `handle_new_user` swaps the id to the auth uid on first sign-in (id-swap pattern; see `docs/decisions.md` Phase 5.4). Phase 5.8.8 added the symmetric `trg_users_align_id_to_auth` BEFORE INSERT trigger on `public.users`: if an `auth.users` row already exists for the incoming email, NEW.id is rewritten to that auth uid before INSERT. Together the two triggers handle both orderings (pre-provision-first via the AFTER INSERT swap on `auth.users`; sign-in-first via this BEFORE INSERT on `public.users`).
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
- `anthropic_call_log` (Phase 5.15): admin-only SELECT via the `anthropic_call_log_admin_read` policy (inline `EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND permission_role = 'admin')`). No INSERT / UPDATE / DELETE policies — writes flow from the service-role wrapper (`_shared/anthropic.ts logCallToTable`) which bypasses RLS; the 12-month prune in `ts-cron-monthly-spend-reset` runs from the same service-role client. GRANT SELECT to `authenticated` so the policy can gate the read; GRANT ALL to `service_role`. Companion RPC `public.anthropic_spend_breakdown(month_iso text)` is SECURITY DEFINER STABLE with an inline `public.is_admin()` gate (raises `'anthropic_spend_breakdown: admin only'` on non-admins); EXECUTE revoked from PUBLIC and granted to `authenticated` so non-admin callers surface the exception cleanly. Phase 5.16.0's `is_active_member()` rewrite may broaden the SELECT predicate; until that pass, admin-only stays the narrow canonical posture for cost data.

Admin checks are done via a SECURITY DEFINER function that reads `permission_role` from `public.users` for `auth.uid()`.

## Frontend route gates

- `<ProtectedRoute>`: any signed-in `@mirrornyc.com` user. **Phase 5.1 behavior change:** when `permission_role = 'pending'`, redirects to `/pending`. The `/pending` route itself wraps in `<ProtectedRoute bypassPending>` so the pending screen renders rather than looping. **Phase 5.4 amendment:** when `active = false`, signs the user out and shows an "Account deactivated" screen instead of rendering the shell.
- `<StandardOrAdminRoute>` (Phase 5.1): wraps `ProtectedRoute`, additionally requires `permission_role IN ('admin', 'standard')`. Used on `/home` and every HQ Core surface beyond `/pending`. Freelance users see a friendly "access restricted" empty state with a Sign Out button.
- `<AdminRoute>`: wraps `ProtectedRoute`, additionally requires `permission_role = 'admin'`. Used on every `/talent-scout/*` route plus `/venue-scout/settings` (Phase 5.12.12 tool-app-wide VS settings stub), `/team`, `/outlook`, `/settings`, `/wiki/new`, `/wiki/:slug/edit`, `/team/new`, `/team/:id/edit`. The Wiki read routes (`/wiki`, `/wiki/:slug`) use `<ProtectedRoute>` directly (all tiers including Freelance); component-level + RLS gating handles the Account Logins exclusion.
- All `/venue-scout/*` routes wrap in `<ProtectedRoute>` only (port plan § 8.6 RLS open-authenticated; Phase 4.2-port landed Scout Index + New Scout with this posture) EXCEPT `/venue-scout/settings` (Phase 5.12.12; AdminRoute-wrapped tool-app-wide settings stub). The per-scout `/venue-scout/scouts/:id/settings` page stays under `ProtectedRoute` (producer-accessible).

## Storage buckets

- `candidate_attachments`: admin only (Talent Scout)
- `packets`: admin only (Talent Scout; round + final-review packet PDFs, Phase 3.6)
- `briefs`, `sourcing_sheets`: any auth user (Venue Scout; relaxed from producer-or-admin in Phase 4.10.3-port to match the open-authenticated vs_* table RLS).
- `venue_photos`: any auth read; producer or admin write (HQ Core master `venues` table photos)
- `vs_venue_photos`: any auth user (Venue Scout deck photos, private; signed URLs at render time, 1-hour TTL). Distinct from the public `venue_photos` bucket; the two coexist because Venue Scout decks need private upload/render while HQ Core's master-venues bucket stays public for downstream usage. Created in Phase 4.7.1-port; producer-or-admin gate relaxed to authenticated in Phase 4.10.3-port.
- `wiki_images`: any auth SELECT; admin-only INSERT/UPDATE/DELETE (matches `wiki_pages` RLS). Private bucket; signed URLs with 1-year TTL embedded in `wiki_pages.body` HTML at upload time. After 1 year, embedded URLs expire and images break until the page is re-edited; render-time URL-swap pattern is the deferred carry-forward if this becomes painful. Created Phase 5.7.10.
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

## SECURITY DEFINER RPCs invoked by an edge function (Phase 5.9.2)

`bulk_import_commit_projects` (and the 5.9.3 `bulk_import_commit_vendors` + 5.9.4 `bulk_import_commit_venues` siblings, all now shipped) follow the `promote_outlook_to_project` precedent: a SECURITY DEFINER `plpgsql` function does an atomic cross-table write that would otherwise trip RLS mid-flight, and re-checks the caller is admin in its first statements (raises `42501` on mismatch) as defense in depth on top of the route gate.

One difference from `promote_outlook_to_project`: the bulk-import RPCs are invoked by the `bulk-import` edge function using the **service-role client**, so `auth.uid()` is NULL inside the function. The admin re-check therefore reads `actor_id` from the JSON payload (the edge function sets it from the verified user) rather than `auth.uid()`. The edge function has already verified the JWT + admin role before invoking, so `actor_id` is trustworthy; the in-function check is the third layer. Any future RPC invoked via the service-role client (not the user JWT) must take its actor from the payload, not `auth.uid()`.

**Phase 5.12.1 added a third posture: SECURITY DEFINER + service-role-only grant + no in-function ownership check.** `vs_research_try_acquire_kickoff` is invoked only by `vs-research-venues` via the service-role client and updates any scout by UUID; it has no caller-ownership check. Granting authenticated would let any signed-in user reset another scout's kickoff state. Posture: REVOKE EXECUTE FROM PUBLIC + anon + authenticated, GRANT EXECUTE TO `service_role` only. The full decision rule for SECURITY INVOKER + authenticated vs. SECURITY DEFINER + authenticated + admin-recheck vs. SECURITY DEFINER + service-role-only lives in `docs/conventions.md` § Schema migrations § RPC posture.

## Edge function using the caller's JWT for RLS-enforced writes (Phase 5.10.0)

`hq-generate-venue-about` is the inverse of the service-role pattern above: it opens a supabase-js client with the **caller's own `Authorization` header** (anon key + forwarded user JWT) and does its SELECT + `about_venue` UPDATE through that client, so every read/write is RLS-enforced under the caller's session. No service role, no SECURITY DEFINER. This works because `venues` UPDATE is **open-authenticated** (per the HQ-tables rule above: SELECT/INSERT/UPDATE for any auth user), so any tier that can view a venue can also generate its About paragraph — no admin re-check needed inside the function. A Freelance/read-only-tier caller whose RLS denies the venues UPDATE would see the write fail and surface as a destructive toast. Use this caller-JWT pattern (not service role) whenever an edge function's writes should respect the caller's RLS rather than escalate past it.

## Function-level authorization gates on cross-scout poisoning (Phase 5.12.7)

`vs-research-single-venue` runs `verify_jwt = true` (user-invoked synchronous; Claude call ~10-20s) but operates against the service-role supabase client for its SELECT + UPDATE. Because `vs_*` RLS is **open-authenticated** (per the HQ-tables rule above; any authenticated `@mirrornyc.com` user can SELECT/INSERT/UPDATE every row in every scout), function-level authorization is the ONLY thing that stops a producer from invoking this function against any `vs_candidate_venues` row in the system. The function enforces three gates inline before any Claude call: (1) `venue.scout_id === scout_id` in the SELECT predicate; (2) `venue.source === 'manual'` in the SELECT predicate; (3) scout `current_step ∈ {shortlist, review_selects, deck_prep}` checked against the loaded scout row (reject from researching / compiling / generating_deck so a stale tab can't poison an in-flight scout's pipeline). All three predicates surface a 404 (rather than 403) on rejection so a probe surfaces no useful signal. Future single-row edge functions that operate against open-authenticated VS or HQ tables MUST apply the same gate shape: scope to the owning entity in the SELECT predicate + reject from incompatible state machines + return the same status code for "not found" and "not authorized" so a probe cannot distinguish.

**Counter-example (Phase 5.12.6): `vs-delete-scout` does NOT need an extra gate.** `vs-delete-scout` also runs `verify_jwt = true` against the service-role supabase client and also operates on open-authenticated `vs_*` tables, but it takes only `scout_id` as input -- no second entity id, no cross-entity surface to poison. Any authenticated user can already delete any scout via direct PostgREST today; the edge function preserves that semantic byte-for-byte (the function exists to add storage-file cleanup, not to tighten authorization). The `verify_jwt = true` gateway check plus the explicit 404 on missing scout is sufficient. The cross-scout poisoning posture above applies when the function accepts a (parent_id, child_id) pair and the child rows are open-authenticated across parents; when the function takes only the parent id, the open-authenticated RLS posture IS the policy and there is nothing to gate further inside the function. Spec decisions for future single-row edge functions: if the input is a single owning-entity id and the function exposes no cross-entity surface, follow the `vs-delete-scout` posture (no extra gate); if the input is a (parent_id, child_id) pair, follow the `vs-research-single-venue` posture (three gates: parent-scope predicate + child-attribute predicate + parent-state-machine predicate, all surfacing 404).

## Phase 5.8.8 hardening notes

Sign-in regressions surfaced in 5.8.5 / 5.8 close-out. The fixes in `20260601100000_phase_5_8_8_auth_pre_provision_hotfix.sql` codify rules that must hold going forward:

- **`handle_new_user` swap block is load-bearing.** Any future `CREATE OR REPLACE FUNCTION public.handle_new_user()` MUST preserve the SELECT-into-`existing_user_id` block and the two IF branches that UPDATE the pre-provisioned row's id to `NEW.id`. Phase 5.5's notifications rewrite silently dropped this block during the dispatch refactor; pre-provisioned sign-ins broke until the 5.8.8 hotfix restored it. Comment the block explicitly in any future spec § 13 prompt to avoid a silent regression in review.
- **Two trigger functions require explicit GRANTs after any REVOKE FROM PUBLIC pass.** `handle_new_user` needs EXECUTE for `supabase_auth_admin` (it fires from the AFTER INSERT trigger on `auth.users`, invoked by the GoTrue role). `users_protect_admin_columns` needs EXECUTE for both `supabase_auth_admin` (so the swap UPDATE inside `handle_new_user` doesn't permission-fail when the BEFORE UPDATE trigger fires) and `authenticated` (so user-row UPDATEs from the app trigger the predicate correctly). The new `users_align_id_to_auth` needs EXECUTE for `authenticated` and `service_role` (Team-page INSERTs run as `authenticated`). Future REVOKE patterns must enumerate trigger functions separately from RLS predicate helpers.
- **OAuth `redirect_uri` sanitization.** `ProtectedRoute` saves `pathname + search` (NOT the hash) to `sessionStorage` as `post_signin_redirect`, AND skips that write when the URL is itself a failed-OAuth callback (query or hash contains `error=`). `signInWithGoogle` reads the stored value, strips any trailing hash, and ignores it when it carries `?error=` / `&error=` / `#error=`. Reason: Google rejects `redirect_uri` with a `#` fragment (HTTP 400, OAuth 2.0 forbids it); re-using a failed-callback URL as `redirectTo` was bricking the next sign-in until the user cleared site data.
- **New-user pending notification: two-channel split.** Bell-panel (`public.notifications` row) goes to every `permission_role = 'admin' AND active = true` user — non-disruptive surface; any admin can assign a tier from the Team page. Email (via `notifications-dispatch`) goes only to active OWNERS (`is_owner = true AND active = true`) — owner-tier escalation. Any future change to either channel must keep the predicates aligned with this split rather than collapsing both into a single SELECT.
- **Pre-provisioning is order-agnostic from 5.8.8 onward.** The `auth.users` AFTER INSERT swap path covers "pre-provision first, sign-in second". The `public.users` BEFORE INSERT alignment trigger covers "sign-in first, pre-provision second" (or "admin deleted a pending row and re-created via the Team-page form"). Verify both triggers exist whenever auditing the auth surface.
- **Every FK pointing at `public.users.id` MUST be `ON UPDATE CASCADE`** (added in 5.8.8.1 migration `20260601200000_phase_5_8_8_1_on_update_cascade_users_id.sql`). Phase 5.4 dropped the `public.users.id → auth.users(id)` FK to enable pre-provisioning + the swap pattern in `handle_new_user`, but missed the inbound side: every FK on tables that reference `public.users(id)` defaulted to `ON UPDATE NO ACTION`. The swap UPDATE on `public.users.id` would FK-violate the moment a pre-provisioned user had any `project_members` / `tasks.assignee_id` / `notifications.user_id` / etc. attachment — surfaced 2026-05-19 PM when a transactional swap simulation against a pre-provisioned user with 3 project_members rows raised `ERROR 23503`. Fixed by flipping `update_rule` to `CASCADE` on all 42 FKs whose referenced column is `public.users(id)`. Each FK preserved its existing `ON DELETE` rule. Any NEW table added later that references `public.users(id)` MUST be created with `ON UPDATE CASCADE` from the start. Verify with `SELECT count(*) FROM information_schema.referential_constraints rc JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = rc.constraint_name WHERE ccu.table_schema = 'public' AND ccu.table_name = 'users' AND ccu.column_name = 'id' AND rc.update_rule != 'CASCADE'` — must return 0.
