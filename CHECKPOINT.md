# Checkpoint

Living-state doc. Update on every meaningful merge to `main`.

**Last updated:** 2026-05-07
**Latest commit on main:** Phase 3.6: Final Review + Packet generation (squash-merged from `phase-3-6-final-review-packet`)
**Active feature branch:** none — Phase 3.6 merged. Phase 3.7 branch not yet cut.
**Current phase:** Phase 3.7 (Cron + watchdogs) — next up.
**Deployed at:** `https://hq.mirrornyc.com` (also `https://mirror-nyc-hq.netlify.app`).

## What's live in production

- **Mirror brand identity applied site-wide** (Phase 3.5b): coral `#BE4E44`, Montserrat ExtraBold display + Roboto Mono captions + Roboto body, dynamic `HQ` / `TALENT` / `VENUES` caption next to the M wordmark in the top nav based on which sub-app you're in. Brand spec lives in `docs/visual-audit/mirror-style-guide.md` with the deck-template authority (`BLANK DECK TEMPLATE (2026).pptx`).
- Stealth coming-soon landing at `/` for unauthenticated visitors. Hidden sign-in trigger is the bottom "STRATEGY / DESIGN / PRODUCTION" line (no visible affordance, default cursor, not keyboard-focusable).
- Authenticated users land on Dashboard. `/projects` renders the projects list. Other HQ Core pages (`/venues`, `/clients`, `/tasks`) are `<ComingSoon />` stubs.
- Talent Scout is fully wired through Phase 3.6 for admin users:
  - Roles index, three-step new-role wizard, role settings (edit + close/reopen).
  - Pull pipeline (manual trigger; scheduled pulls land in Phase 3.7).
  - RoleDashboard with master pool, stat tiles, pull-round cards, two-tier candidate table with bulk actions, "View Final Review" button when one exists.
  - PullDetail with the same shared CandidateTable + round-scoped re-eval (parallel fan-out, cancellable). R-pill left of role title.
  - CandidateDetail with portfolio card on top, files & materials, internal notes auto-save, status dropdown, single re-evaluate.
  - **Phase 3.6 final review** (`ts-final-review`): comparative AI ranking of the master pool, returns immediately, streams `step_progress` via Realtime, writes `final_rankings` (`{candidate_id, final_rank, final_tier, rationale, recruiter_note}` where `recruiter_note` is `string[]` max 3) to `ts_final_reviews`. FinalReviewDetail page renders the rankings table with rationale + bulleted recruiter note.
  - All three Talent Scout Claude prompts consolidated in `supabase/functions/_shared/prompts.ts`. Frontend mirror at `src/lib/talent-scout/defaultEvalPrompt.ts`.
- Netlify auto-deploys on push to `main`.

## What's NOT live yet

- **Packet generation UI is hidden** in the production UI behind `PACKET_FEATURE_ENABLED = false` flags in `PullDetail.tsx` and `FinalReviewDetail.tsx`. Edge Functions (`ts-packet-generate`, `ts-final-review-packet`) and `_shared/packetRender.ts` are deployed and wired, but the path needs end-to-end verification before un-hiding. Flip both flags to `true` to restore.
- No cron jobs running yet (Phase 3.7).
- No notifications (Phase 3.8 + 5).
- Venue Scout routes (`/venue-scout/*`) don't exist yet (Phase 4).
- HQ Core pages beyond `/projects` are stubs (Phase 5).
- Anthropic spend tracking increments correctly but the cap-alert email path is a console-log stub.

## Known issues / drift

- `ts_pull_rounds.reeval_last_progress_at` is dead (Phase 3.5 moved bulk-reeval state to `ts_roles`). Drop in a future cleanup migration.
- Packet path needs end-to-end verification after the WORKER_RESOURCE_LIMIT fix (signed-URL email body, no MIME attachment) before the UI flag flips back on. `ts-final-review` itself is verified end-to-end.
- `monthly-spend-reset` cron not implemented yet — `cap_alert_sent_this_month` will not auto-reset on month boundary. Manual SQL reset works in the meantime (see `docs/operations.md`).
- Cap-alert email path in `_shared/anthropic.ts` is a console-log stub. Real email delivery lands in Phase 3.8.

## Recent commits (main)

```
Phase 3.6: Final Review + Packet generation (squash-merged from phase-3-6-final-review-packet)
0302c0c  Update CHECKPOINT post-Phase-3.5b merge
Phase 3.5b: Visual brand pass — passes 1 through 14, FF-merged from phase-3-5b-visual-brand
495a53f  Restructure docs: split CLAUDE.md into specialized docs, add CHECKPOINT.md
f96e800  Add netlify.toml: explicit Vite build config + SPA redirect fallback
```

## Recent migrations

```
20260506213340_phase_3_6_final_review_and_packets.sql  Phase 3.6 — ts_final_reviews enrichment (status enum, step_progress, packet_* metadata), ts_pull_rounds.packet_*, ts_candidates.email_body_text, packets storage bucket, realtime publication for ts_final_reviews (APPLIED to local + remote)
20260506065157_grant_data_api_access.sql       Phase 2.4 — grant authenticated/service_role on initial schema
20260506061457_initial_schema.sql              Phase 2.2 — full schema (22 tables, enums, RLS, buckets)
20260506162543_phase_3_2_schema_augmentation.sql  Phase 3.2 — pending_candidates, ts_evaluations, cap_alert_sent_this_month
20260506175156_phase_3_4_pull_pipeline.sql     Phase 3.4 — operational columns on ts_pull_rounds, realtime publication, REPLICA IDENTITY FULL
(plus Phase 3.5 migrations: detected_links, location, promote→interview rename, reeval_* columns)
```

## Next up

**Phase 3.7: Cron + watchdogs.** Schedule the things that currently require a manual button. `ts-cron-scheduled-pulls`, `ts-cron-pull-watchdog`, `ts-cron-reeval-watchdog`, `ts-cron-final-review-watchdog`, `ts-cron-storage-cleanup`. Plus `monthly-spend-reset` cron for `cap_alert_sent_this_month`. Cut a fresh `phase-3-7-cron-watchdogs` branch when starting.

**Side-quest before flipping packet UI back on:** verify `ts-final-review-packet` end-to-end after the WORKER_RESOURCE_LIMIT fix (signed-URL link in email body). Once verified, flip `PACKET_FEATURE_ENABLED` to `true` in `PullDetail.tsx` and `FinalReviewDetail.tsx`.

## How to update this file

Update on every meaningful merge to `main`:
1. Bump **Last updated** to today.
2. Bump **Latest commit on main** to the new HEAD hash + message.
3. Add the new commits to **Recent commits** (keep last 5).
4. Add new migrations to **Recent migrations** if any.
5. Move items between "What's live" / "What's NOT live yet" if behavior changed.
6. Add to "Known issues / drift" anything that needs a future cleanup pass.
7. Adjust **Current phase** + **Next up** when phase boundaries cross.
