// Robust JSON extractor for Claude responses. Handles:
//   - Raw JSON
//   - JSON wrapped in ```json ... ``` or ``` ... ``` fences
//   - JSON with leading/trailing prose
export function parseClaudeJson<T = unknown>(rawText: string): T {
  let text = (rawText ?? "").trim();

  // Strip surrounding markdown code fences if present
  const fenceMatch = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  // Find first JSON object or array (handles prose prefix/suffix)
  const objMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (objMatch) {
    text = objMatch[1];
  }

  try {
    return JSON.parse(text) as T;
  } catch (error: any) {
    const truncated = (rawText ?? "").substring(0, 200);
    console.error(
      `[parseClaudeJson] Failed to parse JSON. Error: ${error?.message ?? error}. Raw text (first 200 chars): "${truncated}"`,
    );
    throw error;
  }
}

// Reusable instruction snippet to append to prompts asking Claude for JSON.
export const JSON_ONLY_INSTRUCTION =
  "Return ONLY the raw JSON object. Do not wrap your response in markdown code fences (no ```json blocks). Start your response with { and end with } (or [ ] for arrays). No prose, no explanation, no markdown.";
