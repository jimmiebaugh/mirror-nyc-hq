# Architecture

## Stack

- **Frontend**: React + Vite + TypeScript + Tailwind + shadcn/ui, scaffolded by Lovable.
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
- API keys: project is on the new `sb_publishable_*` / `sb_secret_*` key system (not the legacy anon/service_role JWTs — those return 401 against `/auth/v1` endpoints as of Phase 3.6.16).
  - **Publishable key** (client-side): `sb_publishable_*`. Read at build time from `VITE_SUPABASE_PUBLISHABLE_KEY` (Netlify + local `.env`) with a hardcoded fallback in `src/integrations/supabase/client.ts` so a missing env var doesn't break the app. Publishable keys are designed to be safely exposed in client bundles.
  - **Secret key** (server-side, Edge Functions only): `sb_secret_*`, stored as a Supabase secret on the server. Never inlined client-side.
- DB password: in Jimmie's password manager
- Security settings: Data API enabled, Auto-expose new tables OFF, Auto-RLS ON

## Routing

`src/App.tsx` mounts:
- `/` → `Dashboard` (auth) or stealth `Landing` (anon, via the `ProtectedRoute` wrapper)
- `/projects`, `/venues`, `/clients`, `/tasks` → HQ Core (Phase 5 polishes these)
- `/talent-scout` → Talent Scout index (admin)
- `/talent-scout/new/{details,search,scorecard}` → role-creation wizard
- `/talent-scout/roles/:id` → RoleDashboard
- `/talent-scout/roles/:id/settings` → role edit / close-reopen
- `/talent-scout/roles/:id/pulls/:pullRoundId` → PullDetail
- `/talent-scout/candidates/:id` → CandidateDetail
- `*` → 404

`/venue-scout/*` routes land in Phase 4.

## Realtime

The `supabase_realtime` publication starts empty on this project. Tables that the UI subscribes to via `postgres_changes` need:
1. Added to the publication: `alter publication supabase_realtime add table <name>;`
2. `REPLICA IDENTITY FULL` so UPDATE events carry the full new row.

Currently published: `ts_pull_rounds` (PullDetail subscribes for pull-progress UI). Other tables are unpublished by default; add as needed and document in `docs/schema.md`.

## Storage

Six private buckets, all behind RLS:
- `candidate_attachments` (admin only, Talent Scout)
- `packets` (admin only, Talent Scout — round + final-review packet PDFs, Phase 3.6)
- `briefs` (producer+, Venue Scout)
- `sourcing_sheets` (producer+, Venue Scout)
- `venue_photos` (read auth, write producer+, HQ + Venue Scout)
- `profile_avatars` (read auth, write own folder)

URLs are short-TTL signed URLs from `supabase.storage.createSignedUrl`. No public buckets.

See `docs/auth-model.md` for full bucket policies.

## Hosting + deploy

Netlify auto-deploys from GitHub `main` on every push. Per-branch preview URLs for non-main pushes. `netlify.toml` pins:
- Build command: `npm run build`
- Publish dir: `dist`
- SPA fallback redirect: `/* → /index.html` status 200 (so React Router can handle direct deep-links).

Env vars (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`) live in the Netlify Dashboard, not in `netlify.toml`. Vite reads them at build time. `src/integrations/supabase/client.ts` carries the same values as a hardcoded fallback so a missing env var won't break the app.

Production URL: `hq.mirrornyc.com` → resolves to `mirrornyc-hq.netlify.app`. Subdomain hookup done in Phase 6.3.

## Where things live

- Schema migrations: `supabase/migrations/*.sql`
- Edge Functions: `supabase/functions/<name>/index.ts`
- Shared backend code: `supabase/functions/_shared/*.ts`
- Frontend pages: `src/pages/**/*.tsx`
- Reusable UI: `src/components/**/*.tsx` (shadcn primitives in `src/components/ui/`)
- Hooks: `src/hooks/*.ts`
- Supabase client: `src/integrations/supabase/client.ts` (typed via `src/integrations/supabase/types.ts`, regenerated after schema changes)
- Helper scripts: `scripts/*.ts`
