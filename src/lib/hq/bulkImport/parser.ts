import type { ParsedSheet } from "./types";

const CSV_EXT = /\.csv$/i;
const TSV_EXT = /\.tsv$/i;
const XLSX_EXT = /\.(xlsx|xls)$/i;

export async function parseFile(file: File): Promise<ParsedSheet> {
  const name = file.name ?? "";
  if (CSV_EXT.test(name) || TSV_EXT.test(name)) {
    const text = await file.text();
    return parseDelimitedText(text, TSV_EXT.test(name) ? "\t" : ",");
  }
  if (XLSX_EXT.test(name)) {
    const buffer = await file.arrayBuffer();
    return await parseWorkbook(buffer);
  }
  return {
    headers: [],
    rows: [],
    warnings: [`Unsupported file extension: ${name}`],
  };
}

function parseDelimitedText(text: string, delimiter: "," | "\t"): ParsedSheet {
  const warnings: string[] = [];
  const cleaned = text.replace(/^\uFEFF/, "");
  if (cleaned.length === 0) {
    return { headers: [], rows: [], warnings: ["empty input"] };
  }

  const records = tokenize(cleaned, delimiter);
  if (records.length === 0) {
    return { headers: [], rows: [], warnings: ["no records parsed"] };
  }

  const headers = records[0].map((h) => h.trim());
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

async function parseWorkbook(buffer: ArrayBuffer): Promise<ParsedSheet> {
  // Lazy dynamic import of SheetJS's patched CDN ESM build (Phase 5.16.1.2).
  // Keeps the heavy library out of the bundle AND off npm: the npm `xlsx`
  // 0.18.5 carried unpatched prototype-pollution + ReDoS advisories with no
  // npm fix, so it was removed; the CDN 0.20.3 build is patched. Loads only
  // when an admin uploads an .xlsx/.xls file (the CSV/TSV path above never
  // touches the network). `@vite-ignore` keeps the URL specifier external so
  // Vite leaves it as a runtime import() instead of trying to bundle it.
  const XLSX = await import(
    /* @vite-ignore */ "https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs"
  );
  const warnings: string[] = [];
  const wb = XLSX.read(buffer, { type: "array" });
  if (wb.SheetNames.length > 1) {
    warnings.push(`multi-sheet workbook; using first sheet (${wb.SheetNames[0]})`);
  }
  const first = wb.Sheets[wb.SheetNames[0]];
  if (!first) {
    return { headers: [], rows: [], warnings: ["no sheets in workbook"] };
  }
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(first, {
    defval: "",
    raw: false,
  });
  if (rows.length === 0) {
    return { headers: [], rows: [], warnings: [...warnings, "no rows in first sheet"] };
  }
  const headers = Object.keys(rows[0]).map((h) => h.trim());
  const normalized = rows.map((r) => {
    const out: Record<string, string> = {};
    for (const h of headers) {
      const v = r[h];
      out[h] = v == null ? "" : String(v);
    }
    return out;
  });
  return { headers, rows: normalized, warnings };
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
