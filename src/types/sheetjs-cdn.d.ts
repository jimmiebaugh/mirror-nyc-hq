// Ambient declaration for the SheetJS CDN ESM build consumed lazily by
// src/lib/hq/bulkImport/parser.ts (Phase 5.16.1.2). The npm `xlsx` package was
// removed (its 0.18.5 release carried unpatched prototype-pollution + ReDoS
// advisories with no npm fix); the CDN 0.20.3 build is patched. We declare only
// the narrow surface the parser uses so the URL `import()` typechecks without a
// dependency on `@types/xlsx`.
//
// The module specifier below MUST stay byte-identical to the import string in
// parser.ts (TS matches `declare module` by exact specifier).
declare module "https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs" {
  export interface WorkBook {
    SheetNames: string[];
    Sheets: Record<string, unknown>;
  }
  export function read(
    data: ArrayBuffer | Uint8Array,
    opts?: { type?: "array" | "buffer" | "binary" | "base64" | "file" | "string" },
  ): WorkBook;
  export const utils: {
    sheet_to_json<T = Record<string, unknown>>(
      worksheet: unknown,
      opts?: { defval?: unknown; raw?: boolean; header?: 1 | "A" | string[] },
    ): T[];
  };
}
