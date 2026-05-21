import { useMemo, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import type { DedupeMatch, EntityConfig, ResolvedRow } from "@/lib/hq/bulkImport/types";

type DedupeAction = DedupeMatch["action"];

export function DedupeStep({
  config,
  rows,
  matches,
  decisions,
  onChange,
}: {
  config: EntityConfig;
  rows: ResolvedRow[];
  matches: DedupeMatch[];
  decisions: DedupeMatch[];
  onChange: (next: DedupeMatch[]) => void;
}) {
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(
    matches[0]?.row_index ?? null,
  );

  const decisionByRow = useMemo(() => {
    const map = new Map<number, DedupeMatch>();
    for (const d of decisions) map.set(d.row_index, d);
    return map;
  }, [decisions]);

  if (matches.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border py-12 text-center">
        <p className="text-sm text-muted-foreground">No duplicates found.</p>
      </div>
    );
  }

  const setAction = (rowIndex: number, action: DedupeAction) => {
    const next = decisions.map((d) =>
      d.row_index === rowIndex ? { ...d, action } : d,
    );
    onChange(next);
  };

  const setAll = (action: DedupeAction) => {
    onChange(decisions.map((d) => ({ ...d, action })));
  };

  const skips = decisions.filter((d) => d.action === "skip").length;
  const updates = decisions.filter((d) => d.action === "update").length;
  const creates = decisions.filter((d) => d.action === "create").length;
  const commitCount = rows.length - skips;

  const selected = matches.find((m) => m.row_index === selectedRowIndex) ?? null;
  const selectedRow = selected ? rows.find((r) => r.row_index === selected.row_index) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          {matches.length} potential duplicate{matches.length === 1 ? "" : "s"} found in {config.displayName.toLowerCase()}.
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
            Apply to all
          </Label>
          <Select onValueChange={(v) => setAll(v as DedupeAction)}>
            <SelectTrigger className="h-9 w-[140px]">
              <SelectValue placeholder="Bulk set…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="skip">Skip duplicate</SelectItem>
              <SelectItem value="update">Update existing</SelectItem>
              <SelectItem value="create">Create anyway</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="overflow-hidden rounded-md border border-border">
          <div className="border-b border-border bg-surface-alt px-3 py-2 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
            CSV row · matched existing
          </div>
          <ul className="divide-y divide-border">
            {matches.map((m) => {
              const decision = decisionByRow.get(m.row_index) ?? m;
              const isSelected = selectedRowIndex === m.row_index;
              return (
                <li
                  key={m.row_index}
                  className={`cursor-pointer px-3 py-3 ${
                    isSelected ? "bg-primary/10" : "hover:bg-muted/40"
                  }`}
                  onClick={() => setSelectedRowIndex(m.row_index)}
                >
                  <div className="text-xs text-muted-foreground">Row {m.row_index + 1}</div>
                  <div className="text-sm font-medium">{m.match_label}</div>
                  <div className="mt-2">
                    <RadioGroup
                      value={decision.action}
                      onValueChange={(v) => setAction(m.row_index, v as DedupeAction)}
                      className="flex gap-3"
                    >
                      <RadioOpt id={`skip-${m.row_index}`} value="skip" label="Skip" />
                      <RadioOpt id={`update-${m.row_index}`} value="update" label="Update" />
                      <RadioOpt id={`create-${m.row_index}`} value="create" label="Create anyway" />
                    </RadioGroup>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="rounded-md border border-border bg-surface-alt p-4">
          <div className="border-b border-border pb-3 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
            Matched record preview
          </div>
          {selected && selectedRow ? (
            <div className="space-y-2 pt-3 text-sm">
              <div className="text-xs text-muted-foreground">Existing record</div>
              <div className="font-medium">{selected.match_label}</div>
              <div className="mt-3 text-xs text-muted-foreground">Incoming row {selected.row_index + 1}</div>
              <pre className="overflow-x-auto rounded-md bg-background p-2 text-xs">
                {JSON.stringify(selectedRow.values, null, 2)}
              </pre>
            </div>
          ) : (
            <p className="pt-3 text-sm text-muted-foreground">Select a row to preview.</p>
          )}
        </div>
      </div>

      <div className="text-sm">
        <span className="font-medium">{commitCount}</span> row{commitCount === 1 ? "" : "s"} will commit ·{" "}
        <span className="font-medium">{skips}</span> skipped · {updates} update · {creates} create-anyway.
      </div>
    </div>
  );
}

function RadioOpt({ id, value, label }: { id: string; value: string; label: string }) {
  return (
    <Label htmlFor={id} className="flex items-center gap-1.5 text-xs font-normal">
      <RadioGroupItem id={id} value={value} />
      {label}
    </Label>
  );
}
