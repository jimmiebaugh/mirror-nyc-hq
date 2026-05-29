/**
 * Date helpers shared by Phase 5.2.1 list / detail pages.
 *
 * All HQ Core date columns are `date` (no time-of-day). Calendar math
 * stays in local time per the My Week strip convention from Phase 5.1.
 */

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const WEEKDAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

/**
 * Phase 5.7.9 Calendar Week-view helper. Returns the Sunday of the week
 * containing `d` at local midnight. Sunday-first matches the existing
 * CalendarMonthView column order.
 */
export function startOfWeek(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setDate(out.getDate() - out.getDay());
  return out;
}

/** Phase 5.7.9: add `days` (can be negative) to a Date, returning a new Date. */
export function addDays(d: Date, days: number): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setDate(out.getDate() + days);
  return out;
}

/** Phase 5.7.9: add `months` to a Date, snapping to day 1 of the result month. */
export function addMonths(d: Date, months: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + months, 1);
}

export function parseIso(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function weekdayName(iso: string | null | undefined): string {
  const d = parseIso(iso);
  if (!d) return "";
  return WEEKDAYS[d.getDay()];
}

export function formatShortDate(iso: string | null | undefined): string {
  const d = parseIso(iso);
  if (!d) return "";
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

export function formatMediumDate(iso: string | null | undefined): string {
  const d = parseIso(iso);
  if (!d) return "";
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export function daysUntil(iso: string | null | undefined): number | null {
  const d = parseIso(iso);
  if (!d) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

export function relativeDay(iso: string | null | undefined): string {
  const n = daysUntil(iso);
  if (n === null) return "";
  if (n === 0) return "Today";
  if (n === 1) return "Tomorrow";
  if (n === -1) return "Yesterday";
  if (n > 0) return `In ${n} day${n === 1 ? "" : "s"}`;
  return `${Math.abs(n)} day${Math.abs(n) === 1 ? "" : "s"} ago`;
}

export function formatDateRange(start: string | null | undefined, end: string | null | undefined): string {
  if (!start && !end) return "";
  if (start && !end) return formatShortDate(start);
  if (!start && end) return formatShortDate(end);
  return `${formatShortDate(start)} to ${formatShortDate(end)}`;
}

/**
 * Phase 5.7.5: title-cased relative date label for deliverable surfaces.
 * Returns "Due In 9 Days" / "Due Today" / "Due Yesterday" / "Due 3 Days Ago"
 * for non-complete deliverables, or "Completed 4 Days Ago" / "Completed Today"
 * when status === "Complete" and completedAt is set. Falls back to "" when
 * dueDate is null (and not yet complete).
 */
export function deliverableDueLabel({
  dueDate,
  status,
  completedAt,
}: {
  dueDate: string | null;
  status: "Upcoming" | "Complete" | "Skipped";
  completedAt: string | null;
}): string {
  if (status === "Complete" && completedAt) {
    const n = daysUntil(completedAt.slice(0, 10));
    if (n === null) return "";
    if (n === 0) return "Completed Today";
    if (n === -1) return "Completed Yesterday";
    if (n < 0) return `Completed ${Math.abs(n)} Day${Math.abs(n) === 1 ? "" : "s"} Ago`;
    // Future completed_at (shouldn't happen): treat as today.
    return "Completed Today";
  }
  if (!dueDate) return "";
  const n = daysUntil(dueDate);
  if (n === null) return "";
  if (n === 0) return "Due Today";
  if (n === 1) return "Due Tomorrow";
  if (n === -1) return "Due Yesterday";
  // "Due In X Days on Thursday" for any future-due day past tomorrow;
  // past-due reads "Due X Days Ago" with no weekday suffix.
  if (n > 0) return `Due In ${n} Days on ${weekdayName(dueDate)}`;
  return `Due ${Math.abs(n)} Day${Math.abs(n) === 1 ? "" : "s"} Ago`;
}
