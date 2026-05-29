// Canonical multi-value cell splitter shared across HQ bulk-import + sheet parsing.
// CONTRACT (v1.0): the ONLY multi-value separator is pipe `|`. Slash `/` is a
// literal character and NEVER splits a value, so "Theatre/Auditorium" and
// "Indoor/Outdoor" stay single values. Comma `,` is the CSV column delimiter
// only, never a multi-value separator (so producers never quote a cell just to
// express multiple values).
//
// MIRROR: `supabase/functions/_shared/multiValue.ts` keeps the split logic below
// byte-equivalent. Change both files together.

const MULTI_VALUE_SPLIT = /\|/;

export function splitMultiValue(cell: unknown): string[] {
  return String(cell ?? "")
    .split(MULTI_VALUE_SPLIT)
    .map((t) => t.trim())
    .filter(Boolean);
}
