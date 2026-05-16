import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { IconExt } from "@/components/icons/HQIcons";
import {
  loadOutlookEntriesForYear,
  type OutlookConfidence,
  type OutlookEntry,
} from "@/lib/outlook/queries";

/**
 * Phase 5.3 wiring of the admin Home Outlook condensed card (spec § 4c).
 *
 * Reads `outlook_entries` for the current year (RLS gates standard /
 * freelance out; the card itself is only rendered for admins via Home's
 * tier gate). Groups by month; each month cell shows up to 2 entries plus
 * a "+N more" if there are more. Click on a cell routes to /outlook with
 * the year + month preselected.
 */

const MONTH_LABELS = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

function confidenceColor(c: OutlookConfidence): string {
  switch (c) {
    case "On Radar":  return "hsl(var(--warn))";
    case "Likely":    return "hsl(var(--info))";
    case "Confirmed": return "hsl(var(--success))";
    case "Complete":  return "hsl(var(--border-strong))";
  }
}

export function OutlookCondensedCard() {
  const navigate = useNavigate();
  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth(); // 0-based

  const { data } = useQuery({
    queryKey: ["outlook-entries-condensed", currentYear],
    queryFn: () => loadOutlookEntriesForYear(currentYear),
  });

  const entriesByMonth = useMemo(() => {
    const map = new Map<number, OutlookEntry[]>();
    for (const e of data ?? []) {
      const arr = map.get(e.month) ?? [];
      arr.push(e);
      map.set(e.month, arr);
    }
    return map;
  }, [data]);

  return (
    <div className="hq-card">
      <div className="hq-card-headbar">
        <span className="h-card">Outlook · {currentYear}</span>
        <Link to="/outlook" className="hq-tlink">
          Expand <IconExt className="h-[14px] w-[14px]" />
        </Link>
      </div>
      <div className="hq-card-pad">
        <div className="grid grid-cols-4 gap-2">
          {MONTH_LABELS.map((label, i) => {
            const monthNum = i + 1;
            const monthEntries = entriesByMonth.get(monthNum) ?? [];
            const extra = Math.max(0, monthEntries.length - 2);
            return (
              <button
                key={label}
                type="button"
                className={`hq-ol-cell ${i === currentMonth ? "hq-ol-cell--current" : ""}`}
                style={{
                  textAlign: "left",
                  background: "transparent",
                  cursor: "pointer",
                }}
                onClick={() =>
                  navigate(
                    `/outlook?year=${currentYear}&month=${String(monthNum).padStart(2, "0")}`,
                  )
                }
              >
                <div className="hq-ol-cell-mn">{label}</div>
                {monthEntries.slice(0, 2).map((e) => {
                  const title = e.clientName
                    ? `${e.clientName} · ${e.name}`
                    : e.name;
                  return (
                    <div
                      key={e.id}
                      className="hq-ol-entry"
                      style={{
                        borderLeft: `2px solid ${confidenceColor(e.confidence)}`,
                      }}
                    >
                      <div
                        className="hq-ol-entry-nm"
                        style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                      >
                        {title}
                      </div>
                      <div
                        className="hq-ol-cell-mn"
                        style={{
                          fontSize: 9.5,
                          color: "hsl(var(--subtle-foreground))",
                        }}
                      >
                        {label} · W{e.week}
                      </div>
                    </div>
                  );
                })}
                {extra > 0 ? (
                  <div
                    className="hq-ol-cell-mn"
                    style={{
                      fontSize: 9.5,
                      color: "hsl(var(--subtle-foreground))",
                      marginTop: 2,
                    }}
                  >
                    +{extra} more
                  </div>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
