# Checkpoint

Living-state doc. Update on every meaningful merge to `main`.

**Last updated:** 2026-05-08
**Latest commit on main:** `b70f0e9` Phase 3.10 — scorecard refinement step (squash-merged from `phase-3-10-scorecard-refine`)
**Active feature branch:** none — `phase-3-10-scorecard-refine` was squash-merged. Next branch is `phase-4-venue-scout` when Phase 4 starts. Per Jimmie's deploy policy, all 3.X / 4.X feature work stays on a branch (no commits / no origin pushes without `[skip netlify]`); the only Netlify-deploy event per phase is the squash-merge to `main`.
**Current phase:** Phase 4 — Venue Scout port (next).
**Deployed at:** `https://hq.mirrornyc.com` (also `https://mirrornyc-hq.netlify.app`).

## What's live in production

- **Mirror brand identity applied site-wide** (Phase 3.5b): coral `#BE4E44`, Montserrat ExtraBold display + Roboto Mono captions + Roboto body, dynamic `HQ` / `TALENT` / `VENUES` caption next to the M wordmark in the top nav based on which sub-app you're in. Brand spec lives in `docs/visual-audit/mirror-style-guide.md` with the deck-template authority (`BLANK DECK TEMPLATE (2026).pptx`).
- Stealth coming-soon landing at `/` for unauthenticated visitors. Hidden sign-in trigger is the bottom "STRATEGY / DESIGN / PRODUCTION" line (no visible affordance, default cursor, not keyboard-focusable).
- Authenticated users land on Dashboard. Top nav reduced to `Dashboard` + `Talent Scout` (admin) only — Projects / Venues / Clients / Tasks reachable by drilling in from the Dashboard tile grid.
- Talent Scout is fully wired through Phase 3.7 for admin users:
  - Roles index, three-step new-role wizard, role settings (edit + close/reopen) with sticky save bar + re-eval-trigger confirm dialogs.
  - Pull pipeline (manual trigger; scheduled pulls land in Phase 3.8). Running-state UI shows a 4-step checklist (search → dedupe → process → save) live-updating via Realtime.
  - **Referral ingestion**: `ts-pull-candidates` detects forwards from `*@mirrornyc.com` to `jobs@mirrornyc.com`, unwraps the chain to find the original applicant. Handles standard Gmail forwards, Apple Mail desktop + mobile (`Begin forwarded message:` and `On <date> <Name> <<email>> wrote:` reply-quote attributions), and forward-as-attachment (`message/rfc822`). Captures any `@mirrornyc.com` manager's commentary along the chain into `ts_candidates.internal_notes` (Mirror signatures stripped) so it factors into the FIRST evaluation via the `HIRING MANAGER NOTES:` block in the candidate bundle. `mirrornyc.com` blocked from portfolio URL extraction so manager signatures don't leak as portfolio links.
  - RoleDashboard with Mirror-grey section cards, master pool table titled in-card ("MASTER POOL · from all rounds"), stat tiles, pull-round cards, two-tier candidate table with bulk actions, "View Final Review" button when one exists.
  - PullDetail: title leads, RX + status (Running / Failed) + Latest pills follow at matched height. Same shared CandidateTable + round-scoped re-eval (parallel fan-out, cancellable).
  - CandidateTable: Resume + Portfolio collapsed into one stacked text-button column (no header text), candidate column 220px, score bar proportional fill on `bg-input` track, status column elements (StatusDropdown + ReviewedPill + ReferralPill) at 12px text. ReferralPill is electric blue (Mirror coral was tried in 3.7.8.8 and reverted in 3.7.8.13 because the brand color blended into too many other coral surfaces).
  - CandidateDetail with header cluster simplified: Re-evaluate button (160px wide, full-height of left column) + right-column stack (auto/manual + referral pills on top, status dropdown on bottom). Tier pill removed (overlapped with status). Score Breakdown with vertical muted-grey tier dividers + tighter criterion rows. Internal Notes editor pre-populated when the candidate is a referral with manager commentary.
  - **Phase 3.6 final review** (`ts-final-review`): comparative AI ranking of the master pool, returns immediately, streams `step_progress` via Realtime, writes `final_rankings` (`{candidate_id, final_rank, final_tier, rationale, recruiter_note}` where `recruiter_note` is `string[]` max 3) to `ts_final_reviews`. FinalReviewDetail page renders the rankings table with rationale + bulleted recruiter note.
  - **Global Settings** (admin only) under `/talent-scout/settings`: global competitor list edit (Postgres `text[]`, seeded with Mirror's 19-entry default), default applicable to all roles unless overridden per-role. Phase 3.8 added Anthropic Monthly Spend Cap input + inline current-spend display (coral $X.XX).
  - All three Talent Scout Claude prompts consolidated in `supabase/functions/_shared/prompts.ts`. Frontend mirror at `src/lib/talent-scout/defaultEvalPrompt.ts` (manually synced; verified byte-for-byte at 3.7.7.6).
  - Toasts site-wide use solid Mirror coral with white text (Sonner + Radix Toast both default to coral).
- **Phase 3.8 + 3.9 cron + watchdog infrastructure committed** (squash-merge `e855ffb`): six new edge functions (`ts-cron-scheduled-pulls`, `ts-cron-pull-watchdog`, `ts-cron-reeval-watchdog`, `ts-cron-final-review-watchdog`, `ts-cron-storage-cleanup`, `ts-cron-monthly-spend-reset`), `ts-send-pull-notification` for pull-completion email, real cap-alert email path via `_shared/sendEmail.ts`, two migrations (extensions + schedules + dead-column drop). Watchdogs detect-and-flag only (pull 60min stall, re-eval 30min, final-review 20min). Production wiring still pending — see `NEXT_STEPS.md` § 2.
- **Phase 3.10 scorecard refinement** (squash-merge `b70f0e9`): new `ts-refine-scorecard` edge function. The wizard step-3 page and Edit Role page both surface a Process / Save button morph — when scorecard has unrefined edits, the action runs the refine pass; once clean, it flips back to Lock (wizard) or Save (Edit Role, which triggers bulk re-eval). Server-side dead-criterion drop (weight=0 OR empty name+describer) plus defense-in-depth merge that restores `tier`/`weight`/`is_disqualifier`/`is_manual` from user input regardless of model output.
- Netlify auto-deploys on push to `main`.

## What's NOT live yet

- **Packet generation UI is hidden** in the production UI behind `PACKET_FEATURE_ENABLED = false` flags in `PullDetail.tsx` and `FinalReviewDetail.tsx`. Edge Functions (`ts-packet-generate`, `ts-final-review-packet`) and `_shared/packetRender.ts` are deployed and wired, but the path needs end-to-end verification before un-hiding. Flip both flags to `true` to restore.
- Cron schedules are committed but require runtime activation: production GUCs (`app.supabase_url` + `app.internal_api_secret`) need to be set in Supabase SQL editor before the schedules will fire. Until then they're scheduled-but-noop. See `NEXT_STEPS.md` § 2a.
- All Phase 3.8 edge functions need to be deployed via `supabase functions deploy <name>` (cron functions + `ts-send-pull-notification` + re-deploys for `ts-pull-candidates` and any function that imports `_shared/anthropic.ts`).
- Phase 3.8 migrations need to be pushed: `supabase db push --linked`.
- Venue Scout routes (`/venue-scout/*`) don't exist yet (Phase 4).
- HQ Core pages beyond `/projects` are stubs (Phase 5).
- In-app notifications bell (Phase 5). Pull-completion email is live; bell + per-user prefs come later.

## Known issues / drift

- `auto_rejected` enum value is deprecated (Phase 3.7.2.1 backfilled to `reject` + `manually_reviewed=false`) but kept in the enum for safety. New writes never use it. Cleanup requires enum rebuild — not worth it now.
- Packet path needs end-to-end verification after the WORKER_RESOURCE_LIMIT fix (signed-URL email body, no MIME attachment) before the UI flag flips back on. `ts-final-review` itself is verified end-to-end.

## Recent commits (main)

```
b70f0e9  Phase 3.10: scorecard refinement step (squash-merged from phase-3-10-scorecard-refine)
e855ffb  Phase 3.8 + 3.9: cron + watchdogs + pull notification (squash-merged from phase-3-8-cron-watchdogs)
2ab37c3  Phase 3.7: Candidates UX + referral ingestion (squash-merged from phase-3-7-candidates-ux)
Phase 3.6: Final Review + Packet generation (squash-merged from phase-3-6-final-review-packet)
0302c0c  Update CHECKPOINT post-Phase-3.5b merge
```

## Recent migrations

```
20260508120001_phase_3_8_drop_dead_reeval_progress_column.sql   Phase 3.8 — drop ts_pull_rounds.reeval_last_progress_at (dead since Phase 3.5) (PENDING db push)
20260508120000_phase_3_8_cron_extensions_and_schedules.sql      Phase 3.8 — pg_cron + pg_net + invoke_edge_function helper + six cron schedules (PENDING db push)
20260508005206_phase_3_7_7_referral_columns.sql                 Phase 3.7.7 — is_referral boolean + referrer_email text on ts_candidates (APPLIED)
20260508002545_phase_3_7_6_force_competitor_default.sql         Phase 3.7.6 — idempotent DO block: INSERT row if missing OR UPDATE if column empty for global competitor list (APPLIED)
20260507225501_phase_3_7_6_default_competitor_list.sql          Phase 3.7.6 — conditional UPDATE seeding the default 19-entry global competitor list (APPLIED)
20260507221645_phase_3_7_5_global_competitor_list.sql           Phase 3.7.5 — global_settings.talent_scout_competitor_list text[] column (APPLIED)
20260507092912_phase_3_7_deprecate_auto_rejected.sql            Phase 3.7.2.1 — backfill auto_rejected rows to reject + manually_reviewed=false (APPLIED)
20260507092102_phase_3_7_manually_reviewed.sql                  Phase 3.7.2 — ts_candidates.manually_reviewed boolean default false (APPLIED)
```

## Next up

**Production wiring for Phase 3.8.** Order: set GUCs → push migrations → regen types → deploy 12 edge functions. Then runtime validations (cron sanity, watchdogs scan-and-zero, pull-completion email round-trip). Full step-by-step in `NEXT_STEPS.md` (root).

**Phase 4: Venue Scout port** after wiring + validations are clean. Cut a fresh `phase-4-venue-scout` branch when ready.

**Carried-forward cleanup queued:**
- Verify `ts-final-review-packet` end-to-end after the WORKER_RESOURCE_LIMIT fix, then flip `PACKET_FEATURE_ENABLED` to `true` in `PullDetail.tsx` and `FinalReviewDetail.tsx`.

## How to update this file

Update on every meaningful merge to `main`:
1. Bump **Last updated** to today.
2. Bump **Latest commit on main** to the new HEAD hash + message.
3. Add the new commits to **Recent commits** (keep last 5).
4. Add new migrations to **Recent migrations** if any.
5. Move items between "What's live" / "What's NOT live yet" if behavior changed.
6. Add to "Known issues / drift" anything that needs a future cleanup pass.
7. Adjust **Current phase** + **Next up** when phase boundaries cross.
