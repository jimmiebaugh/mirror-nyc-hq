# Checkpoint

Living-state doc. Update on every meaningful merge to `main`.

**Last updated:** 2026-05-14
**Latest commit on `main`:** `4fa489e` ([skip netlify] vs-research-venues: raise Phase B max_tokens to 12000). Fixes "tool input missing venues array" on research-only (no-sheet) scouts: the `targetNet=10` payload plus interleaved web_search rounds was overflowing the prior 5000-token ceiling and truncating `tool_use` mid-emission. Bumped to 12000; `stop_reason` added to the success diagnostic + the missing-venues failure message. Edge function already deployed to `amipjjmphblfxpghjnel` out-of-band ahead of the commit. Followed by an administrative CHECKPOINT.md backfill commit (`[skip netlify]`).
**Active feature branch:** `claude/phase-4-revision-intake` (Phase 4 Revision - Intake). Feature commit lands on the worktree branch; awaiting squash-approval gate. Migration `20260514110000` + edge function deploys (`vs-generate-brief-overview` new, `vs-parse-brief` + `vs-research-venues` redeployed) already applied to `amipjjmphblfxpghjnel` out-of-band; the intake UI ships on the squash-merge to main.
**Current phase:** **Phase 4 (Venue Scout port) shipped to production 2026-05-13.** Cutover complete. Main contains the full 1:1 port from `mirror-nyc-venue-scout-pro` (Phase 4.1-port through 4.10.6-port) plus the two parallel TS commits that landed on main during the port window (`6775429` Generate Packet button restore + `7cd27ed` packet email template + layout fixes + email-as-cover-letter fallback). The 4a8a5c6 TS-wizard Stepper-migration commit was excluded from the cutover (it depended on a `ui/Stepper.tsx` file introduced by the failed Phase 4.3.1 commit that we dropped); the TS wizard keeps its local `talent-scout/Stepper.tsx`. Next: **Phase 5 (HQ Core)**.
**Deployed at:** `https://hq.mirrornyc.com` (also `https://mirrornyc-hq.netlify.app`). Auto-deploys on push to main.

## What's live in production

- **Mirror brand identity applied site-wide** (Phase 3.5b): coral `#BE4E44`, Montserrat ExtraBold display + Roboto Mono captions + Roboto body, dynamic `HQ` / `TALENT` / `VENUES` caption next to the M wordmark in the top nav based on which sub-app you're in. Brand spec lives in `docs/mirror-style-guide.md` with the deck-template authority (`BLANK DECK TEMPLATE (2026).pptx`).
- Stealth coming-soon landing at `/` for unauthenticated visitors. Hidden sign-in trigger is the bottom "STRATEGY / DESIGN / PRODUCTION" line (no visible affordance, default cursor, not keyboard-focusable).
- Authenticated users land on Dashboard. Top nav reduced to `Dashboard` + `Talent Scout` (admin) only. Projects / Venues / Clients / Tasks are reachable by drilling in from the Dashboard tile grid.
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
- **Phase 3.8 + 3.9 cron + watchdog infrastructure committed** (squash-merge `e855ffb`): six new edge functions (`ts-cron-scheduled-pulls`, `ts-cron-pull-watchdog`, `ts-cron-reeval-watchdog`, `ts-cron-final-review-watchdog`, `ts-cron-storage-cleanup`, `ts-cron-monthly-spend-reset`), `ts-send-pull-notification` for pull-completion email, real cap-alert email path via `_shared/sendEmail.ts`, two migrations (extensions + schedules + dead-column drop). Watchdogs detect-and-flag only (pull 60min stall, re-eval 30min, final-review 20min). Production wiring still pending; see § Carried-forward cleanup below.
- **Phase 3.10 scorecard refinement** (squash-merge `b70f0e9`): new `ts-refine-scorecard` edge function. The wizard step-3 page and Edit Role page both surface a Process / Save button morph: when scorecard has unrefined edits, the action runs the refine pass; once clean, it flips back to Lock (wizard) or Save (Edit Role, which triggers bulk re-eval). Server-side dead-criterion drop (weight=0 OR empty name+describer) plus defense-in-depth merge that restores `tier`/`weight`/`is_disqualifier`/`is_manual` from user input regardless of model output.
- **Phase 3.11 scorecard substance restoration** (squash-merge `cb038fc`): reverted Phase 3.7's over-aggressive 12-word cap on `full_points_rubric`. Each criterion now carries TWO describer fields: `full_points_rubric` (substantive 1-3 sentences, what the per-candidate evaluator reads) and `summary` (≤ 14-word recap for compact UI surfaces). Both generated in same Claude pass. Existing roles upgrade by re-running scorecard generation OR clicking "Process scorecard" on wizard / Edit Role (Phase 3.10).
- **TS Final Review packet** (`6775429` + `7cd27ed`): Generate Packet button is live on the Final Review detail page (PACKET_FEATURE_ENABLED gate removed; button always packets every ranked candidate via `include_all: true`). Hiring-manager email uses subject `[Mirror HQ] Final Review Packet | <Role>`, multipart/alternative MIME with a "Download Final Review packet" hyperlink (no raw URL wall). Cover page eyebrow gap bumped to 48pt; candidate title page rank gap bumped to 50pt (no overlapping text). When a candidate has no cover_letter attachment but has `email_body_text`, the application email body is rendered as a "Cover Letter Email" content page in the cover-letter slot ahead of the resume. Real Mirror M PNG used as cover wordmark (was a Helvetica-M approximation).
- **Venue Scout (full 1:1 port from `mirror-nyc-venue-scout-pro`)**, shipped via the 2026-05-13 cutover. Producer flow: New Scout (project pick) -> Brief upload (DOCX + AI parse via `vs-parse-brief` v14) -> Sheet Prompt -> Sheet Upload (CSV/XLSX + AI enrichment via `vs-parse-sheet` v18) OR Researching (web search via `vs-research-venues` v25, `claude-sonnet-4-6 + web_search_20250305` with `pause_turn` continuation; Phase B `max_tokens`=12000 since 2026-05-14, fixes no-sheet `tool_use` truncation) -> Sourcing Report (matrix) -> Shortlist (matrix + photo upload) -> Review (matrix + Notes/Feedback editor) -> Compiling (per-venue 4-bullet summaries via `vs-compile-summaries` v29) -> Deck Prep (matrix + drag-drop photo reordering + edit-everything) -> Generating (Google Slides deck via `vs-generate-deck` v13) -> deck opens in new tab + producer returns to Deck Prep. Settings reachable via persistent gear icon on every action page; Settings Danger Zone exposes a `start_over_scout` RPC. Full ErrorState.tsx covers every failure path. AI surface uses `pause_turn` continuation, `writeFailure` CAS guards on all 3 AI edge functions, `WORK_TIMEOUT_MS=360s` for the Supabase Pro plan, URL-fallback helpers (`extractWebSearchResults`, `findVenueWebsite`, `findBestSearchResultUrl`) when models leave `website_url` null. Storage buckets: `briefs`, `sourcing_sheets`, `vs_venue_photos` (private; signed-URL reads). Schema: `vs_scouts` (brief-inline shape with `current_step` state machine + `generated_decks` jsonb history + `pipeline_error` channel), `vs_candidate_venues` (single-round per scout, `source` enum among research/sheet/manual, `derived_attrs` jsonb), `vs_venue_photos` (ON DELETE CASCADE). RLS open to authenticated; `vs_scouts` in `supabase_realtime` publication with REPLICA IDENTITY FULL.
- Netlify auto-deploys on push to `main`.

## What's NOT live yet

- Cron schedules are committed but require runtime activation: production GUCs (`app.supabase_url` + `app.internal_api_secret`) need to be set in Supabase SQL editor before the schedules will fire. Until then they're scheduled-but-noop.
- All Phase 3.8 edge functions need to be deployed via `supabase functions deploy <name>` (cron functions + `ts-send-pull-notification` + re-deploys for `ts-pull-candidates` and any function that imports `_shared/anthropic.ts`).
- Phase 3.8 migrations need to be pushed: `supabase db push --linked`.
- HQ Core pages beyond `/projects` are stubs (Phase 5).
- In-app notifications bell (Phase 5). Pull-completion email is live; bell + per-user prefs come later.
- **Phase 4 Revision - Intake UI** (3-step brief stepper: BriefEvent / BriefVenue / BriefReport + the `/brief` redirect index, the always-visible Revisit nav, the `vs-generate-brief-overview` call site) is built on `claude/phase-4-revision-intake` but NOT live in production until the squash-merge to main fires a Netlify deploy. The backing migration (`20260514110000`, `brief` step value + default) and the three edge function deploys are already applied out-of-band, so production scouts read `current_step` defaults of `brief` and the redeployed `vs-parse-brief` / `vs-research-venues` are backward-compatible with the still-live old single-page Brief.

## Known issues / drift

- `auto_rejected` enum value is deprecated (Phase 3.7.2.1 backfilled to `reject` + `manually_reviewed=false`) but kept in the enum for safety. New writes never use it. Cleanup requires enum rebuild; not worth it now.

## Recent commits (main)

```
4fa489e  [skip netlify] vs-research-venues: raise Phase B max_tokens to 12000
04b0f01  [skip netlify] Backfill 49978f4 doc-audit-sweep hash into CHECKPOINT.md
49978f4  [skip netlify] Doc audit sweep (2026-05-13)
0503e6b  [skip netlify] Restore real Mirror M logo (SVG paths) + pull notification HTML hyperlink
6b9ad84  [skip netlify] Post-cutover doc sweep: VS port live in production
```

(A `[skip netlify]` CHECKPOINT.md backfill commit lands on top of `4fa489e`; it is the administrative tail of this fix, not listed here. The next CHECKPOINT update will surface it.)

The 2026-05-13 cutover replaced the failed-attempt Phase 4 stack on main with the full vs-port-fresh history (Phase 4.1-port through 4.10.6-port). 42 commits on main with no patch-equivalent on vs-port-fresh were intentionally dropped. See `docs/decisions.md` and `docs/venue-scout-port-plan.md` § "Done when" for the cutover trail.

## Recent migrations

```
20260514110000_phase_4_revision_intake_current_step.sql              Phase 4 Revision - Intake: DROP + re-ADD vs_scouts_current_step_check with a 10th value `brief` prepended; ALTER COLUMN current_step SET DEFAULT 'brief'. Additive -- existing rows untouched. `brief` is the in-flight 3-step intake step; Step 3 Confirm flips it to `sheet_prompt`. (APPLIED)
20260514100000_phase_4_10_6_port_reset_scout_for_deck_regenerate.sql  Phase 4.10.6-port: reset_scout_for_deck_regenerate(target_scout_id uuid) RPC for the Deck Prep regenerate flow. Atomic single-statement UPDATE that sets current_step='deck_prep', strips deck_generation_started_at from brief_data via the jsonb `-` operator, clears status + pipeline_error, bumps last_touched_at. Replaces a frontend read-then-write that had a TOCTOU race window. SECURITY INVOKER; GRANT EXECUTE TO authenticated. (APPLIED)
20260514000002_phase_4_10_3_port_vs_storage_policies.sql        Phase 4.10.3-port: relax storage policies for briefs / sourcing_sheets / vs_venue_photos buckets from is_producer_or_admin() to authenticated. Matches vs_* table RLS posture per port plan § 8.6 (collaborative agency-wide workflow). vs_venue_photos collapsed from 4 split policies to a single FOR ALL policy. IF EXISTS on DROPs handles Studio-side rename drift. (APPLIED)
20260514000001_phase_4_10_3_port_start_over_scout_pipeline_error.sql  Phase 4.10.3-port: CREATE OR REPLACE start_over_scout to clear pipeline_error instead of research_error post-rename. Body otherwise unchanged from 4.9-port migration. (APPLIED)
20260514000000_phase_4_10_3_port_pipeline_error_rename.sql      Phase 4.10.3-port: ALTER TABLE vs_scouts RENAME COLUMN research_error TO pipeline_error. Aligns column name with actual usage (single AI-pipeline error channel across vs-research-venues + vs-compile-summaries + vs-generate-deck since 4.7.2 / 4.8.2). All existing values preserved by RENAME. (APPLIED)
20260513000000_phase_4_9_port_start_over_rpc.sql                Phase 4.9-port: start_over_scout(target_scout_id uuid) RPC for Scout Settings Danger Zone. Transactional cascade-delete of vs_candidate_venues (photos cascade via FK), reset scout state back to sheet_prompt + clear research_error / derived_columns / sheet_storage_path / deck_order + strip brief_data idempotency timestamps. Keeps brief fields, project_id, generated_decks history, brief_data.uploaded_files. SECURITY INVOKER; GRANT EXECUTE TO authenticated. (APPLIED; pipeline_error rename via 20260514000001 in Phase 4.10.3-port)
20260512240000_phase_4_7_1_port_vs_venue_photos_bucket.sql      Phase 4.7.1-port: CREATE vs_venue_photos storage bucket (private) + 4 RLS policies (SELECT/INSERT/UPDATE/DELETE gated on is_producer_or_admin()). Bucket carries Venue Scout deck photos uploaded via PhotoUploadModal; reads use createSignedUrl(path, 3600). Distinct from the public venue_photos bucket reserved for HQ Core's master venues table. (APPLIED)
20260512230000_phase_4_6_port_shortlist_sync_trigger.sql        Phase 4.6-port: re-introduce vs_candidate_venues_shortlist_sync trigger at simplified shape (shortlisted false→true only). Matches HQ venues by website_url first, then case-insensitive name+neighborhood. SECURITY DEFINER; INSERTs new venues rows when no match. (APPLIED)
20260512220000_phase_4_5_port_research_error.sql                Phase 4.5-port: ALTER TABLE vs_scouts ADD COLUMN research_error text (persisted error channel for the EdgeRuntime.waitUntil + Realtime flow on vs-research-venues) (APPLIED)
20260512210000_phase_4_1_port_drop_orphan_helper.sql            Phase 4.1-port follow-up: DROP _jsonb_array_to_text_array (orphan helper from failed Phase 4.3.1's create_scout_with_brief, missed by the main port migration; surfaced by code-reviewer) (APPLIED)
20260512200000_phase_4_1_port_schema.sql                        Phase 4.1-port: DROP failed-attempt vs_briefs / vs_sourcing_rounds / vs_pitch_decks; reset vs_scouts to brief-inline shape with current_step state machine + generated_decks jsonb history; vs_candidate_venues simplified (single-round per scout); vs_venue_photos with ON DELETE CASCADE; RLS open to authenticated; vs_scouts in supabase_realtime publication with REPLICA IDENTITY FULL (APPLIED)
20260508150000_phase_3_11_pull_watchdog_2min.sql                Phase 3.11.1: pull-watchdog cadence 5min→2min, threshold 60min→5min (APPLIED)
20260508140000_phase_3_8_add_updated_at_to_pull_rounds.sql      Phase 3.8: updated_at trigger on ts_pull_rounds for watchdog heartbeat (APPLIED)
20260508130000_phase_3_8_vault_for_internal_secret.sql          Phase 3.8: Vault stores internal_api_secret (APPLIED)
20260508120001_phase_3_8_drop_dead_reeval_progress_column.sql   Phase 3.8: drop ts_pull_rounds.reeval_last_progress_at (APPLIED)
20260508120000_phase_3_8_cron_extensions_and_schedules.sql      Phase 3.8: pg_cron + pg_net + invoke_edge_function helper + six cron schedules (APPLIED)
```

The nine `phase_4_*` migrations that landed on `main` between Phase 4.1 (Scout Dashboard) and Phase 4.6 (Deck Prep) were repaired to `reverted` in the remote `supabase_migrations.schema_migrations` table on 2026-05-12 ahead of the Phase 4.1-port push. The actual table state is now whatever the port migration produced, regardless of the abandoned history.

## Next up

**Phase 5 (HQ Core).** Venue Scout port shipped to production 2026-05-13. With both Talent Scout (Phase 3) and Venue Scout (Phase 4) live, the next focus is the cross-cutting HQ Core pages (Projects, Venues, Clients, Tasks beyond the current stubs) plus the in-app notifications bell.

**Production wiring for Phase 3.8** still pending (GUCs, db push, 12 edge function deploys). Can happen in parallel since it's all out-of-band (no Netlify). Steps: set `app.supabase_url` and `app.internal_api_secret` GUCs in the Supabase SQL editor, then `supabase db push --linked` for the cron migrations, then `supabase functions deploy <name>` for each of the six cron functions, `ts-send-pull-notification`, plus re-deploys for `ts-pull-candidates` and any function importing `_shared/anthropic.ts`.

**Carried-forward cleanup queued (from cutover):**
- **vs-research-venues duplicate-invocation race.** CAS guards mask the symptom but the underlying race is real. Proper fix: Postgres advisory lock OR kickoff CAS on `brief_data.research_started_at`. Not blocking; both invocations produce valid scouts, just double-spend.
- **`MAX_PAUSE_CONTINUATIONS=1` cap on `callClaude`.** Conservative. If "no structured output" failures surface in prod, raise to 2-3 with a wall-clock budget instead of a continuation-count budget.
- **Real-cron test** of `ts-cron-scheduled-pulls` + watchdogs in production (requires GUCs set in Supabase SQL editor). Tied to the Phase 3.8 production wiring above.
- **Run `to_regclass('public.vs_briefs')` / `vs_sourcing_rounds` / `vs_pitch_decks` in Supabase Studio** to explicit-confirm the 4.1-port migration's drops landed (migration ledger says applied; visual confirmation in Studio is the belt-and-suspenders check).
- **TS wizard `Stepper` consolidation.** The 4a8a5c6 commit was excluded from the cutover (it depended on a `ui/Stepper.tsx` file from the dropped Phase 4.3.1 commit). TS wizard still imports the local `talent-scout/Stepper.tsx`. If we want a canonical `ui/Stepper.tsx` later, hand-write one and migrate the three TS wizard pages.

## How to update this file

Update on every meaningful merge to `main`:
1. Bump **Last updated** to today.
2. Bump **Latest commit on main** to the new HEAD hash + message.
3. Add the new commits to **Recent commits** (keep last 5).
4. Add new migrations to **Recent migrations** if any.
5. Move items between "What's live" / "What's NOT live yet" if behavior changed.
6. Add to "Known issues / drift" anything that needs a future cleanup pass.
7. Adjust **Current phase** + **Next up** when phase boundaries cross.
