import { supabase } from "@/integrations/supabase/client";

/**
 * Calendar page data loaders (Phase 5.3 spec § 3c).
 *
 * Pulls Install / Live / Removal date ranges from projects, due dates from
 * deliverables, and shared Outlook entries (when applicable) for a given
 * month window. CalendarPage composes these into the
 * `CalendarMonthView`-shaped CalendarEvent[] via buildCalendarEvents
 * (kept inside CalendarPage so the filter / visibility / holidays mix lives
 * with the page state, not the data layer).
 */

export type CalendarProjectRow = {
  id: string;
  name: string;
  clientName: string | null;
  category: string | null;
  installStartIso: string | null;
  installEndIso: string | null;
  liveStartIso: string | null;
  liveEndIso: string | null;
  removalStartIso: string | null;
  removalEndIso: string | null;
  accountManagerIds: string[];
  accountManagerLabel: string | null;
};

export type CalendarDeliverableRow = {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  status: "Upcoming" | "Complete" | "Skipped";
  dueIso: string;
};

export type CalendarOutlookRow = {
  id: string;
  name: string;
  clientName: string | null;
  city: string | null;
  year: number;
  month: number;
  week: number;
  dateText: string | null;
  confidence: "On Radar" | "Likely" | "Confirmed" | "Complete";
  sharedWithTeam: boolean;
};

/**
 * Loads every project that has at least one of (install / live / removal)
 * range overlapping the window. The window is the entire active month plus
 * a one-month buffer either side so simple month-nav clicks don't trigger
 * a refetch.
 *
 * Filter: archived_at IS NULL. We don't filter by status here; the page
 * computes visibility per project (toggle + lead + category filters).
 */
export async function loadCalendarProjects(): Promise<CalendarProjectRow[]> {
  const { data, error } = await supabase
    .from("projects")
    .select(
      `id, name, category,
       install_dates_start, install_dates_end,
       live_dates_start, live_dates_end,
       removal_dates_start, removal_dates_end,
       client:clients(name),
       account_managers:project_account_managers(user:users(id, full_name, email))`,
    )
    .is("archived_at", null);
  if (error) {
    console.warn("loadCalendarProjects error", error);
    return [];
  }
  type Row = {
    id: string;
    name: string;
    category: string | null;
    install_dates_start: string | null;
    install_dates_end: string | null;
    live_dates_start: string | null;
    live_dates_end: string | null;
    removal_dates_start: string | null;
    removal_dates_end: string | null;
    client: { name: string | null } | null;
    account_managers:
      | { user: { id: string; full_name: string | null; email: string | null } | null }[]
      | null;
  };
  return ((data ?? []) as unknown as Row[]).map((p) => {
    const ams = (p.account_managers ?? []).map((j) => j.user).filter(Boolean);
    const firstAm = ams[0];
    const firstName = firstAm
      ? (firstAm.full_name?.trim().split(/\s+/)[0] ??
          firstAm.email?.split("@")[0].split(".")[0])
      : null;
    return {
      id: p.id,
      name: p.name,
      clientName: p.client?.name ?? null,
      category: p.category,
      installStartIso: p.install_dates_start,
      installEndIso: p.install_dates_end,
      liveStartIso: p.live_dates_start,
      liveEndIso: p.live_dates_end,
      removalStartIso: p.removal_dates_start,
      removalEndIso: p.removal_dates_end,
      accountManagerIds: ams.map((u) => u!.id),
      accountManagerLabel:
        firstName && firstName.length > 0
          ? firstName.replace(/^./, (c) => c.toUpperCase())
          : null,
    };
  });
}

/**
 * Loads every deliverable with a due_date in the window. Joined to projects
 * for the project name + id (the Calendar's click target on a deliverable
 * is the parent project per the build-notes Surface 22 rule).
 */
export async function loadCalendarDeliverables(
  windowStartIso: string,
  windowEndIso: string,
): Promise<CalendarDeliverableRow[]> {
  const { data, error } = await supabase
    .from("deliverables")
    .select(
      `id, title, status, due_date,
       project:projects(id, name)`,
    )
    .not("due_date", "is", null)
    .gte("due_date", windowStartIso)
    .lte("due_date", windowEndIso);
  if (error) {
    console.warn("loadCalendarDeliverables error", error);
    return [];
  }
  type Row = {
    id: string;
    title: string;
    status: "Upcoming" | "Complete" | "Skipped";
    due_date: string;
    project: { id: string; name: string } | null;
  };
  return ((data ?? []) as unknown as Row[])
    .filter((d) => d.project != null)
    .map((d) => ({
      id: d.id,
      projectId: d.project!.id,
      projectName: d.project!.name,
      title: d.title,
      status: d.status,
      dueIso: d.due_date,
    }));
}

/**
 * Loads shared Outlook entries for the year window. RLS handles the
 * shared_with_team gate for standard users (their SELECT only returns
 * shared rows); admins get back all entries but the Calendar still only
 * renders shared ones per spec § 6a.
 */
export async function loadCalendarOutlook(
  year: number,
): Promise<CalendarOutlookRow[]> {
  const { data, error } = await supabase
    .from("outlook_entries")
    .select(
      `id, name, city, year, month, week, date_text, confidence, shared_with_team,
       client:clients(name)`,
    )
    .eq("year", year);
  if (error) {
    console.warn("loadCalendarOutlook error", error);
    return [];
  }
  type Row = {
    id: string;
    name: string;
    city: string | null;
    year: number;
    month: number;
    week: number;
    date_text: string | null;
    confidence: "On Radar" | "Likely" | "Confirmed" | "Complete";
    shared_with_team: boolean;
    client: { name: string | null } | null;
  };
  return ((data ?? []) as unknown as Row[]).map((e) => ({
    id: e.id,
    name: e.name,
    clientName: e.client?.name ?? null,
    city: e.city,
    year: e.year,
    month: e.month,
    week: e.week,
    dateText: e.date_text,
    confidence: e.confidence,
    sharedWithTeam: e.shared_with_team,
  }));
}

/**
 * Mirror date convention: Week 1 = day 1, Week 2 = day 8, Week 3 = day 15,
 * Week 4 = day 22. The Outlook page stores entries by (year, month, week);
 * the Calendar derives a calendar date for shared entries via this map.
 */
export function weekToDateIso(year: number, month: number, week: number): string {
  const day = (week - 1) * 7 + 1;
  const m = String(month).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${year}-${m}-${d}`;
}
