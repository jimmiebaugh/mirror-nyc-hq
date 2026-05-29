/**
 * Phase 6.4 (N4): shared currency input helpers. Single source of truth for
 * budget/currency field formatting across HQ Core (ProjectEdit) and Venue
 * Scout (BriefEvent). Whole-dollar display ($X,XXX, no decimals); parse strips
 * $ / commas / whitespace back to an integer for NUMERIC columns.
 */

/** Format raw user input as `$X,XXX` (no decimals). Empty / no-digits -> "". */
export function formatCurrencyInput(raw: string): string {
  const digits = (raw ?? "").replace(/[^0-9]/g, "");
  if (!digits) return "";
  const n = parseInt(digits, 10);
  return Number.isFinite(n) ? `$${n.toLocaleString("en-US")}` : "";
}

/**
 * Format a STORED numeric amount for display as `$X,XXX` (rounded to whole
 * dollars). Use this for hydrating a NUMERIC column into the input — do NOT
 * route a number through formatCurrencyInput(String(n)), which strips the
 * decimal point and 10x-inflates a fractional legacy value. Empty for null.
 */
export function formatCurrencyDisplay(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

/**
 * Parse a formatted/typed currency string back to an integer. Strips
 * $ / commas / whitespace. Returns null when empty or unparseable.
 */
export function parseCurrencyToNumber(text: string): number | null {
  const stripped = (text ?? "").replace(/[$,\s]/g, "");
  if (!stripped) return null;
  const n = Number(stripped);
  return Number.isFinite(n) ? Math.round(n) : null;
}
