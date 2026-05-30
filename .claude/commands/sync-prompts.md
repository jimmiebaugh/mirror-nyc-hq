---
description: Verify the frontend eval prompt matches the DEFAULT_EVAL_PROMPT export in _shared/prompts.ts byte for byte.
---

Verify that `src/lib/talent-scout/defaultEvalPrompt.ts` matches the `DEFAULT_EVAL_PROMPT` export in `supabase/functions/_shared/prompts.ts` byte-for-byte.

## Why this exists

The frontend mirror of the eval prompt populates the editable `evaluation_prompt` field when a role is created in the wizard. After role creation, `ts_roles.evaluation_prompt` is what the eval pipeline reads. Drift between the two files only affects NEW roles, but it has bitten us twice already (Phase 3.7.6.9, Phase 3.7.8). Manually-synced files always drift eventually.

## Steps

1. Read `supabase/functions/_shared/prompts.ts` and extract the `DEFAULT_EVAL_PROMPT` template literal value.
2. Read `src/lib/talent-scout/defaultEvalPrompt.ts` and extract its exported `DEFAULT_EVAL_PROMPT` constant.
3. Compare byte-for-byte. Whitespace, punctuation, and bullet characters all matter.
4. Report:
   - **If match:** ✅ "in sync as of `<git log -1 --format=%ai supabase/functions/_shared/prompts.ts>`".
   - **If drift:** ❌ with a unified diff (`diff -u` style) showing exactly where they differ. Recommend `prompts.ts` is canonical (it's what the production eval pipeline reads); `defaultEvalPrompt.ts` should be updated to match unless Jimmie says otherwise.

## Don't

Don't auto-fix. Drift might be intentional (a prompt change being staged in one file before the other ships). Surface it; let Jimmie decide which side wins.

## Background gotchas

- The two files are identical strings as of last sync, but the surrounding TypeScript syntax differs (`prompts.ts` uses a tagged template + string concatenation; `defaultEvalPrompt.ts` is a single `export const = \`...\`;`). Compare the resolved string contents, not the source.
- `prompts.ts` may use template-literal interpolation (`${MIRROR_NYC_CONTEXT}`) that resolves to constants defined elsewhere in the same file. Resolve those before comparing.
