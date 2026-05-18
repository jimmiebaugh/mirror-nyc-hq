---
name: ship-phase
description: "Use when ending a phase / preparing the squash-merge to main. Single-commit-per-ship: CHECKPOINT.md update folds into the squash on the worktree branch BEFORE the squash-merge; one push fires Netlify (or skips, if the subject carries the canonical deploy-skip directive). Triggers: 'squash-merge', 'ship phase', 'merge to main', 'pre-merge checklist'."
metadata:
  author: hq
  version: "2.0.0"
---

# Ship Phase

Live convention per `docs/working-with-claude.md` § 4.5.c: single-commit-per-ship. CHECKPOINT.md update folds INTO the squash on the worktree branch BEFORE the squash-merge. No separate backfill commit.

## PRE-MERGE CHECKLIST (on feature branch)
- `npx tsc --noEmit` clean
- `npm run build` clean
- `supabase migration list --linked` (Local = Remote)
- All edge functions deployed at latest shared-module versions
- Doc sweep: `docs/roadmap.md` (phase done summary), `docs/decisions.md` (rationale), `docs/schema.md` (any column changes), `docs/edge-functions.md`, `CHECKPOINT.md` (rolled to this ship, new `<X.Y.Z>` placeholder added, prior placeholder backfilled if any)

## ON THE WORKTREE BRANCH (before squash)
- Run `supabase db push --linked` (from inside the worktree directory; CWD matters because the new migration files only exist here)
- Run `supabase gen types typescript --linked > /tmp/types.ts && test -s /tmp/types.ts && mv /tmp/types.ts src/integrations/supabase/types.ts`
- Run the spec's `## Seed data for the visual check` SQL block against the live DB
- Commit regenerated `types.ts` if changed: `[skip netlify] regen types from linked DB`
- Update `CHECKPOINT.md`: body paragraph rolls to this ship, Active feature branch refreshed, Recent commits gains new `<X.Y.Z>` placeholder + backfills prior placeholder, Recent migrations gains new entry if any. Commit on the worktree branch.

## SQUASH MERGE (from the bare repo)
- `git checkout main && git pull --ff-only`
- `git merge --squash <feature-branch>`
- Unstage any session-handoff docs that slipped through (`PROJECT_STATUS.md` / `NEXT_STEPS.md` / `DECISIONS.md` / `CONTEXT_FOR_NEXT_CHAT.md`)
- `git commit` with the squash subject. **Deploy semantics:**
  - If this ship is the deploy event: OMIT the Netlify deploy-skip directive from the subject. Body has zero occurrences of the literal substring either way (per `feedback_skip_netlify_substring_trap.md`).
  - If this ship is in a deploy-skipping batch: include the canonical deploy-skip directive in the SUBJECT only; constructed from the workflow convention, never pasted from any spec / sync / memory document. Body has zero occurrences.
- `git push origin main` (single push; replaces the old two-push dance). Per `feedback_push_approval_per_squash.md`, the push requires a fresh explicit "go" from Jimmie even if the ship was approved earlier.

## POST-MERGE
- CHECKPOINT.md is already updated (folded into the squash per the live convention).
- `git worktree remove .claude/worktrees/<branch> && git branch -D claude/<branch>`
- Deploy any pending edge functions: `supabase functions deploy <name>`
- Apply any pending GUC / Vault config in dashboard
- Overwrite `OUTPUTS/COWORK_SYNC.md` with the SHIPPED template per `docs/working-with-claude.md` § 2 (covers files changed, decisions confirmed, spec deviations, carry-forwards).
