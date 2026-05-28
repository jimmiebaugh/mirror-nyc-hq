---
description: Post-push ship finalization. Overwrites COWORK_SYNC, cleans worktree + branch, verifies. Run after `git push origin main` lands a sub-phase squash.
allowed-tools: Bash, Edit, Read, Write
argument-hint: "[branch-name] (the claude/* branch to clean)"
---

Execute the post-push ship finalization for the just-pushed sub-phase. Branch name (argument): `$ARGUMENTS`. If empty, derive from the most-recent merge commit's subject via `git log -1 --format='%s' main` (e.g., "Phase 5.12.12: ..." → use the worktree path that matches the sub-phase number).

Do not consider this command complete until all three verifications report clean. The session has consistently dropped these steps when run from the depleted-context end of a long ship; this command exists to make the steps atomic and verified.

## Step 1: Overwrite `OUTPUTS/COWORK_SYNC.md`

Path: `/Users/jimmie/Claude/Mirror NYC HQ/OUTPUTS/COWORK_SYNC.md`

**Preferred path: pre-drafted SHIPPED block.** Per the updated `docs/working-with-claude.md` § 4.5 AWAITING-block guidance, you should have drafted the SHIPPED block during the AWAITING phase with `<SHA>` placeholders. If that pre-draft exists (check chat history or scratch notes), find-and-replace `<SHA>` with the actual squash hash and write the file. This is the 30-second path.

**Fallback path: write from scratch.** If no pre-draft exists, write the SHIPPED block now from the squash + push artifacts. Use this exact structure:

```
# COWORK_SYNC: Code to Cowork status channel

**Status:** SHIPPED, Phase <X.Y> (<one-line ship title>)
**Marker commit:** `<squash-sha>` (squash)
**Follow-on:** `<backfill-sha>` (SHA placeholder backfill `<X.Y>` -> `<squash-sha>`) [if applicable; omit line if not]
**Predecessor:** Phase <prev-X>.<prev-Y> (`<prev-sha>`, <date>) -> follow-on `<prev-backfill-sha>` [if applicable]
**Earlier predecessors:** <prev-2> (`<sha>`, <date>), <prev-3> (`<sha>`, <date>), ...
**Pushed to origin:** ✅ commits pushed to `origin/main` <date> with Jimmie's explicit go.
**Netlify deploys:** <suppressed-per-deploy-budget OR deployed-now status>
**Migration on live:** <yes + filename + RAISE NOTICE summary OR `n/a, no migration this ship`>
**Branch:** `claude/<branch-name>` (worktree cleared by Code at push time, Step 2 below).

**Branch state on `origin/main`:**

```
<paste output of `git log --oneline -6` here>
```

---

## Files changed

### New
- `<path>`: one-line purpose summary
- ...

### Modified
- `<path>`: one-line summary of the change
- ...

---

## Post-squash code-review fixes (if any, folded into squash via `--amend`)

<omit section if none>

### [P<level>] <fix title>
<paragraph describing the fix>

---

## Decisions confirmed

1. **<decision title>**: <one-paragraph explanation>
2. ...

---

## Spec deviations

- **<deviation title>**: <one-paragraph explanation of what diverged from the spec and why>
- (If none, write: `No spec deviations. <Specific files touched verbatim per spec.>`)

---

## Carry-forwards

- **<carry-forward title>**: <one-paragraph note + where it belongs in the roadmap>

---

## Applied REPO_DOC_UPDATES entries (if any; remove from the Pending list)

1. **<author>, `<file>` <amendment>**: <one-paragraph note>
2. ...

(If none applied, write: `No REPO_DOC_UPDATES entries applied this ship. Pending list unchanged.`)
```

Source the content from: the squash commit body, `docs/decisions.md` § Phase <X.Y> entry (which carries the locked decisions), the diff against `main~N..main` for the files-changed section, and the AWAITING block notes if pre-drafted.

## Step 2: Clean up the feature worktree + branch

**Scope rule (locked 2026-05-25 after the .4-pilot incident):** this step only ever touches THIS session's own worktree + branch. Never touch any other worktree, even if `git worktree list` flags it `prunable`. Other `claude/*` worktrees may belong to concurrent parallel-pilot sessions with uncommitted work that git's prunable flag cannot detect. Honoring this rule trades occasional stale-worktree cruft for the guarantee that `/ship-finalize` cannot destroy a sibling session's in-flight work. Stale-worktree cleanup is a separate manual operation the user runs when no parallel sessions are active.

```bash
git worktree remove --force /Users/jimmie/Code/mirror-nyc-hq/.claude/worktrees/<BRANCH_NAME>
git branch -D claude/<BRANCH_NAME>
```

Replace `<BRANCH_NAME>` with the actual sub-phase branch (e.g., `phase-5-12-12-rail-nav-settings`).

If the worktree path doesn't exist (already removed), report and continue. If the branch doesn't exist locally (already deleted), report and continue.

Do NOT iterate over `git worktree list` to prune additional worktrees. The own-branch removal above is the entire scope of this step.

## Step 3: Verify all three steps landed

Run each command and inspect the output:

1. **Push landed:** `git log --oneline -3`
   - Expected: top line is the just-shipped commit (or its SHA-backfill follow-on). If you see the predecessor's hash at top, push didn't fire; re-run `git push origin main`.

2. **COWORK_SYNC overwrote:** `head -10 "/Users/jimmie/Claude/Mirror NYC HQ/OUTPUTS/COWORK_SYNC.md"`
   - Expected: the Marker commit line shows the new ship's squash SHA, not the previous ship's. If you see the previous Marker commit, Step 1 didn't write; re-run it.

3. **Worktree gone:** `git worktree list`
   - Expected: the just-shipped branch's worktree is absent. Other worktrees (bare-repo + any concurrent parallel-pilot sessions') stay untouched and present. If your own worktree is still listed, re-run Step 2's `git worktree remove --force`. Do NOT touch any other worktree to satisfy this check.

If any verification fails, re-run the corresponding step, then re-verify. Do not conclude until all three show clean.

## Final report

Report in this exact format so the human can scan it:

```
Ship finalization for Phase <X.Y>:
  ✅/❌ COWORK_SYNC.md overwritten (Marker commit: `<sha>`)
  ✅/❌ Worktree `/Users/jimmie/Code/mirror-nyc-hq/.claude/worktrees/<branch>` removed
  ✅/❌ Branch `claude/<branch>` deleted

Any failures + recovery actions taken: <list or "none">
```

Notes for future ships:

- The "pre-draft the SHIPPED block in the AWAITING phase" lever (per § 4.5) makes Step 1 a find-and-replace instead of a fresh write. Use it. The cognitive cost moves to the high-context start of the session instead of the depleted end.
- Stale-worktree cruft accumulates over time when sessions crash mid-flow. Clean it up manually with `git worktree list` + targeted `git worktree remove` calls when no `claude/*` branches are active. Never automate this inside `/ship-finalize` (see Step 2 scope rule).
