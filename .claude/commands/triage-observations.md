Triage the `code-observations.md` log: turn the passive findings into a summary, a prioritized fix plan with recommended phase/order, and a ready-to-paste Code prompt. Runs the `triage-observations` skill (`.agents/skills/triage-observations/SKILL.md`). Does NOT implement fixes; the prepared prompt is the deliverable.

## Argument

`$ARGUMENTS` (optional) is a filter to narrow the pass. Accepts:
- A severity (`high`, `med`, `low`): triage only rows at that severity.
- A section name (`frontend`, `edge-functions`, `database`, `build`, `docs`, `other`): triage only that section.
- Empty: triage the whole log.

## Steps

Follow the `triage-observations` skill end to end:

1. **Read** `code-observations.md` at the repo root. If it carries only the empty template, say so and stop.
2. **Summarize**: open count split verified/unverified, breakdown by section and severity, every `[high]` row called out with `file:line` and its note. Apply `$ARGUMENTS` as a filter if given.
3. **Verify pass** (Code session only): open the cited `file:line` for each unverified row you intend to act on; flip `V ☐` to `☑` on confirm, strikethrough plus `(retracted: <reason>)` on a false positive. In Cowork during active feature work, skip the writes and queue them in `OUTPUTS/REPO_DOC_UPDATES.md` instead (two-session discipline).
4. **Recommend fixes + phase/order**: `[high]` standalone now (especially live-path), `[med]` folded into the active Phase 5 sub-phase that already touches that area (check `docs/roadmap.md`), `[low]` batched into one dedicated cleanup pass. Within a tier, order by blast radius then by whether the fix unblocks active work.
5. **Prepare the Code prompt**: one self-contained, copy-pasteable implementation prompt scoped to the first batch. Each fix numbered with `file:line` plus exact change plus the observation `#`, plus the wrap-up (run `code-reviewer`, mark `R ☑` with the fix commit hash, deploy-policy compliance).

## Output format

1. **Summary**: the condensed picture from step 2.
2. **Verify pass results**: what got confirmed, what got retracted, what still needs an owner. Skip this block if nothing was unverified.
3. **Fix plan**: the prioritized list from step 4, grouped `[high]` / `[med]` / `[low]`, each with the one-line fix and where it lands.
4. **Code prompt**: the step-5 prompt, inline in a fenced code block.

End with a one-line read: `N observations, M ready to batch now` or `Log is clean, nothing to triage`.

## Don't

Don't implement the fixes. Don't reorder or delete rows in `code-observations.md` (verify-pass glyph flips and retraction strikethroughs are the only allowed edits). Don't fold a `[high]` finding into unrelated feature work just to avoid a separate branch.
