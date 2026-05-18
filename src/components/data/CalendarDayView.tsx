import type { CalendarEvent } from "@/components/data/CalendarMonthView";

/**
 * Phase 5.7.9 §9.E Day view. Renders the active date as a vertical list
 * of `.cal-ev--row` items lifting the `.cal-ev.<kind>` palette so the
 * banner colors stay consistent with the Month grid. No hour grid per
 * plan decision #12.
 */

const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEK_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function isoOf(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function CalendarDayView({
  events,
  date,
  onEventClick,
}: {
  events: CalendarEvent[];
  date: Date;
  onEventClick?: (event: CalendarEvent) => void;
}) {
  const dateIso = isoOf(date);
  const dayEvents = events.filter((e) => e.dateIso === dateIso);

  return (
    <div className="stack-3">
      <div className="h-card" style={{ fontSize: 14 }}>
        {WEEK_DAYS[date.getDay()]}, {MONTH_LABELS[date.getMonth()]}{" "}
        {date.getDate()}, {date.getFullYear()}
      </div>
      {dayEvents.length === 0 ? (
        <div
          className="empty"
          style={{
            border: "1px dashed hsl(var(--border-strong))",
            borderRadius: "var(--radius)",
            padding: "32px 16px",
            textAlign: "center",
            color: "hsl(var(--muted-foreground))",
            fontSize: 13,
          }}
        >
          Nothing scheduled for {MONTH_LABELS[date.getMonth()]} {date.getDate()}.
        </div>
      ) : (
        <div className="caldayview">
          {dayEvents.map((ev) => (
            <div
              key={ev.id}
              className={`cal-ev cal-ev--row ${ev.kind === "plain" ? "" : ev.kind}`}
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
                · {ev.title}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
