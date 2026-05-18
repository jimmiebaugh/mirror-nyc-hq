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

export type CalendarTaskRow = {
  id: string;
  title: string;
  dueIso: string;
  status: "To Do" | "Doing" | "Blocked" | "Done";
  priority: "Urgent" | "High" | "Normal" | "Low";
  projectId: string | null;
  projectName: string | null;
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
 * Phase 5.7.9 §9.D personal tasks layer. Loads tasks assigned to the
 * current user with `due_date` in the active window. Done tasks are
 * excluded to mirror MyTasksThisWeekCard posture; the calendar shows
 * actionable items only.
 *
 * PostgREST FK disambiguation: `tasks` has two FKs to `users`
 * (assignee_id + created_by) so a bare `user:users(...)` embed would
 * 300. The `project:projects(...)` embed has only one path, but we
 * still name the constraint so the intent is explicit per
 * `feedback_postgrest_embed_constraint_named_fk.md`.
 */
export async function loadCalendarTasks(
  userId: string,
  windowStartIso: string,
  windowEndIso: string,
): Promise<CalendarTaskRow[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select(
      `id, title, due_date, status, priority,
       project:projects!tasks_project_id_fkey(id, name)`,
    )
    .eq("assignee_id", userId)
    .not("due_date", "is", null)
    .gte("due_date", windowStartIso)
    .lte("due_date", windowEndIso)
    .in("status", ["To Do", "Doing", "Blocked"]);
  if (error) {
    console.warn("loadCalendarTasks error", error);
    return [];
  }
  type Row = {
    id: string;
    title: string;
    due_date: string;
    status: "To Do" | "Doing" | "Blocked" | "Done";
    priority: "Urgent" | "High" | "Normal" | "Low";
    project: { id: string; name: string } | null;
  };
  return ((data ?? []) as unknown as Row[]).map((t) => ({
    id: t.id,
    title: t.title,
    dueIso: t.due_date,
    status: t.status,
    priority: t.priority,
    projectId: t.project?.id ?? null,
    projectName: t.project?.name ?? null,
  }));
}

