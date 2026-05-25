# Checkpoint

Living-state doc. The "Now" block below should answer "where is the project right now" inside 30 seconds. Update on every meaningful merge to `main`.

## Now

- **Latest ship:** Phase 5.11 — UX/design-system audit + structural consistency + docs reorg. Marker commit `<5.11>` (SHA backfills on next ship). Combines what was 5.11.0 + 5.11.1 + 5.11.2 + the follow-on docs-cleanup pass into one squashed commit per the X.X-per-ship convention.
- **Currently deployed to production:** Phase 5.11 (this commit). Pushing fires the Netlify deploy carrying everything since the v1 audit-pass build (`34b32d4`).
- **Next sub-phase per roadmap:** Phase 5.12 (Venue Scout review).
- **Last updated:** 2026-05-23.

## What's where

- Full per-phase ship history → `docs/v1-changelog.md`.
- Architectural decisions with rationale → `docs/decisions.md`.
- Forward plan + active-phase detail → `docs/roadmap.md`.
- Schema → `docs/schema.md`. Edge functions → `docs/edge-functions.md`. Auth/RLS/storage → `docs/auth-model.md`. Cron → `docs/cron-jobs.md`. Operations → `docs/operations.md`.
- Passive code findings → `code-observations.md`.
- Recent commits → `git log`. Recent migrations → `supabase/migrations/`.

## Known drift / open carry-forwards

Only items that need a fresh eye to act on. Items already triaged into a phase plan or `code-observations.md` belong there, not here.

- **esbuild dev-only SSRF advisory.** Deferred until the dedicated Vite 5 → 8 upgrade phase (a Phase 5.8 carry-forward).
- **Lint baseline ~192 problems** tracked in `code-observations.md` Build & Tooling #3; build does not gate on lint.
- **Owner-decision rows on observations:** Build & Tooling #2 (`@testing-library/react` keep or drop) and Frontend #16 (`IconStar` keep or prune). One-line calls from Jimmie unblock them.

## How to update this file

On every meaningful merge to `main`:

1. Bump **Last updated** to today.
2. Replace **Active phase** with the new sub-phase: status + commit hash + pointers to its `docs/decisions.md` entry and (once it deploys) its `docs/v1-changelog.md` section.
3. Update **Currently deployed to production** if the push fired a Netlify deploy.
4. Add anything to **Known drift** that doesn't fit an existing phase plan or observation row.

History does not live here. Phase-by-phase ship narrative belongs in `docs/v1-changelog.md`. Decisions belong in `docs/decisions.md`. Recent commits + recent migrations belong in `git log` and `supabase/migrations/`.
