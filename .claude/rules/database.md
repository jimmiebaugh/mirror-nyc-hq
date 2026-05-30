---
description: DB migration and schema conventions. Read before changing schema.
paths:
  - "supabase/migrations/**"
  - "**/*.sql"
---

`docs/schema.md` is the single source of truth for every table, column, enum, and trigger.

When changing schema:
1. Write the migration in `supabase/migrations/` (timestamped).
2. Regenerate types: `supabase gen types typescript --linked > /tmp/types.ts && test -s /tmp/types.ts && mv /tmp/types.ts src/integrations/supabase/types.ts`
3. Update `docs/schema.md` in the SAME commit as the migration.

Before `supabase db push --linked`, run the `migration-reviewer` agent. It catches reversibility, RLS, GRANT, and cascade issues.

Every new table needs RLS policies. See `docs/auth-model.md` for the role model (admin / standard / freelance / pending).
