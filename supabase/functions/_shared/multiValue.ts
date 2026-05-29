// Edge-side mirror of `src/lib/multiValue.ts`. Canonical multi-value cell
// splitter for sheet parsing.
// CONTRACT (v1.0): the ONLY multi-value separator is pipe `|`. Slash `/` is a
// literal character and NEVER splits a value, so "Theatre/Auditorium" and
// "Indoor/Outdoor" stay single values. Comma `,` is the CSV column delimiter
// only, never a multi-value separator.
//
// MIRROR: keep the split logic below byte-equivalent with the frontend file.
// Change both files together.

const MULTI_VALUE_SPLIT = /\|/;

export function splitMultiValue(cell: unknown): string[] {
  return String(cell ?? "")
    .split(MULTI_VALUE_SPLIT)
    .map((t) => t.trim())
    .filter(Boolean);
}
