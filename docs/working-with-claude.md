# Working with Claude on Mirror NYC HQ

Living playbook for setting up Code + Cowork sessions to ship HQ work cleanly. Tailored to Jimmie's role (Senior Producer, not a developer) and the patterns built up through Phases 1 to 4.

Phase 4 (Venue Scout port) shipped to production 2026-05-13. Phase 5 (HQ Core) is the next major build. All UX/UI design happens directly in Claude (Cowork for wireframing + design specs, Code for implementation). Lovable is no longer in the toolchain. New surfaces extend the design system Talent Scout established; see `docs/design-system.md`.

---

## 1. Two surfaces, two jobs

| Surface | Job | When to reach for it |
| --- | --- | --- |
| **Cowork** (Claude desktop app) | Planning, prompt-drafting, exploration, "what should we build," wireframes. | Before opening a Code session, drafting specs, refining requirements, recapping a phase. |
| **Code** (Claude desktop app) | Execution, implementation, anything that touches files, DB, or edge functions. | Once the spec is clear and you want the work done. |

**How to open Code:** launch the Claude desktop app, switch to Code mode, open the `mirror-nyc-hq` folder directly in the app. Jimmie does not use the CLI. Never instruct `cd` + `claude` in a terminal.

**The mistake to avoid:** using Code for ideation. Code burns context fast and loses architectural decisions in the noise of file edits. Use Cowork to think; arrive in Code with a tight prompt.

**The cleanest sequence for any new feature:**

1. **Cowork session:** brainstorm + interview-style spec.
2. **Cowork outputs a markdown spec** to `OUTPUTS/phase-X-Y-<surface>-spec.md`.
3. **Code session:** paste the spec, ask Code to validate or critique it first, then implement.
4. **After each sub-phase:** Code writes `OUTPUTS/COWORK_SYNC.md`. Cowork reads it at the start of the next session and updates docs as needed.
5. **End-of-feature:** doc sweep in Code (roadmap, edge-functions.md, decisions, etc.), then squash-merge.

---

## 2. Two-session discipline

This project runs two parallel Claude sessions. Both sessions can edit files. Without discipline, they clobber each other.

### The rule

**Cowork is read-only on `/Users/jimmie/Code/mirror-nyc-hq` while any `claude/*` feature branch is active.** During active feature work:

- Cowork doc-update intent goes into `OUTPUTS/REPO_DOC_UPDATES.md` (Cowork workspace, not the repo). Code consumes it on its branch.
- Spec drafts go into `OUTPUTS/phase-X-Y-<surface>-spec.md` (Cowork workspace).
- The `OUTPUTS/COWORK_SYNC.md` channel remains Code to Cowork. Code overwrites it after each sub-phase wrap-up.

Cowork commits to repo `main` are allowed only when there are no active feature branches AND no uncommitted WIP on `main`. Same `[skip netlify]` pattern. Verify with the pre-flight check below.

### Pre-flight check (start of every session, both Cowork and Code)

```bash
cd /Users/jimmie/Code/mirror-nyc-hq && \
  echo "=== branch ===" && git branch --show-current && \
  echo "=== status ===" && git status --short && \
  echo "=== worktrees ===" && git worktree list && \
  echo "=== unmerged claude branches ===" && (git branch | grep '^  claude/' || echo "(none)") && \
  echo "=== sync-doc drift check ===" && \
  ACTUAL=$(git log -1 origin/main --format=%H) && \
  CLAIMED=$(grep -oP 'SHIPPED at[ \x60]+\K[a-f0-9]{7,40}' /Users/jimmie/Claude/Mirror\ NYC\ HQ/OUTPUTS/COWORK_SYNC.md 2>/dev/null || echo "(no SHIPPED hash)") && \
  echo "  origin/main: $ACTUAL" && \
  echo "  sync doc:    $CLAIMED" && \
  ( [ "${ACTUAL:0:7}" = "${CLAIMED:0:7}" ] || echo "  >>> DRIFT: sync doc and origin/main disagree" )
```

Decision tree on the drift line:

- **No drift (hashes match):** sync doc is fresh. Trust it.
- **Sync doc says SHIPPED but hash mismatches origin/main:** sync wasn't refreshed after a subsequent commit landed. Re-read git log to find the actual latest state before any further work.
- **Sync doc says AWAITING SQUASH APPROVAL:** the previous phase stopped at the approval gate. Cowork should NOT start new work; surface to Jimmie what's pending and offer to advance.
- **No SHIPPED hash anywhere in the sync doc:** sync doc may be stale or the phase isn't complete. Investigate.

Decision tree on the output:

- **Active worktree on `claude/*` AND uncommitted changes on `main`:** Cowork goes read-only. Surface the WIP files to Jimmie. Don't edit, don't stash.
- **Active worktree, main clean:** Cowork goes read-only. Code is the writer.
- **No active worktree, main has uncommitted changes:** previous session left WIP. Surface to Jimmie before any new work.
- **No active worktree, main clean:** business as usual.

### Pre-squash check (Code, before any `git checkout main && git merge --squash`)

Hard gate. Run `git status --short` on `main` first. If output is non-empty, **stop**. Do not auto-stash. Do not auto-commit. Surface every modified or deleted file to Jimmie with the diff and let him decide.

The Phase 4.3.1 main-checkout conflict was caught by exactly this check. Keep it.

### Worktree hygiene

After a sub-phase squash-merges, Code removes the worktree:

```bash
git worktree remove .claude/worktrees/<name>
git branch -D claude/<name>
```

Stale worktrees make `git status` and `git branch -a` noisy. Clean up before declaring the sub-phase done.

### COWORK_SYNC.md write convention (two-write per phase)

`OUTPUTS/COWORK_SYNC.md` is the Code to Cowork status channel. To avoid stale-sync confusion, Code writes the doc twice per phase with an explicit status marker.

**Write 1: at the squash-approval gate.** When Code has implemented + reviewed + committed locally and is stopping for Jimmie's squash decision, it writes a short sync block:

```markdown
**Status:** AWAITING SQUASH APPROVAL
**Feature branch:** claude/<name>
**Feature commit:** <hash>
**Migration applied:** yes/no
**Edge function deployed:** yes/no
**Build:** tsc + vite clean
```

Plus a "What landed" summary and the squash + push instructions Jimmie will run.

**Write 2: after squash + push + backfill + cleanup.** Code OVERWRITES the doc once the full flow completes:

```markdown
**Status:** SHIPPED at <main-hash>
**Squashed at:** <squash-hash>
**Backfilled at:** <backfill-hash>
**Pushed to origin:** yes
**Netlify deploy:** triggered (or skipped if [skip netlify])
**Worktree:** cleaned up
**Feature branch:** deleted
```

Plus the full "What landed" summary, code-reviewer recap, decisions confirmed, and carried-forward items. This is the version Cowork syncs from.

**Why two writes:** if Jimmie session-outs before approving, Cowork next session reads the AWAITING block and knows the actual state without grepping git logs. If Jimmie approves and the full flow completes, Cowork reads SHIPPED and trusts the doc fully.

**Don't conflate writes.** The AWAITING block is short and explicitly preliminary. The SHIPPED block is comprehensive and the source of truth. Don't try to make the AWAITING block do double duty.

---

## 3. Cowork as the sync enforcer

Every time a Code sub-phase summary lands in Cowork (via `OUTPUTS/COWORK_SYNC.md` or manual paste), Cowork's first action is a doc sync pass:

1. Update `CHECKPOINT.md`. Branch commit hash, current sub-phase, what's done vs. next.
2. Update `docs/decisions.md`. Any architectural decisions, conflict resolutions, or rationale captured in the Code output that isn't already in the doc.
3. Flag if anything in the Code output contradicts existing docs (`docs/schema.md`, `docs/edge-functions.md`, `docs/auth-model.md`) so it can be corrected before the next session starts.

This makes Cowork the enforcing sync layer rather than relying on Code to defer to end-of-phase sweeps.

### The COWORK_SYNC.md auto-bridge

Code writes a structured summary to `OUTPUTS/COWORK_SYNC.md` after each sub-phase completion. Cowork reads it at session start instead of copying the terminal wall of text. Activate via the Code kickoff prompt:

```
After each sub-phase commit, write a structured summary to /Users/jimmie/Claude/Mirror NYC HQ/OUTPUTS/COWORK_SYNC.md with:
- Sub-phase number and commit hash
- What landed (files created/modified, migrations applied, functions deployed)
- Decisions made or confirmed
- Open items / flags for Jimmie
- Next sub-phase
Overwrite the file each time (Cowork reads the latest, not a log).
```

### Phase-boundary check (roadmap.md)

At every phase boundary (the squash-merge of the last sub-phase of a phase), Cowork verifies `docs/roadmap.md` reflects the new state:

1. **Finishing phase summarizes to one line.** Per `docs/conventions.md`, completed phases collapse to a single-line `DONE` summary with shipped date and main HEAD hash. Phase 4 example: `Phase 4: Venue Scout port. DONE. Shipped to production 2026-05-13 (main at \`7cd27ed\`). Full 1:1 port from \`mirror-nyc-venue-scout-pro\`; 4.1-port through 4.10.6-port. Details in \`docs/venue-scout-port-plan.md\` and \`CHECKPOINT.md\`.`
2. **Next phase expands to full active-phase detail.** Sub-phase candidates, ordering notes, dependencies between sub-phases.
3. **Open questions section reconciled.** Anything answered by the finished phase moves to `docs/decisions.md` or is struck. Anything still open and forward-looking moves to the next phase's section.

Two-session discipline applies. If a `claude/*` feature branch is still open at the moment of the check (rare; usually the last sub-phase is squashed before the phase formally closes), the roadmap edit queues in `OUTPUTS/REPO_DOC_UPDATES.md` instead of landing directly on `main`.

The `TEMPLATES/phase-end-doc-sweep.md` template carries the full end-of-phase sweep list; the roadmap check is the Cowork-side enforcement of step 1 of that template.

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
     SQUASH APPROVAL block in OUTPUTS/COWORK_SYNC.md. See § 4.1 below.

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

### 4.2. Migration push timing (deferred until squash-approval gate)

Old habit: `supabase db push --linked` ran during Code's implementation pass so types could regenerate against the live DB. Problem: if the work halts mid-flight (cancelled prompt, scope reset, branch deletion), the live DB is ahead of `main` and the shipped frontend breaks against the renamed columns and tables. The 2026-05-15 Phase 5.2.2 attempt halted exactly this way and required a Step-0 reconciliation pass to unbreak `hq.mirrornyc.com`.

Rule: `supabase db push --linked` runs only at the squash-approval gate, alongside the final build + visual check + code-reviewer pass. Migrations stay local during implementation. Code can iterate against a local Supabase (`supabase start`) or hand-craft `types.ts` from the migration SQL.

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

---

## 5. Code observations (passive logging)

After completing each task, Code logs noteworthy findings it encountered into `code-observations.md` at repo root. Persistent across sessions. Triaged on calm afternoons.

Workflow detail lives in `CLAUDE.md` § Code observations and the header of `code-observations.md`. Short version:

- Append-only table per area (Frontend, Edge Functions, Database, Build & Tooling, Docs, Other).
- Each row carries date, file, introducing commit hash (from `git blame`), severity tag, verify/resolve glyphs, and a one-sentence note.
- In end-of-turn responses, Code mentions findings only if directly relevant to the current task; otherwise says "N new observations logged."

Don't derail the active task to fix what Code flags. Log it, keep moving. The verify step catches false positives later.

---

## 6. Code-side setup (state of the playbook as of Phase 5)

The HQ repo already has a strong `CLAUDE.md` and docs structure. The configuration below is what Code reads at session start.

### Subagents in `.claude/agents/`

Each `*.md` file defines a named subagent runnable via `/agent <name>`. Currently defined:

- **`code-reviewer.md`**. Two-Claude review pattern. Run after any substantive feature implementation, before squash-merge. Verifies design-system adherence + brand-rules-that-bit-us list.
- **`security-auditor.md`**. Runs on any new edge function before deploy. Wired into the `add-edge-function` skill at step 7.
- **`design-spec-builder.md`**. Cowork-or-Code, drafts a new HQ surface spec before any implementation. Reads design-system.md and finds the closest Talent Scout analog. Save output to `OUTPUTS/phase-X-Y-<surface>-spec.md`.
- **`migration-reviewer.md`**. Runs before any `supabase db push --linked`. Catches reversibility, RLS, GRANT, and cascade issues.

### Skills in `.agents/skills/<name>/SKILL.md`

Repo convention: canonical skill content lives in `.agents/skills/<name>/SKILL.md` (tracked in git, with YAML frontmatter). The `.claude/skills/` directory is gitignored.

Each `SKILL.md` starts with frontmatter:

```yaml
---
name: skill-name
description: "Use when <trigger>. Triggers: <comma-separated keywords>."
metadata:
  author: hq
  version: "1.0.0"
---
```

Currently shipped:

- **`add-edge-function`**. Verify_jwt + config.toml + callClaude + sendEmail conventions. Step 7 invokes `security-auditor`.
- **`add-migration`**. Migration file naming, types regen, schema.md update, re-eval flag.
- **`ship-phase`**. The squash-merge dance (pre-merge checklist + squash + post-merge backfill).
- **`new-hq-surface`**. Phase-5 specific. Pattern for a new page that has no existing template.
- **`triage-observations`**. Turns the `code-observations.md` log into a summary, a prioritized fix plan with recommended phase/order, and a ready-to-paste Code prompt. Does not implement fixes.

### Custom slash commands in `.claude/commands/`

- **`/ship`**. Pre-merge checklist + report.
- **`/diagnose`**. Cron + edge fn health + migrations drift check.
- **`/spec <surface>`**. Boot the design-spec-builder subagent. Save output to `OUTPUTS/phase-X-Y-<surface>-spec.md`.
- **`/sync-prompts`**. Verify `src/lib/talent-scout/defaultEvalPrompt.ts` matches `supabase/functions/_shared/prompts.ts` DEFAULT_EVAL_PROMPT byte-for-byte.
- **`/triage-observations`**. Run the `triage-observations` skill against `code-observations.md`: summary, prioritized fix plan, ready-to-paste Code prompt.

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

## 8. Phase 5 specific recommendations

Phase 5 is six cross-cutting surfaces with no reference repo to port from. This is the test of the spec-driven workflow.

### The six surfaces

1. **Notifications dispatch.** Foundation. Folds in `ts-send-pull-notification` and the future bell. Provides the event pipeline before Dashboard tiles or in-app bell can wire to it.
2. **Dashboard tile grid.** Main landing for authenticated users. Each tile links to a destination. Needs Projects to exist before it lands.
3. **Real `/projects` page.** Highest-traffic HQ Core surface. Replaces the current stub.
4. **`/venues`, `/clients`, `/tasks` pages.** Parallelizable once Projects pattern is set.
5. **Activity log feed.** Cross-cutting. Hooks into project, venue, role, scout, and task triggers.
6. **Admin pages.** User role management. Global settings UI for fields currently SQL-only.

### Order matters

Dashboard depends on Projects (the tile is hollow without a destination). Notifications can ship in parallel since it's edge-function-plus-table groundwork; the bell wires after Dashboard. Activity log lands after enough event triggers exist to populate it.

### Per-surface discipline

Each surface gets a Cowork-drafted spec before any code. Six surfaces will drift from each other (and from Talent Scout's patterns) without the spec discipline. The cleanup pass after a drifted batch is expensive.

### Phase 4 context

Phase 4 shipped as a 1:1 port from `mirror-nyc-venue-scout-pro`. Reference: `docs/venue-scout-port-plan.md`. The functional scope of Venue Scout was inherited; HQ design tokens were applied. Phase 5 doesn't have that crutch: every surface is greenfield against the design system Talent Scout established.

---

## 9. Anti-patterns to avoid (lessons from Phases 3 and 4)

**1. Mid-phase scope creep.** Phase 3.7 was supposed to be candidates UX; it absorbed referral ingestion late and grew into 18 sub-phases. Phase 3.8 absorbed real-cap-alert email mid-stream.

*Fix:* if a "while we're here" idea comes up mid-phase, capture it in `CHECKPOINT.md` § Next-up for a future phase. Resist absorbing it into the active branch unless the branch is fresh.

**2. Documentation drift on shared modules.** `src/lib/talent-scout/defaultEvalPrompt.ts` mirrors `supabase/functions/_shared/prompts.ts`. Drifted twice. Each drift caused real eval differences.

*Fix:* the `/sync-prompts` slash command.

**3. Long-running session context decay.** After 3+ /compact cycles, decisions from early in the session get fuzzy. Phase 3.8's 60-min stall threshold was wrong mid-session because the per-candidate heartbeat detail got lost.

*Fix:* end a session at phase boundaries. Start the next phase fresh, with the kickoff template. Capture decisions to `docs/decisions.md` live during the phase, not retroactively.

**4. Edge function deploy lag.** Repeatedly during Phase 3.X, code commits needed `supabase functions deploy <name>` to take effect, and the deploy lagged the commit by hours.

*Fix:* the `add-edge-function` skill includes the deploy step. The `ship-phase` skill explicitly lists which functions need re-deploy at squash-merge time. Use them.

**5. Em dashes leaking back in.** Multiple times. The rule is in `CLAUDE.md` and `ABOUT ME/anti-ai-writing-style.md`. Voice still slips.

*Fix:* the doc-audit sweep (2026-05-13) cleared the existing population. Catch new ones via the `grep -nP "[\x{2014}\x{2013}]"` check before any commit that adds docs.

**6. Phase 4 failed-attempt branch.** The first Phase 4.1 through 4.6 attempt on `main` drifted enough from the Lovable source repo that producer testing exposed a stack of small UX regressions and rework cost grew nonlinearly. Recovery: hard-reset main to a fresh `vs-port-fresh` 1:1 port branch via `--force-with-lease` push.

*Fix:* for port phases, hold port-fidelity tightly. Allowed divergences: HQ design tokens, port-plan-locked backend changes. Anything else is a bug, not a feature. Memory rule `feedback_port_fidelity`.

**7. Tool-output collapse on AI surfaces.** Multiple sessions burned re-tuning system prompts when an LLM call returned empty payloads. Root cause: forced `tool_choice` plus per-item gating + schema mismatch.

*Fix:* don't edit system prompts to fix it. Move the lever to schema descriptions + post-emission sanitization. Memory rule `feedback_tool_choice_collapse`.

**8. CHECKPOINT.md staleness.** The doc that's supposed to be the living state drifted from reality when post-squash backfill commits got delayed. Bit Cowork at 4.3.2 and 4.3.3 wrap-ups.

*Fix:* the COWORK_SYNC two-write convention codified in § 2 above (AWAITING SQUASH APPROVAL stub at the gate, SHIPPED block after squash + push + cleanup). CHECKPOINT.md gets updated in the same commit as any sub-phase completion. Don't defer.

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

*Living playbook. Update when patterns we discover deserve to be encoded. Keep under 500 lines.*
