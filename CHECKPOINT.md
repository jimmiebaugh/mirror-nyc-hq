# Checkpoint

Living-state doc. The "Now" block below should answer "where is the project right now" inside 30 seconds. Update on every meaningful merge to `main`.

## Now

- **Latest ship:** Phase 5.12 (Venue Scout review, complete). Full review cycle: 28 sub-phases shipped 2026-05-23 to 2026-05-27, collapsed into a single squash. Per-sub-phase narratives in `docs/v1-changelog.md`. Architectural decisions in `docs/decisions.md` (`.tbl` matrix decouple, back-crumb relocation to TopBar, Lookup Lists shared component, plus per-sub-phase decisions across the 5.12 cycle). 10 migrations + 9 edge functions touched cumulatively across the cycle; all applied out-of-band during the cycle. Roadmap renumbered (5.14/5.15/5.16/5.17). `1a01d3e` 2026-05-27.

- **Currently deployed to production:** Phase 5.11 (`d563bce`). **Netlify deploy pending:** the Phase 5.12 squash (`1a01d3e`) is pushed but Netlify deploys are currently locked; Jimmie unlocks Netlify after the push and the production frontend deploy fires from `1a01d3e`. Edge functions and migrations from the 5.12 cycle were applied out-of-band during the cycle (10 migrations applied; 9 edge functions touched across multiple redeploys: `vs-generate-deck`, `vs-research-venues`, `vs-compile-summaries`, `vs-parse-brief`, `vs-generate-brief-overview`, `vs-research-single-venue`, `vs-delete-scout`, `hq-generate-venue-about`, `vs-regenerate-venue-overview`). Phase 5.12.8 was CUT.
- **Recent commits** (newest first):
  - `1a01d3e` Phase 5.12: Venue Scout review (complete) — 28 sub-phases collapsed into one squash; per-sub-phase narratives in `docs/v1-changelog.md`
- **Recent migrations** (5.12 cycle — 10 files applied out-of-band; canonical list in `supabase/migrations/`):
  - `20260607000000_phase_5_12_10_venue_types_db_driven.sql` (Phase 5.12.10)
  - `20260606000000_phase_5_12_9_neighborhoods_lookup.sql` (Phase 5.12.9)
  - `20260605000000_phase_5_12_5_brief_data_shape_backfill.sql` (Phase 5.12.5)
  - `20260604120000_phase_5_12_4_1_deck_kickoff_lock.sql` (Phase 5.12.4.1)
  - `20260603220000_phase_5_12_3_vs_candidate_venues_dedupe_meta.sql` (Phase 5.12.3)
  - `20260603200000_phase_5_12_2_city_aliases_cleanup.sql` (Phase 5.12.2)
  - `20260603190000_phase_5_12_2_city_aliases.sql` (Phase 5.12.2)
  - `20260603180000_phase_5_12_2_backfill_scout_cities.sql` (Phase 5.12.2)
  - `20260603160000_phase_5_12_1_hq_pool_source_and_research_kickoff_lock.sql` (Phase 5.12.1)
  - `20260603140000_phase_5_12_0_drop_shortlist_sync_trigger.sql` (Phase 5.12.0)
- **Next sub-phase per roadmap:** Phase 5.12 VS review fully closed. Phase 5.13 (TS review) is NEXT per `docs/roadmap.md`. Queued future phases: Phase 5.14 venue photo persistence to HQ Venues DB; Phase 5.15 Anthropic per-tool call-log infra; Phase 5.16 DB tier hardening + freelance access + codebase triage; Phase 5.17 final smoke test + revisions. Queued carry-forwards (not yet slotted into a phase): HQ-wide `.tbl` canon flip (`code-observations.md` row #47, deferred); `vs-generate-deck` neighborhood auto-add into `public.neighborhoods` (5.12.13.3 carry-forward); VS research-accuracy C3 URL accuracy (logged in spec for future sub-phase).
- **Last updated:** 2026-05-27 (Phase 5.12 squash — full Venue Scout review cycle collapsed into single commit `1a01d3e`; Netlify deploy pending unlock).

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
