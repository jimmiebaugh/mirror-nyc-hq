# Decisions

Decisions made during Phase 3.6 iteration. Earlier phase decisions live in `docs/decisions.md`.

## Architecture / infra

- **Drop CloudConvert.** Jimmie removed the CloudConvert account. PDF generation moved to pure `pdf-lib` rendering inside `supabase/functions/_shared/packetRender.ts`. Uses `StandardFonts.Helvetica` and `StandardFonts.HelveticaBold`. No HTML→PDF step anywhere in the packet path.
- **Packet email sends a link, not the PDF.** Instead of MIME-attaching the merged PDF, the email body contains a signed Supabase Storage URL. Two URLs generated per packet via `uploadPacketAndSign`: 1h URL for the in-app browser viewer, 7d URL for the email. Reason: base64-encoding a 20+ MB PDF as a MIME attachment was tripping `WORKER_RESOURCE_LIMIT` in the Edge Function.
- **No size cap on portfolio attachments during PDF merge.** Jimmie's explicit call: design portfolios can legitimately be 25+ MB. We don't skip them. If memory becomes a problem again the fix is on the email/transport side, not the merge side.
- **`fmtErr` helper for surfacing real error messages.** Postgrest errors from `supabase-js` are plain objects, not `Error` instances, so `String(err)` yields `[object Object]`. `fmtErr` handles `Error`, plain objects with `.message`, and Postgrest's `{message, code, details, hint}` shape. Apply this anywhere Edge Functions surface errors back to the client.
- **`EdgeRuntime.waitUntil` for background work in `ts-final-review`.** Function returns `final_review_id` immediately; the long Claude call + DB writes happen in `waitUntil` so the client can subscribe to Realtime `step_progress` instead of waiting on the HTTP response.

## Prompts

- **Single Claude call per candidate eval.** `quick_overview`, `top_strengths`, `key_gaps`, `recruiter_note` all come back in one structured response from `DEFAULT_EVAL_PROMPT`. Not split across multiple calls.
- **All three Talent Scout prompts live in `supabase/functions/_shared/prompts.ts`.** Single source of truth on the server side. The three exports:
  - `DEFAULT_EVAL_PROMPT` — per-candidate eval
  - `FINAL_REVIEW_PROMPT_TEMPLATE` — comparative final review (uses string substitution for context)
  - `scorecardGenerationPrompt()` — function that returns the scorecard prompt
- **Frontend prompt mirror is manual.** `src/lib/talent-scout/defaultEvalPrompt.ts` is a hand-maintained copy of the server-side prompt with a header note explaining why. Frontend can't import from `supabase/functions/_shared` so the duplication is intentional. Keep them in sync when the prompt changes.
- **Rationale: 2-3 sentences max.** Earlier outputs were too long. Hard cap in the prompt.
- **Recruiter note: `string[]`, max 3 items.** Was a single string; changed to a bullet list. Schema and validation both reflect `string[]`. Render path turns each item into `• item` in PDFs.
- **`final_overview` removed entirely.** Was originally specified as a 4-6 headline field per candidate; Jimmie's call: "a lot of noise here." Removed from prompt, JSON schema, validation, packet enrichment, and the FinalReviewDetail table column.

## Final review data shape

`final_rankings` row shape (per candidate):
```
{
  candidate_id: string,
  final_rank: number,
  final_tier: string,
  rationale: string,            // 2-3 sentences
  recruiter_note: string[]      // up to 3 bullets
}
```
`ts-final-review` coerces `recruiter_note` to `string[]` if a legacy single-string value comes back from Claude (handles older saved reviews).

## UI / component decisions

- **Single shared `CandidateTable.tsx`** used by both `RoleDashboard` and `PullDetail`. Search field, bulk-action bar, sort headers, and Resume/Portfolio icon columns all live in the table. Pages just pass `search` / `onSearchChange` / `searchPlaceholder` props.
- **Bulk action bar always rendered** (with `opacity-0` and `pointer-events-none` when empty) instead of conditionally mounted. Reason: conditional mount caused the table to shift down when the first row was selected.
- **Resume + Portfolio icon buttons share `ICON_BUTTON_CLS`.** Headers split into two equal `flex-1` halves so each label sits centered directly above its icon.
- **`ScoreInline` (colored number + horizontal mini-bar)** lives inside the Candidate cell, not as its own column. Score color comes from `getScoreColor` keyed on score range.
- **Status pill labels are past-tense** ("Rejected"). Bulk-action button verbs are imperative ("Reject"). Distinct affordances on purpose.
- **`auto_rejected` is AI-only.** Not selectable manually in the dropdown; safety guard in `onValueChange` returns early. Shown disabled if it's the current value.
- **`StatusDropdown` size variants** are `compact` / `default` / `large`. Latest compact is `h-9 text-[14px] min-w-[124px]` (3.6.10 bumped from 3.6.9).
- **R-pill on PullDetail moved LEFT of the role title** and scaled +25% (`text-[16px] px-4 py-2`).
- **Pull round cards on RoleDashboard slim:** outer Card `p-4`, inner Link cards `p-3`. `processed_count` meta + the divider are gone.
- **Portfolio Card on CandidateDetail sits ABOVE the Resume & Files card** (formerly "Files & Materials"). Reason: the portfolio link is the most-clicked field; surface it first.

## CandidateTable grid (latest)

```
grid-cols-[minmax(260px,1fr)_185px_minmax(0,2.4fr)_132px_36px]
```

- Col 1: Candidate (with embedded ScoreInline). `minmax(260px, 1fr)`.
- Col 2: Resume + Portfolio. Fixed `185px`. `pr-[25px]` on header + body wrappers gives the right-side breathing room before Quick Overview.
- Col 3: Quick Overview. `minmax(0, 2.4fr)`.
- Col 4: Status. Fixed `132px`. Header centered.
- Col 5: Row menu. Fixed `36px`.

## Things ruled out

- **HTML → PDF via CloudConvert.** Removed. Don't reintroduce.
- **Email packet as MIME attachment.** Use signed URL in body instead.
- **Capping individual attachment sizes during merge.** Jimmie said no.
- **Splitting eval into multiple Claude calls.** Single call returns everything; don't fan out.
- **Final Overview field.** Don't reintroduce as a Claude output, schema field, or column.
- **Long rationale.** Two-to-three sentences max in the prompt.
- **`recruiter_note` as a single string.** It's an array now.
- **Separate `CandidateSearch` component above the table.** Search lives inside `CandidateTable`. Don't add a second one.
- **Conditional render of the bulk-action bar.** Always render with opacity toggle to avoid layout shift.
- **Standalone `ScoreBar`.** Replaced by `ScoreInline`.
- **`Include Fast-Track` checkbox on FinalReviewDetail.** Removed.
- **"Generated X ago" caption + "Click a row to expand" hint on FinalReviewDetail.** Removed.

## Naming + structure

- **Prompts file:** `supabase/functions/_shared/prompts.ts`. Singular file, three exports.
- **Frontend prompt mirror:** `src/lib/talent-scout/defaultEvalPrompt.ts`.
- **PDF render helpers:** `supabase/functions/_shared/packetRender.ts`. Pure pdf-lib. Helpers: `addCoverPage`, `addCandidateTitlePage`, `addSectionDivider`, `drawSectionTitle`, `drawTable`, `drawWriteupCard`, `drawParagraph`, `mergePdfAttachments`, `sendPacketEmail`, `uploadPacketAndSign`.
- **URL unwrap:** `src/lib/unwrapUrl.ts` exports `unwrapSecurityWrapper`.
- **Shared icon button class:** `ICON_BUTTON_CLS` constant inside `src/components/talent-scout/CandidateTable.tsx`.
- **Score component:** `src/components/talent-scout/ScoreInline.tsx`.

## Tone / process (Jimmie)

- Casual, direct. No filler affirmations. No em dashes anywhere.
- Recommend, don't present options.
- Reference only the latest version. If we iterated, the old version is gone.
- Don't fill gaps. Ask if unclear.
- Phase commits use `Phase 3.6.N` numbering. Co-author: `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`.
