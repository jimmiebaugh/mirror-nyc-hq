---
description: Edge Function auth and Anthropic conventions. Read before adding or editing a function.
paths:
  - "supabase/functions/**"
---

Canonical references: `docs/edge-functions.md` (every function and its `verify_jwt` posture) and `docs/auth-model.md` (auth helpers).

If a function self-invokes, set `verify_jwt = false` and pick the auth helper by surface:
- `requireInternalOrAdminUser` for admin-only or service-role surfaces (Talent Scout).
- `requireInternalOrUserAuth` only for machine-only or cron surfaces.

All Anthropic calls go through `callClaude(app, ...)` from `_shared/anthropic.ts`. Never raw `fetch` to the API.

After editing a `_shared/*` module, identify and redeploy every dependent function (`supabase functions deploy <name>`). The `/ship` checklist computes the actual impacted set.

Run the `security-auditor` agent on new or modified functions before merge.
