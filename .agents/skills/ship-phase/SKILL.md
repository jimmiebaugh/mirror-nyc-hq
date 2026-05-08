---
name: ship-phase
description: "Use when ending a phase / preparing the squash-merge to main. The single-Netlify-deploy-per-phase dance: pre-merge checklist, squash-merge with no [skip netlify], post-merge CHECKPOINT backfill with [skip netlify]. Triggers: 'squash-merge', 'ship phase', 'merge to main', 'pre-merge checklist'."
metadata:
  author: hq
  version: "1.0.0"
---

# Ship Phase

## PRE-MERGE CHECKLIST (on feature branch)
- `npx tsc --noEmit` clean
- `npm run build` clean
- `supabase migration list --linked` (Local = Remote)
- All edge functions deployed at latest shared-module versions
- Doc sweep: `docs/roadmap.md` (phase done summary), `docs/decisions.md` (rationale), `docs/schema.md` (any column changes), `docs/edge-functions.md`, `CHECKPOINT.md` (queued for backfill)

## SQUASH MERGE
- `git checkout main && git pull --ff-only`
- `git merge --squash <feature-branch>`
- Unstage any session-handoff docs from the squash (`PROJECT_STATUS.md` / `NEXT_STEPS.md` / `DECISIONS.md` / `CONTEXT_FOR_NEXT_CHAT.md` if they're in tree)
- `git commit` (NO `[skip netlify]`, this IS the deploy event)
- `git push origin main` triggers Netlify build

## POST-MERGE
- Backfill `CHECKPOINT.md` with new commit hash + push WITH `[skip netlify]`
- `git branch -D <feature-branch>`
- Deploy any pending edge functions
- Apply any pending GUC / Vault config in dashboard
