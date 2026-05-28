# Checkpoint

Living-state doc. The "Now" block below should answer "where is the project right now" inside 30 seconds. Update on every meaningful merge to `main`.

## Now

- **Latest ship:** Phase 5.15 (Anthropic per-tool call-log infra + spend breakdown surface). 4 sub-phases collapsed into one squash. New `anthropic_call_log` table (per-row Claude API spend, 12-month retention pruned by `ts-cron-monthly-spend-reset`) + `public.anthropic_spend_breakdown(window_kind text default 'month', window_iso text default null)` SECURITY DEFINER RPC supporting both calendar-month and calendar-year windows. `callClaude` wrapper writes a log row after `trackSpendAndAlert` (non-fatal); `CallClaudeOptions` gains optional `scout_id` + `role_id`; caller sweep threads ids across the VS + TS pipelines. Cap-control consolidation: HQ Admin Settings becomes the canonical cap-edit surface; TS + VS Settings flip to read-only spend displays. UX: new `<AnthropicSpendBreakdownTable>` with `appFilter` + `window` props; Month / Year `.viewswitch` toggle in the breakdown header row on all three Settings consumers; HQ Cap-card spend display scales (of $Y cap / of $Y annualized). CSS: `.scout-list-tbl` renamed globally to `.tbl-list`; `.tbl-divider` repainted to muted coral with wrapper-aware selector. Cron `ts-cron-monthly-spend-reset` gains a 12-month log prune.

- **Currently deployed to production:** Phase 5.15 collapsed (`e9a382e`). History-rewrite rebase replaced the four prior 5.15.x commits on `origin/main`. Both migrations + 11 edge function redeploys already on live (unchanged from the four-commit state). Builds on Phase 5.14 (`4e67f12`).
- **Recent commits** (newest first):
  - `e9a382e` Phase 5.15: Anthropic per-tool call-log infra + spend breakdown surface — 4 sub-phases collapsed; per-phase narratives in `docs/v1-changelog.md`
  - `4e67f12` Phase 5.14: venue photo persistence — persist at deck-gen + pre-populate at research seed (all paths)
  - `2393840` Phase 5.13: Talent Scout review (complete) + project doc clean-up, 7 sub-phases collapsed into one squash
  - `ed81c38` Phase 5.12: Venue Scout full audit + UX update + cleanup — 28 sub-phases collapsed; per-sub-phase narratives in `docs/v1-changelog.md`
  - `fee051e` Phase 5.11: UX/design-system audit + structural consistency + docs reorg
  - `55bfee1` Phase 5.10: venues.about_venue rename + AI About Venue generator + Venue Edit/Detail refresh + v1 codebase triage cleanup
- **Recent migrations:** `20260609000000_phase_5_15_3_spend_breakdown_window.sql` (Phase 5.15: drop old `anthropic_spend_breakdown(text)`, create new `(window_kind text default 'month', window_iso text default null)`) + `20260608000000_phase_5_15_anthropic_call_log.sql` (Phase 5.15: `anthropic_call_log` table + 4 indexes + admin-only RLS + original breakdown RPC). Both applied out-of-band via `supabase db push --linked`; types regenerated. Predecessor: 5.14 had no migration; prior set was the 5.12 cycle (10 files).
- **Next sub-phase per roadmap:** Phase 5.15 complete (4 sub-phases collapsed). **Phase 5.16** (DB tier hardening + freelance project-contributor access + codebase triage) is next; spec at `OUTPUTS/phase-5-16-0-spec.md`. Then Phase 5.17 final smoke test + revisions. Queued carry-forwards: HQ-wide `.tbl` canon flip (`code-observations.md` row #47, deferred); HQ Core list-page sweep to adopt `.tbl-list` (deferred from 5.15); `vs-generate-deck` neighborhood auto-add into `public.neighborhoods` (5.12.13.3 carry-forward); VS research-accuracy C3 URL accuracy; VenueDetail photo display (Phase 5.15+ per 5.14 D7); per-scout / per-role drilldown UI deferred from 5.15; `SpendCapCard` rename to `AnthropicSpendCard` deferred from 5.15; month-selector / custom-range UI deferred from 5.15 (RPC's `window_iso` param exposed for it); toggle-state navigation persistence deferred from 5.15.
- **Last updated:** 2026-05-28 (Phase 5.15 consolidation rebase).

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
