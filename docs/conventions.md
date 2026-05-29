# Conventions

How we write code in this repo. Read this before adding tables, columns, edge functions, or UI components.

## Communication with Jimmie

Canonical tone rules live in `CLAUDE.md` § How to talk to Jimmie (casual-direct, no em dashes, no filler affirmations, recommend-don't-present, latest-version-only, ask-don't-assume). This doc covers code conventions; the communication rules are not duplicated here.

## Schema migrations

- **Always use `timestamptz`** for time-of-event columns. **`date`** for date-only columns. Never `timestamp without time zone`.
- **Always include explicit GRANTs** to `authenticated` and `service_role` for new tables. Auto-expose stays off as the project security default. See `supabase/migrations/20260506065157_grant_data_api_access.sql` for the canonical pattern.
- Always include RLS policies for new tables; never leave RLS implicit. Default deny if unsure.
- UUID PKs default to `gen_random_uuid()`.
- Foreign keys with cascading deletes where the child has no meaning without the parent (`ts_pull_rounds.role_id` → `ts_roles.id ON DELETE CASCADE`). Otherwise leave default RESTRICT.
- New `updated_at` columns get the `updated_at_auto` trigger.
- After applying, regenerate types: `supabase gen types typescript --linked > src/integrations/supabase/types.ts`.
- After adding fields, update `docs/schema.md` in the same commit.

### RPC posture (which security + grant pattern)

Three patterns are in use; pick the right one based on who invokes the function and whether the function enforces caller scope.

- **`SECURITY INVOKER` + `GRANT EXECUTE TO authenticated`** when the browser is the caller and RLS on the affected tables enforces caller scope. Example: `reset_scout_for_deck_regenerate` (called from `DeckPrep.tsx generate()`; the caller's RLS gates which scouts they can reset). The function inherits the caller's identity; no extra in-function check needed because RLS is the gate.

- **`SECURITY DEFINER` + `SET search_path = public` + service-role-only grant** (Phase 5.12.1) when only an edge function is allowed to invoke and the function has no caller-ownership check. Example: `vs_research_try_acquire_kickoff` (called from `vs-research-venues` via the service-role client; updates any scout by UUID without verifying ownership). REVOKE EXECUTE from PUBLIC + anon + authenticated; GRANT EXECUTE TO `service_role` only. Granting authenticated would let any signed-in user reset another row's state since the function lacks the ownership check that RLS would have given an INVOKER + authenticated function.

- **`SECURITY DEFINER` + `SET search_path = public` + `GRANT EXECUTE TO authenticated` + in-function admin re-check** when the function does an atomic cross-table write that would trip RLS mid-flight AND the caller chain is mixed (edge function invokes via service-role client, but `auth.uid()` may or may not flow). Example: `bulk_import_commit_projects` / `_vendors` / `_venues` (called from the `bulk-import` edge function via the service-role client; `auth.uid()` is NULL inside the function; the body re-checks `permission_role='admin'` from a payload-supplied `actor_id`, raises 42501 otherwise). See `docs/auth-model.md` § "SECURITY DEFINER RPCs invoked by an edge function" for the actor-from-payload rule.

Always pin `search_path = public` on SECURITY DEFINER functions to prevent search-path attacks; never inherit the caller's. Always REVOKE FROM PUBLIC + anon + authenticated before GRANT-ing to a narrower role; implicit grants are not safe (`feedback_revoke_execute_check_rls_callers`).

## Realtime

- Tables the UI subscribes to via `postgres_changes` must be added to the `supabase_realtime` publication AND have `REPLICA IDENTITY FULL`. Both go in the same migration that adds the subscription.
- Document the subscription in `docs/schema.md` under the table's section ("Realtime: ...").

## Edge Functions

- New self-invoking functions: add `[functions.<name>] verify_jwt = false` to `supabase/config.toml`, pick the right `_shared/internalAuth.ts` helper (`requireInternalOrAdminUser` for admin-only / service-role surfaces like Talent Scout; `requireInternalOrUserAuth` only for machine-only / cron surfaces), and pass `x-internal-secret: ${INTERNAL_API_SECRET}` on self-invocations. See `docs/auth-model.md` (canon). `verify_jwt = true` alone proves authentication, not admin authorization.
- One-shot user-invoked functions stay on the default `verify_jwt = true`.
- Anthropic calls go through `callClaude(app, ...)` from `_shared/anthropic.ts`, never raw `fetch`. This is how spend tracking and per-app keys work.
- Use Anthropic prompt caching (`cache_control: { type: 'ephemeral', ttl: '1h' }`) on stable system + role-context blocks any time the same role is processed N times in quick succession (initial pull batches, bulk re-eval, final review).
- Outbound email goes through the service account (`gmail.send` scope) from `jobs@mirrornyc.com`, not from individual users.
- **Typing (no `any`).** The Deno tree is linted by the frontend `no-explicit-any` rule but has no tsc/deno typecheck gate, so eslint is the only automated guard. Type real shapes, never `as any`: Anthropic payloads via `_shared/anthropic.ts` (`ClaudeResult`, `ClaudeResponseBlock`, `ClaudeTool`); Google Drive/Slides REST responses via hand-rolled interfaces covering only the fields read; Supabase rows via narrow per-`.select()` projection interfaces by default (the generated `Database` types in `supabase/functions/_shared/database.types.ts`, Phase 5.16.1.2, are imported by ZERO edge functions today and drift from the live schema between regens, so they are NOT a live contract: code-observations Edge #32 / F038. Regen them per the migrations CLAUDE.md `/tmp` + `test -s` + `mv` rule before relying on them, then `Database["public"]["Tables"][...]["Row"]` is fine for full-row selects once a function actually imports them. See `docs/decisions.md` § Phase 5.16); request bodies as `unknown` + field guards; `catch (e: unknown)` with explicit narrowing. Inline `// eslint-disable-next-line @typescript-eslint/no-explicit-any` is a last resort (cap ~5 repo-wide) and needs a one-line "why".

## Frontend

- Pages live in `src/pages/**`. Reusable UI in `src/components/**`. shadcn primitives in `src/components/ui/` are not edited.
- Tailwind for styling. No CSS files except for global resets.
- Inline-mutation components await the DB write before calling parent `onChange`/refetch. Calling `onChange` first races the write and leaves the UI one click behind. See Phase 3.5 `StatusDropdown` decision in `docs/decisions.md`.
- **Server-state access is a de-facto split (reconciled to reality in Phase 6.0, finding F013).** HQ Core surfaces (~63 pages plus every shared hook) hand-roll `useEffect` + `supabase.from()` with module-level caches (`lookups.ts`, `useClientsAndVendors.ts`) and Realtime subscriptions; `react-query` is used only on the Outlook / Calendar surfaces (~3 files), and the shared `QueryClient` carries no `defaultOptions`. This bimodal pattern is the working convention, not a defect. Adopting `react-query` repo-wide (or setting `defaultOptions` and migrating the hand-rolled hooks) is deferred to the post-v1 tech-debt phase; it is not a v1 expectation. Local UI state is fine in `useState`. Wizard state goes in a Zustand store (see `src/lib/talent-scout/wizardStore.ts`).
- Route gates: `<ProtectedRoute>` for auth, `<AdminRoute>` for admin-only routes (already wraps `ProtectedRoute`).
- Type imports come from `@/integrations/supabase/types` so they stay in sync with schema regen.
- `src/lib/venue-scout/venueTypes.ts` mirrors `supabase/functions/_shared/venueTypes.ts`. Any change to `CANONICAL_TYPES`, `TYPE_STYLES`, `canonicalizeType`, `canonicalizeMultiType`, `parseTypes`, or `sanitizeWebsiteUrl` touches BOTH files in the same commit. The header comment on each file flags the rule; drift produces mismatched venue-type pills between the matrix UI and the AI / sheet source data.
- VS surfaces that display photos use `supabase.storage.from("vs_venue_photos").createSignedUrl(path, 3600)` for 1-hour TTL signed URLs (the `vs_venue_photos` bucket is private, producer-or-admin storage RLS). Public-bucket reads are reserved for HQ Core's `venue_photos` bucket on the master `venues` table; the two buckets are distinct.

## PostgREST embeds

Any join with multiple FKs to the same parent table must use a
constraint-named embed alias. PostgREST's default heuristic can return
arrays vs. objects inconsistently across calls when more than one FK
matches the embed, and silently returns no rows when it can't decide.

Wrong:
  `supabase.from("vendor_ratings").select("user:users(full_name)")`

Right:
  `supabase.from("vendor_ratings").select("user:users!vendor_ratings_user_id_fkey(full_name)")`

Lesson learned in 5.6.2 (client cell rendered blank when `projects` had
both `client_id` and `venue_id` FKs to the same join target) and 5.7.7
(`project_members` embed). When an embed silently returns no rows even
though the underlying join is intact, suspect FK disambiguation first.

## Naming

- Talent Scout tables: `ts_*` prefix. Venue Scout: `vs_*` prefix. HQ Core: no prefix.
- Edge Functions: `<module>-<verb>-<noun>` (e.g. `ts-evaluate-candidate`, `vs-generate-deck`).
- Cron jobs: `<module>-cron-<purpose>` (e.g. `ts-cron-scheduled-pulls`).
- React components: PascalCase. Hooks: `useCamelCase`. Files match the export.
- Migrations: timestamp-prefixed, snake_case, descriptive (`20260506162543_phase_3_2_schema_augmentation.sql`).

## Git

- Jimmie's commit author email is `jimmie@jimmiebaugh.com`. His Mirror NYC email is the auth identity, not the commit identity.
- Commit message format: imperative, "Phase X.Y: <summary>" for phase completions, lowercase verb otherwise. See `git log` for examples.
- Commit only when explicitly asked.

## Documentation

- This repo's "single source of truth" docs are in `/docs/`. CLAUDE.md is a lean index pointing to them.
- Update `docs/schema.md` in the same commit as any schema migration.
- Update `docs/edge-functions.md` in the same commit as any new or modified edge function.
- Update `CHECKPOINT.md` in the same commit as any sub-phase completion -- not deferred to end-of-phase. Required fields: latest branch commit hash, current sub-phase, what's done vs. next.
- Passive code-quality findings encountered while working land in `code-observations.md` per the workflow in `CLAUDE.md` § Code observations, but only when they remain open at the end of the task. Do not log issues fixed in the same task or resolved hotfix summaries there; document those in the relevant repo docs, CHECKPOINT, changelog, or commit message.
- Decisions worth preserving go in `docs/decisions.md` with the rationale. Don't bury them in commit messages. Capture during the sub-phase, not retroactively.
- The roadmap (`docs/roadmap.md`) gets the full sub-phase breakdown written at the START of a new phase (in the kickoff commit), not at the end. Finished sub-phases get a status + commit hash in the same commit they complete.
- Before every commit, ask: does CHECKPOINT.md reflect what this commit did? If not, update it in the same commit.
