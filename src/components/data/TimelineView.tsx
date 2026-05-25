import type { ReactNode } from "react";

/**
 * 8-month gantt view for Projects Timeline (Surface 06). Wireframe-fidelity
 * rebuild (Phase 5.2.1 Revision); renders the `.tl > .tl-head + .tl-row >
 * .tl-name + .tl-track > .tl-bar` structure from
 * OUTPUTS/phase-5-hq-wireframe-v1-LOCKED.html lines 1264-1311.
 *
 * Row left border colored by status token (`rb-<token>` -> inline
 * border-left-color since the wireframe uses an inline style). Bar colors:
 * Install = info cyan, Live = primary coral, Removal = warn amber.
 */

import type { StatusToken } from "@/lib/home/projectStatusToken";

export type TimelineBar = {
  kind: "install" | "live" | "removal";
  startIso: string;
  endIso?: string | null;
  label?: string;
};

export type TimelineRow = {
  id: string;
  /** Title cell content (project name + sub line). */
  name: ReactNode;
  subText?: string;
  bars: TimelineBar[];
  token?: StatusToken;
};

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const BAR_COLOR: Record<TimelineBar["kind"], string> = {
  install: "hsl(var(--info))",
  live: "hsl(var(--primary))",
  removal: "hsl(var(--warn))",
};

const TOKEN_BORDER: Record<StatusToken, string> = {
  info: "hsl(var(--info))",
  success: "hsl(var(--success))",
  warn: "hsl(var(--warn))",
  destructive: "hsl(var(--destructive))",
  muted: "hsl(var(--border-strong))",
};

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
function diffDays(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}
function parseIso(iso: string): Date | null {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
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
  const slots = Array.from({ length: 8 }, (_, i) => addMonths(axisStart, i));

  const positionFor = (startIso: string, endIso?: string | null) => {
    const start = parseIso(startIso);
    if (!start) return null;
    const end = endIso ? parseIso(endIso) ?? start : start;
    if (end < axisStart || start > axisEnd) return null;
    const cs = start < axisStart ? axisStart : start;
    const ce = end > axisEnd ? axisEnd : end;
    const offsetDays = diffDays(axisStart, cs);
    const widthDays = Math.max(1, diffDays(cs, ce));
    return {
      left: `${(offsetDays / totalDays) * 100}%`,
      width: `${(widthDays / totalDays) * 100}%`,
    };
  };

  if (rows.length === 0) {
    return (
      <div className="empty">
        <p>No projects with dated milestones in the next 8 months.</p>
      </div>
    );
  }

  return (
    <div className="tl">
      <div className="tl-head">
        <div>Project</div>
        {slots.map((m) => (
          <div key={m.toISOString()}>{MONTHS[m.getMonth()]}</div>
        ))}
      </div>
      {rows.map((row) => (
        <div
          key={row.id}
          className="tl-row"
          onClick={() => onBarClick?.(row.id)}
        >
          <div
            className="tl-name"
            style={{
              borderLeftColor: row.token ? TOKEN_BORDER[row.token] : "transparent",
            }}
          >
            {row.name}
            {row.subText ? <div className="sub">{row.subText}</div> : null}
          </div>
          <div className="tl-track">
            <div className="tl-grid-lines">
              {slots.map((m, i) => (
                <span key={i} style={i === 0 ? { borderLeft: "none" } : undefined} />
              ))}
            </div>
            {row.bars.map((bar, i) => {
              const pos = positionFor(bar.startIso, bar.endIso);
              if (!pos) return null;
              return (
                <div
                  key={`${row.id}-${i}`}
                  className="tl-bar"
                  style={{ ...pos, background: BAR_COLOR[bar.kind] }}
                >
                  {bar.label ?? bar.kind.toUpperCase()}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
