# Next Steps

Ordered most-immediate first. On `main`. Working tree clean (or about to be after the in-flight Pass commits).

Phase 3.7 is in progress: **Candidates UX + referral ingestion**. Five small passes. Cron + watchdogs got pushed to Phase 3.8.

## 1. Phase 3.7.1 — mailto + row left-border  ✓ LANDED

Email cells across CandidateTable, CandidateDetail, FinalReviewDetail are now `mailto:` links. Each candidate row in CandidateTable gets a 3px left-border in its status color via inline `borderLeft` style (matches the FinalReviewDetail rationale-cell pattern). `statusStyle()` in `StatusDropdown.tsx` now exposes a `colorHex` field per option.

## 2. Phase 3.7.2 — `manually_reviewed` field + auto/manual pill

- **Migration:** add `manually_reviewed boolean not null default false` to `ts_candidates`.
- **Edge Functions:** no changes needed for initial AI eval (defaults to false). For re-eval (`ts-evaluate-candidate`, `ts-bulk-reevaluate`, round-scoped re-eval), if the candidate row has `manually_reviewed = true`, write the new score / breakdown / strengths / gaps / overview but DO NOT update `status`. Keep the user's status decision intact.
- **`StatusDropdown.tsx`:** `onValueChange` should also set `manually_reviewed = true`. Remove the `if (next === current) return;` short-circuit so re-selecting the same value still flips reviewed.
- **`CandidateTable.tsx`:** under the Status dropdown in each row, render a small grey pill: `auto` if `manually_reviewed=false`, `manual` if true. When `manually_reviewed=false`, the row gets a slightly lighter background tint (try `bg-white/[0.02]` or similar). Click on the `auto` pill flips to manual (one-way only). When the referral pill is also rendered (Pass 5), the two pills go side-by-side — combined width ~50%/50% of the status column (132px → ~66px each).
- **Bulk actions:** the bulk-action handlers in CandidateTable that update status should also set `manually_reviewed = true` for every row in the action.
- **`CandidateDetail.tsx`:** stack the same auto/manual pill below the status dropdown.
- **Gotcha:** existing rows backfill to `false` (so they render as `auto`). That's correct — they were created via AI eval before this field existed.

## 3. Phase 3.7.3 — CandidateDetail card layout reorg

- Restructure the cards on `src/pages/talent-scout/CandidateDetail.tsx` into a 3×2 grid:
  - R1: Files & Materials (L) | Recruiter Overview (R)
  - R2: Top Strengths (L) | Key Gaps (R)
  - R3: Internal Notes (L) | Score Breakdown (R)
- Use Tailwind `grid grid-cols-2 gap-6` with `items-start` so each row's cards top-align even when heights differ. Default CSS Grid row behavior handles this.
- Pure layout, no schema/logic.

## 4. Phase 3.7.4 — Scorecard 100-point cap

- Tighten the prompt in `supabase/functions/_shared/prompts.ts` (`scorecardGenerationPrompt`) — restate "Total weights = 100 points (HARD)" and explicitly say "If your selections don't sum to 100, scale them proportionally before returning."
- Add a post-Claude normalizer in `supabase/functions/ts-generate-scorecard/index.ts`: after parsing, sum `criteria[].weight`. If `sum !== 100`, multiply each weight by `100 / sum` and round; fix the delta on the largest weight so the sum is exactly 100.
- Optional: surface a non-blocking warning in the wizard's step-3 UI if Claude returned non-100 (defensive — prompt + normalizer should make this rare).

## 5. Phase 3.7.5 — Referral ingestion

The biggest pass. Forwards from Mirror managers should ingest the original applicant.

- **Migration:** add to `ts_candidates`:
  - `is_referral boolean not null default false`
  - `referrer_email text` (nullable; only set when `is_referral=true`)
- **`ts-pull-candidates/index.ts`:** for each Gmail message in the role's pull window:
  - If sender domain is `mirrornyc.com` AND the subject matches the role's existing search settings (the same filter that's already applied to direct-jobs@ messages), treat as a potential referral.
  - Parse the message body to find the forwarded original. Standard markers: `---------- Forwarded message ---------` (Gmail), `Begin forwarded message:` (Apple Mail), `From: <name> <email@host>` header block (Outlook). Extract the original sender's email + name, the original subject, the original body.
  - Use the original sender as the candidate identity (name, email). Set `is_referral=true`, `referrer_email = manager's email`. Otherwise the eval pipeline runs identically — eval prompt is BLIND to referral status.
  - Attachments: forwarded MIME messages typically preserve attachments as parts. Pull them through the existing attachment pipeline.
- **Frontend pill:** when `is_referral=true`, render an electric-blue pill (try `#3b82f6` / blue-500) inline-right of the auto/manual pill. When BOTH pills are rendered, each is ~50% of the status column width (132px column → roughly 64-66px each pill).
- **Edge cases to handle:**
  - Same candidate emails jobs@ directly AND gets forwarded: dedupe on email address. First-write wins; if direct came first, don't flip to referral; if referral came first, leave is_referral=true even after a direct email arrives.
  - Forward chains (manager A forwards to jobs@, but the original email itself was a forward to manager A): only unwrap once. Use the deepest "From" email as the candidate.
  - Plain-text vs HTML body: handle both. The existing email parser likely covers this.

## Other open items (queued, not strictly part of 3.7)

- **Verify `ts-final-review-packet` end-to-end** after the WORKER_RESOURCE_LIMIT fix. Then flip `PACKET_FEATURE_ENABLED` from `false` to `true` in `PullDetail.tsx` + `FinalReviewDetail.tsx`.
- **Drop dead column:** `ts_pull_rounds.reeval_last_progress_at` (replaced by `ts_roles` reeval state in Phase 3.5). Cleanup migration whenever convenient.
- **`monthly-spend-reset` cron** — `cap_alert_sent_this_month` doesn't auto-reset. Lands with Phase 3.8 cron work.
