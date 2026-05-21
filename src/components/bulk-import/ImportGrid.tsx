import { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Button } from "@/components/ui/button";
import { ColumnPickerDrawer } from "./ColumnPickerDrawer";
import { TextCell } from "./cells/TextCell";
import { LongTextCell } from "./cells/LongTextCell";
import { NumberCell } from "./cells/NumberCell";
import { MoneyCell } from "./cells/MoneyCell";
import { DateCell } from "./cells/DateCell";
import { EnumCell } from "./cells/EnumCell";
import { LookupCell } from "./cells/LookupCell";
import { RefResolvedCell } from "./cells/RefResolvedCell";
import type { CellEditorProps } from "./cells/types";
import type { ColumnSchema, EntityConfig } from "@/lib/hq/bulkImport/types";

function CellEditor(props: CellEditorProps) {
  switch (props.col.kind) {
    case "longText":
      return <LongTextCell {...props} />;
    case "number":
      return <NumberCell {...props} />;
    case "money":
      return <MoneyCell {...props} />;
    case "date":
      return <DateCell {...props} />;
    case "enum":
      return <EnumCell {...props} />;
    case "lookup":
      return <LookupCell {...props} />;
    case "refResolved":
      return <RefResolvedCell {...props} />;
    case "text":
    default:
      return <TextCell {...props} />;
  }
}

type ValidationError = { row_index: number; column: string; message: string };

type GridRow = Record<string, unknown>;

const ROW_HEIGHT = 36;

export function ImportGrid({
  config,
  rows,
  errors,
  columnKeys,
  onRowsChange,
  onColumnKeysChange,
}: {
  config: EntityConfig;
  rows: GridRow[];
  errors: ValidationError[];
  columnKeys: string[];
  onRowsChange: (next: GridRow[]) => void;
  onColumnKeysChange: (next: string[]) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const visibleColumns = useMemo<ColumnSchema[]>(() => {
    const map = new Map(config.columns.map((c) => [c.key, c]));
    const out: ColumnSchema[] = [];
    for (const k of columnKeys) {
      const col = map.get(k);
      if (col) out.push(col);
    }
    return out;
  }, [config.columns, columnKeys]);

  const errorsByRow = useMemo(() => {
    const map = new Map<number, ValidationError[]>();
    for (const e of errors) {
      const list = map.get(e.row_index) ?? [];
      list.push(e);
      map.set(e.row_index, list);
    }
    return map;
  }, [errors]);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  const updateCell = (rowIndex: number, columnKey: string, value: unknown) => {
    const next = rows.map((r, i) =>
      i === rowIndex ? { ...r, [columnKey]: value } : r,
    );
    onRowsChange(next);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          {rows.length} row{rows.length === 1 ? "" : "s"} ready to import.{" "}
          {errors.length > 0 ? (
            <span className="text-destructive">{errors.length} validation error{errors.length === 1 ? "" : "s"}.</span>
          ) : null}
        </div>
        <Button variant="outline" type="button" onClick={() => setPickerOpen(true)}>
          Columns ▾
        </Button>
      </div>

      {errors.length > 0 ? (
        <div className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm">
          <div className="font-medium text-destructive">Validation errors</div>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
            {errors.slice(0, 5).map((e, i) => (
              <li key={i}>
                Row {e.row_index + 1}, {e.column}: {e.message}
              </li>
            ))}
            {errors.length > 5 ? (
              <li>…and {errors.length - 5} more.</li>
            ) : null}
          </ul>
        </div>
      ) : null}

      <div
        ref={scrollRef}
        className="relative max-h-[60vh] overflow-auto rounded-md border border-border"
      >
        <div
          className="grid sticky top-0 z-10 border-b border-border bg-surface-alt"
          style={{ gridTemplateColumns: gridTemplate(visibleColumns) }}
        >
          <div className="px-3 py-2 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
            #
          </div>
          <div className="px-3 py-2 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
            ●
          </div>
          {visibleColumns.map((col) => (
            <div
              key={col.key}
              className="px-3 py-2 text-[11px] font-mono uppercase tracking-wider text-muted-foreground"
            >
              {col.label}
              {col.required ? <span className="ml-1 text-primary">*</span> : null}
            </div>
          ))}
        </div>

        <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
          {rowVirtualizer.getVirtualItems().map((vrow) => {
            const rowIndex = vrow.index;
            const row = rows[rowIndex];
            const rowErrors = errorsByRow.get(rowIndex) ?? [];
            const isInvalid = rowErrors.length > 0;
            return (
              <div
                key={vrow.key}
                className="grid items-center border-b border-border text-sm"
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: ROW_HEIGHT,
                  transform: `translateY(${vrow.start}px)`,
                  gridTemplateColumns: gridTemplate(visibleColumns),
                }}
              >
                <div className="px-3 text-xs text-muted-foreground">{rowIndex + 1}</div>
                <div className="px-3">
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${
                      isInvalid ? "bg-destructive" : "bg-success"
                    }`}
                    title={isInvalid ? rowErrors.map((e) => e.message).join("; ") : "Valid"}
                  />
                </div>
                {visibleColumns.map((col) => {
                  const value = row[col.key];
                  const cellErr = rowErrors.find((e) => e.column === col.key);
                  return (
                    <div
                      key={col.key}
                      className={`truncate px-3 ${cellErr ? "ring-1 ring-inset ring-destructive" : ""}`}
                      title={cellErr?.message}
                    >
                      <CellEditor
                        value={value}
                        col={col}
                        instanceId={`${rowIndex}-${col.key}`}
                        onCommit={(next) => updateCell(rowIndex, col.key, next)}
                      />
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      <ColumnPickerDrawer
        open={pickerOpen}
        columns={config.columns}
        selectedKeys={columnKeys}
        onChange={onColumnKeysChange}
        onClose={() => setPickerOpen(false)}
      />
    </div>
  );
}

function gridTemplate(visibleColumns: ColumnSchema[]): string {
  return ["48px", "32px", ...visibleColumns.map(() => "minmax(140px, 1fr)")].join(" ");
}
