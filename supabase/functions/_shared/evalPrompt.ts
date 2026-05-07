// Re-exports from the consolidated _shared/prompts.ts (Phase 3.6.5).
// The eval prompt itself moved to prompts.ts so all Talent Scout Claude
// prompts live in one file for easy review/editing.
export { DEFAULT_EVAL_PROMPT } from "./prompts.ts";

// Legacy template-fill helper. Retained for any callers that still inject role
// context inline (e.g., role.custom_evaluation_prompt overrides). New per-candidate
// Claude calls should use buildClaudeEvalRequest() instead.
export function fillEvalPrompt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    const v = vars[k];
    return v === undefined || v === null ? "" : String(v);
  });
}
