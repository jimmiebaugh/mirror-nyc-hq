import type { FilterChip, FilterState } from "@/components/data/FilterBar";

/**
 * Generic in-memory filter applier. Each chip is evaluated against the
 * row's flat-string view (provided per-surface). The chip's op semantics:
 * is / is not / contains / is any of / is before / is after.
 *
 * Keeping the filter engine client-side keeps Phase 5.2.1 simple; queries
 * load the full active set and the FilterBar narrows it on render. With
 * < ~10k rows per surface this is comfortably fast.
 */

export function applyFilters<T>(
  rows: T[],
  state: FilterState,
  getField: (row: T, key: string) => string | string[] | null,
): T[] {
  if (state.chips.length === 0) return rows;
  const check = (row: T, chip: FilterChip): boolean => {
    const val = getField(row, chip.field);
    if (val == null) return false;
    const cell = Array.isArray(val) ? val.join(" · ") : val;
    const cellLow = cell.toLowerCase();
    if (chip.op === "is") {
      return Array.isArray(chip.value)
        ? chip.value.some((v) => v.toLowerCase() === cellLow)
        : cellLow === chip.value.toLowerCase();
    }
    if (chip.op === "is not") {
      return Array.isArray(chip.value)
        ? !chip.value.some((v) => v.toLowerCase() === cellLow)
        : cellLow !== chip.value.toLowerCase();
    }
    if (chip.op === "contains") {
      const needle = (Array.isArray(chip.value) ? chip.value.join(" ") : chip.value).toLowerCase();
      return cellLow.includes(needle);
    }
    if (chip.op === "is any of") {
      const opts = Array.isArray(chip.value) ? chip.value : [chip.value];
      return opts.some((v) => v.toLowerCase() === cellLow);
    }
    if (chip.op === "is before") {
      const needle = Array.isArray(chip.value) ? chip.value[0] : chip.value;
      return cell < needle;
    }
    if (chip.op === "is after") {
      const needle = Array.isArray(chip.value) ? chip.value[0] : chip.value;
      return cell > needle;
    }
    return false;
  };

  return rows.filter((r) => {
    if (state.connector === "AND") return state.chips.every((c) => check(r, c));
    return state.chips.some((c) => check(r, c));
  });
}
