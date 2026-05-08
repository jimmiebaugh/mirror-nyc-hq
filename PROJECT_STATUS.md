# Project Status

## Where we are

- **Production:** `hq.mirrornyc.com` at `0dc0ca8` (CHECKPOINT backfill on top of `2ab37c3` Phase 3.7 squash-merge).
- **Active branch:** none. `phase-3-7-candidates-ux` was squash-merged and deleted (locally + origin).
- **Current phase:** Phase 3.8 (cron + watchdogs) — not started yet.

## What just shipped (Phase 3.7)

Squash-merged 2026-05-08 at commit `2ab37c3`. Spans 3.7.1 through 3.7.8.18. Highlights:

- **Schema (6 migrations, all applied to remote):** `ts_candidates.manually_reviewed`, `is_referral`, `referrer_email`; `global_settings.talent_scout_competitor_list text[]` with default 19-entry seed; `auto_rejected` enum value deprecated (backfilled).
- **Referral ingestion:** `*@mirrornyc.com` forwards detected; chain-walking parser handles Gmail / Apple Mail (desktop + mobile) / `message/rfc822` / reply-quote attributions; every `@mirrornyc.com` manager's commentary along the chain captured into `internal_notes` (Mirror sigs stripped); folded into FIRST eval via `HIRING MANAGER NOTES:`; `mirrornyc.com` blocked from portfolio URL extraction.
- **Manual-review gating:** `manually_reviewed` flag (one-way auto → manual flip); re-eval respects it (updates score/breakdown/strengths/gaps but not status); bulk re-eval defaults to `not_manually_rejected`.
- **Scorecard 100-pt cap:** post-Claude weight normalizer in `ts-generate-scorecard`.
- **Global Settings page** at `/talent-scout/settings` (admin only) for editing the global competitor list.
- **UI overhaul:** top nav reduced to Dashboard + Talent Scout; Mirror grey card surfaces; in-card "MASTER POOL · from all rounds" header on the master-pool table; CandidateTable typography rebalanced (name 15px, score 14px with 80px proportional bar on visible track, R+P stacked text-button column at 13px); CandidateDetail header cluster simplified (Re-evaluate 160px full-height + auto/manual + referral pills + status dropdown stack; tier pill removed); Score Breakdown with vertical muted-grey tier dividers; PullDetail title-leads + matched-height pills; pull-running 4-step checklist driven by realtime; toasts default to coral.

Full decision rationale lives in `docs/decisions.md` (Phase 3.7 section). Schema diff in `docs/schema.md`.

## Edge function deploy state

All deployed at the latest shared-module versions:
- `ts-pull-candidates` (3.7.8.16)
- `ts-evaluate-candidate` (3.7.8.15)
- `ts-final-review` + `ts-generate-scorecard` (re-deployed pre-merge to pick up `_shared/prompts.ts` 3.7.6.9 update)
- `ts-bulk-reevaluate`, `ts-packet-generate`, `ts-final-review-packet` stable — only import shared modules unchanged in 3.7

## Known drift / cleanup queued

- `ts_pull_rounds.reeval_last_progress_at` — dead column since Phase 3.5 moved bulk-reeval state to `ts_roles`. Drop in a future migration.
- `auto_rejected` enum value deprecated but kept for safety. Cleanup requires enum rebuild — not worth it.
- `PACKET_FEATURE_ENABLED=false` in `PullDetail.tsx` and `FinalReviewDetail.tsx` until packet path is verified end-to-end post-WORKER_RESOURCE_LIMIT-fix.
- `CHECKPOINT.md` backfill commit (`0dc0ca8`) was pushed without `[skip netlify]` and probably triggered an extra Netlify deploy. Heads up for next time — non-feature commits to main should carry the marker.

## What's next

Phase 3.8: cron + watchdogs. See `NEXT_STEPS.md`.
