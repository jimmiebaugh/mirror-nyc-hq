import type { ColumnSchema, ParsedSheet } from "./types";

/**
 * Phase 5.16.1.2: header -> column-key mapping for bulk import.
 *
 * The whole bulk-import pipeline (ref enumeration, the ImportGrid, dedupe,
 * validation, and the commit payload) reads each parsed row as `row[col.key]`,
 * where `col.key` is the internal field name (`name`, `address`, ...). The
 * shipped templates use those keys verbatim as headers, so a template sheet
 * flows straight through; a friendly-header / modified sheet does not, and the
 * Review grid rendered blank cells.
 *
 * `buildAutoHeaderMapping` seeds an editable header -> col.key map by matching
 * on a normalized token (lowercased, non-alphanumerics stripped) against both
 * the column `key` and `label` (key wins on collision), so `name` / `Name` /
 * `venue_types` / "Venue Types" all auto-resolve. Headers it can't safely guess
 * (synonyms like "Venue" -> `name`, "Size" -> `square_footage`) are left out so
 * the UploadStep can let the admin map them by hand. `applyHeaderMapping` then
 * re-keys the rows per the final (auto + manual) mapping so the rest of the
 * pipeline sees entity-keyed rows. Entity-agnostic (keyed off `config.columns`).
 */

function normalizeToken(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Auto-match headers to column keys. Returns { header -> col.key } for the
 *  headers it can resolve; unmatched headers are absent (default "don't import",
 *  editable in the UploadStep mapping UI). col.key wins over col.label. */
export function buildAutoHeaderMapping(
  headers: string[],
  columns: ColumnSchema[],
): Record<string, string> {
  const tokenToKey = new Map<string, string>();
  for (const c of columns) {
    const t = normalizeToken(c.key);
    if (t && !tokenToKey.has(t)) tokenToKey.set(t, c.key);
  }
  for (const c of columns) {
    const t = normalizeToken(c.label);
    if (t && !tokenToKey.has(t)) tokenToKey.set(t, c.key);
  }
  const mapping: Record<string, string> = {};
  for (const h of headers) {
    const key = tokenToKey.get(normalizeToken(h));
    if (key && !(h in mapping)) mapping[h] = key;
  }
  return mapping;
}

/** Re-key a parsed sheet's rows + headers from raw upload headers onto column
 *  keys per an explicit mapping (header -> col.key; absent or "" = drop the
 *  column). First source header wins when two map to the same column. */
export function applyHeaderMapping(
  sheet: ParsedSheet,
  mapping: Record<string, string>,
): ParsedSheet {
  const seen = new Set<string>();
  const headers: string[] = [];
  for (const h of sheet.headers) {
    const key = mapping[h];
    if (key && !seen.has(key)) {
      seen.add(key);
      headers.push(key);
    }
  }
  const rows = sheet.rows.map((row) => {
    const out: Record<string, string> = {};
    for (const [h, v] of Object.entries(row)) {
      const key = mapping[h];
      if (key && !(key in out)) out[key] = v;
    }
    return out;
  });
  return { headers, rows, warnings: [...sheet.warnings] };
}
