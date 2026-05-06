# Checkpoint

Living-state doc. Update on every meaningful merge to `main`.

**Last updated:** 2026-05-06
**Latest commit on main:** `f96e800` — Add netlify.toml: explicit Vite build config + SPA redirect fallback
**Current phase:** Phase 3.6 (Final review + packet) — not yet started
**Deployed at:** `https://hq.mirrornyc.com` (also `https://mirror-nyc-hq.netlify.app`)

## What's live in production

- Stealth coming-soon landing at `/` for unauthenticated visitors. Hidden sign-in trigger is the bottom "STRATEGY / DESIGN / PRODUCTION" line (no visible affordance, default cursor, not keyboard-focusable).
- Authenticated users land on Dashboard. `/projects` renders the projects list. Other HQ Core pages (`/venues`, `/clients`, `/tasks`) are `<ComingSoon />` stubs.
- Talent Scout is fully wired through Phase 3.5 for admin users:
  - Roles index, three-step new-role wizard, role settings (edit + close/reopen).
  - Pull pipeline (manual trigger; scheduled pulls land in Phase 3.7). End-to-end verified on a live role with $0.24 Anthropic spend on 4 candidates.
  - RoleDashboard with master pool, stat tiles, pull-round cards, two-tier candidate table with bulk actions.
  - PullDetail with same table + round-scoped re-eval (parallel fan-out, cancellable).
  - CandidateDetail with files & materials, internal notes auto-save, status dropdown, single re-evaluate.
- Netlify auto-deploys on push to `main`.

## What's NOT live yet

- Generate Final Review and Generate Packet buttons on RoleDashboard / PullDetail are placeholder-disabled. Phase 3.6 wires them.
- No cron jobs running yet (Phase 3.7).
- No notifications (Phase 3.8 + 5).
- Venue Scout routes (`/venue-scout/*`) don't exist yet (Phase 4).
- HQ Core pages beyond `/projects` are stubs (Phase 5).
- Anthropic spend tracking increments correctly but the cap-alert email path is a console-log stub.

## Recent commits

```
f96e800  Add netlify.toml: explicit Vite build config + SPA redirect fallback
a427116  Use authoritative Mirror wordmark SVG; bump landing logo + text 20%; restore HQ title metadata
568fa7a  Add coming-soon stealth landing with hidden sign-in trigger
ab21c58  Phase 3.5: Candidate detail, ts-evaluate-candidate, ts-bulk-reevaluate, master pool restructure, eval history retention, two-tier candidate table
1017720  Document verify_jwt=false + INTERNAL_API_SECRET pattern in auth model
```

## Recent migrations

```
20260506065157_grant_data_api_access.sql       Phase 2.4 — grant authenticated/service_role on initial schema
20260506061457_initial_schema.sql              Phase 2.2 — full schema (22 tables, enums, RLS, buckets)
20260506162543_phase_3_2_schema_augmentation.sql  Phase 3.2 — pending_candidates, ts_evaluations, cap_alert_sent_this_month
20260506175156_phase_3_4_pull_pipeline.sql     Phase 3.4 — operational columns on ts_pull_rounds, realtime publication, REPLICA IDENTITY FULL
(plus Phase 3.5 migrations: detected_links, location, promote→interview rename, reeval_* columns)
```

## Known issues / drift

- `ts_pull_rounds.reeval_last_progress_at` is dead (Phase 3.5 moved bulk-reeval state to `ts_roles`). Drop in a future cleanup migration.
- `monthly-spend-reset` cron not implemented yet — `cap_alert_sent_this_month` will not auto-reset on month boundary. Manual SQL reset works in the meantime (see `docs/operations.md`).
- Cap-alert email path in `_shared/anthropic.ts` is a console-log stub. Real email delivery lands in Phase 3.8.

## Next up

**Phase 3.6: Final review + packet.** See `docs/roadmap.md` for the full plan. Two new edge functions (`ts-final-review`, `ts-packet-generate`) plus FinalReviewLoading + FinalReviewDetail pages. Q5 reminder: read source's `generate-packet` vs `generate-final-review-packet` before implementing to confirm whether to build one function or two.

## How to update this file

Update on every meaningful merge to `main`:
1. Bump **Last updated** to today.
2. Bump **Latest commit on main** to the new HEAD hash + message.
3. Add the new commits to **Recent commits** (keep last 5).
4. Add new migrations to **Recent migrations** if any.
5. Move items between "What's live" / "What's NOT live yet" if behavior changed.
6. Add to "Known issues / drift" anything that needs a future cleanup pass.
7. Adjust **Current phase** + **Next up** when phase boundaries cross.
