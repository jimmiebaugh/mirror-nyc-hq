# Working with Claude on Mirror NYC HQ

Living playbook for setting up Code + Cowork sessions to ship HQ work cleanly. Tailored to Jimmie's role (Senior Producer, not a developer). Current phase lives in `CHECKPOINT.md`; finished-phase history in `docs/v1-changelog.md`.

All UX/UI design happens directly in Claude (Cowork for wireframing + design specs, Code for implementation). Lovable is no longer in the toolchain. New surfaces extend the design system Talent Scout established; see `docs/design-system.md`.

---

## 1. Two surfaces, two jobs

| Surface | Job | When to reach for it |
| --- | --- | --- |
| **Cowork** (Claude desktop app) | Planning, prompt-drafting, exploration, "what should we build," wireframes. | Before opening a Code session, drafting specs, refining requirements, recapping a phase. |
| **Code** (Claude Code CLI, primary; desktop app secondary) | Execution, implementation, anything that touches files, DB, or edge functions. | Once the spec is clear and you want the work done. |

**How to open Code:** as of 2026-05-27 Jimmie runs Claude Code primarily via the **CLI** (`cd` into `mirror-nyc-hq`, then `claude`); CLI commands are fine to reference. The desktop app (open the `mirror-nyc-hq` folder directly, switch to Code mode) is the secondary Code surface and is mainly reserved for Cowork. Either runtime drives the same repo; the two-session discipline below (Cowork read-only on the repo during active `claude/*` branches) is unchanged.

**The mistake to avoid:** using Code for ideation. Code burns context fast and loses architectural decisions in the noise of file edits. Use Cowork to think; arrive in Code with a tight prompt.

**The cleanest sequence for any new feature:**

1. **Cowork session:** brainstorm + interview-style spec.
2. **Cowork outputs a markdown spec** to `OUTPUTS/phase-X-Y-<surface>-spec.md`.
3. **Code session:** paste the spec, ask Code to validate or critique it first, then implement.
4. **After each sub-phase:** Code writes `OUTPUTS/COWORK_SYNC.md`. Cowork reads it at the start of the next session and updates docs as needed.
5. **End-of-feature:** doc sweep in Code (roadmap, edge-functions.md, decisions, etc.), then squash-merge.

---

## 2. Two-session discipline

Cowork and Code both edit files. Without discipline, they clobber each other.

### The rule

**Cowork is read-only on `/Users/jimmie/Code/mirror-nyc-hq` while any `claude/*` feature branch is active.** During active feature work:

- Cowork doc-update intent queues in `OUTPUTS/REPO_DOC_UPDATES.md` (Cowork workspace, not the repo). Code consumes the queue on its branch.
- Spec drafts go into `OUTPUTS/phase-X-Y-<surface>-spec.md` (Cowork workspace).
- `OUTPUTS/COWORK_SYNC.md` is the Code-to-Cowork status channel. Code overwrites it at phase wrap-up, single write per phase. See `feedback_cowork_sync`.

Cowork commits to repo `main` are allowed only when there are no active feature branches AND no uncommitted WIP on `main`. Verify with the pre-flight check below.

### Pre-flight check (start of every session)

```bash
cd /Users/jimmie/Code/mirror-nyc-hq && \
  echo "=== branch ===" && git branch --show-current && \
  echo "=== status ===" && git status --short && \
  echo "=== worktrees ===" && git worktree list && \
  echo "=== unmerged claude branches ===" && (git branch | grep '^  claude/' || echo "(none)")
```

Decision tree:

- **Active worktree on `claude/*` OR uncommitted changes on `main`:** Cowork goes read-only. Queue doc edits in `OUTPUTS/REPO_DOC_UPDATES.md`.
- **No active worktree, main clean:** repo doc edits are allowed.

### Pre-squash check (Code, before any `git checkout main && git merge --squash`)

Hard gate. Run `git status --short` on `main` first. If output is non-empty, **stop**. Do not auto-stash. Do not auto-commit. Surface modified files to Jimmie and let him decide.

The Phase 4.3.1 main-checkout conflict was caught by exactly this check. Keep it.

### Worktree spin-up: symlink the `.env`

A fresh `git worktree add` does NOT copy `.env` because it's gitignored. Without it, `src/integrations/supabase/client.ts` throws `VITE_SUPABASE_URL is required` at module load and the page renders fully blank with NO console error. Silent failure mode.

Fix on every fresh worktree before `npm run dev`:

```bash
ln -s /Users/jimmie/Code/mirror-nyc-hq/.env .claude/worktrees/<name>/.env
```

Symlink (not copy) so secrets stay in one place. See `feedback_worktree_env_symlink`.

### Worktree hygiene

After a sub-phase squash-merges, Code removes its own worktree:

```bash
git worktree remove .claude/worktrees/<name>
git branch -D claude/<name>
```

Scope strictly to THIS session's own worktree. Do NOT prune other `claude/*` worktrees even if git flags them prunable; concurrent sessions may have uncommitted work that the prunable flag cannot detect. See `feedback_worktree_cleanup_only_my_own`.

---

## 3. Cowork as the sync enforcer

When Code overwrites `OUTPUTS/COWORK_SYNC.md` at phase wrap-up, Cowork's next session opens with a doc sync pass:

1. Update `CHECKPOINT.md`. Branch commit hash, current sub-phase, what's done vs. next.
2. Update `docs/decisions.md` with any architectural decisions captured in COWORK_SYNC that aren't already logged.
3. Flag any contradictions with `docs/schema.md`, `docs/edge-functions.md`, `docs/auth-model.md` so they can be reconciled before the next session.

### Phase-boundary check (roadmap.md)

At every phase boundary (the squash-merge of the last sub-phase of a phase), Cowork verifies `docs/roadmap.md`:

1. **Finishing phase summarizes to one line** per `docs/roadmap.md` line 3 convention. Detail moves to `docs/v1-changelog.md`.
2. **Next phase expands to full active-phase detail.** Sub-phase candidates, ordering, dependencies.
3. **Open questions reconciled.** Anything answered moves to `docs/decisions.md`; anything still open moves to the next phase's section.

Two-session discipline applies. If a `claude/*` feature branch is open when the check runs, the roadmap edit queues in `OUTPUTS/REPO_DOC_UPDATES.md`. `TEMPLATES/phase-end-doc-sweep.md` carries the full end-of-phase sweep list.

---

## 4. Standard new-surface workflow

```
For each new HQ surface:

  1. Cowork session:
     a. Run design-spec-builder subagent (or paste the prompt manually).
     b. Subagent reads docs/design-system.md first to find the closest Talent Scout analog.
     c. Drafts a spec mapping the new surface to existing patterns.
        Calls out what's being lifted vs. adapted vs. invented.
     d. Spec includes a `## Seed data for the visual check` block with
        a SQL seed populating realistic test rows. See § 4.3 below.
     e. Spec includes a `## Wireframe binding` block citing per-surface
        wireframe HTML line ranges. See § 4.4 below.
     f. Save to OUTPUTS/phase-X-Y-<surface>-spec.md.

  2. Pause. Review and edit the spec yourself before any code is touched.

  3. Code session: paste the spec.
     "Implement exactly per the spec at OUTPUTS/phase-X-Y-<surface>-spec.md.
      Reference docs/design-system.md and the closest Talent Scout component.
      Ask before deviating."

  4. Code writes migrations + components + pages. Runs migration-reviewer
     subagent. Does NOT yet `supabase db push --linked`. See § 4.2 below.

  5. Code runs the seed SQL from the spec against a local Supabase (or
     hand-crafts types.ts from the migration files if no local Supabase
     is running).

  6. Code runs `npm run dev` on the worktree, navigates each new surface
     at 1440px, screenshots each one. Embeds screenshots in the AWAITING
     SQUASH APPROVAL block surfaced in chat. See § 4.1 below.

  7. Code runs code-reviewer subagent on the diff with cold context.
     Subagent verifies design-system.md adherence + the brand-rules-that-
     bit-us list + the wireframe-binding contract from § 4.4.

  8. Squash-approval gate. Jimmie compares screenshots against the
     wireframe HTML. If anything drifts, Code iterates before squash.

  9. ONLY at the squash-approval gate: Code runs `supabase db push
     --linked` to apply migrations to the live DB, then squash-merges
     to main. See § 4.2 below.
```

The standard workflow above is the canonical one. The four subsections below codify the discipline that was missing through Phase 5.2.1.

### 4.1. Visual screenshot check before squash

Code-reviewer cannot see. It reads the diff, not the rendered DOM. Component classes can be wrong, dynamic class names can be Tailwind-purged, status pills can render bare, layout can drift from the wireframe, and code-reviewer signs off clean.

Rule: every surface in a sub-phase gets a screenshot at 1440px viewport, taken by Code on the worktree before the AWAITING SQUASH APPROVAL block writes. Screenshots embed in the AWAITING block as file paths.

Jimmie's job at the squash-approval gate is to open the screenshots side-by-side with the wireframe HTML at the same viewport and confirm visual parity. If anything drifts, the squash does not happen until Code iterates.

Burn: ~5 minutes per surface for the screenshot pass. Save: an entire revision round.

### 4.1.a Carve-out for invasive-schema sub-phases

When a sub-phase's migrations would break a live-DB screenshot (RENAME / DROP of tables or columns that the new UI immediately depends on; column adds that the new UI immediately requires), the AWAITING-gate screenshot pass can't run against the live linked DB. The new surfaces would query for columns that don't exist yet.

Two options when this happens:

1. **Local Supabase via `supabase start`** (preferred when available): bring up a local DB, `supabase migration up --local` against the worktree branch's migration files, point the dev server at the local URL via a temporary `.env.local` override, capture screenshots, embed in the AWAITING block.

2. **Skip live screenshots** (acceptable fallback): rely on code-reviewer cold pass + JSDoc wireframe-binding citations + post-squash eyeball. Document the decision explicitly in the AWAITING block under a "Screenshots not captured (invasive schema reshape)" subsection citing which migrations created the conflict.

Either option is fine; default to (2) when local Supabase isn't already running, since spinning it up adds Docker + setup overhead that isn't proportional to the sub-phase's risk. (Phase 5.2.3 took option (2) cleanly; see git history.)

### 4.2. Migration push timing (deferred until squash-approval gate)

Rule: `supabase db push --linked` runs only at the squash-approval gate, alongside the final build + visual check + code-reviewer pass. Migrations stay local during implementation. Code can iterate against a local Supabase (`supabase start`) or hand-craft `types.ts` from the migration SQL. Pushing during implementation risks leaving the live DB ahead of `main` (renamed columns/tables) and breaking the shipped frontend if the work halts mid-flight. (Phase 5.2.2, 2026-05-15, halted exactly this way and needed a reconciliation pass to unbreak `hq.mirrornyc.com`; see git history.)

If a sub-phase halts, the live DB stays at last-shipped main and nothing breaks.

Carve-out: `supabase functions deploy <name>` is fine to run during implementation (no Netlify, no schema impact). Edge function deploys can happen out-of-band any time.

### 4.3. Seed data block in every spec

Every new-surface spec includes a `## Seed data for the visual check` section with a SQL block populating realistic test rows. Spec author owns the SQL; Code runs it after the migration pass + before the screenshot step.

The SQL block should:

- Resolve the current admin user (`SELECT id FROM public.users WHERE email = ... AND active = true LIMIT 1`) with a fallback to the oldest active admin.
- Insert realistic rows across every entity in the sub-phase.
- Cover every status enum variant so pill rendering is verifiable.
- Hit every join (organization to projects, project to deliverables, etc.) so embedded relationships resolve.
- Use `ON CONFLICT DO NOTHING` for idempotency so the block is safe to re-run.
- Wrap in a `DO $$ ... END $$` block for transactionality (a failure mid-block rolls back cleanly).

Realistic-data target per surface: enough rows to populate every view variant (list two-tier collapse, board columns, timeline bars, calendar cells), enough status diversity to verify every pill token, enough relationship coverage to confirm joins resolve.

Empty surfaces are not a valid visual check.

### 4.4. Wireframe binding (per-surface line ranges)

When a locked wireframe HTML exists for a sub-phase, the spec includes a `## Wireframe binding` section listing per-surface wireframe line ranges:

| Surface | Wireframe lines | Shipped page file |
| --- | --- | --- |
| 04 Projects List | 938-1053 | `src/pages/projects/ProjectsList.tsx` |
| 05 Projects Board | 1056-1207 | (same file, view variant) |
| ... | ... | ... |

Code adds a JSDoc comment at the top of every surface page component citing the wireframe line range it implements. Example:

```tsx
/**
 * Projects List.
 * Wireframe binding: OUTPUTS/phase-5-hq-wireframe-v1-LOCKED.html lines 938-1053.
 * Build notes: OUTPUTS/phase-5-hq-wireframe-build-notes.md § "04 Projects list".
 */
export default function ProjectsList() { ... }
```

Code-reviewer (cold pass) checks the JSDoc is present + the line range exists in the cited wireframe HTML. If a surface's rendered DOM diverges from its bound wireframe range, it is a MUST FIX.

Adds 30 to 60 minutes of design upfront per surface but eliminates "built inconsistent with Talent Scout, redo" loops AND "doesn't match the wireframe, redo" loops.

### 4.5. Squash autonomy (Code runs the full ship flow after Jimmie's approval)

After Jimmie reviews the AWAITING SQUASH APPROVAL block (screenshots + visual diff summary + carry-forward items) and says "go" or "squash" or "approve" in chat, Code runs the full squash flow autonomously. NOT as a numbered shell-command list for Jimmie to copy-paste.

The ship flow:

1. From the worktree directory: `supabase db push --linked` (applies the sub-phase's migrations to the live DB).
2. From the worktree directory: `supabase gen types typescript --linked > src/integrations/supabase/types.ts`.
3. Run the spec's `## Seed data for the visual check` SQL block against the live DB.
4. Commit any regenerated `types.ts` to the worktree branch as `[skip netlify] regen types from linked DB`.
5. **Update `CHECKPOINT.md` on the worktree branch BEFORE squash-merging.** Edit the head paragraph + Active-feature-branch + Current-phase lines + shift the predecessor chain. Do NOT reference the upcoming squash commit's hash: see § 4.5.c. Commit on the worktree branch as `[skip netlify] CHECKPOINT.md for Phase X.Y`.
6. From the bare repo: `git checkout main && git pull && git merge --squash <worktree-branch>` and commit with the message body drafted in the AWAITING block. The squash now includes the CHECKPOINT.md update from step 5 in the same commit (one commit per ship, not two).
7. From the bare repo: `git push origin main`. Netlify sees the deploy-worthy commit at HEAD (assuming no `[skip netlify]` for a real deploy, or `[skip netlify]` if the deploy budget is in effect: either way only one push fires).
8. Worktree cleanup: `git worktree remove .claude/worktrees/<branch> && git branch -D claude/<branch>`.
9. Overwrite `OUTPUTS/COWORK_SYNC.md` with the latest ship state. Single write per phase. See `feedback_cowork_sync`.

Jimmie's role at the gate: review screenshots, give a one-word go (or send specific iteration feedback if anything reads off). Code does everything else.

When Code drafts the AWAITING SQUASH APPROVAL block, frame the squash-flow section as Code's own checklist of what it will execute after approval. Not as instructions for Jimmie. The framing matters: "Squash + push flow (Code executes after approval)" not "Run from the BARE REPO root."

### 4.5.a. Why step 7 runs autonomously (Bash permission rule)

The auto-mode classifier enforces at the Bash-tool layer; it doesn't read AskUserQuestion answers or chat approvals as policy overrides. So a narrowly-scoped permission rule pre-added to `.claude/settings.json` lets the classifier permit the autonomous push. (Phase 5.2.3 confirmed the block empirically; a codified manual hand-off then bit us with unsent local-only commits and a doubled Netlify deploy, so the allowlist rule replaced it. See git history.)

- The allowlist rule is exact-match only: `Bash(git push origin main)`. Not `git push --force`, not pushes to feature branches, not pushes to `master`, not push with options. Other push patterns still hit the classifier.
- `.claude/hooks/block_dangerous.sh` already explicitly allows `git push origin main` (it's the merge-event push; CLAUDE.md item 8 documents this is the sanctioned Netlify-deploy moment). The hook layer was never the block.
- The real gate is the chat approval at the AWAITING block. Code only reaches the push step after Jimmie says "go" / "squash" / "approve"; the orchestration discipline above the Bash layer is the actual safety check.

If `.claude/settings.json` is ever reset / cloned fresh, the `Bash(git push origin main)` rule must be re-added before any autonomous ship flow runs. Without it, the push will be blocked at the classifier and Code falls back to surfacing a manual hand-off to Jimmie.

Migration push specifically: `supabase db push --linked` reads the CWD's `supabase/migrations/` folder. Since the new migration files only exist on the worktree branch, the push MUST run from inside the worktree directory (`.claude/worktrees/<branch>/`). Running from the bare repo when main lacks the new migration files is a silent no-op and breaks the seed run downstream. The git operations (steps 5 through 7) still need the bare repo (you can't `git merge --squash` from inside a worktree of the branch you're trying to merge), but everything in steps 1-4 happens in the worktree.

### 4.5.b. Historical: why the ship flow used two pushes (Phase 5.3 → 5.7.3)

Superseded 2026-05-17 by the single-commit convention in § 4.5.c. See git history for the old two-push convention, the 50+ backfill-commit rewrite, and recovery refs.

### 4.5.c. Single-commit ship convention (current)

Each ship is exactly one commit on `main`: the squash itself, with CHECKPOINT.md updates folded in. No separate backfill commit. No "Backfill X into CHECKPOINT.md" follow-on cluttering the log.

**Why a single commit works.** The old two-commit pattern existed to give the CHECKPOINT.md update its own `[skip netlify]` trigger semantics (per § 4.5.b). With one combined commit, the commit's own `[skip netlify]` flag (or absence) drives Netlify's decision directly. No second commit needed.

**Chicken-and-egg on the squash hash.** The old "Backfilled at `<hash>`" pattern referenced the squash commit's own hash, which can't be computed before the commit is made. The new convention drops the explicit self-reference from CHECKPOINT.md's head paragraph: the head paragraph describes WHAT shipped (phase name, summary, file count, migrations), not the commit identity. Anyone wanting the hash runs `git log --oneline | head -1`. Predecessor paragraphs in CHECKPOINT.md continue to cite explicit hashes because those squashes are already historical (their hashes were knowable when they were demoted from head to predecessor).

**Operational impact.** Step 5 (CHECKPOINT.md update) moves to the WORKTREE branch BEFORE the squash-merge. The merge-squash folds CHECKPOINT.md changes into the same commit as everything else. Step 7 (single `git push`) replaces the old 5b + 5d two-push dance.

Worktree-side commits (the `[skip netlify] regen types from linked DB` in step 4) still don't affect Netlify because they're on the feature branch, not on main. Squash-merge folds them all into the single ship commit.

### 4.5.d. Post-push housekeeping (atomic; do not consider session complete until all verified)

Amendment 2026-05-25. Steps 8 + 9 of the § 4.5 ship flow are routinely dropped at the depleted-context end of long ships (verified across 5.12.6 / 5.12.7 / 5.12.9 / 5.12.12 ships). Treat them as part of the ship itself, not trailing optional work. The slash command `/ship-finalize` (under `.claude/commands/ship-finalize.md`) automates these steps + the verification gate; prefer it over running the steps manually.

**Step 8: Worktree + branch cleanup. SCOPED STRICTLY to this session's own worktree + branch.**

```bash
git worktree remove --force /Users/jimmie/Code/mirror-nyc-hq/.claude/worktrees/<branch>
git branch -D claude/<branch>
```

**Scope rule (locked 2026-05-25 after the 5.12.13.4-pilot incident).** Step 8 only ever touches THIS session's own worktree + branch. Do NOT iterate over `git worktree list` to prune additional worktrees, even if git flags them `prunable`. Other `claude/*` worktrees may belong to concurrent parallel-pilot sessions with uncommitted work that the `prunable` flag cannot detect; the destructive `--force` flag bypasses git's "contains modified or untracked files" check on whatever target it's pointed at. During the 5.12.13.4 parallel pilot, the .4 session's `/ship-finalize` opportunistic-prune step deleted the .3 session's `keen-tharp-1ac9bb` worktree mid-session, destroying .3's committed-but-unpushed work; .3 had to re-author from scratch. The rule is non-negotiable during ANY parallel-pilot window. Stale-worktree cleanup is a separate manual operation the user runs when no `claude/*` branches are active.

**Step 9: Overwrite `OUTPUTS/COWORK_SYNC.md`** with the latest ship state. Single write per phase. Canonical structure: squash SHA + Netlify deploy state + migrations applied + edge functions touched + decisions confirmed + carry-forwards + next phase pointer. See `feedback_cowork_sync`.

**Verification gate (mandatory; session is NOT complete until clean):**

1. `git log --oneline -3`. Top line should be the just-shipped commit (or its SHA-backfill follow-on). If you see the predecessor's hash at top, push didn't fire; re-run `git push origin main`.
2. `head -10 OUTPUTS/COWORK_SYNC.md`. Marker commit shows the new ship's squash SHA, not the previous ship's. If you see the previous Marker commit, step 9 didn't write; re-run it.
3. `git worktree list`. The just-shipped feature worktree no longer appears. If still listed, re-run step 8's `git worktree remove --force`.

If any verification fails, re-run the corresponding step and re-verify. The session is not done until all three show clean. The `/ship-finalize` command runs all three verifications + reports a PASS/FAIL summary; use it.

### 4.6 Smoke-ready handoff (parallelize doc updates with Jimmie's smoke window)

Amendment 2026-05-25. The doc-update phase (CHECKPOINT.md / decisions.md / v1-changelog.md / roadmap.md / design-system.md / code-observations.md / REPO_DOC_UPDATES.md / OUTPUTS/COWORK_SYNC.md prep) routinely takes 5-15 minutes per ship. Pre-2026-05-25 Jimmie waited that window idle, then started smoke-testing after Code posted the AWAITING block. Producer call (Jimmie 2026-05-25): parallelize.

**New step, between the verification gate (typecheck / build / test all clean) and the start of the doc-update phase:**

If the ship touches any frontend code (any edit under `src/` other than pure shared-module consumers like `src/integrations/supabase/types.ts`), Code spins up `npm run dev` as a non-blocking background process before starting the doc-update phase. Surface a single-line ready message to Jimmie:

> Smoke ready at http://127.0.0.1:8080/. Beginning doc updates in parallel.

Then proceed with the doc-update phase without blocking. Jimmie smoke-tests while Code writes the doc updates. If Jimmie surfaces a smoke issue mid-doc-update, Code pauses doc writes, addresses the fix forward, then resumes doc updates.

For edge-function-only / migration-only / prompt-tuning ships with no frontend diff (5.12.10 prompt-edit-only ships, 5.12.13.X SYSTEM-prompt ships, vs-* edge-function-only ships), skip the dev server: no smoke surface to use it.

**Lifecycle.** The dev server stays running through the doc-update phase, the AWAITING block draft, Jimmie's approval window, and the squash flow (§ 4.5 steps 1-9). `/ship-finalize` does NOT kill the dev server (Jimmie may still want it for follow-on inspection); Code kills it explicitly as the last housekeeping step OR Jimmie kills it manually with Ctrl-C.

**Why this works.** The dev server hot-reloads any source change. Code's doc-update edits don't touch `src/`, so the server's view stays stable while Jimmie smokes. If a smoke issue surfaces and Code edits source to fix it, the dev server reloads and Jimmie sees the fix without re-launching.

**Why this doesn't break anything.** The dev server is local-only (`http://127.0.0.1:8080/`); no Netlify deploy implication. The doc-update phase doesn't depend on the dev server being up or down. The AWAITING block can post whether or not Jimmie has finished smoking; the dev server URL just gives Jimmie the option to smoke earlier.

**Concrete prompt template for Code's smoke-ready message:**

```
Verification clean (typecheck + build + test). Spinning up `npm run dev`...

Smoke ready at http://127.0.0.1:8080/. Beginning doc updates in parallel.

Doc updates will land on the worktree branch over the next ~5-15 minutes. Smoke at your pace; I'll surface the AWAITING SQUASH APPROVAL block when docs are done. If you hit a smoke issue, just flag it in chat and I'll fix forward before continuing docs.
```

The numbering convention stays § 4.5.X for the ship-flow sub-rules; 4.6 is the smoke-ready handoff because it sits BETWEEN verification and the § 4.5 ship-flow steps (which run post-approval).

---

## 5. Code observations (passive logging)

After completing each task, Code logs noteworthy unresolved follow-up findings it encountered into `code-observations.md` at repo root. Persistent across sessions. Triaged on calm afternoons. Issues fixed in the same task, resolved hotfixes, and narrative summaries of completed work belong in the relevant repo docs, CHECKPOINT, changelog, or commit message instead.

Workflow detail lives in `CLAUDE.md` § Code observations and the header of `code-observations.md`. Short version:

- Append-only table per area (Frontend, Edge Functions, Database, Build & Tooling, Docs, Other), but only for findings that remain open at the end of the task.
- Each row carries date, file, introducing commit hash (from `git blame`), severity tag, verify/resolve glyphs, and a one-sentence note.
- In end-of-turn responses, Code mentions findings only if directly relevant to the current task; otherwise says "N new observations logged."

Don't derail the active task to fix what Code flags. Log it, keep moving. The verify step catches false positives later.

---

## 6. Code-side setup

The HQ repo already has a strong `CLAUDE.md` and docs structure. The configuration below is what Code reads at session start.

### Subagents, skills, slash commands

Canonical source for each is the file's own frontmatter/body; this list intentionally stays a pointer so it can't drift:

- **Subagents** in `.claude/agents/` (`*.md`, runnable via `/agent <name>`): `code-reviewer`, `security-auditor`, `design-spec-builder`, `migration-reviewer`.
- **Skills** in `.agents/skills/<name>/SKILL.md` (tracked in git with YAML frontmatter; the `.claude/skills/` dir is gitignored): `add-edge-function`, `add-migration`, `ship-phase`, `new-hq-surface`, `triage-observations`.
- **Slash commands** in `.claude/commands/`: `/ship`, `/ship-finalize` (post-push housekeeping + verification gate per § 4.5.d), `/diagnose`, `/spec`, `/sync-prompts`, `/triage-observations`.

Read the relevant file's frontmatter for the current trigger/behavior of any one of these.

### Subdirectory CLAUDE.md files

Loaded on-demand when working in that directory:

- **`src/components/talent-scout/CLAUDE.md`**. UI conventions (hooks above early return, bg-input on tracks, mailto styling, ReferralPill color history, StatusDropdown sizing).
- **`supabase/functions/CLAUDE.md`**. Edge function conventions (self-invoke pattern, callClaude wrapper, sendEmail vs packetRender, types regen flow).
- **`supabase/migrations/CLAUDE.md`**. Migration conventions (timestamptz, GRANTs, Realtime publication, updated_at trigger, Vault for GUCs).

### Hooks (`.claude/settings.json`)

PostToolUse runs `npx tsc --noEmit` after any `.ts` or `.tsx` write. PreToolUse runs `block_dangerous.sh` to block force-push to main, accidental rm -rf, supabase db reset, and direct secrets writes that aren't paired with a Vault update.

The hooks document intent and run regardless of model judgment. The sandbox catches most of this independently.

---

## 7. Slash command muscle memory

The high-leverage shortcuts inside any active session:

| Command | When | Why |
| --- | --- | --- |
| `/compact` | Hit ~50% context | Manual compact before the auto. Controls what survives. |
| `/cost` | Periodically | Fuel gauge. Know when to compact. |
| `/model` | Architecture vs execution | Opus for spec, review, hard refactors. Sonnet (default) for execution. Haiku for quick lookups. |
| `/clear` | Session goes off rails | Soft reset, preserves project context. |
| `!<cmd>` | Need shell output | Direct shell run inline, no copy-paste. |
| `/loop <interval> <prompt>` | Background poll | "Check the Netlify build every 5 min." Useful during phase squash-merges. |

---

## 8. Phase-specific recommendations

The Phase 5 HQ Core surfaces shipped through 5.16. For what each phase delivered and its locked decisions, see `docs/v1-changelog.md` and the finished-phase summaries in `docs/roadmap.md`. The durable lesson stands: every greenfield surface gets a Cowork-drafted spec before any code, or batches drift from each other and from Talent Scout's patterns and the cleanup pass is expensive.

---

## 9. Anti-patterns to avoid (lessons from Phases 3 and 4)

**1. Mid-phase scope creep.** If a "while we're here" idea comes up mid-phase, capture it in `CHECKPOINT.md` § Next-up for a future phase. Resist absorbing it into the active branch unless the branch is fresh. (Phase 3.7 absorbed referral ingestion late and grew into 18 sub-phases; see git history.)

**2. Documentation drift on shared modules.** `src/lib/talent-scout/defaultEvalPrompt.ts` mirrors `supabase/functions/_shared/prompts.ts`; it drifted twice, each drift causing real eval differences. *Fix:* the `/sync-prompts` slash command.

**3. Long-running session context decay.** After 3+ /compact cycles, decisions from early in the session get fuzzy. *Fix:* end a session at phase boundaries, start the next fresh with the kickoff template, and capture decisions to `docs/decisions.md` live during the phase, not retroactively.

**4. Edge function deploy lag.** Code commits need `supabase functions deploy <name>` to take effect. *Fix:* the `add-edge-function` skill includes the deploy step; the `ship-phase` skill lists which functions need re-deploy at squash-merge time. Use them.

**5. Em dashes leaking back in.** The rule is in `CLAUDE.md` and `ABOUT ME/anti-ai-writing-style.md`; voice still slips. *Fix:* catch new ones via the `grep -nP "[\x{2014}\x{2013}]"` check before any commit that adds docs.

**6. Port-phase fidelity drift.** For port phases, hold port-fidelity tightly. Allowed divergences: HQ design tokens, port-plan-locked backend changes. Anything else is a bug, not a feature. Memory rule `feedback_port_fidelity`. (The first Phase 4.1 through 4.6 attempt drifted from the Lovable source and was recovered via a fresh 1:1 `vs-port-fresh` branch; see git history.)

**7. Tool-output collapse on AI surfaces.** When an LLM call returns empty payloads (forced `tool_choice` plus per-item gating + schema mismatch), don't edit system prompts to fix it. Move the lever to schema descriptions + post-emission sanitization. Memory rule `feedback_tool_choice_collapse`.

**8. CHECKPOINT.md staleness.** *Fix:* the COWORK_SYNC convention codified in § 2 above. CHECKPOINT.md gets updated in the same commit as any sub-phase completion. Don't defer.

---

## 10. Templates available

Pre-built session-prompt scaffolds in the Cowork workspace at `/Users/jimmie/Claude/Mirror NYC HQ/TEMPLATES/`:

- **`new-phase-kickoff.md`**. Paste at the start of a new phase Code session.
- **`new-edge-function.md`**. For spinning up a new edge function.
- **`new-hq-surface.md`**. For a new page/route.
- **`phase-end-doc-sweep.md`**. For end-of-phase documentation pass.

Each template is short and links into the appropriate skill or subagent.

---

## 11. The mindset shift

The leverage isn't in better prompts. It's in better system design.

For HQ at the project level: `CLAUDE.md`, layered docs, deploy policy, two-session discipline, code-observations log, CHECKPOINT.md as living state. For HQ at the session level: subagents, skills, hooks, slash commands, kickoff templates.

The question before any new feature: "What automation can I set up once that makes every future occurrence of this pattern smoother?"

Phase 4 was a known shape (port). Phase 5 is the real test. The infrastructure above is what makes Phase 5 ship cleanly instead of grinding for weeks.

---

## 12. Resources

- `code.claude.com/docs/en/best-practices`. Anthropic's official guide.
- `github.com/hesreallyhim/awesome-claude-code`. Curated subagents, hooks, skills, MCP servers.
- `github.com/VoltAgent/awesome-claude-code-subagents`. 100+ pre-built subagent definitions.
- `humanlayer.dev/blog/writing-a-good-claude-md`. CLAUDE.md instruction-budget analysis.

---

*Living playbook. Update when patterns we discover deserve to be encoded. Trim opportunistically.*
