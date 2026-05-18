import type { CalendarEvent } from "@/components/data/CalendarMonthView";

/**
 * Phase 5.7.9 §9.E Week view. 7-column Sun-Sat grid for the week containing
 * `weekStart`. Each column lists the day's events stacked vertically. No
 * hour rows per plan decision #12; this is the time-agnostic week view
 * that mirrors the Month grid's banner treatment.
 */

const WEEK_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function isoOf(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function CalendarWeekView({
  events,
  weekStart,
  onEventClick,
}: {
  events: CalendarEvent[];
  /** Sunday of the week to render (use `startOfWeek(d)` from lib/hq/dates). */
  weekStart: Date;
  onEventClick?: (event: CalendarEvent) => void;
}) {
  const cells: { date: Date; iso: string }[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(
      weekStart.getFullYear(),
      weekStart.getMonth(),
      weekStart.getDate() + i,
    );
    cells.push({ date: d, iso: isoOf(d) });
  }

  const eventsByDay = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const arr = eventsByDay.get(e.dateIso) ?? [];
    arr.push(e);
    eventsByDay.set(e.dateIso, arr);
  }

  const todayIso = isoOf(new Date());

  return (
    <div className="calweek">
      {cells.map((c) => {
        const dayEvents = eventsByDay.get(c.iso) ?? [];
        const isToday = c.iso === todayIso;
        return (
          <div
            key={c.iso}
            className={`calweekcol ${isToday ? "calweekcol--today" : ""}`}
          >
            <div className="dn">
              {WEEK_DAYS[c.date.getDay()]} {c.date.getDate()}
            </div>
            {dayEvents.map((ev) => (
              <div
                key={ev.id}
                className={`cal-ev ${ev.kind === "plain" ? "" : ev.kind}`}
                onClick={() => onEventClick?.(ev)}
              >
                <span
                  className="en"
                  style={
                    ev.strikethrough
                      ? { textDecoration: "line-through", opacity: 0.6 }
                      : undefined
                  }
                >
                  {ev.projectTitle}
                </span>
                <span
                  className="ek"
                  style={
                    ev.strikethrough
                      ? { textDecoration: "line-through", opacity: 0.6 }
                      : undefined
                  }
                >
                  {ev.title}
                </span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
