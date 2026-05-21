// HQ-side sheet parser. Fresh build, intentionally separate from
// vs-parse-sheet so future HQ-side schema or sanitization changes can't
// regress the venue-scout sourcing-sheet path. See phase-5-9-bulk-import
// plan doc Risks section.
//
// Scope in 5.9.1: CSV / TSV parsing only. The browser parses XLSX via the
// xlsx browser build (src/lib/hq/bulkImport/parser.ts) and posts already-
// parsed rows to the bulk-import edge function, so server-side XLSX
// support isn't needed in this sub-phase. The per-entity handlers in
// 5.9.2 / .3 / .4 will use parseDelimited() for any server-side
// re-validation pass they need.

export type ParsedSheet = {
  headers: string[];
  rows: Record<string, string>[];
  warnings: string[];
};

export type ParseOptions = {
  delimiter?: "," | "\t" | "auto";
  trimHeaders?: boolean;
};

const DEFAULT_OPTIONS: Required<ParseOptions> = {
  delimiter: "auto",
  trimHeaders: true,
};

export function parseDelimited(text: string, options: ParseOptions = {}): ParsedSheet {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const warnings: string[] = [];

  const cleaned = text.replace(/^\uFEFF/, "");
  if (cleaned.length === 0) {
    return { headers: [], rows: [], warnings: ["empty input"] };
  }

  const delimiter = opts.delimiter === "auto" ? detectDelimiter(cleaned) : opts.delimiter;

  const records = tokenize(cleaned, delimiter);
  if (records.length === 0) {
    return { headers: [], rows: [], warnings: ["no records parsed"] };
  }

  const rawHeaders = records[0];
  const headers = opts.trimHeaders ? rawHeaders.map((h) => h.trim()) : rawHeaders;

  if (headers.some((h) => h.length === 0)) {
    warnings.push("one or more headers are empty");
  }
  const seen = new Set<string>();
  for (const h of headers) {
    if (seen.has(h)) warnings.push(`duplicate header: ${h}`);
    seen.add(h);
  }

  const rows: Record<string, string>[] = [];
  for (let i = 1; i < records.length; i += 1) {
    const cells = records[i];
    if (cells.length === 1 && cells[0] === "") continue;
    const row: Record<string, string> = {};
    for (let c = 0; c < headers.length; c += 1) {
      row[headers[c]] = cells[c] ?? "";
    }
    if (cells.length > headers.length) {
      warnings.push(`row ${i} has ${cells.length} cells but only ${headers.length} headers`);
    }
    rows.push(row);
  }

  return { headers, rows, warnings };
}

function detectDelimiter(text: string): "," | "\t" {
  // First non-empty line wins. CSV is far more common; tab beats comma
  // only when there are more tabs than commas on that line.
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const tabs = (firstLine.match(/\t/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  return tabs > commas ? "\t" : ",";
}

function tokenize(text: string, delimiter: "," | "\t"): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  while (i < len) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < len && text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === delimiter) {
      row.push(cell);
      cell = "";
      i += 1;
      continue;
    }
    if (ch === "\r") {
      i += 1;
      continue;
    }
    if (ch === "\n") {
      row.push(cell);
      out.push(row);
      row = [];
      cell = "";
      i += 1;
      continue;
    }
    cell += ch;
    i += 1;
  }

  row.push(cell);
  if (row.length > 1 || row[0] !== "") {
    out.push(row);
  }
  return out;
}

export function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[\s_-]+/g, "_").replace(/[^a-z0-9_]/g, "");
}
