# Architecture

## Stack

- **Frontend**: React + Vite + TypeScript + Tailwind + shadcn/ui.
- **Backend**: Supabase (Postgres, Auth, Edge Functions, Realtime, Storage).
- **Hosting**: Netlify (auto-deploy from GitHub on push to main, preview URLs per branch). Build config in `netlify.toml`.
- **Repo**: GitHub `mirror-nyc-hq` (private).
- **AI**: Anthropic API (Talent Scout evaluations, Venue Scout research). Per-app keys (`ANTHROPIC_API_KEY_TS` / `_VS` / `_HQ`) selected by the `callClaude(app, ...)` wrapper.
- **Google APIs**: Gmail, Slides, Drive via a single service account with domain-wide delegation.

## Monolith

Mirror NYC HQ is one app. Talent Scout (`/talent-scout/*`) and Venue Scout (`/venue-scout/*`) are routes inside it, sharing one database, auth, and design system. There's no plan to split them out. Talent Scout is admin-only (`<AdminRoute>`); Venue Scout is producer+admin.

The `/` route serves a stealth coming-soon landing for unauthenticated visitors (`src/pages/Landing.tsx`); the hidden sign-in trigger is the bottom "STRATEGY / DESIGN / PRODUCTION" line. Authenticated users hit Dashboard.

## Supabase project

- URL: `https://amipjjmphblfxpghjnel.supabase.co`
- Project ref ID: `amipjjmphblfxpghjnel`
- API keys: project is on the new `sb_publishable_*` / `sb_secret_*` key system (not the legacy anon/service_role JWTs; those return 401 against `/auth/v1` endpoints; migration completed in Phase 3.6.16).
  - **Publishable key** (client-side): `sb_publishable_*`. Read at build time from `VITE_SUPABASE_PUBLISHABLE_KEY` (Netlify + local `.env`) with a hardcoded fallback in `src/integrations/supabase/client.ts` so a missing env var doesn't break the app. Publishable keys are designed to be safely exposed in client bundles.
  - **Secret key** (server-side, Edge Functions only): `sb_secret_*`, stored as a Supabase secret on the server. Never inlined client-side.
- DB password: in Jimmie's password manager
- Security settings: Data API enabled, Auto-expose new tables OFF, Auto-RLS ON

## Routing

`src/App.tsx` mounts:
- `/` (Landing for anon) and `/home` → Dashboard (per-tier variants)
- `/projects`, `/tasks`, `/deliverables`, `/venues`, `/clients`, `/vendors`, `/people` → HQ Core list / detail / edit per surface (Phase 5.2-5.6)
- `/calendar` → unified Calendar (Phase 5.3, all tiers)
- `/outlook` → Outlook 12-month grid (Phase 5.3, admin-only)
- `/wiki`, `/wiki/:slug`, `/wiki/new`, `/wiki/:slug/edit` → Wiki (Phase 5.4)
- `/account-logins` → Account Logins (Phase 5.4, admin + standard, freelance blocked)
- `/users`, `/users/:id`, `/users/new`, `/users/:id/edit` → Team page (5.4) + Profile (5.7.12, all tiers for `/users/:id`)
- `/settings`, `/settings/profile`, `/notifications/preferences` → Settings (Phase 5.4, 5.7.10, 5.7.12)
- `/activity` → Activity Feed (Phase 5.5)
- `/search?q=` → Search (Phase 5.5)
- `/talent-scout` → Talent Scout index (admin)
- `/talent-scout/new/{details,search,scorecard}` → role-creation wizard
- `/talent-scout/roles/:id` → RoleDashboard
- `/talent-scout/roles/:id/settings` → role edit / close-reopen
- `/talent-scout/roles/:id/pulls/:pullRoundId` → PullDetail
- `/talent-scout/candidates/:id` → CandidateDetail
- `*` → 404

`/venue-scout/*` Venue Scout routes (live as of Phase 4, shipped 2026-05-13). The 13-route map under `/venue-scout/scouts/:id/*` covers brief → sheet → research → report → shortlist → review → compile → deck → generating with per-step error states. See the `vs-*` edge function entries in `docs/edge-functions.md` for the backend pairings.

## Realtime

The `supabase_realtime` publication starts empty on this project. Tables that the UI subscribes to via `postgres_changes` need:
1. Added to the publication: `alter publication supabase_realtime add table <name>;`
2. `REPLICA IDENTITY FULL` so UPDATE events carry the full new row.

Currently published: `ts_pull_rounds` (PullDetail subscribes for pull-progress UI), `ts_final_reviews` (FinalReviewDetail subscribes for ranking-progress UI), `vs_scouts` (Researching, Compiling, Generating subscribe for pipeline status), `projects` + `tasks` + `deliverables` (Board view cross-tab sync, Phase 5.2.1), `notifications` (bell badge live-update, Phase 5.5; filtered by `user_id=eq.{uid}`), `activity_log` (ProjectActivity rollup, Phase 5.7.14). Other tables are unpublished by default; add and document in `docs/schema.md`.

## Storage

Eight private buckets, all behind RLS:
- `candidate_attachments` (admin only, Talent Scout)
- `packets` (admin only, Talent Scout; round + final-review packet PDFs, Phase 3.6)
- `briefs` (any auth user, Venue Scout)
- `sourcing_sheets` (any auth user, Venue Scout)
- `venue_photos` (read auth, write producer+, HQ Core master venues)
- `vs_venue_photos` (any auth user; private signed URLs at render time; Phase 4.7.1-port; distinct from the public `venue_photos` bucket)
- `wiki_images` (any auth read, admin-only write; Phase 5.7.10; signed URLs 1-year TTL embedded into wiki body HTML)
- `profile_avatars` (read auth, write own folder)

URLs are short-TTL signed URLs from `supabase.storage.createSignedUrl`. No public buckets.

See `docs/auth-model.md` for full bucket policies.

## Hosting + deploy

Netlify auto-deploys from GitHub `main` on every push. Per-branch preview URLs for non-main pushes. `netlify.toml` pins:
- Build command: `npm run build`
- Publish dir: `dist`
- SPA fallback redirect: `/* → /index.html` status 200 (so React Router can handle direct deep-links).

Env vars (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`) live in the Netlify Dashboard, not in `netlify.toml`. Vite reads them at build time. `src/integrations/supabase/client.ts` carries the same values as a hardcoded fallback so a missing env var won't break the app.

Production URL: `hq.mirrornyc.com` → resolves to `mirrornyc-hq.netlify.app`. Subdomain `hq.mirrornyc.com` is live and serves the production deploy.

## Where things live

- Schema migrations: `supabase/migrations/*.sql`
- Edge Functions: `supabase/functions/<name>/index.ts`
- Shared backend code: `supabase/functions/_shared/*.ts`
- Frontend pages: `src/pages/**/*.tsx`
- Reusable UI: `src/components/**/*.tsx` (shadcn primitives in `src/components/ui/`)
- Hooks: `src/hooks/*.ts`
- Supabase client: `src/integrations/supabase/client.ts` (typed via `src/integrations/supabase/types.ts`, regenerated after schema changes)
- Helper scripts: `scripts/*.ts`
