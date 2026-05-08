---
name: add-migration
description: "Use when writing a new Supabase migration in HQ. Codifies filename format, migration-reviewer subagent invocation, db push + migration list verification, types regen pattern, and the re-eval-relevant fields convention. Triggers: creating supabase/migrations/<timestamp>_<name>.sql, mentions of 'new migration', 'add column', 'schema change', 'db push'."
metadata:
  author: hq
  version: "1.0.0"
---

# Add Migration

1. Create `supabase/migrations/<YYYYMMDDHHMMSS>_<name>.sql`
2. Run migration-reviewer subagent before push
3. `supabase db push --linked`
4. `supabase migration list --linked` (confirm Local = Remote)
5. `supabase gen types typescript --linked > /tmp/types.ts && test -s /tmp/types.ts && mv /tmp/types.ts src/integrations/supabase/types.ts`
6. Update `docs/schema.md` in the SAME commit as the types regen
7. If CHANGES re-eval-relevant fields (`jd` / `hiring_priorities` / `scorecard` / `evaluation_prompt`), note in commit message that bulk re-eval will be triggered on next role save
