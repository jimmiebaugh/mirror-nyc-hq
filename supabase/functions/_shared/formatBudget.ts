// Pure-JS comma-formatter for the budget DISPLAY string used in edge-function
// prompts. Replaces Number.toLocaleString("en-US") on the server side so the
// prompt never depends on V8's ICU output: same input always yields the same
// formatted string regardless of runtime ICU posture. Closes code-observations
// Edge #2 (vs-generate-brief-overview ICU parity).
//
// Frontend usage (browser is V8; no ICU divergence to chase) can stay on
// toLocaleString.

export function formatBudgetForPrompt(
  value: number | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value)) return null;
  // Round to integer for display; strip negative sign defensively.
  const rounded = Math.round(Math.abs(value));
  const str = String(rounded);
  let withCommas = "";
  for (let i = 0; i < str.length; i++) {
    if (i > 0 && (str.length - i) % 3 === 0) withCommas += ",";
    withCommas += str[i];
  }
  return `$${withCommas}`;
}
