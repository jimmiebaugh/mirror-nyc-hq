---
description: Run the HQ pre-merge checklist and report what's clean vs what needs fixing before squash-merge.
---

Run the HQ pre-merge checklist and report what's clean vs what needs fixing before squash-merge. Don't run the actual merge — just report the state.

## Checks

### 1. Working tree state
- `git status` (any uncommitted changes?)
- `git log --oneline main..HEAD` if on a feature branch (what's pending?)

### 2. TypeScript + build
- `npx tsc --noEmit` (must be clean)
- `npm run build` (must be clean)

### 3. Migrations sync
- `supabase migration list --linked` — Local must equal Remote across every entry
- If drift exists, run `supabase db push --linked` first and re-check

### 4. Edge functions deploy state
- List edge functions in `supabase/functions/` that import from `_shared/prompts.ts`, `_shared/anthropic.ts`, `_shared/sendEmail.ts`, `_shared/packetRender.ts`, or `_shared/internalAuth.ts` (shared modules whose changes require dependent re-deploys).
- Cross-check against `git log` for the last commit touching each shared file vs the last deploy of each consumer.
- Output: list of functions that need `supabase functions deploy <name>` before squash-merge.

### 5. Doc sweep
For each item, verify it reflects the current state of the active phase:
- `docs/roadmap.md` — current phase marked DONE with one-line summary?
- `docs/decisions.md` — any decisions from this phase captured (the new section at the top)?
- `docs/schema.md` — reflects any column / table / enum changes?
- `docs/edge-functions.md` — reflects new or changed functions?
- `docs/conventions.md` / `docs/cron-jobs.md` — reflects any new gotchas / schedules?
- `docs/design-system.md` — reflects any new design pattern that should be canonized?
- `CHECKPOINT.md` — queued for backfill (but DON'T update yet; that happens post-merge with `[skip netlify]`)

### 6. Em-dash sweep
- `grep -rn "—" docs/ src/ supabase/functions/ CLAUDE.md CHECKPOINT.md` (excluding `node_modules`, `dist`, `.git`, lockfiles)
- Per Jimmie's tone rule, em dashes shouldn't appear in any new content. Surface every match in modified files; ignore matches in unmodified files (legacy content).

## Output format

Per check:
- ✅ clean
- ⚠ needs attention — with the exact fix command
- ❌ blocker — must fix before merge

End with a one-line summary: `Ready to merge` or `N items need attention before merge`.
