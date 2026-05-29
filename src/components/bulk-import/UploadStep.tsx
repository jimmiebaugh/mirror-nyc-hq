import { useMemo, useRef, useState } from "react";
import { Loader2, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { parseFile } from "@/lib/hq/bulkImport/parser";
import {
  applyHeaderMapping,
  buildAutoHeaderMapping,
} from "@/lib/hq/bulkImport/normalizeHeaders";
import type { EntityConfig, ParsedSheet } from "@/lib/hq/bulkImport/types";

const ACCEPTED = ".csv,.tsv,.xlsx,.xls";
const SELECT_CLASS =
  "w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring";

export function UploadStep({
  config,
  parsed,
  fileName,
  onParsed,
}: {
  config: EntityConfig;
  parsed: ParsedSheet | null;
  fileName: string | null;
  onParsed: (sheet: ParsedSheet | null, fileName: string | null) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  // Raw parse (original headers) + the editable header -> col.key mapping. The
  // mapped result is pushed up via onParsed so the rest of the pipeline sees
  // entity-keyed rows. Local to this step: on re-entry from a later step
  // (rawSheet null but `parsed` set) we fall back to a read-only preview.
  const [rawSheet, setRawSheet] = useState<ParsedSheet | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});

  const resetUpload = () => {
    setRawSheet(null);
    setMapping({});
    onParsed(null, null);
  };

  const handleFile = async (file: File) => {
    setBusy(true);
    try {
      const sheet = await parseFile(file);
      if (sheet.headers.length === 0) {
        toast({
          title: "Couldn't parse file",
          description: sheet.warnings.join("; ") || "No headers found.",
          variant: "destructive",
        });
        resetUpload();
        return;
      }
      // Phase 5.16.1.2: seed an editable header -> col.key mapping (auto-match
      // ignores case/spaces/underscores). The admin maps any header the auto
      // match can't guess (synonyms) below; the mapped sheet flows downstream.
      const auto = buildAutoHeaderMapping(sheet.headers, config.columns);
      setRawSheet(sheet);
      setMapping(auto);
      onParsed(applyHeaderMapping(sheet, auto), file.name);
      if (sheet.warnings.length > 0) {
        toast({
          title: `Parsed with ${sheet.warnings.length} warning(s)`,
          description: sheet.warnings.slice(0, 3).join("; "),
        });
      }
    } catch (err) {
      toast({
        title: "Parse failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
      resetUpload();
    } finally {
      setBusy(false);
    }
  };

  const updateMapping = (header: string, colKey: string) => {
    if (!rawSheet) return;
    const next = { ...mapping };
    if (colKey) next[header] = colKey;
    else delete next[header];
    setMapping(next);
    onParsed(applyHeaderMapping(rawSheet, next), fileName);
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) await handleFile(file);
  };

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await handleFile(file);
    e.target.value = "";
  };

  const mapped = useMemo<ParsedSheet | null>(
    () => (rawSheet ? applyHeaderMapping(rawSheet, mapping) : null),
    [rawSheet, mapping],
  );

  // Required columns no header maps to (surfaced as a warning; the validation
  // step is the hard gate). + columns targeted by more than one header.
  const mappingInsights = useMemo(() => {
    const targets = Object.values(mapping);
    const targetCounts = new Map<string, number>();
    for (const t of targets) targetCounts.set(t, (targetCounts.get(t) ?? 0) + 1);
    const requiredUnmapped = config.columns
      .filter((c) => c.required && !targetCounts.has(c.key))
      .map((c) => c.label);
    const duplicated = config.columns
      .filter((c) => (targetCounts.get(c.key) ?? 0) > 1)
      .map((c) => c.label);
    const mappedCount = targets.length;
    return { requiredUnmapped, duplicated, mappedCount };
  }, [mapping, config.columns]);

  // Fresh upload: full mapping editor. -----------------------------------------
  if (rawSheet && fileName && mapped) {
    return (
      <div className="space-y-4">
        <div className="rounded-md border border-border bg-surface-alt p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">{fileName}</div>
              <div className="text-xs text-muted-foreground">
                {rawSheet.rows.length} row{rawSheet.rows.length === 1 ? "" : "s"} ·{" "}
                {rawSheet.headers.length} column{rawSheet.headers.length === 1 ? "" : "s"} ·{" "}
                {mappingInsights.mappedCount} mapped to fields
              </div>
            </div>
            <Button
              variant="outline"
              type="button"
              onClick={() => {
                resetUpload();
                fileInputRef.current?.click();
              }}
            >
              Choose different file
            </Button>
          </div>

          {rawSheet.warnings.length > 0 ? (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-amber-400">
              {rawSheet.warnings.slice(0, 5).map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          ) : null}
        </div>

        {/* Column mapping: each uploaded header -> a field (or skip). */}
        <div className="rounded-md border border-border">
          <div className="border-b border-border bg-surface-alt px-4 py-3">
            <div className="h-card">Map columns to fields</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Each column from your file maps to a {config.displayName.replace(/s$/, "")} field.
              Close matches are filled in automatically; set anything we couldn't match (or leave
              it as <span className="font-medium">Don't import</span>).
            </p>
          </div>

          {mappingInsights.requiredUnmapped.length > 0 ? (
            <div className="border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-xs text-destructive">
              Required field{mappingInsights.requiredUnmapped.length === 1 ? "" : "s"} not mapped:{" "}
              <span className="font-medium">{mappingInsights.requiredUnmapped.join(", ")}</span>. Map a
              column to {mappingInsights.requiredUnmapped.length === 1 ? "it" : "them"} or the import
              will fail validation.
            </div>
          ) : null}
          {/* "first matching column wins" = sheet-header order: applyHeaderMapping
              iterates sheet.headers and keeps the first header that targets a key. */}
          {mappingInsights.duplicated.length > 0 ? (
            <div className="border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs text-amber-500">
              More than one column maps to:{" "}
              <span className="font-medium">{mappingInsights.duplicated.join(", ")}</span>. The first
              matching column wins.
            </div>
          ) : null}

          <div className="divide-y divide-border">
            {rawSheet.headers.map((h, idx) => {
              const unmapped = !mapping[h];
              return (
                // key carries idx: a CSV can carry duplicate / blank header
                // strings (the parser warns but keeps them), so `h` alone isn't
                // a stable unique key.
                <div key={`${h}-${idx}`} className="grid grid-cols-12 items-center gap-3 px-4 py-2.5">
                  <div className="col-span-5 min-w-0">
                    <div className="truncate font-mono text-sm text-foreground" title={h}>
                      {h || <span className="text-muted-foreground">(blank header)</span>}
                    </div>
                  </div>
                  <div className="col-span-1 text-center text-muted-foreground">→</div>
                  <div className="col-span-6">
                    <select
                      className={`${SELECT_CLASS} ${unmapped ? "text-muted-foreground" : ""}`}
                      value={mapping[h] ?? ""}
                      onChange={(e) => updateMapping(h, e.target.value)}
                    >
                      <option value="">— Don't import —</option>
                      {config.columns.map((c) => (
                        <option key={c.key} value={c.key}>
                          {c.label}
                          {c.required ? " *" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Preview of the mapped result. */}
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-alt">
              <tr>
                {mapped.headers.map((h) => (
                  <th
                    key={h}
                    className="px-3 py-2 text-left text-[11px] font-mono font-bold uppercase tracking-wider text-muted-foreground"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {mapped.rows.slice(0, 5).map((row, i) => (
                <tr key={i} className="border-t border-border">
                  {mapped.headers.map((h) => (
                    <td key={h} className="max-w-[260px] truncate px-3 py-2 text-foreground">
                      {row[h] || <span className="text-muted-foreground">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
              {mapped.headers.length === 0 ? (
                <tr>
                  <td className="px-3 py-3 text-xs text-muted-foreground">
                    No columns mapped yet — pick fields above.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
          {mapped.rows.length > 5 ? (
            <div className="border-t border-border bg-surface-alt px-3 py-2 text-xs text-muted-foreground">
              Showing first 5 of {mapped.rows.length} rows
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  // Re-entry / draft restore: raw sheet gone, but a mapped sheet exists. Show a
  // read-only preview + the option to re-upload (which re-opens the mapper).
  if (parsed && fileName) {
    return (
      <div className="space-y-4">
        <div className="rounded-md border border-border bg-surface-alt p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">{fileName}</div>
              <div className="text-xs text-muted-foreground">
                {parsed.rows.length} row{parsed.rows.length === 1 ? "" : "s"} · {parsed.headers.length} column
                {parsed.headers.length === 1 ? "" : "s"}
              </div>
            </div>
            <Button
              variant="outline"
              type="button"
              onClick={() => {
                resetUpload();
                fileInputRef.current?.click();
              }}
            >
              Choose different file
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Re-upload to change the column mapping.
          </p>
        </div>

        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-alt">
              <tr>
                {parsed.headers.map((h) => (
                  <th
                    key={h}
                    className="px-3 py-2 text-left text-[11px] font-mono font-bold uppercase tracking-wider text-muted-foreground"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {parsed.rows.slice(0, 5).map((row, i) => (
                <tr key={i} className="border-t border-border">
                  {parsed.headers.map((h) => (
                    <td key={h} className="max-w-[260px] truncate px-3 py-2 text-foreground">
                      {row[h] || <span className="text-muted-foreground">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {parsed.rows.length > 5 ? (
            <div className="border-t border-border bg-surface-alt px-3 py-2 text-xs text-muted-foreground">
              Showing first 5 of {parsed.rows.length} rows
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div
        className={`rounded-md border-2 border-dashed py-12 text-center transition-colors ${
          dragOver ? "border-primary bg-primary/5" : "border-border"
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        {busy ? (
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Parsing file…</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <UploadCloud className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Drop a CSV here or click to pick a file.
            </p>
            <Button
              variant="outline"
              type="button"
              onClick={() => fileInputRef.current?.click()}
            >
              Choose a file
            </Button>
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED}
          className="sr-only"
          onChange={onPick}
        />
      </div>

      {config.templateFilename ? (
        <p className="text-xs text-muted-foreground">
          <a
            href={`/templates/${config.templateFilename}`}
            className="tlink"
            download
          >
            Download {config.displayName} template CSV
          </a>
        </p>
      ) : null}
    </div>
  );
}
