# Mirror NYC HQ

Internal operations app for Mirror NYC, an experiential agency in NYC. Replaces scattered Google Sheets and Drive folders with a relational, Notion-style central database, plus two embedded workflow modules (Talent Scout for hiring, Venue Scout for sourcing).

- **Production:** [hq.mirrornyc.com](https://hq.mirrornyc.com)
- **Stack:** React + Vite + TS + Tailwind + shadcn/ui (frontend), Supabase Postgres + Edge Functions + Storage + Realtime (backend), Netlify (hosting), Anthropic API + Google Workspace via service account (integrations).
- **Auth:** Google OAuth restricted to `@mirrornyc.com`. Four permission tiers: admin / standard / freelance / pending.

## Where to start

- [`CLAUDE.md`](CLAUDE.md) — project entry point + topic index.
- [`docs/`](docs/) — single source of truth (architecture, schema, auth, conventions, design system, decisions, roadmap, operations).
- [`CHECKPOINT.md`](CHECKPOINT.md) — living state; latest commit, recent commits, known drift.
- [`docs/v1-changelog.md`](docs/v1-changelog.md) — HQ v1 release notes (Phase 5.1 through 5.8.0).

## Local dev

```bash
npm install
npm run dev   # localhost:8080
npm run build
npm run lint
```

Local dev talks to the production Supabase project; there is no local Supabase stack. See [`docs/operations.md`](docs/operations.md) for migration + deploy + debug recipes.
