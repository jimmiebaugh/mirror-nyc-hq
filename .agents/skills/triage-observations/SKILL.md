---
name: triage-observations
description: "Use when reviewing or triaging the code-observations.md log: turning the passive findings into a summary, a prioritized fix plan with recommended phase/order, and a ready-to-paste Code prompt. Triggers: 'triage observations', 'review code-observations', 'what is in the observations log', 'plan the cleanup pass', 'code-observations.md'."
metadata:
  author: hq
  version: "1.0.0"
---

# Triage Observations

Turns the passive `code-observations.md` log into three deliverables: a summary, a prioritized fix plan with recommended phase/order, and a ready-to-paste Code prompt. Read-only on the codebase except for the verify-pass glyph updates in step 3. Does NOT implement fixes; the prepared prompt is the deliverable.

## 1. Read the log

Read `code-observations.md` at the repo root. If it carries only the template header and empty section tables (zero observation rows), say so and stop; nothing to triage.

## 2. Summarize

Report a condensed picture, not a row dump:

- Total open observations (R `☐`), split into verified (V `☑`) vs unverified (V `☐`).
- Breakdown by section (Frontend / Edge Functions / Database / Build & Tooling / Docs / Other).
- Breakdown by severity (`[high]` / `[med]` / `[low]`).
- Call out every `[high]` row explicitly: `file:line`, the one-sentence note, V status.
- Note any already-resolved (R `☑`) or retracted (strikethrough) rows so the reader knows they are handled; do not carry them forward into the plan.

## 3. Verify pass (Code session only)

For each unverified (`V ☐`) observation you intend to recommend acting on, open the cited `file:line` and confirm the finding is real.

- Confirmed → flip V to `☑` in `code-observations.md`.
- False positive → strike the row through and append `(retracted: <reason>)` to the Note. Do not delete it (the log is append-only).
- Genuinely undecidable without deeper context → leave V `☐` and flag it "needs owner verification" in the summary.

**Two-session discipline:** the glyph edits above touch a repo file. Only make them in a Code session, or when no `claude/*` feature branch is active. In Cowork during active feature work, skip the writes, report verify status as a recommendation, and queue the glyph updates in `OUTPUTS/REPO_DOC_UPDATES.md` for Code to apply.

## 4. Recommend fixes + phase/order

Build a fix plan from the open + verified rows. For each row give the fix in one line and where it lands.

Ordering rules:

- `[high]` (probable bug or security smell) first. If it touches a live production path, recommend a standalone scoped fix now, not folded into feature work.
- `[med]` (consistency / clarity) next. Fold into whichever active Phase 5 sub-phase already touches that file or area, so the fix rides along with work that is already opening that surface. Check `docs/roadmap.md` for the active sub-phase map.
- `[low]` (polish) last. Batch into a single dedicated cleanup pass; do not spread across feature branches.
- Within a tier, order by blast radius (shared modules before leaf files) and by whether the fix unblocks active work.

Respect the log's own rule: do not recommend derailing an in-flight task. A fix either rides along with work already touching that area, or it gets its own scoped branch.

## 5. Prepare the Code prompt

Write one ready-to-paste implementation prompt for a Code session, scoped to the batch you would tackle first (usually all `[high]` plus any `[med]` that rides along cleanly). The prompt must be self-contained:

- One line of context: this is a code-observations triage batch, not feature work.
- Each fix as its own numbered item: `file:line`, what is wrong, the exact change. Cite the observation `#` from the log.
- Reference `docs/conventions.md` and the relevant topic doc for anything non-obvious.
- Wrap-up instructions: run the `code-reviewer` subagent on the diff; for each fixed observation mark R `☑` in `code-observations.md` and put the fix commit's short hash in the Note; commit `[skip netlify]` if docs-only, normal otherwise; respect the deploy policy (feature branch, no push without Jimmie's go).

Output the prompt inline in a fenced code block. If running in Cowork, also offer to save it to `OUTPUTS/`.

## Don't

- Don't implement the fixes. The prompt is the deliverable.
- Don't reorder or delete rows in `code-observations.md`. Verify-pass glyph flips and retraction strikethroughs are the only allowed edits.
- Don't recommend folding a `[high]` finding into unrelated feature work just to avoid a separate branch.
