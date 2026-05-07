# Next Steps

Ordered most-immediate first. Branch is `phase-3-6-final-review-packet`, latest commit `d6a53d6`, working tree clean.

## 1. Jimmie reviews latest visual state

- **Goal:** Get sign-off (or another revision request) on the CandidateTable layout after `d6a53d6` (15px padding between Portfolio and Quick Overview).
- **Files to look at:** `src/components/talent-scout/CandidateTable.tsx` rendered on `/talent-scout/roles/[id]` (RoleDashboard) and `/talent-scout/roles/[id]/pulls/[pullId]` (PullDetail).
- **External dep:** Waiting on Jimmie. He may come back with another nudge or say it's done.
- **Gotcha:** Local dev needs to be running. Use `http://127.0.0.1:8080/`, not `localhost:8080` (Vite binds IPv6, Chrome misroutes localhost).

## 2. Verify packet-generate end-to-end after the WORKER_RESOURCE_LIMIT fix

- **Goal:** Confirm `ts-final-review-packet` actually generates a PDF, uploads to the `packets` bucket, and sends the signed-URL email. The fix landed in this conversation but the path was not retested after the change.
- **Files involved:**
  - `supabase/functions/ts-final-review-packet/index.ts`
  - `supabase/functions/_shared/packetRender.ts` (`uploadPacketAndSign`, `sendPacketEmail`)
- **How:** From the FinalReviewDetail page, click "Generate Packet". Watch Edge Function logs (`supabase functions logs ts-final-review-packet --tail`). Confirm:
  - PDF lands in the `packets` bucket
  - Email arrives with signed URL link in body (no MIME attachment)
  - Signed URL opens in browser
- **Gotcha:** Two URLs in play — 1h `signedUrl` for browser, 7d `emailUrl` for email body. If links 404 after a few hours, that's expected; not a bug.

## 3. Confirm the Phase 3.6 migration state

- **Goal:** Know whether `20260506213340_phase_3_6_final_review_and_packets.sql` is applied to local AND production Supabase, and whether it still includes `final_overview` if that column was added there.
- **How:**
  ```
  supabase migration list --linked
  ```
  Compare local vs remote. If `final_overview` column exists on `ts_final_reviews` and we no longer write to it, decide: drop column in a follow-up migration, or leave it as dead column for now.
- **Gotcha:** CHECKPOINT.md (last updated 2026-05-06) still says this migration is not yet applied. That's stale — `ts-final-review` ran successfully which means it's at least applied locally. Production status unverified from this conversation.

## 4. Update CHECKPOINT.md before merging to main

- **Goal:** Bring CHECKPOINT.md current. It was last touched 2026-05-06 and predates the entire 3.6.1 → 3.6.11 iteration.
- **What to update:**
  - Latest commit on the active branch
  - "What's on the active branch" section — reflect current state (CloudConvert removed, prompts consolidated, ScoreInline, etc.)
  - "Recent commits" list
  - Migration status (see step 3)
- **Gotcha:** Project rule from `CLAUDE.md`: update CHECKPOINT.md on every meaningful merge to main. So this should land before the merge, not after.

## 5. Merge `phase-3-6-final-review-packet` to `main`

- **Goal:** Ship Phase 3.6 to production.
- **Pre-merge checks:**
  - Steps 1-4 complete
  - `npx tsc --noEmit` clean
  - `npm run build` clean
  - Phase 3.6 migration applied on production via `supabase db push --linked`
  - Updated types committed: `supabase gen types typescript --linked > /tmp/types.ts && test -s /tmp/types.ts && mv /tmp/types.ts src/integrations/supabase/types.ts`
- **Gotcha:** Don't pipe `supabase gen types` directly into the file. Shell `>` truncates first; if the gen fails the file ends up empty (this happened mid-conversation, recovered via `git checkout`).
- **Gotcha:** `docs/decisions.md` and `docs/schema.md` should be updated in the same commit if schema changed.

## 6. Phase 3.7 — Cron + watchdogs

- **Goal:** Schedule the things that currently require a manual button. Per `docs/roadmap.md` and CHECKPOINT, Phase 3.7 starts after 3.6 merges.
- **Scope (from CHECKPOINT context, verify against `docs/roadmap.md` before starting):**
  - Scheduled candidate pulls (currently manual)
  - Watchdog jobs to clean up stuck rounds / stale state
  - `monthly-spend-reset` cron for `cap_alert_sent_this_month` (currently manual SQL reset)
- **Gotcha:** Don't start until Phase 3.6 merges. The active branch already touches some of the same surfaces (Edge Functions, Realtime publication).

## Cross-cutting cleanup queued for a future migration

- Drop `ts_pull_rounds.reeval_last_progress_at` (dead since Phase 3.5).
- Possibly drop `ts_final_reviews.final_overview` if the migration added it (see step 3).
