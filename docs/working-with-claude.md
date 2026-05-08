# Working with Claude on Mirror NYC HQ

A playbook for setting up Code + Cowork sessions to ship Phase 4 (Venue Scout) and Phase 5 (Cross-cutting) cleanly. Tailored to Jimmie's role (Senior Producer, not a developer) and the way we've built HQ through Phases 1 to 3.11.

**Workflow change as of 2026-05-08:** Lovable is no longer used for UI scaffolding. All UX/UI design now happens directly in Claude (Cowork for wireframing + design specs, Code for implementation). The Talent Scout pattern set is the design system foundation for everything new — see `docs/design-system.md` for canonical layout, component, and behavioral references.

The premise from the articles: most people use Claude as a faster autocomplete. The leverage is in treating it as **programmable infrastructure** you configure once and re-use forever. You've already done a lot of this implicitly (CLAUDE.md, layered docs, deploy policy, CHECKPOINT). This doc closes the gaps and adds the next-tier setup so the upcoming phases run smoother than 3.X did.

---

## 1. Two surfaces, two jobs

You're already running this pattern informally. Make it explicit.

| Surface | Job | When you reach for it |
| --- | --- | --- |
| **Cowork** (Claude desktop) | Planning, prompt-drafting, exploration, "what should we build" | Before opening a Code session, drafting specs, refining requirements, recapping a phase |
| **Code** (this terminal) | Execution, implementation, anything that touches files / DB / edge fns | Once the spec is clear and you want me to do the work |

**The mistake to avoid:** using Code for ideation. Code sessions burn context fast, and it's easy to lose architectural decisions in the noise of file edits. Use Cowork to think; arrive in Code with a tight prompt.

**The cleanest sequence for any new feature:**
1. Cowork session: brainstorm + interview-style spec (use Extended Thinking on Opus 4.6)
2. Cowork outputs a markdown spec → save to `OUTPUTS/` or paste back into a Code-session prompt
3. Code session: paste the spec, ask me to validate/critique it FIRST, then implement
4. End-of-feature: Cowork captures decisions back into `docs/decisions.md`

---

## 2. Cowork folder setup (one-time, ~30 min)

The Cowork article is right that the folder system is the whole game. Set this up once and every session arrives with you-context already loaded.

```
~/Documents/Claude Cowork/
├── ABOUT ME/
│   ├── about-me.md           ← who you are, how you think, how you want output
│   ├── anti-ai-writing-style.md  ← THE no-em-dashes file + other voice rules
│   └── my-company.md         ← Mirror NYC priorities, this quarter's goals
├── OUTPUTS/                  ← where Claude saves drafted specs, plans, decision memos
└── TEMPLATES/                ← reusable session-prompt templates (see §6)
```

### What to put in each ABOUT ME file

**`about-me.md`** — under 2000 words. Have Claude interview you. Sample seed:
> "Interview me to create an about-me.md. Ask 15-20 questions about my role at Mirror NYC, how I think about building products, my technical level (light HTML/CSS, fluent in AI workflow design, comfortable in Lovable, NOT a coder), my tone preferences (casual / direct / no filler / no em dashes), and how I want Claude to push back on me vs. defer."

**`anti-ai-writing-style.md`** — codify the rules already in CLAUDE.md item "How to talk to Jimmie":
- No em dashes anywhere. Use `,` or `(parentheses)` or `:` instead
- No filler affirmations ("Great question!", "Absolutely!")
- Recommend, don't present options. State the tradeoff
- Reference only the latest version of anything we iterated on
- Don't fill gaps; ask if unclear
- Concise by default, deeper when the task warrants it

**`my-company.md`** — 6-8 sharp questions, answered with focus. What's Mirror NYC building this quarter? What does HQ unlock for the team? What are you actively trying to avoid? Update quarterly.

### Global Instructions (Cowork settings → Edit Global Instructions)

```
You're working with Jimmie Baugh, Senior Producer at Mirror NYC.

Folder structure:
- ABOUT ME/ → who he is, voice rules, company priorities. Read every session.
- OUTPUTS/ → save substantive drafts (specs, plans, decision memos) here when work is worth keeping.
- TEMPLATES/ → reusable session-prompt scaffolds for HQ work (Phase port plan, new edge function spec, new HQ surface page spec, etc.). Pull from here when starting a new task that fits a pattern.

Always: read ABOUT ME on session start. Reference anti-ai-writing-style.md when drafting any text Jimmie will paste elsewhere. Update my-company.md if priorities shift mid-conversation.
```

**Why this matters specifically:** every Cowork session starts cold. Without this you're re-explaining tone, role, and project context every time. With it, you open a session and start with "draft a spec for the Notifications system" and it lands in your voice the first try.

---

## 3. Code-side setup (worth doing before Phase 4 starts)

The HQ repo already has a strong CLAUDE.md and docs structure. The gaps below are about layering in subagents, hooks, and slash commands so I operate more autonomously without losing accuracy.

### What you already have (don't change)

- `CLAUDE.md` (project bible, lean, tone rules, deploy policy in item 8)
- `docs/architecture.md` / `auth-model.md` / `schema.md` / `edge-functions.md` / `decisions.md` / `roadmap.md` / `conventions.md` / `cron-jobs.md` / `operations.md`
- `CHECKPOINT.md` (living state)
- `DECISIONS.md` / `NEXT_STEPS.md` / `PROJECT_STATUS.md` / `CONTEXT_FOR_NEXT_CHAT.md` (session-handoff)
- The squash-merge-only-as-deploy-event policy (CLAUDE.md item 8)

### What to add (recommendations, prioritized)

#### 3a. Subagents — one `.md` file per agent inside `.claude/agents/`

Folder is `.claude/agents/`. The `*.md` shorthand below means "create individual `.md` files inside that folder" — `.claude/agents/code-reviewer.md`, `.claude/agents/security-auditor.md`, etc. The glob isn't literal.

Per the playbook: subagents run in isolated context windows, return summaries, and are how you keep the main session clean. Worth defining for HQ:

**`code-reviewer.md`** — the two-Claude review pattern. Especially valuable for Phase 5 since there's no reference repo to validate against.

```markdown
---
name: code-reviewer
description: Reviews recent commits or staged diff cold, with no prior context. Use AFTER any substantive feature implementation, BEFORE squash-merge.
tools: Read, Grep, Glob, Bash
model: claude-opus-4-6
---

You are a staff engineer reviewing this branch with no prior context. The implementer
took shortcuts; you find them.

For each modified file, check:
1. Correctness — does this do what the commit message claims?
2. HQ-specific gotchas:
   - Hooks above any early return (no "Rendered more hooks than during the previous render")
   - useBlocker NOT used (HQ stays on plain BrowserRouter)
   - JSX names imported (tsc + build don't catch all typos; runtime crashes do)
   - bg-input not bg-secondary on slider/score-bar tracks (Mirror grey card surfaces)
   - mailto: uses inline-block max-w-full truncate align-bottom
3. Edge function specifics:
   - verify_jwt setting in config.toml matches usage pattern
   - requireInternalOrUserAuth for self-invoking functions
   - callClaude wrapper used (never raw fetch to api.anthropic.com)
4. Migration safety:
   - timestamptz for time-of-event columns
   - Realtime tables added to publication if UI subscribes
   - Explicit GRANTs in migration
5. Deploy policy:
   - [skip netlify] on every commit unless explicit deploy
   - No dual-pushed origin feature branches

Output: structured report with MUST FIX, SHOULD FIX, CONSIDER. Be direct, no hedging.
```

**`security-auditor.md`** — runs on any new edge function before it ships.

```markdown
---
name: security-auditor
description: Audits a new or modified edge function for auth, secrets, and data exposure issues.
tools: Read, Grep, Glob, Bash
model: claude-opus-4-6
---

You are auditing an HQ edge function. HQ runs on Supabase with admin-gated routes
and shared INTERNAL_API_SECRET for cron paths.

Check:
1. Auth: requireInternalOrUserAuth used? config.toml verify_jwt setting matches
   call pattern? Self-invoke uses internal-secret header?
2. Secrets: no hardcoded keys, no service role exposed in response, no Vault values
   echoed in logs.
3. Data exposure: response payload doesn't leak unintended fields (esp. user PII or
   other-tenant data via misjoined queries).
4. Storage: signed URLs (not public) for any candidate_attachments / packets refs.
5. RLS bypass justification: if function uses service role to bypass RLS, the
   docstring explains WHY and what authorization replaces it.

Output: MUST FIX (security), SHOULD FIX (defense-in-depth), notes.
```

**`design-spec-builder.md`** — Phase 4 + 5 specific. We design in Claude now (no Lovable), and Talent Scout is the design system foundation. Use this in Cowork OR Code mode before any new-surface implementation.

```markdown
---
name: design-spec-builder
description: Drafts a detailed spec for a new HQ surface (page, edge function, or feature) before any implementation. Use when starting any new Phase 4 / 5 work.
tools: Read, Grep, Glob
model: claude-opus-4-6
---

You're drafting a spec for a new HQ surface. The implementer (the main session)
will follow this spec exactly, so under-specifying is worse than over-specifying.

Read first (in this order):
1. docs/design-system.md — the canonical layout / component / behavioral patterns
   for any HQ surface. The new surface MUST extend these, not invent.
2. The §11 "Talent Scout pages as design references" table in design-system.md
   — find the closest analog and start from its structure.
3. The actual reference file(s) in src/pages/talent-scout/ that match the new
   surface type.
4. docs/architecture.md, auth-model.md, schema.md, conventions.md.

Then draft a spec covering:
1. Closest Talent Scout analog (e.g. "this is a list/table page so it inherits
   from RoleDashboard.tsx + CandidateTable.tsx structure"). State explicitly
   what's being lifted vs. adapted vs. invented.
2. Route + auth gate (ProtectedRoute / AdminRoute / ProducerRoute).
3. Data model: which tables read/write, columns, RLS implications.
4. UI layout: section-by-section, mapped to design-system.md primitives. Page
   width (max-w-3xl / 4xl / 7xl), card surfaces (bg-surface-alt), header pattern
   (back-link / h-page / muted description), action bar (sticky bottom for forms,
   inline for non-form pages). Reference specific design-system.md sections.
5. Components used: shadcn/ui primitives first, Talent-Scout-internal primitives
   second (Stepper, TagInput, CriterionCard pattern), only invent NEW components
   if the gap is real and the new component will be reused.
6. State + behavior: dirty tracking, loading states, error handling, empty
   states, confirmation dialogs. Map to design-system.md §9 behavioral patterns.
7. Edge functions invoked (existing or new), their signatures, verify_jwt posture.
8. Migrations needed, with timestamptz / GRANTs / Realtime publication notes.
9. Re-eval / re-pull implications if the change can affect existing candidates.
10. Test plan (manual checklist, since we don't run automated tests).
11. The 5-8 brand rules from design-system.md §12 that specifically apply to
    this surface (e.g. bg-input not bg-secondary on tracks, hooks above early
    returns, JSX names imported).

Output: a markdown spec ready to paste into Code as the implementation prompt.
The implementer should be able to build the surface from this spec without
re-reading every Talent Scout file.
```

**`migration-reviewer.md`** — runs before any `supabase db push --linked`.

```markdown
---
name: migration-reviewer
description: Reviews a pending migration before db push. Catches reversibility, RLS, GRANT, and cascade issues.
tools: Read, Grep, Bash
model: claude-sonnet-4-6
---

Read the pending migration file. Cross-check against docs/schema.md and existing
migrations in supabase/migrations/.

Check:
1. Reversibility: is there a clear rollback path? If destructive (DROP COLUMN /
   DROP TABLE / TRUNCATE), is it justified?
2. RLS: new tables added to RLS-enforce list per docs/auth-model.md? Tier
   correct (member / producer / admin)?
3. GRANTs: explicit GRANT TO authenticated/service_role per the conventions in
   docs/schema.md?
4. Realtime: if frontend will subscribe via postgres_changes, is the table added
   to supabase_realtime publication with REPLICA IDENTITY FULL?
5. Cascade behavior: ON DELETE CASCADE / SET NULL appropriate for FKs?
6. updated_at_auto trigger added if the table has updated_at?
7. Data backfill: if column is NOT NULL with default, will existing rows accept it?

Output: MUST FIX (blocks push), SHOULD FIX (post-push cleanup), CONSIDER.
```

#### 3b. Skills — one `.md` file per skill inside `.claude/skills/`

Skills codify recurring HQ workflows so I don't reinvent them each phase.

**`add-edge-function.md`**:
```
1. Create supabase/functions/<name>/index.ts
2. Decide verify_jwt setting (default true; false ONLY for self-invoking or cron-
   called functions, then add requireInternalOrUserAuth)
3. Add config.toml entry if verify_jwt = false
4. Use callClaude('app', ...) for any Anthropic call (NEVER raw fetch)
5. Use _shared/sendEmail.ts for transactional email (NEVER raw Gmail API)
6. Document in docs/edge-functions.md
7. Deploy: supabase functions deploy <name>
8. If imports _shared/prompts.ts, also re-deploy other consumers
   (ts-pull-candidates, ts-evaluate-candidate, ts-bulk-reevaluate, ts-final-review,
   ts-generate-scorecard, ts-refine-scorecard)
```

**`add-migration.md`**:
```
1. Create supabase/migrations/<YYYYMMDDHHMMSS>_<name>.sql
2. Run migration-reviewer subagent before push
3. supabase db push --linked
4. supabase migration list --linked  (confirm Local = Remote)
5. supabase gen types typescript --linked > /tmp/types.ts && test -s /tmp/types.ts
   && mv /tmp/types.ts src/integrations/supabase/types.ts
6. Update docs/schema.md in the SAME commit as the types regen
7. If CHANGES re-eval-relevant fields (jd / hiring_priorities / scorecard /
   evaluation_prompt), note in commit message that bulk re-eval will be triggered
   on next role save
```

**`ship-phase.md`** — the squash-merge dance.
```
PRE-MERGE CHECKLIST (on feature branch):
  - npx tsc --noEmit clean
  - npm run build clean
  - supabase migration list --linked (Local = Remote)
  - All edge functions deployed at latest shared-module versions
  - Doc sweep: roadmap.md (phase done summary), decisions.md (rationale), schema.md
    (any column changes), edge-functions.md, CHECKPOINT.md (queued for backfill)

SQUASH MERGE:
  - git checkout main && git pull --ff-only
  - git merge --squash <feature-branch>
  - Unstage any session-handoff docs from the squash (PROJECT_STATUS.md /
    NEXT_STEPS.md / DECISIONS.md / CONTEXT_FOR_NEXT_CHAT.md if they're in tree)
  - git commit (NO [skip netlify] — this IS the deploy event)
  - git push origin main → triggers Netlify build

POST-MERGE:
  - Backfill CHECKPOINT.md with new commit hash + push WITH [skip netlify]
  - git branch -D <feature-branch>
  - Deploy any pending edge functions
  - Apply any pending GUC / Vault config in dashboard
```

**`new-hq-surface.md`** — Phase 5 specific. The pattern for a brand-new page that has no existing template.
```
1. Run design-spec-builder subagent to draft the spec (don't skip)
2. Schema + migration first if new tables involved (run migration-reviewer)
3. Edge functions next if new ones needed
4. Frontend last:
   - Route in src/App.tsx (under ProtectedRoute or AdminRoute)
   - Page in src/pages/<area>/<Name>.tsx
   - Components extract to src/components/<area>/ once a piece is reused twice
   - Brand: bg-surface-alt cards, coral primary, font-display for headers
5. Run code-reviewer subagent before commit
6. Hooks above any early return; double-check JSX imports
```

#### 3c. Hooks (`.claude/settings.json`)

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "if echo \"$CLAUDE_TOOL_FILE_PATH\" | grep -qE '\\.(ts|tsx)$'; then cd \"$CLAUDE_PROJECT_DIR\" && npx tsc --noEmit 2>&1 | head -20; fi"
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/block_dangerous.sh"
          }
        ]
      }
    ]
  }
}
```

`.claude/hooks/block_dangerous.sh` — block force-push to main, accidental rm -rf, supabase db reset (would wipe local DB, but worth a confirm), and direct supabase secrets writes that aren't paired with a vault update.

These hooks aren't strictly necessary (the harness sandbox already catches most of this) but they document intent and run regardless of model judgment.

#### 3d. Custom slash commands — one `.md` file per command inside `.claude/commands/`

**`/ship`** — run the pre-merge checklist + report. Equivalent of "before I squash-merge, what's not clean?"

**`/diagnose`** — query cron + edge fn health + recent migrations against remote to surface drift.

**`/spec <surface>`** — boot the design-spec-builder subagent for a named surface, save output to `docs/specs/<surface>.md`.

**`/sync-prompts`** — verify `src/lib/talent-scout/defaultEvalPrompt.ts` matches `supabase/functions/_shared/prompts.ts` DEFAULT_EVAL_PROMPT byte-for-byte. (We've drifted on this twice. Worth a one-liner.)

#### 3e. Subdirectory CLAUDE.md files

Add lean per-area CLAUDE.md files with the gotchas that bit us. Loaded on-demand only when working in that directory. Keeps the root file under instruction budget.

`src/components/talent-scout/CLAUDE.md`:
```
# Talent Scout UI conventions
- Hooks above any early return (Phase 3.5 black-screen lesson)
- Slider track: bg-input (not bg-secondary) on bg-surface-alt cards
- Score bar track: same — bg-input
- mailto: inline-block max-w-full truncate align-bottom (NOT block truncate)
- ReferralPill stays electric blue (coral was tried in 3.7.8.8, reverted in 3.7.8.13)
- StatusDropdown compact = h-9 text-[12px] (not h-8 text-[11px])
- CriterionCard textarea auto-grows via scrollHeight effect
```

`supabase/functions/CLAUDE.md`:
```
# Edge function conventions
- Self-invoking functions: verify_jwt = false in config.toml, requireInternalOrUserAuth in code
- Anthropic: callClaude('talent_scout' | 'venue_scout' | 'hq', ...) — never raw fetch
- Email: _shared/sendEmail.ts (general) or _shared/packetRender.ts sendPacketEmail (packet path)
- Service-account Google: _shared/gmailServiceAccount.ts is the template
- DO NOT pipe `supabase gen types --linked` directly into types.ts — use /tmp + test -s + mv
```

`supabase/migrations/CLAUDE.md`:
```
# Migration conventions
- timestamptz for time-of-event, date for date-only
- Explicit GRANTs to authenticated + service_role (see initial_schema.sql template)
- Realtime tables: add to supabase_realtime publication + REPLICA IDENTITY FULL
- Tables with updated_at: add the updated_at_auto trigger
- Reversibility: prefer additive changes; flag destructive ones in PR description
- ALTER DATABASE / ALTER ROLE on custom GUCs: BLOCKED in Supabase-hosted Postgres.
  Use Vault (vault.create_secret) instead, with a SECURITY DEFINER helper that reads
  vault.decrypted_secrets.
```

---

## 4. Slash command muscle memory (in any active session)

The 14-commands article hits the high-leverage shortcuts. The ones that matter most for our workflow:

| Command | When | Why |
| --- | --- | --- |
| `/compact` | Hit ~50% context | Manually, before the auto-compact. Your control of what survives. |
| `/cost` | Periodically | Fuel gauge. Know when to compact. |
| `/model` | Architecture vs execution | Opus for spec / review / hard refactors; Sonnet (default) for execution; Haiku for quick lookups. Switch mid-session. |
| `/clear` | Session goes off rails | Soft reset, preserves project context. Better than closing the tab. |
| `!<cmd>` | Need shell output in context | Direct shell run inline, no copy-paste. |
| `/btw` | Side question | Ask without losing main thread. We don't use this much yet — worth trying. |
| `/loop <interval> <prompt>` | Background poll | "Check the Netlify build every 5 min." Useful during phase squash-merges. |

---

## 5. Phase 4 + 5 specific recommendations

**Both phases follow the same workflow now.** Lovable is no longer in the toolchain. Cowork wireframes + drafts the spec; Code implements exactly per spec; the design system in `docs/design-system.md` is the canonical reference. The Talent Scout pages are the live design system — you read them as reference for layout, components, and behavior, not to port.

### The standard new-surface workflow (Phase 4 + 5)

```
For each new surface:
  1. Cowork session: 
     a. Run design-spec-builder subagent (or paste the prompt manually).
     b. Subagent reads docs/design-system.md FIRST to find the closest TS analog.
     c. Drafts a spec mapping the new surface to existing patterns. Calls out
        what's being lifted vs. adapted vs. invented.
     d. Save to docs/specs/<surface>.md.
  2. Pause. Review the spec yourself. Edit it before any code is touched.
  3. Code session: paste the spec, "implement exactly per docs/specs/<surface>.md.
     Reference docs/design-system.md and the closest Talent Scout component.
     Ask before deviating."
  4. After implementation: code-reviewer subagent on the diff with cold context.
     Subagent verifies design-system.md adherence + checks the brand-rules-that-
     bit-us list.
  5. Iterate fixes. Squash-merge.
```

Adds 30-60 min of design upfront per surface but eliminates the "we built it inconsistent with Talent Scout, let's redo" loops.

### Phase 4 (Venue Scout)

The Venue Scout Lovable draft exists but is reference for **functional scope only**, not for design. Don't port styling or layout from it. The screen-by-screen spec Jimmie has supplies the functional requirements; design-system.md supplies the look + feel.

Sub-phase pattern (mirrors Talent Scout port plan):
1. **4.1 Inventory + spec** — write `docs/venue-scout-port-plan.md`. List every surface (brief upload, sourcing wizard, candidate venue list, venue detail, deck generation, scout dashboard). Map each to its Talent Scout analog per design-system.md §11.
2. **4.2 Schema + edge function shells** — vs_* tables, vs-* edge functions stubbed.
3. **4.3 Scout dashboard + brief upload** — first surface to ship. Match RoleDashboard.tsx structure.
4. **4.4 Sourcing wizard** — match the new-role wizard pattern (3-step Stepper + wizardStore equivalent).
5. **4.5 Candidate venue list + detail** — match CandidateTable + CandidateDetail.
6. **4.6 Deck generation** — packet path equivalent. Reuse `_shared/packetRender.ts`.

Same deploy policy: feature branch + `[skip netlify]` per commit, squash-merge as the single Netlify-deploy event.

### Phase 5 (Cross-cutting — the hard one)

Six new surfaces, no functional reference at all:
1. **Notifications dispatch** (the foundation; folds in `ts-send-pull-notification`)
2. **Dashboard tile grid** (main landing; needs something to link to from each tile)
3. **Real `/projects` page** (highest-traffic HQ Core surface)
4. **`/venues`, `/clients`, `/tasks` pages** (parallelizable once Projects pattern is set)
5. **Activity log feed** (cross-cutting, hooks into project / venue / task triggers)
6. **Admin pages** (user role management, global settings UI for any setting still managed via SQL)

Each gets a Cowork-drafted spec before any code. The spec-driven workflow above is the discipline — without it, six surfaces will drift from each other AND from Talent Scout's patterns, and the cleanup pass will be expensive.

**Order matters:** Dashboard depends on Projects existing first (the tile is hollow without a destination). Notifications can ship in parallel since it's an edge function + future bell UI; the bell wires up after Dashboard exists.

---

## 6. Templates worth creating in Cowork

Save these to `~/Documents/Claude Cowork/TEMPLATES/`:

**`new-phase-kickoff.md`** — paste this at the start of a new phase Code session:
```
We're starting Phase X.Y. Read the following IN ORDER before doing anything:
1. docs/roadmap.md (full context on this phase)
2. docs/decisions.md (most recent phase first)
3. CHECKPOINT.md (latest commit, drift, deployed state)
4. docs/specs/<this-surface>.md (the spec we drafted in Cowork)
5. docs/working-with-claude.md (this playbook)

Then propose: feature branch name, sub-phase breakdown, the FIRST sub-phase's
implementation plan. Don't start coding until I approve the plan.
```

**`new-edge-function.md`** — for spinning up a new function:
```
New edge function: <name>

Body / behavior: <one paragraph>

Auth posture: <verify_jwt true / false + reason>

Required secrets: <list>

Anthropic call: <yes/no — if yes, which app key>

Reference functions: <which existing function in HQ has the closest pattern>

Run add-edge-function skill, then security-auditor subagent before commit.
```

**`new-hq-surface.md`** — for a new page/route:
```
New HQ surface: <route path>

Auth gate: <ProtectedRoute / AdminRoute / ProducerRoute>

Run design-spec-builder subagent FIRST. Save output to docs/specs/<name>.md.
Pause. I'll review and edit the spec before you implement.

Then run new-hq-surface skill.
```

**`phase-end-doc-sweep.md`** — for end-of-phase documentation pass:
```
We're squash-merging Phase X.Y in the next 24 hours. Run the doc sweep:

1. docs/roadmap.md → mark this phase DONE with one-line summary
2. docs/decisions.md → make sure every meaningful decision in this phase is captured
3. docs/schema.md → reflect any column / table changes
4. docs/edge-functions.md → reflect any new / changed functions
5. docs/conventions.md → if we discovered a new gotcha, add it
6. CHECKPOINT.md → queue for backfill (don't update until post-merge)

Net result: the doc state should let a fresh session pick up the next phase without
asking us anything.
```

---

## 7. Anti-patterns I've seen in our work together (and how to avoid them in 4 + 5)

These are honest. From reviewing how we operated through Phase 3.X.

**1. Mid-phase scope creep.** Phase 3.7 was supposed to be candidates UX; it absorbed referral ingestion late and grew into 18 sub-phases. Phase 3.8 absorbed real-cap-alert email mid-stream.

  *Fix:* if a "while we're here" idea comes up mid-phase, capture it in `NEXT_STEPS.md` for the next phase. Resist absorbing it into the active branch unless the branch hasn't been around long.

**2. Documentation drift on shared modules.** We had `src/lib/talent-scout/defaultEvalPrompt.ts` mirror `supabase/functions/_shared/prompts.ts`. Drifted twice. Each time it caused real eval differences.

  *Fix:* the `/sync-prompts` slash command above. Or a proper hook that fails on commit if they diverge.

**3. Sandbox-permissive destructive actions.** Earlier today the sandbox correctly blocked me from auto-loading the Vault secret because that's a credential operation needing explicit confirmation. Good.

  *Fix:* keep the sandbox's destructive-action gates strict. When I propose an action it'll block, that's the signal to ask you first.

**4. Long-running session context decay.** After 3+ /compact cycles in one session, decisions made early get fuzzy. The Phase 3.8 "60-min stall threshold" rationale was wrong because I forgot the per-candidate heartbeat detail mid-session.

  *Fix:* end a session at phase boundaries. Start the next phase fresh, with the kickoff template above. Capture decisions to `docs/decisions.md` LIVE during the phase, not retroactively.

**5. Edge fn deploy lag.** Multiple times this week I committed code that needed `supabase functions deploy <name>` to actually take effect, and the deploy lagged behind the commit by hours.

  *Fix:* the `add-edge-function` skill above includes the deploy step. The `ship-phase` skill explicitly lists which functions need re-deploy at squash-merge time. Use them.

**6. Em dashes leaking back in.** Multiple times. The rule is in CLAUDE.md AND your tone preferences AND `anti-ai-writing-style.md`. I still slip.

  *Fix:* a hook that greps committed files for em dashes and warns. Not blocking (sometimes they're in legacy content), just a heads-up.

---

## 8. Day-by-day rollout (one week, ~4 hours total)

You don't need all of this at once. Here's what moves the needle most per hour spent.

| Day | Effort | Action |
| --- | --- | --- |
| 1 | 30 min | Cowork folder structure: ABOUT ME / OUTPUTS / TEMPLATES. Run the about-me.md interview. |
| 1 | 15 min | Write anti-ai-writing-style.md from your CLAUDE.md tone rules. |
| 2 | 30 min | Write my-company.md. Set Cowork Global Instructions. |
| 2 | 30 min | Add the four subagents (.claude/agents/) — code-reviewer, security-auditor, design-spec-builder, migration-reviewer. |
| 3 | 20 min | Add `.claude/settings.json` with the PostToolUse tsc hook. |
| 3 | 20 min | Add the four subdirectory CLAUDE.md files. |
| 4 | 30 min | Define the four custom slash commands (/ship, /diagnose, /spec, /sync-prompts). |
| 4 | 30 min | Save the four Cowork TEMPLATES files. |
| 5 | 30 min | Try it: open a Cowork session, draft a Phase 4 sub-phase spec. |
| 5 | 30 min | Open a Code session with the new-phase-kickoff template. Verify the subagents run cleanly. |
| 6-7 | — | Use the system on Phase 4. Iterate as gaps surface. |

**Don't:**
- Try to do all of this in one session
- Add subagents you won't use; only define the ones that map to your real workflow
- Bloat CLAUDE.md with everything in this doc; keep CLAUDE.md lean and reference this file from item 9 of the index

---

## 9. The mindset shift

The articles all converge on one point: you're not getting better at prompting, you're getting better at **system design**. You've already done this for HQ at the project level (CLAUDE.md, layered docs, deploy policy). The next layer is the same discipline applied to the Claude Code session itself.

The question to ask before any new feature: "What automation can I set up ONCE that makes every future occurrence of this pattern smoother?" Not "what's the prompt for this task?" That's the difference between a faster autocomplete and a programmable engineering team.

Phase 4 is a known shape (port from Lovable, follows Talent Scout pattern). Phase 5 is the test — six new surfaces with no reference. The infrastructure above is what makes Phase 5 ship cleanly instead of grinding for weeks.

---

## 10. Resources from the articles worth bookmarking

- `code.claude.com/docs/en/best-practices` — Anthropic's official concise guide
- `github.com/hesreallyhim/awesome-claude-code` — curated subagents / hooks / skills / MCP servers
- `github.com/VoltAgent/awesome-claude-code-subagents` — 100+ pre-built subagent definitions; cherry-pick the ones that fit HQ
- `github.com/obra/superpowers` — TDD-enforced 7-phase workflow. Heavier than HQ needs but worth reading for the discipline patterns.
- `github.com/shanraisshan/claude-code-best-practice` — daily-use practitioner playbook from Anthropic engineers
- `humanlayer.dev/blog/writing-a-good-claude-md` — the most rigorous CLAUDE.md instruction-budget analysis

---

*This doc is the living playbook for our work together. Update it when patterns we discover deserve to be encoded. Keep it under 500 lines so it stays scannable.*
