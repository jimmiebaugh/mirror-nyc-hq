/**
 * Phone normalization utility (Phase 5.6.1).
 *
 * `parsePhone` extracts exactly 10 US digits from any input; strips an
 * optional leading "1" so 11-digit US numbers collapse to 10. Returns null
 * for international, extension-bearing, or otherwise non-parseable inputs.
 *
 * `formatPhone` is the save-time formatter: callers wire it to a phone
 * field's `onBlur`. If parseable it returns `(XXX) XXX-XXXX`; otherwise it
 * passes the raw value through unchanged so international, extension, or
 * garbage values survive untouched. No live-formatting while typing
 * (cursor-jump avoidance).
 *
 * The DB-side counterpart is the one-shot normalize-existing-rows
 * migration at supabase/migrations/2026XXXX_phase_5_6_1_phone_normalization.sql.
 */

export function parsePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    digits = digits.slice(1);
  }
  return digits.length === 10 ? digits : null;
}

export function formatPhone(raw: string | null | undefined): string {
  if (!raw) return raw ?? "";
  const digits = parsePhone(raw);
  if (!digits) return raw;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}
