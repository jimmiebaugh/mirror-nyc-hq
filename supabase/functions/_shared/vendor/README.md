# Vendored third-party libraries (edge tree)

Self-contained builds vendored into the repo because the Supabase edge deploy
bundler can't fetch them from their CDN at deploy time. Imported locally by
edge functions (the bundler bundles local files fine).

## `xlsx.mjs` — SheetJS Community Edition 0.20.3

- **Source:** `https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs`
- **Why vendored:** the npm / esm.sh `xlsx` tops out at `0.18.5`, which carries
  unpatched prototype-pollution + ReDoS advisories with no npm fix. SheetJS ships
  the patched build (0.19.3+, 0.20.x) only via their CDN. The Supabase edge
  bundler rejects `cdn.sheetjs.com` as a runtime import host ("Cannot import from
  cdn.sheetjs.com:443"), so the patched ESM build is committed here and imported
  locally instead. (The frontend, which builds through Vite, imports the same CDN
  build directly at runtime — see `src/lib/hq/bulkImport/parser.ts`.)
- **Consumer:** `supabase/functions/vs-parse-sheet/index.ts` (`XLSX.read` +
  `XLSX.utils.sheet_to_json`). Self-contained ESM (named exports `read`, `utils`,
  …); environment-aware (Deno/Node/browser); no real external imports.
- **Update procedure:** bump the version, re-download, re-deploy `vs-parse-sheet`,
  and re-smoke a PDF / xlsx / csv upload:
  ```bash
  curl -fsSL "https://cdn.sheetjs.com/xlsx-<ver>/package/xlsx.mjs" \
    -o supabase/functions/_shared/vendor/xlsx.mjs
  supabase functions deploy vs-parse-sheet
  ```
- **Lint:** explicitly eslint-ignored via `supabase/functions/_shared/vendor/**`
  in `eslint.config.js` (eslint's default JS handling otherwise lints `.mjs`).
- Introduced: Phase 5.16.1.2 (code-observations Edge #21).
