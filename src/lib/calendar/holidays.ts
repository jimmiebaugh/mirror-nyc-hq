/**
 * Mirror NYC Holiday Calendar 2026 (+ 2027 stubs).
 *
 * Sourced from the official 2026 PDF (`uploads/Holiday Schedule 2026.pdf`).
 * Multi-day Christmas / New Year's window expanded into one entry per non-
 * weekend closed day so the Calendar renders a banner on every closed day.
 *
 * 5.4 will ship a Settings-page CRUD editor against this list; until then
 * this constant is the source of truth and the Calendar reads it directly.
 */

export type MirrorHoliday = {
  /** YYYY-MM-DD. */
  dateIso: string;
  label: string;
};

export const MIRROR_HOLIDAYS: MirrorHoliday[] = [
  // 2026
  { dateIso: "2026-01-01", label: "New Year's Day" },
  { dateIso: "2026-01-19", label: "MLK Jr. Day" },
  { dateIso: "2026-02-16", label: "Presidents Day" },
  { dateIso: "2026-05-22", label: "Memorial Day (observed)" },
  { dateIso: "2026-05-25", label: "Memorial Day" },
  { dateIso: "2026-06-19", label: "Juneteenth" },
  { dateIso: "2026-07-03", label: "Fourth of July (observed)" },
  { dateIso: "2026-09-04", label: "Labor Day (observed)" },
  { dateIso: "2026-09-07", label: "Labor Day" },
  { dateIso: "2026-11-26", label: "Thanksgiving" },
  { dateIso: "2026-11-27", label: "Day after Thanksgiving" },
  // Christmas / New Year's Holiday: Thu Dec 24 -> Fri Jan 1
  // (Dec 26 + 27 = weekend, skipped; Jan 2 onward = back to work).
  { dateIso: "2026-12-24", label: "Christmas / New Year's Holiday" },
  { dateIso: "2026-12-25", label: "Christmas / New Year's Holiday" },
  { dateIso: "2026-12-28", label: "Christmas / New Year's Holiday" },
  { dateIso: "2026-12-29", label: "Christmas / New Year's Holiday" },
  { dateIso: "2026-12-30", label: "Christmas / New Year's Holiday" },
  { dateIso: "2026-12-31", label: "Christmas / New Year's Holiday" },
  { dateIso: "2027-01-01", label: "Christmas / New Year's Holiday" },
  // 2027 single-day stubs seeded so early 2027 planning isn't blank;
  // extend in 5.4 Settings editor when the 2027 PDF is published.
];
