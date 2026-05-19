Boot the design-spec-builder subagent for a new HQ surface. The spec is the deliverable; Jimmie reviews + edits it before any code is touched.

## Argument

`$ARGUMENTS` — the surface name in kebab-case (e.g. `venue-scout-dashboard`, `projects-list`, `notifications-bell`, `admin-user-management`).

## Steps

1. **Note:** in the standard two-session workflow, Phase 5+ HQ specs are drafted in the Cowork session and saved to `/Users/jimmie/Claude/Mirror NYC HQ/OUTPUTS/phase-X-Y-<surface>-spec.md` per `docs/working-with-claude.md` § 4. The `/spec` command in Code is the fallback for one-shot non-phase work (e.g. a prototype spec); it saves to a sibling `OUTPUTS/` folder in the repo. Confirm `OUTPUTS/` exists; create with `mkdir -p OUTPUTS` if not. **For Phase 5+ HQ work, prefer drafting in Cowork via the `hq-spec-drafter` skill.**

2. Use the Agent tool with `subagent_type: "design-spec-builder"` (defined in `.claude/agents/design-spec-builder.md`). Pass it this prompt:

   > Draft a detailed implementation spec for a new HQ surface called `$ARGUMENTS`.
   >
   > Read in this order before drafting:
   > 1. `docs/design-system.md` (especially §11 "Talent Scout pages as design references" to find the closest analog)
   > 2. The Talent Scout reference file(s) §11 points to
   > 3. `docs/architecture.md`, `docs/auth-model.md`, `docs/schema.md`, `docs/conventions.md`
   >
   > Then map the new surface to existing patterns. Output sections per the agent's standard structure (closest TS analog, route + auth gate, data model, UI layout, components, state + behavior, edge functions, migrations, re-eval implications, test plan, brand rules from design-system.md §12 that apply).
   >
   > Be specific about what's lifted from Talent Scout vs adapted vs invented. Under-specifying is worse than over-specifying — the implementer will follow this spec exactly.

3. Save the subagent's output to `OUTPUTS/$ARGUMENTS.md`. For Phase 5+ HQ work, this command is the wrong tool: draft the spec in Cowork via the `hq-spec-drafter` skill and save to `/Users/jimmie/Claude/Mirror NYC HQ/OUTPUTS/phase-X-Y-spec.md`.

4. Report back with:
   - The path to the saved spec
   - A 3-bullet summary of what the spec covers
   - The closest Talent Scout analog the spec inherits from
   - Anything ambiguous that Jimmie needs to weigh in on before implementation

## Don't

Don't start implementing. The spec is the deliverable. Implementation happens in a separate Code session, with the spec pasted in as the prompt.

## If `.claude/agents/design-spec-builder.md` doesn't exist yet

The subagent definition lives in `.claude/agents/design-spec-builder.md`. If it's not present, the command can't run. Either:
- Create the subagent file first using the definition in `docs/working-with-claude.md` § 3a, OR
- Run the spec-drafting prompt above directly in the main session (less ideal — pollutes main context — but works as a fallback).
