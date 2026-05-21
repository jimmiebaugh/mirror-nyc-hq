import type { EntityConfig, ParsedSheet, UnresolvedRef } from "./types";

/**
 * Generic unresolved-ref enumeration shared by every entity's
 * `buildUnresolved`. Walks the parsed sheet, collects every distinct raw
 * value found in `refResolved` columns, grouped by ref kind. Multi-value
 * columns split on "|" so each token resolves independently. Sync (no DB):
 * the actual existence match happens in MapStep.
 *
 * Columns that share a `refKind` collapse into one group, so a value that
 * appears in multiple columns resolves once and applies everywhere.
 */
export function enumerateUnresolvedRefs(
  config: EntityConfig,
  parsed: ParsedSheet,
): UnresolvedRef[] {
  // kind -> raw_value -> set of row indices
  const byKind = new Map<string, Map<string, Set<number>>>();

  const refColumns = config.columns.filter(
    (c) => c.kind === "refResolved" && c.refKind,
  );

  parsed.rows.forEach((row, rowIndex) => {
    for (const col of refColumns) {
      const kind = col.refKind!;
      const cell = (row[col.key] ?? "").trim();
      if (!cell) continue;
      const tokens = col.multiValue
        ? cell.split("|").map((t) => t.trim()).filter(Boolean)
        : [cell];
      for (const token of tokens) {
        let valueMap = byKind.get(kind);
        if (!valueMap) {
          valueMap = new Map();
          byKind.set(kind, valueMap);
        }
        let rows = valueMap.get(token);
        if (!rows) {
          rows = new Set();
          valueMap.set(token, rows);
        }
        rows.add(rowIndex);
      }
    }
  });

  const out: UnresolvedRef[] = [];
  for (const [kind, valueMap] of byKind) {
    for (const [raw_value, rows] of valueMap) {
      out.push({ kind, raw_value, row_indices: Array.from(rows).sort((a, b) => a - b) });
    }
  }
  return out;
}

/** Split a multi-value cell on "|" into trimmed non-empty tokens. */
export function splitMulti(cell: unknown): string[] {
  return String(cell ?? "")
    .split("|")
    .map((t) => t.trim())
    .filter(Boolean);
}
