# Project Status

## What this project is

Mirror NYC HQ is an internal web app for Mirror NYC (experiential events agency) that replaces scattered Google Sheets and Drive folders with a relational central database plus two embedded modules (Talent Scout, Venue Scout). React + Vite + TS + Tailwind + shadcn/ui frontend, Supabase Postgres + Edge Functions + Storage + Realtime backend, Netlify hosting, Anthropic API + Google Workspace via service account. Production at `hq.mirrornyc.com`. Supabase project ref `amipjjmphblfxpghjnel`.

## Where we are right now

- **Active phase:** Phase 3.6 (Final Review + Packet generation), iteration in progress on branch `phase-3-6-final-review-packet`.
- **Branch state:** clean, pushed, up to date with origin.
- **Latest commit:** `d6a53d6` — `Phase 3.6.11: +15px padding between Portfolio and Quick Overview`.
- **Not merged to main.** Production is still on the pre-3.6 main branch.
- **Next phase queued:** Phase 3.7 (Cron + watchdogs), starts after 3.6 merges.

## What's working / confirmed done in this branch

- Edge Function `ts-final-review` ran successfully end-to-end locally (Jimmie's "final rview ran!" confirmation). Returns `final_review_id` immediately, streams `step_progress` via Realtime, writes `final_rankings` to `ts_final_reviews`.
- Edge Function `ts-final-review-packet` rewritten to pure pdf-lib (CloudConvert removed). Uploads PDF to `packets` Storage bucket, emails hiring manager a signed URL link in the body (1h browser URL + 7d email URL via `uploadPacketAndSign`).
- Edge Function `ts-packet-generate` uses the same pdf-lib helpers in `supabase/functions/_shared/packetRender.ts`.
- All three Talent Scout Claude prompts consolidated in `supabase/functions/_shared/prompts.ts`:
  - `DEFAULT_EVAL_PROMPT` (per-candidate eval; outputs `quick_overview`, `top_strengths`, `key_gaps`, `recruiter_note` in single Claude call)
  - `FINAL_REVIEW_PROMPT_TEMPLATE` (final review with template substitutions)
  - `scorecardGenerationPrompt()` function
- `final_rankings` shape locked: `{candidate_id, final_rank, final_tier, rationale, recruiter_note}`. `recruiter_note` is `string[]` (bullet list, 3 max). `rationale` is 2-3 sentences max. `final_overview` field removed entirely.
- `src/lib/talent-scout/defaultEvalPrompt.ts` is the frontend manual mirror of the server-side prompt (frontend can't import from `supabase/functions/_shared`).
- `src/lib/unwrapUrl.ts` strips email-security wrappers (Outlook safelinks, Mimecast, Proofpoint, Cuda, EdgePilot). Applied to portfolio links across CandidateTable, CandidateDetail, FinalReviewDetail.
- `src/components/talent-scout/CandidateTable.tsx`:
  - Shared component used by both `RoleDashboard.tsx` and `PullDetail.tsx`.
  - Search field + bulk action bar in single header row (search left, bulk buttons + "N selected" right). Bar always rendered with `opacity-0` when empty so DOM doesn't shift.
  - Resume + Portfolio icon columns, both centered under their headers via `flex-1` split halves. `ICON_BUTTON_CLS` shared between them.
  - Score moved into the candidate cell via `ScoreInline` (colored number + horizontal mini-bar).
  - Latest grid: `grid-cols-[minmax(260px,1fr)_185px_minmax(0,2.4fr)_132px_36px]` with `pr-[25px]` on header + body R+P cell wrappers.
- `src/components/talent-scout/StatusDropdown.tsx`: compact size is `h-9 text-[14px] min-w-[124px]`.
- `src/components/talent-scout/ScoreInline.tsx`: colored number (via `getScoreColor` by range) + horizontal mini-bar. Replaces standalone ScoreBar.
- `src/pages/talent-scout/FinalReviewDetail.tsx`:
  - Rows clickable to candidate detail.
  - Resume column before Portfolio. Both icons sized `h-11 w-11`.
  - "Rationale & Considerations" header.
  - 5-column card grid for previous reviews (FR1, FR2 numbering).
  - Pool Summary + Final Rankings titles 16px.
  - `recruiter_note` rendered as bulleted list with coral title.
  - "Generate Packet" button up top with "Re-Review" inline left.
  - Removed: "Generated X ago" caption, "Click a row to expand" text, Include Fast-Track checkbox, Final Overview column.
- `src/pages/talent-scout/RoleDashboard.tsx`:
  - Pull round cards: outer Card `p-4`, inner Link cards `p-3`. `processed_count` meta + divider removed.
  - "View Final Review" button when `latestFinalReviewId` exists.
  - Passes `search` / `onSearchChange` directly to CandidateTable (no separate CandidateSearch above).
- `src/pages/talent-scout/PullDetail.tsx`:
  - R-pill moved LEFT of role title, scaled +25% (`text-[16px] px-4 py-2`).
  - Passes `search` / `onSearchChange` to CandidateTable.
- `src/pages/talent-scout/CandidateDetail.tsx`:
  - Portfolio Card moved ABOVE Resume & Files Card (renamed from "Files & Materials").
  - `unwrapSecurityWrapper` applied to portfolio links.
- WORKER_RESOURCE_LIMIT 500 fixed by sending packet as signed-URL link in email body instead of base64 MIME attachment. Attachments are NOT size-capped during PDF merge (Jimmie's call: design portfolios can be 25MB+).
- `fmtErr` helper added to `ts-final-review` (and pattern applied where Postgrest errors surface) so `[object Object]` is replaced with real error text.
- `EdgeRuntime.waitUntil` used for background work in `ts-final-review`.

## In progress / open

- **CandidateTable column / spacing iteration.** Last change: `d6a53d6` added 15px right-padding between Portfolio and Quick Overview. Jimmie has not confirmed the latest layout is final.
- **PR review.** Branch is awaiting Jimmie's local review before merge to `main`.
- **Visual approval round.** Iteration has been continuous across 3.6.1 → 3.6.11. No "looks done, merge it" signal yet from Jimmie.

## Likely drift / unverified

- `CHECKPOINT.md` was last updated 2026-05-06 and predates Phase 3.6.1 → 3.6.11 work. It still says the Phase 3.6 migration `20260506213340_phase_3_6_final_review_and_packets.sql` is "NOT YET APPLIED — needs supabase db push". Jimmie confirmed final review ran locally so it's applied to local Supabase; production status unknown from this conversation.
- It's not clear from conversation whether `final_overview` was dropped from the migration / column or just removed from the prompt + render path. Worth checking before merge.
- It's not clear whether the diagnostic column tints were definitively removed everywhere (commit `b7e8163` says "diagnostic tints stripped" so they should be gone).
- `ts-final-review-packet` end-to-end email-send path has not been confirmed since the WORKER_RESOURCE_LIMIT fix in this conversation. The `ts-final-review` function ran; the packet path was not explicitly re-tested in conversation after the fix.

## Blocked on

- Nothing technically blocked. Awaiting Jimmie's review/sign-off on the visual iteration before merge.

## Last commands run

```
git add -A && git commit -m "Phase 3.6.11: +15px padding between Portfolio and Quick Overview ..."
git push origin phase-3-6-final-review-packet
```

Push succeeded: `a753574..d6a53d6  phase-3-6-final-review-packet -> phase-3-6-final-review-packet`.

## Recent prior errors hit (and resolved)

- `{"error":"[object Object]"}` from `ts-final-review` — Postgrest errors aren't `instanceof Error`. Fixed via `fmtErr` helper.
- `WORKER_RESOURCE_LIMIT` 500 on packet generation — base64-encoding the merged PDF as a MIME attachment doubled memory. Fixed by sending signed-URL link in email body.
- `src/integrations/supabase/types.ts` got emptied by failed `supabase gen types --linked > types.ts` (shell `>` truncates first). Restored via `git checkout` of prior version. Safer pattern documented: write to `/tmp/types.ts` first, `test -s`, then `mv`.
- `localhost:8080` 404 in Chrome — Vite binds to `::` (IPv6). Workaround: use `http://127.0.0.1:8080/`.
- Bulk action bar layout shift on select-all — DOM was being added/removed. Fixed by always rendering with `opacity-0` when empty.
