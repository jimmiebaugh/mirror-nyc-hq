/**
 * Phase 5.1 week-window helpers for the Home `My Week` strip.
 *
 * Week starts Monday and ends Sunday (per spec § 7c). All boundaries are
 * computed in the browser's local timezone so a producer in NYC sees the
 * "Mon-Sun" window they'd expect; the underlying date columns in `projects`
 * are `date`-typed (no time component), so we compare YYYY-MM-DD strings.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function toIsoDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function currentWeekWindow(now: Date = new Date()): { mondayIso: string; sundayIso: string; monday: Date; sunday: Date } {
  const today = startOfDay(now);
  const dow = today.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
  const offsetToMonday = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(today.getTime() + offsetToMonday * DAY_MS);
  const sunday = new Date(monday.getTime() + 6 * DAY_MS);
  return {
    mondayIso: toIsoDate(monday),
    sundayIso: toIsoDate(sunday),
    monday,
    sunday,
  };
}

const DOW_LABEL = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const MONTH_LABEL = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export function formatWeekcardDate(iso: string): string {
  // Parse a YYYY-MM-DD as local date to avoid TZ drift.
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return `${DOW_LABEL[dt.getDay()]} ${MONTH_LABEL[dt.getMonth()]} ${dt.getDate()}`;
}

export function formatRangeLabel(start: Date, end: Date): string {
  const sameMonth = start.getMonth() === end.getMonth();
  const startStr = `${MONTH_LABEL[start.getMonth()]} ${start.getDate()}`;
  const endStr = sameMonth ? `${end.getDate()}` : `${MONTH_LABEL[end.getMonth()]} ${end.getDate()}`;
  return `${startStr} to ${endStr}`;
}