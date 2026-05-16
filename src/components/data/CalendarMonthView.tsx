import { useState, type ReactNode } from "react";

/**
 * Month-grid calendar for the Deliverables default view (Surface 14).
 * Wireframe-fidelity rebuild (Phase 5.2.1 Revision); renders the
 * `.calgrid > .caldow + .calcell > .cal-ev.<kind> > .en + .ek` structure
 * from OUTPUTS/phase-5-hq-wireframe-v1-LOCKED.html Surface 14 (lines
 * 2370+).
 *
 * Banner kinds (`.in / .live / .rem / .del`) map per spec § 2.G:
 *   Complete    -> .del   (success green)
 *   In Progress -> .in    (info cyan)
 *   Upcoming    -> .rem   (amber)
 *   Skipped     -> plain  (strike rendered via `strikethrough: true`)
 */

export type CalendarEventKind = "in" | "live" | "rem" | "del" | "plain";

export type CalendarEvent = {
  id: string;
  dateIso: string;
  projectTitle: string;
  title: string;
  kind: CalendarEventKind;
  strikethrough?: boolean;
};

const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEK_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function startOfMonth(year: number, month: number): Date {
  return new Date(year, month, 1);
}

function buildCells(year: number, month: number) {
  const first = startOfMonth(year, month);
  // Sunday-first per the wireframe column order.
  const offset = first.getDay();
  const cells: { date: Date; outOfMonth: boolean }[] = [];
  const startDate = new Date(year, month, 1 - offset);
  for (let i = 0; i < 42; i++) {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + i);
    cells.push({ date: d, outOfMonth: d.getMonth() !== month });
  }
  return cells;
}

function isoOf(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function CalendarMonthView({
  events,
  onEventClick,
  toolbarRight,
}: {
  events: CalendarEvent[];
  onEventClick?: (event: CalendarEvent) => void;
  toolbarRight?: ReactNode;
}) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());

  const cells = buildCells(year, month);
  const eventsByDay = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const arr = eventsByDay.get(e.dateIso) ?? [];
    arr.push(e);
    eventsByDay.set(e.dateIso, arr);
  }

  const goPrev = () => {
    if (month === 0) {
      setYear((y) => y - 1);
      setMonth(11);
    } else {
      setMonth((m) => m - 1);
    }
  };
  const goNext = () => {
    if (month === 11) {
      setYear((y) => y + 1);
      setMonth(0);
    } else {
      setMonth((m) => m + 1);
    }
  };

  const todayIso = isoOf(today);

  return (
    <div className="stack-3">
      <div className="row between" style={{ alignItems: "center" }}>
        <div className="row-c">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={goPrev}
            aria-label="Previous month"
          >
            ←
          </button>
          <div className="h-page" style={{ fontSize: 20, margin: 0 }}>
            {MONTH_LABELS[month]} {year}
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={goNext}
            aria-label="Next month"
          >
            →
          </button>
        </div>
        {toolbarRight}
      </div>
      <div>
        <div className="calgrid">
          {WEEK_DAYS.map((d) => (
            <div key={d} className="caldow">{d}</div>
          ))}
          {cells.map((c, i) => {
            const iso = isoOf(c.date);
            const list = eventsByDay.get(iso) ?? [];
            const isToday = iso === todayIso;
            return (
              <div
                key={i}
                className={`calcell ${c.outOfMonth ? "calcell--off" : ""} ${isToday ? "calcell--today" : ""}`}
              >
                <div className="dn">{c.date.getDate()}</div>
                {list.slice(0, 3).map((ev) => (
                  <div
                    key={ev.id}
                    className={`cal-ev ${ev.kind === "plain" ? "" : ev.kind}`}
                    onClick={() => onEventClick?.(ev)}
                  >
                    <span
                      className="en"
                      style={ev.strikethrough ? { textDecoration: "line-through", opacity: 0.6 } : undefined}
                    >
                      {ev.projectTitle}
                    </span>
                    <span
                      className="ek"
                      style={ev.strikethrough ? { textDecoration: "line-through", opacity: 0.6 } : undefined}
                    >
                      {ev.title}
                    </span>
                  </div>
                ))}
                {list.length > 3 ? (
                  <div className="cap" style={{ marginTop: 3 }}>
                    +{list.length - 3} more
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
