Boot the design-spec-builder subagent for a new HQ surface. The spec is the deliverable; Jimmie reviews + edits it before any code is touched.

## Argument

`$ARGUMENTS` — the surface name in kebab-case (e.g. `venue-scout-dashboard`, `projects-list`, `notifications-bell`, `admin-user-management`).

## Steps

1. Confirm `docs/specs/` exists; create it with `mkdir -p docs/specs` if not.

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

3. Save the subagent's output to `docs/specs/$ARGUMENTS.md`.

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
