import type { FilterChip, FilterState } from "@/components/data/FilterBar";

/**
 * Generic in-memory filter applier. Each chip is evaluated against the
 * row's flat-string view (provided per-surface). The chip's op semantics:
 * is / is not / contains / is any of / is before / is after.
 *
 * Keeping the filter engine client-side keeps Phase 5.2.1 simple; queries
 * load the full active set and the FilterBar narrows it on render. With
 * < ~10k rows per surface this is comfortably fast.
 *
 * "Me" semantics (Phase 5.2.1 Revision NIT 3): any chip whose value is the
 * literal string "Me" (case-insensitive) is substituted with the caller-
 * provided `context.meUserId` before comparison. Pass the context arg on
 * surfaces that expose user-field chips. Default surfaces like Tasks ship
 * with an `{ field: 'assignee', op: 'is', value: 'Me' }` chip so the
 * filter resolves to "this row's assignee_id === auth.uid()" without the
 * caller having to bake the current user's uuid into the chip.
 */

export type ApplyFiltersContext = {
  meUserId?: string | null;
};

function resolveMeValue(
  value: string | string[],
  context?: ApplyFiltersContext,
): string | string[] {
  const me = context?.meUserId ?? null;
  // When `me` is null (session expired or auth not loaded), fall back to
  // the original "me" string so the comparison matches nothing rather than
  // matching empty-assignee rows. Reviewer S5 from the 4-fix delta.
  const subst = (v: string) => (v.trim().toLowerCase() === "me" ? (me ?? v) : v);
  return Array.isArray(value) ? value.map(subst) : subst(value);
}

export function applyFilters<T>(
  rows: T[],
  state: FilterState,
  getField: (row: T, key: string) => string | string[] | null,
  context?: ApplyFiltersContext,
  /**
   * Per-field "always matches" predicate. When a chip's field has an entry
   * here and the predicate returns true for a row, that chip auto-passes for
   * that row regardless of its cell value. Used for nationwide vendors: a
   * vendor flagged nationwide satisfies any `city` chip (Phase 5.9.3.1), so it
   * surfaces under every city filter while a non-nationwide vendor still
   * matches its base city normally.
   */
  fieldMatchAll?: Record<string, (row: T) => boolean>,
): T[] {
  if (state.chips.length === 0) return rows;
  const check = (row: T, chip: FilterChip): boolean => {
    if (fieldMatchAll?.[chip.field]?.(row)) return true;
    const val = getField(row, chip.field);
    // Presence: "yes" => field has a value; "no" => field is empty. Evaluated
    // before the null guard since a null value is itself a meaningful answer.
    if (chip.op === "presence") {
      const want = (Array.isArray(chip.value) ? chip.value[0] : chip.value) !== "no";
      return want ? val != null : val == null;
    }
    if (val == null) return false;
    const cell = Array.isArray(val) ? val.join(" · ") : val;
    const cellLow = cell.toLowerCase();
    const chipValue = resolveMeValue(chip.value, context);
    if (chip.op === "is") {
      return Array.isArray(chipValue)
        ? chipValue.some((v) => v.toLowerCase() === cellLow)
        : cellLow === chipValue.toLowerCase();
    }
    if (chip.op === "is not") {
      return Array.isArray(chipValue)
        ? !chipValue.some((v) => v.toLowerCase() === cellLow)
        : cellLow !== chipValue.toLowerCase();
    }
    if (chip.op === "contains") {
      const needle = (Array.isArray(chipValue) ? chipValue.join(" ") : chipValue).toLowerCase();
      return cellLow.includes(needle);
    }
    if (chip.op === "is any of") {
      const opts = Array.isArray(chipValue) ? chipValue : [chipValue];
      return opts.some((v) => v.toLowerCase() === cellLow);
    }
    if (chip.op === "is before") {
      const needle = Array.isArray(chipValue) ? chipValue[0] : chipValue;
      return cell < needle;
    }
    if (chip.op === "is after") {
      const needle = Array.isArray(chipValue) ? chipValue[0] : chipValue;
      return cell > needle;
    }
    return false;
  };

  return rows.filter((r) => {
    if (state.connector === "AND") return state.chips.every((c) => check(r, c));
    return state.chips.some((c) => check(r, c));
  });
}
