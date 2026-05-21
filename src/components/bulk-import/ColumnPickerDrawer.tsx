import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { ColumnSchema, ColumnSection } from "@/lib/hq/bulkImport/types";

const SECTION_ORDER: ColumnSection[] = [
  "Required",
  "Essentials",
  "Dates & Phases",
  "References",
  "Folders & Links",
  "Notes",
];

export function ColumnPickerDrawer({
  open,
  columns,
  selectedKeys,
  onChange,
  onClose,
}: {
  open: boolean;
  columns: ColumnSchema[];
  selectedKeys: string[];
  onChange: (next: string[]) => void;
  onClose: () => void;
}) {
  const grouped = useMemo(() => {
    const map = new Map<ColumnSection, ColumnSchema[]>();
    for (const col of columns) {
      const list = map.get(col.section) ?? [];
      list.push(col);
      map.set(col.section, list);
    }
    return map;
  }, [columns]);

  if (!open) return null;

  const toggle = (key: string, on: boolean) => {
    if (on) {
      if (!selectedKeys.includes(key)) onChange([...selectedKeys, key]);
    } else {
      onChange(selectedKeys.filter((k) => k !== key));
    }
  };

  return (
    <div
      className="fixed inset-0 z-30 bg-black/60"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside
        className="absolute right-0 top-0 flex h-full w-[360px] flex-col overflow-y-auto border-l border-border bg-background p-6"
        role="dialog"
        aria-label="Column picker"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="h-card">Columns</h2>
          <Button variant="ghost" type="button" onClick={onClose}>
            Done
          </Button>
        </div>

        <div className="space-y-5">
          {SECTION_ORDER.map((section) => {
            const cols = grouped.get(section);
            if (!cols || cols.length === 0) return null;
            return (
              <div key={section}>
                <div className="mb-2 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                  {section}
                </div>
                <ul className="space-y-2">
                  {cols.map((col) => {
                    const id = `colpicker-${col.key}`;
                    const checked = selectedKeys.includes(col.key);
                    const locked = col.required;
                    return (
                      <li key={col.key} className="flex items-center gap-2">
                        <Checkbox
                          id={id}
                          checked={checked || locked}
                          disabled={locked}
                          onCheckedChange={(v) => toggle(col.key, !!v)}
                        />
                        <label htmlFor={id} className="text-sm">
                          {col.label}
                          {locked ? (
                            <span className="ml-1 text-xs text-muted-foreground">(required)</span>
                          ) : null}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      </aside>
    </div>
  );
}
