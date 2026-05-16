/**
 * Date helpers shared by Phase 5.2.1 list / detail pages.
 *
 * All HQ Core date columns are `date` (no time-of-day). Calendar math
 * stays in local time per the My Week strip convention from Phase 5.1.
 */

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export function parseIso(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
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
