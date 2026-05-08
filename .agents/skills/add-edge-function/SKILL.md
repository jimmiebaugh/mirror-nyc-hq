---
name: add-edge-function
description: "Use when adding a new Supabase Edge Function to HQ. Codifies the verify_jwt + config.toml + callClaude + sendEmail conventions and the deploy-cascade rule for shared-module changes. Triggers: creating supabase/functions/<name>/index.ts, mentions of 'new edge function', 'add function', 'self-invoking function'."
metadata:
  author: hq
  version: "1.0.0"
---

# Add Edge Function

1. Create `supabase/functions/<name>/index.ts`
2. Decide `verify_jwt` setting (default `true`; `false` ONLY for self-invoking or cron-called functions, then add `requireInternalOrUserAuth`)
3. Add `config.toml` entry if `verify_jwt = false`
4. Use `callClaude('app', ...)` for any Anthropic call (NEVER raw fetch)
5. Use `_shared/sendEmail.ts` for transactional email (NEVER raw Gmail API)
6. Document in `docs/edge-functions.md`
7. Deploy: `supabase functions deploy <name>`
8. If imports `_shared/prompts.ts`, also re-deploy other consumers (`ts-pull-candidates`, `ts-evaluate-candidate`, `ts-bulk-reevaluate`, `ts-final-review`, `ts-generate-scorecard`, `ts-refine-scorecard`)
