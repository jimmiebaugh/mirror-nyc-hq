# Checkpoint

Living-state doc. The "Now" block below should answer "where is the project right now" inside 30 seconds. Update on every meaningful merge to `main`.

## Now

- **Latest ship:** Phase 5.14 (venue photo persistence, backend-only). `vs-generate-deck`: new `persistVenuePhotosToHq` step after `pushVenuesToHq` downloads each candidate's finalized `vs_venue_photos` to the HQ `venue_photos` bucket at `<venue_id>/photo_<slot>.<ext>` and updates `venues.photos` with a 4-element array. `vs-research-venues`: all three hq_pool INSERT paths now seed `vs_venue_photos` from stored HQ photos — `loadHqVenuesIntoPool` deterministic-keep, Phase B seed-then-drop, and `rescueHqPoolFitVetoedVenues`. All three `[hqPoolPhotoSeed]` telemetry lines carry `path=load/seed_then_drop/rescue`. No migration (existing `venues.photos` column + `venue_photos` bucket). Two edge functions; no frontend.

- **Currently deployed to production:** Phase 5.11 (`fee051e`). **Netlify deploy now live:** Phase 5.14 squash is on `main`; Netlify deploy fired. Edge functions deployed: `vs-generate-deck` + `vs-research-venues`.
- **Recent commits** (newest first):
  - `bf2cb67` Phase 5.14: venue photo persistence — persist at deck-gen + pre-populate at research seed (all paths)
  - `9e15841` Phase 5.13: Talent Scout review (complete) + project doc clean-up, 7 sub-phases collapsed into one squash
  - `ed81c38` Phase 5.12: Venue Scout full audit + UX update + cleanup — 28 sub-phases collapsed; per-sub-phase narratives in `docs/v1-changelog.md`
  - `fee051e` Phase 5.11: UX/design-system audit + structural consistency + docs reorg
  - `55bfee1` Phase 5.10: venues.about_venue rename + AI About Venue generator + Venue Edit/Detail refresh + v1 codebase triage cleanup
  - `81cdaf2` Phase 5.9: Bulk import (Projects/Vendors/Venues) + audit page + undo + event-day-rate/email
- **Recent migrations:** None for Phase 5.14. Last migrations were the 5.12 cycle (10 files applied out-of-band; canonical list in `supabase/migrations/`).
- **Next sub-phase per roadmap:** Phase 5.14 complete. **Phase 5.15** (Anthropic per-tool call-log infra) is next. Queued future phases: Phase 5.16 DB tier hardening + freelance access + codebase triage; Phase 5.17 final smoke test + revisions. Queued carry-forwards: HQ-wide `.tbl` canon flip (`code-observations.md` row #47, deferred); `vs-generate-deck` neighborhood auto-add into `public.neighborhoods` (5.12.13.3 carry-forward); VS research-accuracy C3 URL accuracy; VenueDetail photo display (Phase 5.15+ per D7).
- **Last updated:** 2026-05-28 (Phase 5.14).

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

On every meaningful merge and every push to `main`:

1. Bump **Last updated** to today.
2. Replace **Active phase** with the new sub-phase: status + commit hash + pointers to its `docs/decisions.md` entry and (once it deploys) its `docs/v1-changelog.md` section.
3. Update **Currently deployed to production** if the push fired a Netlify deploy.
4. Add anything to **Known drift** that doesn't fit an existing phase plan or observation row.

History does not live here. Phase-by-phase ship narrative belongs in `docs/v1-changelog.md`. Decisions belong in `docs/decisions.md`. Recent commits + recent migrations belong in `git log` and `supabase/migrations/`.
