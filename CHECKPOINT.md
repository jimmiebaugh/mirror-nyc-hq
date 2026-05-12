# Checkpoint

Living-state doc. Update on every meaningful merge to `main`.

**Last updated:** 2026-05-12
**Latest commit on `main`:** `6532235` (URL-quality patch + Phase 4.6 stack). The failed-attempt Phase 4 work (Scout Dashboard through Deck Prep) is archived on `main` and is no longer the canonical Venue Scout. See `OUTPUTS/COWORK_SYNC.md` 2026-05-11 for the pivot trail.
**Active feature branch:** `vs-port-fresh` (branched off `dd38577`). Accumulates the 1:1 port from `mirror-nyc-venue-scout-pro` per `docs/venue-scout-port-plan.md`. Active sub-phase worktree: `claude/vs-port-4-5-researching` at `.claude/worktrees/vs-port-4-5-researching/`.
**Latest commit on `vs-port-fresh`:** `6c98137` (4.4-port backfill); 4.5-port awaits squash. Worktree HEAD will become `<TBD-4.5-port-squash>` after the awaiting-squash gate.
**Current phase:** Phase 4.5-port (Researching + vs-research-venues) IN PROGRESS in worktree `claude/vs-port-4-5-researching`. Awaiting squash gate.
**Deployed at:** `https://hq.mirrornyc.com` (also `https://mirrornyc-hq.netlify.app`). The port branch does NOT deploy until cutover; see port plan § "Done when".

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
- **Phase 3.11 scorecard substance restoration** (squash-merge `cb038fc`): reverted Phase 3.7's over-aggressive 12-word cap on `full_points_rubric`. Each criterion now carries TWO describer fields — `full_points_rubric` (substantive 1-3 sentences, what the per-candidate evaluator reads) and `summary` (≤ 14-word recap for compact UI surfaces). Both generated in same Claude pass. Existing roles upgrade by re-running scorecard generation OR clicking "Process scorecard" on wizard / Edit Role (Phase 3.10).
- Netlify auto-deploys on push to `main`.

## What's NOT live yet

- **Packet generation UI is hidden** in the production UI behind `PACKET_FEATURE_ENABLED = false` flags in `PullDetail.tsx` and `FinalReviewDetail.tsx`. Edge Functions (`ts-packet-generate`, `ts-final-review-packet`) and `_shared/packetRender.ts` are deployed and wired, but the path needs end-to-end verification before un-hiding. Flip both flags to `true` to restore.
- Cron schedules are committed but require runtime activation: production GUCs (`app.supabase_url` + `app.internal_api_secret`) need to be set in Supabase SQL editor before the schedules will fire. Until then they're scheduled-but-noop. See `NEXT_STEPS.md` § 2a.
- All Phase 3.8 edge functions need to be deployed via `supabase functions deploy <name>` (cron functions + `ts-send-pull-notification` + re-deploys for `ts-pull-candidates` and any function that imports `_shared/anthropic.ts`).
- Phase 3.8 migrations need to be pushed: `supabase db push --linked`.
- **Venue Scout** is being rebuilt as a 1:1 port from `mirror-nyc-venue-scout-pro` on the `vs-port-fresh` branch (started 2026-05-12). The failed-attempt Phase 4 stack on `main` (Scout Dashboard through Deck Prep + URL-quality hot patch) is archived as a reference but no longer the canonical implementation. See `docs/venue-scout-port-plan.md` for the 10 sub-phase sequence and `OUTPUTS/COWORK_SYNC.md` for current state.
- **`vs-parse-brief` (port version) is deployed to production but the Brief page is on `vs-port-fresh` only.** The new edge function lives in the same deployment slot as the failed-attempt vs-parse-brief and has its signature / output shape (`{ scout_id, storage_path }` → `{ parsed_fields }`). Only the Brief page (on `vs-port-fresh`) calls it; until cutover, the new code is reachable but unexercised in main.
- **`vs-parse-sheet` (port version) is deployed to production but SheetUpload is on `vs-port-fresh` only.** Same parallel as vs-parse-brief: the new edge function lives in the same deployment slot as the failed-attempt vs-parse-sheet (`{ scout_id, storage_path }` payload, INSERTs into `vs_candidate_venues` not `venues`, `venue_type` not `type`). Only SheetUpload (on `vs-port-fresh`) calls it; until cutover, the new code is reachable but unexercised in main.
- **`vs-research-venues` (Phase 4.5-port, NEW function name) is deployed to production but the Researching page is on `vs-port-fresh` only.** Different from 4.3-port / 4.4-port: this is not a slot replacement. VS Pro's `research-venues` is unused in HQ; the failed-attempt HQ research function is named `vs-start-sourcing` and stays on the cutover deletion list. `vs-research-venues` writes to `vs_candidate_venues` (`source='research'`) and updates `vs_scouts` with `derived_columns` / `current_step='sourcing_report'` / `status='in_progress'`, or `status='failed'` + `research_error` on any error. Returns 200 immediately; AI work runs in `EdgeRuntime.waitUntil`. Only the Researching page (on `vs-port-fresh`) calls it.
- HQ Core pages beyond `/projects` are stubs (Phase 5).
- In-app notifications bell (Phase 5). Pull-completion email is live; bell + per-user prefs come later.

## Known issues / drift

- `auto_rejected` enum value is deprecated (Phase 3.7.2.1 backfilled to `reject` + `manually_reviewed=false`) but kept in the enum for safety. New writes never use it. Cleanup requires enum rebuild — not worth it now.
- Packet path needs end-to-end verification after the WORKER_RESOURCE_LIMIT fix (signed-URL email body, no MIME attachment) before the UI flag flips back on. `ts-final-review` itself is verified end-to-end.
- **Failed-attempt Venue Scout artifacts still in production until cutover:** three orphaned edge functions remain (`vs-start-sourcing`, `vs-compile-summaries`, `vs-generate-deck`); `vs-parse-brief` (4.3-port) and `vs-parse-sheet` (4.4-port) have been rebuilt in place at the same slot. Storage buckets `briefs`, `sourcing_sheets`, `venue_photos` retain their objects. Phase 4.1-port migration dropped the failed-attempt vs_* tables and the nine `phase_4_*` migration history rows are repaired to `reverted` in the supabase schema_migrations table. Edge function deletion + bucket cleanup are queued for the cutover commit (see port plan § "Done when").

## Recent commits (main)

```
6532235  [skip netlify] Backfill a44c6a3 hash into CHECKPOINT.md (failed Phase 4 path; archived)
a44c6a3  [skip netlify] URL-quality patch (failed Phase 4 path; archived)
cb038fc  Phase 3.11: scorecard substance restoration + summary field (squash-merged from phase-3-11-scorecard-substance)
b70f0e9  Phase 3.10: scorecard refinement step (squash-merged from phase-3-10-scorecard-refine)
e855ffb  Phase 3.8 + 3.9: cron + watchdogs + pull notification (squash-merged from phase-3-8-cron-watchdogs)
```

## Recent commits (vs-port-fresh, NOT on main yet)

```
<TBD-4.5-port-squash>  [skip netlify] Phase 4.5-port: Researching + vs-research-venues rebuild (squash-merged from claude/vs-port-4-5-researching)
6c98137  [skip netlify] Backfill a20b8e3 squash hash into CHECKPOINT.md
a20b8e3  [skip netlify] Phase 4.4-port: SheetPrompt + SheetUpload + vs-parse-sheet rebuild (squash-merged from claude/vs-port-4-4-sheet)
edf92ae  [skip netlify] Backfill 39e7edd squash hash into CHECKPOINT.md
39e7edd  [skip netlify] Phase 4.3-port: Brief page + vs-parse-brief rebuild (squash-merged from claude/vs-port-4-3-brief)
c2af48e  [skip netlify] Phase 4.2-port doc sync: drop stale 4.2-port awaiting-squash gate, mark stepToRoute as landed in schema.md
0fedaa9  [skip netlify] Backfill f4a9a2a squash hash into CHECKPOINT.md
f4a9a2a  [skip netlify] Phase 4.2-port: Scout Index + New Scout entry (squash-merged from claude/vs-port-4-2-scout-index)
08d6564  [skip netlify] Backfill 4483895 squash hash into CHECKPOINT.md
4483895  [skip netlify] Phase 4.1-port: schema augmentation + shared module priming (squash-merged from claude/vs-port-4-1-schema)
ae22bb8  [skip netlify] Port plan: Venue Scout 1:1 port from mirror-nyc-venue-scout-pro
dd38577  [skip netlify] Phase 4.1 Cowork-side doc state (port branch base)
```

## Recent migrations

```
20260512220000_phase_4_5_port_research_error.sql                Phase 4.5-port — ALTER TABLE vs_scouts ADD COLUMN research_error text (persisted error channel for the EdgeRuntime.waitUntil + Realtime flow on vs-research-venues) (APPLIED)
20260512210000_phase_4_1_port_drop_orphan_helper.sql            Phase 4.1-port follow-up — DROP _jsonb_array_to_text_array (orphan helper from failed Phase 4.3.1's create_scout_with_brief, missed by the main port migration; surfaced by code-reviewer) (APPLIED)
20260512200000_phase_4_1_port_schema.sql                        Phase 4.1-port — DROP failed-attempt vs_briefs / vs_sourcing_rounds / vs_pitch_decks; reset vs_scouts to brief-inline shape with current_step state machine + generated_decks jsonb history; vs_candidate_venues simplified (single-round per scout); vs_venue_photos with ON DELETE CASCADE; RLS open to authenticated; vs_scouts in supabase_realtime publication with REPLICA IDENTITY FULL (APPLIED)
20260508150000_phase_3_11_pull_watchdog_2min.sql                Phase 3.11.1 — pull-watchdog cadence 5min→2min, threshold 60min→5min (APPLIED)
20260508140000_phase_3_8_add_updated_at_to_pull_rounds.sql      Phase 3.8 — updated_at trigger on ts_pull_rounds for watchdog heartbeat (APPLIED)
20260508130000_phase_3_8_vault_for_internal_secret.sql          Phase 3.8 — Vault stores internal_api_secret (APPLIED)
20260508120001_phase_3_8_drop_dead_reeval_progress_column.sql   Phase 3.8 — drop ts_pull_rounds.reeval_last_progress_at (APPLIED)
20260508120000_phase_3_8_cron_extensions_and_schedules.sql      Phase 3.8 — pg_cron + pg_net + invoke_edge_function helper + six cron schedules (APPLIED)
```

The nine `phase_4_*` migrations that landed on `main` between Phase 4.1 (Scout Dashboard) and Phase 4.6 (Deck Prep) were repaired to `reverted` in the remote `supabase_migrations.schema_migrations` table on 2026-05-12 ahead of the Phase 4.1-port push. The actual table state is now whatever the port migration produced, regardless of the abandoned history.

## Next up

**Phase 4.6-port** per `docs/venue-scout-port-plan.md` § 11: Sourcing Report + Shortlist + matrix primitives. The matrix surfaces where 4.5-port's Researching pipeline lands.

`vs-port-fresh` is published on origin (HEAD `6c98137` after the 4.4-port post-squash push). Pushes to this branch do not deploy; only `main` fires Netlify. Future per-sub-phase squashes accumulate on `vs-port-fresh` until the eventual cutover to `main` after Phase 4.10-port.

**Production wiring for Phase 3.8** still pending (GUCs, db push, 12 edge function deploys). Can happen in parallel since it's all out-of-band (no Netlify). Full step-by-step in `NEXT_STEPS.md`.

**Carried-forward cleanup queued:**
- Verify `ts-final-review-packet` end-to-end after the WORKER_RESOURCE_LIMIT fix, then flip `PACKET_FEATURE_ENABLED` to `true` in `PullDetail.tsx` and `FinalReviewDetail.tsx`.
- Cutover deletion of failed-attempt edge functions: `vs-start-sourcing`, `vs-compile-summaries`, `vs-generate-deck`. (`vs-parse-brief` was rebuilt in place at 4.3-port and `vs-parse-sheet` at 4.4-port; both reduce to "verify the port version is current rather than delete." 4.5-port's `vs-research-venues` is a NEW function name and does not slot-replace anything; `vs-start-sourcing` remains queued for deletion.) Defer until vs-port-fresh squash-merges (or hard-resets) onto main.

## How to update this file

Update on every meaningful merge to `main`:
1. Bump **Last updated** to today.
2. Bump **Latest commit on main** to the new HEAD hash + message.
3. Add the new commits to **Recent commits** (keep last 5).
4. Add new migrations to **Recent migrations** if any.
5. Move items between "What's live" / "What's NOT live yet" if behavior changed.
6. Add to "Known issues / drift" anything that needs a future cleanup pass.
7. Adjust **Current phase** + **Next up** when phase boundaries cross.
