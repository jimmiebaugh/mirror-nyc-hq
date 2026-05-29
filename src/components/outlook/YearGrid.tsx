import { useMemo } from "react";
import type { OutlookEntry, OutlookConfidence } from "@/lib/outlook/queries";

/**
 * Outlook 12-month grid (Phase 5.3 spec § 4b, Surface 16 wireframe).
 *
 * Renders the wireframe-canonical `.olgrid > .ol-head + .ol-row > .ol-mn +
 * .ol-cell > .ol-ev` DOM. CSS lifted to src/index.css under the Phase 5.3
 * block. Confidence-color modifier classes follow locked-decisions § 4
 * mapping (NOT the wireframe CSS): On Radar = amber (.ol-rad), Likely =
 * cyan (.ol-like), Confirmed = green (.ol-conf), Complete = gray
 * (.ol-comp).
 */

const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function confidenceClass(c: OutlookConfidence): string {
  switch (c) {
    case "On Radar":  return "ol-rad";
    case "Likely":    return "ol-like";
    case "Confirmed": return "ol-conf";
    case "Complete":  return "ol-comp";
  }
}

function formatBudget(b: number | null): string {
  if (b == null) return "TBD";
  if (b >= 1_000_000) {
    const m = b / 1_000_000;
    // 10M+ rounds to whole number; below that keeps up to two decimals and
    // strips trailing zeros (+ the dot when both decimals strip), so
    // $1,000,000 → $1M, $1,250,000 → $1.25M, $1,500,000 → $1.5M.
    const formatted =
      m >= 10 ? m.toFixed(0) : m.toFixed(2).replace(/\.?0+$/, "");
    return `$${formatted}M`;
  }
  if (b >= 1000) return `$${Math.round(b / 1000)}k`;
  return `$${b}`;
}

export function OutlookYearGrid({
  entries,
  selectedEntryId,
  onSelectEntry,
}: {
  entries: OutlookEntry[];
  selectedEntryId: string | null;
  // Accepted for parent-contract parity (OutlookPage passes entriesQuery
  // .isLoading) but unused since Phase 6.5 (G6/#52) removed the no-op
  // loading ternary; the grid renders entries as they arrive.
  loading?: boolean;
  onSelectEntry: (id: string) => void;
}) {
  const byMonthWeek = useMemo(() => {
    const map = new Map<string, OutlookEntry[]>();
    for (const e of entries) {
      const key = `${e.month}-${e.week}`;
      const arr = map.get(key) ?? [];
      arr.push(e);
      map.set(key, arr);
    }
    return map;
  }, [entries]);

  return (
    <div className="olgrid">
      <div className="ol-head">
        <div>Month</div>
        <div>Week 1</div>
        <div>Week 2</div>
        <div>Week 3</div>
        <div>Week 4</div>
      </div>
      {MONTH_SHORT.map((m, idx) => (
        <div key={m} className="ol-row">
          <div className="ol-mn">{m}</div>
          {[1, 2, 3, 4].map((week) => {
            const cellEntries = byMonthWeek.get(`${idx + 1}-${week}`) ?? [];
            return (
              <div key={week} className="ol-cell">
                {cellEntries.map((entry) => {
                  const isSelected = entry.id === selectedEntryId;
                  const title = entry.clientName
                    ? `${entry.clientName} · ${entry.name}`
                    : entry.name;
                  const metaParts = [
                    entry.city,
                    entry.dateText ?? `${m} W${week}`,
                    formatBudget(entry.budget),
                  ].filter(Boolean);
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      className={`ol-ev ${confidenceClass(entry.confidence)}`}
                      onClick={() => onSelectEntry(entry.id)}
                      style={
                        isSelected
                          ? { outline: "1px solid hsl(var(--primary))" }
                          : undefined
                      }
                    >
                      <span className="en">{title}</span>
                      <span className="em">{metaParts.join(" · ")}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
