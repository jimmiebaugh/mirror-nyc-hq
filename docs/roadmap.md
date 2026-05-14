# Roadmap

Phase-by-phase build plan. Finished phases summarize to one line; the next phase has full detail. Update this doc when phases complete.

For granular project state and the latest commit hash, see `CHECKPOINT.md` at the repo root.

## Phase 1: Foundation — DONE

Supabase project, Google Cloud Console OAuth client, service account `mirror-ny-hq-backend@mirror-nyc-hq.iam.gserviceaccount.com` with domain-wide delegation across `gmail.readonly` / `gmail.send` / `drive` / `presentations`, GitHub repo, Netlify import, local toolchain. Service account verification script lives at `scripts/verify-service-account.ts`.

## Phase 2: Schema and auth — DONE

Initial schema migration (`20260506061457_initial_schema.sql`): 22 tables, enums, helper + trigger functions, RLS policies, 5 storage buckets. Jimmie seeded as admin. Sanity test: `/projects` query fixed for new schema, types regenerated, GRANTs migration (`20260506065157_grant_data_api_access.sql`) applied. Cross-user RLS test deferred to Phase 6.4.

## Phase 3: Talent Scout port — DONE

Lifted from `mirror-talent-scout`. Full pipeline ported and deployed. Sub-phase summary:

| Sub-phase | Summary |
|---|---|
| 3.1 | Inventory + port plan (`docs/talent-scout-port-plan.md`). |
| 3.2 | Schema augmentation (`ts_evaluations`, `ts_pull_rounds` extensions, `cap_alert_sent_this_month`); edge function shells. |
| 3.3 | Roles CRUD + 3-step new-role wizard; `_shared/anthropic.ts callClaude` wrapper. |
| 3.4 | `ts-pull-candidates` (chunked self-invoke, BATCH_SIZE=8); service-account Gmail; Realtime on pull rounds. |
| 3.5 | CandidateDetail + status dropdown + re-eval (single + round + role-scoped); `promote` → `interview` enum rename. |
| 3.6 | Final review (`ts-final-review`) + packet generation (`ts-final-review-packet` via pure pdf-lib + signed URL email). OAuth pivot to `sb_publishable_*` keys. |
| 3.7 | Manual-reviewed flag, CandidateDetail layout reorg, Global Settings + competitor list, referral ingestion (Gmail forward chain walker). |
| 3.8 | pg_cron + 6 cron jobs (scheduled pulls, 3 watchdogs, storage cleanup, monthly spend reset); cap-alert email path. |
| 3.9 | `ts-send-pull-notification` (fires from pull complete; folds into `notifications-dispatch` in Phase 5). |
| 3.10 | `ts-refine-scorecard` + wizard step-3 Process/Save morph. |
| 3.11 | Scorecard `full_points_rubric` + `summary` two-field design (restore substantive describers). |

**Final Talent Scout Final Review packet feature flag (`PACKET_FEATURE_ENABLED` in `PullDetail.tsx` + `FinalReviewDetail.tsx`)** stays `false` until producer runs end-to-end smoke after the WORKER_RESOURCE_LIMIT fix; carry-forward item, not a code change.

## Phase 4: Venue Scout port — DONE (cutover-ready)

1:1 port from `mirror-nyc-venue-scout-pro` onto `vs-port-fresh` branch. The 1st-attempt Phase 4 (4.1 - 4.6 with the abandoned route tree) was discarded after Phase 4.6 mid-pivot when end-to-end testing surfaced systemic gaps; switched to porting the working Lovable-driven VS Pro app verbatim with HQ design-token swaps. Full port plan: `docs/venue-scout-port-plan.md`.

Auth gate: `ProtectedRoute` (all authenticated users). RLS open to authenticated per `docs/auth-model.md` § Storage policies (4.10.3-port reconciliation made VS member-tier).

Sub-phase summary (all DONE):

| Sub-phase | Summary |
|---|---|
| 4.1-port | Schema augmentation + shared module priming (canonicalizeType, sanitizeWebsiteUrl, matrix primitives). |
| 4.2-port | Scout Index page + scout list. |
| 4.3-port | New Scout wizard + Brief page + `vs-parse-brief` edge function. |
| 4.4-port | Sheet Prompt + Sheet Upload + `vs-parse-sheet` edge function. |
| 4.5-port | Researching page + `vs-research-venues` (AI sourcing via Anthropic `submit_research` + web_search; EdgeRuntime.waitUntil + Realtime). |
| 4.6-port | SourcingReport + Shortlist matrix (sticky-column 8-col / 9-col layouts; type pills, alignment column, RankDisplay). |
| 4.7.1-port | Review Selects page + PhotoUploadModal + signed-URL photo display. |
| 4.7.2-port | Compiling page + `vs-compile-summaries` (Pass 1 fill_venue + Pass 2 write_overview; EdgeRuntime.waitUntil + Realtime). |
| 4.8.1-port | Deck Prep page + dnd-kit row/photo reorder; `_shared/googleServiceAccount.ts` cherry-picked from main. |
| 4.8.2-port | Generating page + `vs-generate-deck` (Google Slides template-copy + scoped text replacements + image alt-tag replacement; per-error-code ErrorState routing). |
| 4.8.3-port | Deck-output correctness hotfix (slide index shift +1 to match 6 front-matter slides; ALL-CAPS `venue_name`; loading-page copy refresh). |
| 4.9-port | Scout Settings page (rename, danger-zone Start Over via `start_over_scout` RPC); full ErrorState.tsx with 4 deck-error keys; always-visible gear icon; post-completion step-through nav. |
| 4.10.1-port | vs-parse-sheet AI enrichment (initially); `_shared/venueFill.ts` (FILL_TOOL + FILL_SYSTEM + buildFillUserMsg); vs-compile-summaries Pass 1 sheet-row backfill. |
| 4.10.2-port | Matrix UX overhaul: inline editing across SourcingReport + Shortlist + DeckPrep; SourcePill in col2; Alignment column removed (rank moved into VenueIdentityStack); manual-at-top sort. |
| 4.10.3-port | URL HEAD validation (`_shared/urlValidation.ts`); Recs/Considerations schema tuning; 3-tier SOURCE_PRIORITY sort; TypeTogglePopover; `vs_scouts.research_error` → `pipeline_error` column rename; VS storage policy reconciliation; AI surface consolidation (sheet enrichment moved from vs-parse-sheet into vs-research-venues Phase A). |
| 4.10.4-port | Pre-cutover smoke polish: rank hidden in matrix UI (DB column kept); alphabetical secondary sort; photo column dropped from Shortlist; Notes/Feedback editor on Review; OVERVIEW_TOOL tuned for 3-4 sentence outputs; Compiling + Generating copy refresh; Deck Prep bottom nav rework; notes consolidated above table; cell line-breaks. |
| 4.10.5-port | AI surface stabilization: model + web_search pivot to `claude-sonnet-4-6 + web_search_20250305`; `callClaude` pause_turn continuation loop; `writeFailure` CAS guards on all 3 AI functions; timeout sizing for Supabase Pro plan; trim `brief_data` JSON dump from user messages; placeholder-string sanitizer; drop forced `tool_choice` on Phase A. |
| 4.10.6-port | URL acquisition fallbacks (`extractWebSearchResults` + `findVenueWebsite` + `findBestSearchResultUrl`) + deck flow polish: post-generation new-tab open + return to Deck Prep; `reset_scout_for_deck_regenerate` RPC for atomic regenerate state reset; slide 2 ALL CAPS; venue slide interleaved-forward order via per-slide `updateSlidesPosition`; vs-generate-deck success-path CAS guard; photo dnd `rectSortingStrategy`; ErrorState "Contact the team" buttons removed. |

**State as of wrap:** `vs-port-fresh` HEAD has all sub-phases squashed; origin in sync. Edge functions all redeployed at `amipjjmphblfxpghjnel`. Migrations applied: `20260514100000_phase_4_10_6_port_reset_scout_for_deck_regenerate.sql` is the most recent.

**Cutover next (Phase 6 territory)** — cherry-pick the must-carry main commits onto `vs-port-fresh` (currently just `f24d3f5`: TS Final Review packet email template fixes), verify via `git show --stat <new-sha>` diff equivalence, hard-reset main to `vs-port-fresh` HEAD. That force-push to main is the production deploy event. Post-cutover: delete `vs-start-sourcing` orphan edge function; drop abandoned `vs_briefs` / `vs_sourcing_rounds` / `vs_pitch_decks` tables in production if any remain.

Carry-forward debt to revisit post-cutover:
- Duplicate-invocation race in `vs-research-venues` is masked by CAS guards but not prevented (proper fix is a Postgres advisory lock or kickoff CAS).
- `MAX_PAUSE_CONTINUATIONS=1` cap in `callClaude` is conservative; raise if "no structured output" failures surface in prod logs.
- The failed-attempt Phase 4.1-4.6 + URL-quality hot patches archived on `main` are intentionally discarded at cutover (replaced by the 1:1 port).

## Phase 5: Cross-cutting — TODO

- Notifications system: `notifications-dispatch` Edge Function + UI bell + per-user prefs + email delivery via service account.
- Activity log feed on Project / Venue / Task pages.
- Admin pages: user role management, global settings UI.
- Polish: HQ Core pages currently stubbed as `<ComingSoon />` (`/projects`, `/venues`, `/clients`, `/tasks`) get real implementations.
- Fold `ts-send-pull-notification` into `notifications-dispatch`.

## Phase 6: Cutover — IMMINENT (Phase 4 wrap is the gate)

- 6.1 Pre-cutover hold: Phase 4 wrap is the precondition. Confirm the active branch (`vs-port-fresh`) builds clean, runs clean end-to-end via dev server, and all edge functions are redeployed at their latest versions. Verify via `supabase functions list` SHA + timestamp.
- 6.2 Identify the must-carry main commit set. As of 2026-05-13, that's `f24d3f5` (TS Final Review packet email template + email-as-cover-letter fallback). Cherry-pick onto `vs-port-fresh`; verify clean apply via `git show --stat <new-sha>` matches `git show --stat f24d3f5`.
- 6.3 Talent Scout data preservation. Re-create active/open roles in the new HQ instance (re-pulling candidates from Gmail reproduces the structured data). Manually copy bucket decisions and internal notes for in-flight candidates. Export packet PDFs from Lovable for closed roles, preserve as historical archive in HQ file storage.
- 6.4 Production deploy. `git push origin vs-port-fresh:main --force-with-lease` — fires the Netlify deploy. Launch on `hq.mirrornyc.com` (already wired). Post-deploy: delete orphan `vs-start-sourcing` edge function from production; drop abandoned `vs_briefs` / `vs_sourcing_rounds` / `vs_pitch_decks` tables if any remain.
- 6.5 Onboard team. Send link, verify accounts created with `member` role, promote producers and admins via admin UI. Run the cross-user RLS violation test deferred from Phase 2.4.
- 6.6 Sunset Lovable. Shut down all three Lovable projects, cancel subscription, archive credentials.
- 6.7 Carry-forward items:
  - Flip `PACKET_FEATURE_ENABLED` to `true` after Talent Scout WORKER_RESOURCE_LIMIT smoke verification.
  - Real-cron test of `ts-cron-scheduled-pulls` + watchdogs in production (requires GUCs set in Supabase SQL editor).
  - Cleanup of deprecated `auto_rejected` enum value (needs enum rebuild; defer indefinitely).
  - Proper fix for the vs-research-venues duplicate-invocation race (advisory lock).

## Open questions still pending

- Project status enum may be refined and reduced. Current 14 values are fine for now; revisit in Phase 5 polish.
- Talent Scout data extraction details (Phase 6.3). If Phase 6 inventory turns up data that doesn't fit the re-pull plan, revisit.
