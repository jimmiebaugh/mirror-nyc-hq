/**
 * 8-month gantt view for the Projects Timeline surface.
 *
 * Spec: § 5.A.3. Rows are projects; bars are Install / Live / Removal,
 * drawn proportionally across an 8-month axis (current month + 7 forward).
 * Bars click into the project detail. Per build notes Surface 06, projects
 * with NO dated milestones are hidden from this view (filtered upstream).
 *
 * The component is generic enough to be reused for Venues if a similar
 * gantt lands later; for now Projects is the only consumer.
 */

import type { ReactNode } from "react";

export type TimelineBar = {
  kind: "install" | "live" | "removal";
  startIso: string;
  endIso?: string | null;
  label?: string;
};

export type TimelineRow = {
  id: string;
  label: ReactNode;
  bars: TimelineBar[];
  /** Optional left-border token to surface row status colour. */
  token?: "info" | "success" | "warn" | "destructive" | "muted";
};

const LABEL_COL_PX = 220;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, d.getDate());
}

function diffDays(a: Date, b: Date): number {
  const ms = b.getTime() - a.getTime();
  return Math.round(ms / 86400000);
}

export function TimelineView({
  rows,
  onBarClick,
}: {
  rows: TimelineRow[];
  onBarClick?: (rowId: string) => void;
}) {
  const today = new Date();
  const axisStart = startOfMonth(today);
  const axisEnd = addMonths(axisStart, 8);
  const totalDays = diffDays(axisStart, axisEnd);

  const monthSlots = Array.from({ length: 8 }, (_, i) => addMonths(axisStart, i));

  const positionForRange = (startIso: string, endIso?: string | null) => {
    const [sy, sm, sd] = startIso.split("-").map(Number);
    const start = new Date(sy, sm - 1, sd);
    let end: Date;
    if (endIso) {
      const [ey, em, ed] = endIso.split("-").map(Number);
      end = new Date(ey, em - 1, ed);
    } else {
      end = start;
    }
    if (end < axisStart || start > axisEnd) return null;
    const clampedStart = start < axisStart ? axisStart : start;
    const clampedEnd = end > axisEnd ? axisEnd : end;
    const offsetDays = diffDays(axisStart, clampedStart);
    const widthDays = Math.max(1, diffDays(clampedStart, clampedEnd));
    return {
      left: `calc(${LABEL_COL_PX}px + ${(offsetDays / totalDays) * 100}% - ${(LABEL_COL_PX * offsetDays) / totalDays}px)`,
      width: `calc(${(widthDays / totalDays) * 100}% - ${(LABEL_COL_PX * widthDays) / totalDays}px)`,
    };
  };

  const axisTemplate = `${LABEL_COL_PX}px repeat(8, 1fr)`;

  return (
    <div className="hq-timeline">
      <div className="hq-timeline-axis" style={{ gridTemplateColumns: axisTemplate }}>
        <div />
        {monthSlots.map((m) => (
          <div key={m.toISOString()}>{MONTHS[m.getMonth()]} {String(m.getFullYear()).slice(-2)}</div>
        ))}
      </div>
      {rows.length === 0 ? (
        <div className="hq-dt-empty">
          <p className="text-sm">No projects with dated milestones.</p>
        </div>
      ) : (
        rows.map((row) => (
          <div
            key={row.id}
            className="hq-timeline-row"
            data-row-token={row.token}
            style={{ gridTemplateColumns: axisTemplate }}
            onClick={() => onBarClick?.(row.id)}
          >
            <div className="hq-timeline-rowlbl">{row.label}</div>
            {row.bars.map((bar, i) => {
              const pos = positionForRange(bar.startIso, bar.endIso);
              if (!pos) return null;
              return (
                <div
                  key={`${row.id}-${i}`}
                  className={`hq-timeline-bar hq-timeline-bar--${bar.kind}`}
                  style={pos}
                >
                  {bar.label ?? bar.kind.toUpperCase()}
                </div>
              );
            })}
          </div>
        ))
      )}
      <div className="flex items-center justify-end gap-3 px-3 py-2 text-[10px] font-mono uppercase tracking-widest text-[hsl(var(--subtle-foreground))]">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: "#06B6D4" }} /> Install
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: "hsl(var(--primary))" }} /> Live
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: "hsl(var(--warn))" }} /> Removal
        </span>
      </div>
    </div>
  );
}
