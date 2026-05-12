# Conventions

How we write code in this repo. Read this before adding tables, columns, edge functions, or UI components.

## Communication with Jimmie

- Casual, direct, friend-who-knows-this-stuff tone.
- **No em dashes anywhere.**
- No filler affirmations ("Great question!", "Absolutely!", etc.).
- Concise by default; go deeper when the task calls for it.
- Recommend, don't just present options. Give your read with the tradeoff stated plainly.
- Reference only the latest version of anything he's submitted; if something changed, the old version is gone.
- Don't fill in gaps. If something is unclear or missing, ask him.

## Schema migrations

- **Always use `timestamptz`** for time-of-event columns. **`date`** for date-only columns. Never `timestamp without time zone`.
- **Always include explicit GRANTs** to `authenticated` and `service_role` for new tables. Auto-expose stays off as the project security default. See `supabase/migrations/20260506065157_grant_data_api_access.sql` for the canonical pattern.
- Always include RLS policies for new tables — never leave RLS implicit. Default deny if unsure.
- UUID PKs default to `gen_random_uuid()`.
- Foreign keys with cascading deletes where the child has no meaning without the parent (`ts_pull_rounds.role_id` → `ts_roles.id ON DELETE CASCADE`). Otherwise leave default RESTRICT.
- New `updated_at` columns get the `updated_at_auto` trigger.
- After applying, regenerate types: `supabase gen types typescript --linked > src/integrations/supabase/types.ts`.
- After adding fields, update `docs/schema.md` in the same commit.

## Realtime

- Tables the UI subscribes to via `postgres_changes` must be added to the `supabase_realtime` publication AND have `REPLICA IDENTITY FULL`. Both go in the same migration that adds the subscription.
- Document the subscription in `docs/schema.md` under the table's section ("Realtime: ...").

## Edge Functions

- New self-invoking functions: add `[functions.<name>] verify_jwt = false` to `supabase/config.toml`, use `requireInternalOrUserAuth` from `_shared/internalAuth.ts`, and pass `x-internal-secret: ${INTERNAL_API_SECRET}` on self-invocations. See `docs/auth-model.md`.
- One-shot user-invoked functions stay on the default `verify_jwt = true`.
- Anthropic calls go through `callClaude(app, ...)` from `_shared/anthropic.ts`, never raw `fetch`. This is how spend tracking and per-app keys work.
- Use Anthropic prompt caching (`cache_control: { type: 'ephemeral', ttl: '1h' }`) on stable system + role-context blocks any time the same role is processed N times in quick succession (initial pull batches, bulk re-eval, final review).
- Outbound email goes through the service account (`gmail.send` scope) from `jobs@mirrornyc.com`, not from individual users.

## Frontend

- Pages live in `src/pages/**`. Reusable UI in `src/components/**`. shadcn primitives in `src/components/ui/` are not edited.
- Tailwind for styling. No CSS files except for global resets.
- Inline-mutation components await the DB write before calling parent `onChange`/refetch. Calling `onChange` first races the write and leaves the UI one click behind. See Phase 3.5 `StatusDropdown` decision in `docs/decisions.md`.
- Use `react-query` for server state. Local UI state is fine in `useState`. Wizard state goes in a Zustand store (see `src/stores/wizardStore.ts`).
- Route gates: `<ProtectedRoute>` for auth, `<AdminRoute>` for admin-only routes (already wraps `ProtectedRoute`).
- Type imports come from `@/integrations/supabase/types` so they stay in sync with schema regen.
- `src/lib/venue-scout/venueTypes.ts` mirrors `supabase/functions/_shared/venueTypes.ts`. Any change to `CANONICAL_TYPES`, `TYPE_STYLES`, `canonicalizeType`, `canonicalizeMultiType`, `parseTypes`, or `sanitizeWebsiteUrl` touches BOTH files in the same commit. The header comment on each file flags the rule; drift produces mismatched venue-type pills between the matrix UI and the AI / sheet source data.
- VS surfaces that display photos use `supabase.storage.from("vs_venue_photos").createSignedUrl(path, 3600)` for 1-hour TTL signed URLs (the `vs_venue_photos` bucket is private, producer-or-admin storage RLS). Public-bucket reads are reserved for HQ Core's `venue_photos` bucket on the master `venues` table; the two buckets are distinct.

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
- Decisions worth preserving go in `docs/decisions.md` with the rationale. Don't bury them in commit messages. Capture during the sub-phase, not retroactively.
- The roadmap (`docs/roadmap.md`) gets the full sub-phase breakdown written at the START of a new phase (in the kickoff commit), not at the end. Finished sub-phases get a status + commit hash in the same commit they complete.
- Before every commit, ask: does CHECKPOINT.md reflect what this commit did? If not, update it in the same commit.
