# Drop-in prompt for the next Claude Code session

Paste everything below the line into a fresh chat to bring it up to speed.

---

You're picking up work on **Mirror NYC HQ**, the internal web app I'm building (I'm Jimmie Baugh, Senior Producer at Mirror NYC, an experiential events agency in NYC). I'm not a developer. You do the heavy backend lifting; I use Lovable for net-new UI scaffolding only.

## How I want you to talk to me

- Casual, direct, friend-who-knows-this-stuff tone.
- **No em dashes anywhere.**
- No filler affirmations ("Great question!", "Absolutely!", etc.).
- Concise by default, deeper when the task calls for it.
- Recommend, don't just present options. State the tradeoff plainly.
- Reference only the latest version of anything. If we iterated, the old version is gone.
- Don't fill in gaps. If something's unclear, ask me. Don't infer.

Full conventions live in `docs/conventions.md`.

## Stack at a glance

React + Vite + TS + Tailwind + shadcn/ui frontend. Supabase Postgres + Edge Functions + Storage + Realtime backend. Netlify hosting. Anthropic API + Google Workspace via service account. Production at `hq.mirrornyc.com`. Supabase project ref `amipjjmphblfxpghjnel`.

Monolith: one repo, one app, one DB. `/talent-scout` and `/venue-scout` are routes inside HQ.

## Where we are

**Phase 3.7 (Candidates UX + referral ingestion) shipped on 2026-05-08.** Squash-merge commit `2ab37c3`, production at `0dc0ca8` after the CHECKPOINT backfill. Branch `phase-3-7-candidates-ux` deleted.

**Current phase:** Phase 3.8 (cron + watchdogs). Not started yet. Cut a fresh `phase-3-8-cron-watchdogs` branch when work begins.

For full state, read these in order before doing anything:

1. **`PROJECT_STATUS.md`** (root) — what just shipped in 3.7, edge function deploy state, known drift.
2. **`NEXT_STEPS.md`** (root) — Phase 3.8 plan + pre-merge checklist + carried-forward gotchas.
3. **`CHECKPOINT.md`** (root) — living-state doc, latest commit hash, recent migrations, what's live vs not.
4. **`docs/decisions.md`** — long-lived architectural decisions with rationale (Phase 3.7 section is the most recent).
5. **`docs/roadmap.md`** — phase-by-phase plan; Phase 3.7 is now summarized as DONE, Phase 3.8 has full detail.
6. **`docs/schema.md`** — current DB schema, source of truth for tables/columns/enums.

Also useful:
- `CLAUDE.md` (project root) — the project bible. Item 8 is the deploy policy.
- `docs/edge-functions.md` — every edge function and its `verify_jwt` posture.
- `docs/architecture.md`, `docs/auth-model.md`, `docs/cron-jobs.md`, `docs/conventions.md`, `docs/operations.md`.

## Deploy policy (active through all of Phase 3.X)

Captured in `CLAUDE.md` item 8.

- Netlify charges credits per deploy. Feature work lives on a feature branch.
- **No commits to main, no pushes to main, no pushes to origin feature branch** unless the HEAD commit message has `[skip netlify]`.
- The single Netlify-deploy event per phase is the squash-merge to `main`, and only when Jimmie explicitly approves.
- Edge function deploys (`supabase functions deploy`) and DB migrations (`supabase db push --linked`) don't touch Netlify and are fine during feature work.

## Things that bit us in past sessions (worth keeping in mind)

- **`useBlocker` from react-router-dom v6 throws under plain `<BrowserRouter>`.** HQ stays on plain BrowserRouter; don't reintroduce useBlocker.
- **Always hoist hooks above any early return.** `useMemo` / `useState` below an early-return causes "Rendered more hooks than during the previous render" / black screen.
- **TypeScript build doesn't catch every JSX-name typo.** A component used but not imported can pass `tsc` and the production build, only to crash at runtime.
- **Don't pipe `supabase gen types --linked` directly into `src/integrations/supabase/types.ts`.** Shell `>` truncates first; if gen fails the file is empty. Use `/tmp` + `test -s` + `mv`.
- **Local dev runs at `http://127.0.0.1:8080/`**, not `localhost:8080`. Vite binds IPv6.
- **Mailto fix:** use `inline-block max-w-full truncate align-bottom` on the `<a>`, not `block truncate` (which makes the entire column clickable).
- **`supabase functions logs` may not be in Jimmie's CLI** depending on version. Use the dashboard at `https://supabase.com/dashboard/project/amipjjmphblfxpghjnel/functions/<name>/logs`.
- **Slider track + score-bar track use `bg-input`** (not `bg-secondary`) so they're visible on `bg-surface-alt` Mirror grey card surfaces.
- **`mirrornyc.com` is in `BLOCKED_PORTFOLIO_DOMAINS`** — don't remove it; manager email signatures embed the URL and we need it filtered.

## Start here

Read `PROJECT_STATUS.md`, `NEXT_STEPS.md`, and `CHECKPOINT.md` in that order. Then check in with me on whether Phase 3.8 work starts now or there's something else first.
