# Checkpoint

Living-state doc. The "Now" block below should answer "where is the project right now" inside 30 seconds. Update on every meaningful merge to `main`.

## Now

- **Latest ship:** Phase 5.16 (v1 wind-down cycle) — the 4 sub-phases (5.16.0 + 5.16.1.0 + 5.16.1.1 + 5.16.1.2) collapsed into ONE **consolidation squash** rebased onto Phase 5.15 (`1814867`), same pattern as the 5.15 consolidation. The tree is byte-identical to the per-sub-phase ships; this only collapses history. Cycle scope: freelance→standard flatten + `is_active_member()` DB tier hardening (~57 RLS rewrites); Vite 5→8 + tooling (bundle 603→584 KB); lint 191→0 full repo + ProjectDetail split + `.tbl` canon flip + delimiter fix; Supabase advisor focused (bulk-import + trigger-fn GRANT lockdown, 2 init-plan wraps, 6 FK indexes, 12 SECURITY DEFINER warnings documented); `xlsx`→SheetJS (frontend lazy CDN; edge `vs-parse-sheet` vendored patched 0.20.3) + `qs` fix (`npm audit` 0); Database types in the Deno tree (Edge #18); `logClaudeUsage` pruned (Edge #19); HQ Bulk Import column-mapping UI (Frontend #50); Phase B name-schema wording locked (Edge #13). 3 migrations + 21 edge-fn redeploys live across the cycle. Lint 0, build green (~584 KB). Per-sub-phase detail in `docs/decisions.md` § Phase 5.16.* ; narrative in `docs/v1-changelog.md` § 5.16. **Self-SHA placeholder `<pending consolidation squash>` backfills to the real consolidation SHA in the Phase 6.0 doc sweep** (per [[feedback_no_standalone_backfill_commits]]).

- **Currently deployed to production:** Phase 5.16 consolidation (`<pending consolidation squash>`) on the frontend (force-pushed to `main`; deploy fired). The cycle's 3 migrations + all touched edge functions are already live (applied / deployed out-of-band during the sub-phases), so the force-push tree is byte-identical to the per-sub-phase ships and the rebuild is wasted-but-harmless. Predecessors: 5.15 (`1814867`), 5.14 (`4e67f12`), 5.13 (`2393840`), 5.12 (`ed81c38`).
- **Recent commits** (newest first, last 5):
  - `<pending consolidation squash>` Phase 5.16: v1 wind-down cycle (4 sub-phases collapsed); see `docs/v1-changelog.md` § 5.16 + `docs/decisions.md` § Phase 5.16.*
  - `1814867` Phase 5.15: Anthropic per-tool call-log infra + spend breakdown surface (4 sub-phases collapsed)
  - `4e67f12` Phase 5.14: venue photo persistence (persist at deck-gen + pre-populate at research seed)
  - `2393840` Phase 5.13: Talent Scout review (complete) + project doc clean-up
  - `ed81c38` Phase 5.12: Venue Scout full audit + UX update + cleanup
- **Recent migrations:** all 3 applied to live out-of-band during the 5.16 cycle — `20260612000000_phase_5_16_1_2_advisor_focused.sql` (bulk-import + trigger-fn GRANT lockdown, 2 RLS init-plan wraps, 6 FK indexes; no schema/type change), `20260611000000_phase_5_16_1_1_briefs_dedupe_policy.sql` (briefs storage-policy dedupe), `20260610000000_phase_5_16_0_freelance_flatten_and_tier_hardening.sql` (`is_active_member()` helper + ~57 RLS rewrites).
- **Next phase:** **Phase 6.0** — post-v1 full-site smoke + punch list (the work formerly numbered "5.17 final smoke"; renumbered at the v1 close). The v1 build cycle closes with this 5.16 consolidation.
- **Last updated:** 2026-05-28 (Phase 5.16 consolidation rebase).

## What's where

- Full per-phase ship history → `docs/v1-changelog.md`.
- Architectural decisions with rationale → `docs/decisions.md`.
- Forward plan + active-phase detail → `docs/roadmap.md`.
- Schema → `docs/schema.md`. Edge functions → `docs/edge-functions.md`. Auth/RLS/storage → `docs/auth-model.md`. Cron → `docs/cron-jobs.md`. Operations → `docs/operations.md`.
- Passive code findings → `code-observations.md`.
- Recent commits → `git log`. Recent migrations → `supabase/migrations/`.

## Known drift / open carry-forwards

Only items that need a fresh eye to act on. Items already triaged into a phase plan or `code-observations.md` belong there, not here.

- **Phase B `name` schema wording LOCKED 2026-05-28** (0 iterations; `code-observations.md` Edge #13 closed).
- **Both xlsx smokes PASSED 2026-05-28:** HQ Bulk Import real `.xlsx` (frontend browser CDN import) + Venue Scout sheet upload (vendored edge xlsx 0.20.3). `npm audit` 0; lint 0.
- **DateRangePicker HQ lift deferred** to its own sub-phase (display-string/range-only API vs HQ's ISO `date` columns; a faithful lift needs a dual-contract picker extension). `code-observations.md` Frontend #43.
- **Phase 6.0 carry-forwards:** RLS-helper `internal`-schema relocation (decisions § 5.16.1.2 D8); revisit the ~25 unused-index drops once production scan stats are meaningful (D6); the ~30 audit-column FK indexes (D7); RoleSettings.tsx + ProjectEdit.tsx god-file splits (Frontend #19 remainder); HQ Core list-page `.tbl-list` sweep; `vs-generate-deck` neighborhood auto-add into `public.neighborhoods`; VS research-accuracy C3 URL accuracy; per-scout / per-role drilldown UI; month-selector / custom-range UI; toggle-state navigation persistence.

(Self-SHA `<pending consolidation squash>` in CHECKPOINT / changelog / roadmap / decisions backfills to the real consolidation SHA in the Phase 6.0 doc sweep — no standalone deploy-firing commit.)

## How to update this file

On every meaningful merge and every push to `main`:

1. Bump **Last updated** to today.
2. Replace **Active phase** with the new sub-phase: status + commit hash + pointers to its `docs/decisions.md` entry and (once it deploys) its `docs/v1-changelog.md` section.
3. Update **Currently deployed to production** if the push fired a Netlify deploy.
4. Add anything to **Known drift** that doesn't fit an existing phase plan or observation row.

History does not live here. Phase-by-phase ship narrative belongs in `docs/v1-changelog.md`. Decisions belong in `docs/decisions.md`. Recent commits + recent migrations belong in `git log` and `supabase/migrations/`.
