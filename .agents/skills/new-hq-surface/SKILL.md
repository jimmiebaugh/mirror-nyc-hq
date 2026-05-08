---
name: new-hq-surface
description: "Use when building a new HQ page or surface (Phase 4 Venue Scout, Phase 5 Cross-cutting work, anything beyond Talent Scout). Codifies the spec-first workflow: design-spec-builder → migration-reviewer → frontend → code-reviewer. Triggers: 'new page', 'new surface', 'new HQ route', 'wire up <X> page', any new entry under src/pages/."
metadata:
  author: hq
  version: "1.0.0"
---

# New HQ Surface

1. Run design-spec-builder subagent to draft the spec (don't skip)
2. Schema + migration first if new tables involved (run migration-reviewer)
3. Edge functions next if new ones needed
4. Frontend last:
   - Route in `src/App.tsx` (under `ProtectedRoute` or `AdminRoute`)
   - Page in `src/pages/<area>/<Name>.tsx`
   - Components extract to `src/components/<area>/` once a piece is reused twice
   - Brand: `bg-surface-alt` cards, coral primary, `font-display` for headers
5. Run code-reviewer subagent before commit
6. Hooks above any early return; double-check JSX imports
