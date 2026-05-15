import { useState, type ReactNode } from "react";
import type { StatusToken } from "@/lib/home/projectStatusToken";

/**
 * Month-grid calendar for the Deliverables default view (Surface 14).
 *
 * Spec: § 5.C.1. Cells need min-height 140px to fit up to three two-row
 * banners (project title + deliverable title). Banner click routes via
 * onEventClick. Skipped deliverables render strikethrough + opacity-60.
 */

export type CalendarEvent = {
  id: string;
  dateIso: string;
  projectTitle: string;
  title: string;
  token: StatusToken;
  strikethrough?: boolean;
};

const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEK_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function startOfMonth(year: number, month: number): Date {
  return new Date(year, month, 1);
}

function buildCells(year: number, month: number) {
  const first = startOfMonth(year, month);
  // Monday = 0 .. Sunday = 6.
  const offset = (first.getDay() + 6) % 7;
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
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="hq-savedview-btn"
            onClick={goPrev}
            aria-label="Previous month"
          >
            ←
          </button>
          <div className="font-display text-[20px] uppercase">
            {MONTH_LABELS[month]} {year}
          </div>
          <button
            type="button"
            className="hq-savedview-btn"
            onClick={goNext}
            aria-label="Next month"
          >
            →
          </button>
        </div>
        {toolbarRight}
      </div>
      <div className="hq-calendar">
        <div className="hq-calendar-head">
          {WEEK_DAYS.map((d) => (
            <div key={d}>{d}</div>
          ))}
        </div>
        <div className="hq-calendar-grid">
          {cells.map((c, i) => {
            const iso = isoOf(c.date);
            const list = eventsByDay.get(iso) ?? [];
            return (
              <div
                key={i}
                className={`hq-calendar-cell ${c.outOfMonth ? "hq-calendar-cell--out" : ""}`}
              >
                <div
                  className={`hq-calendar-daynum ${iso === todayIso ? "hq-calendar-daynum--today" : ""}`}
                >
                  {c.date.getDate()}
                </div>
                {list.slice(0, 3).map((ev) => (
                  <div
                    key={ev.id}
                    className={`hq-calendar-event ${ev.strikethrough ? "hq-calendar-event--strike" : ""}`}
                    data-token={ev.token}
                    onClick={() => onEventClick?.(ev)}
                  >
                    <div className="hq-calendar-event-project">{ev.projectTitle}</div>
                    <div className="hq-calendar-event-title">{ev.title}</div>
                  </div>
                ))}
                {list.length > 3 ? (
                  <div className="text-[10px] text-[hsl(var(--subtle-foreground))]">
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
