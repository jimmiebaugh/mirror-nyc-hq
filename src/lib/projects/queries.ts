import { supabase } from "@/integrations/supabase/client";

export type ProjectStatus =
  | "Approved"
  | "In Production"
  | "In Progress"
  | "Location Scouting"
  | "Install"
  | "Removal"
  | "Billing"
  | "Queued"
  | "Quoting"
  | "Quote Sent"
  | "Awaiting Feedback"
  | "On Hold"
  | "Complete"
  | "Cancelled";

export const PROJECT_STATUS_VALUES: ProjectStatus[] = [
  "Approved",
  "In Production",
  "In Progress",
  "Location Scouting",
  "Install",
  "Removal",
  "Billing",
  "Queued",
  "Quoting",
  "Quote Sent",
  "Awaiting Feedback",
  "On Hold",
  "Complete",
  "Cancelled",
];

export const TERMINAL_PROJECT_STATUSES: ProjectStatus[] = ["Complete", "Cancelled"];

export type ProjectListRow = {
  id: string;
  name: string;
  status: ProjectStatus;
  jobNumber: string | null;
  category: string | null;
  city: string | null;
  tags: string[];
  clientId: string | null;
  clientName: string | null;
  installStartIso: string | null;
  installEndIso: string | null;
  liveStartIso: string | null;
  liveEndIso: string | null;
  removalStartIso: string | null;
  removalEndIso: string | null;
  nextDeliverableTitle: string | null;
  nextDeliverableDueIso: string | null;
  leadName: string | null;
  designerName: string | null;
  /**
   * Phase 5.7.4 smoke followup: full-name arrays of every Account Lead +
   * Design Lead on the project. Powers the new combined
   * "Account / Design Leads" column on the list. `leadName` /
   * `designerName` (single first-name) kept for filter + sort + board
   * card compatibility.
   */
  leadNames: string[];
  designerNames: string[];
  /**
   * Phase 5.7.7: full-name array of every general-bucket project team
   * member. Joined alongside leadNames + designerNames via the new
   * `project_members` table. Feeds the "Team" filter (key still
   * `leadName` for saved-view back-compat; the applyFn remaps to
   * `teamNames` for matching).
   */
  memberNames: string[];
};

function firstName(name: string | null | undefined, email: string | null | undefined): string | null {
  if (name) return name.trim().split(/\s+/)[0] || null;
  if (email) return email.split("@")[0].split(".")[0].replace(/^./, (c) => c.toUpperCase());
  return null;
}

export async function loadProjects(): Promise<ProjectListRow[]> {
  const { data, error } = await supabase
    .from("projects")
    .select(
      `id, name, status, job_number, category, city, tags,
       install_dates_start, install_dates_end,
       live_dates_start, live_dates_end,
       removal_dates_start, removal_dates_end, client_id,
       client:clients!projects_client_id_fkey(id, name),
       account_managers:project_account_managers(user:users(full_name, email)),
       designers:project_designers(user:users(full_name, email)),
       members:project_members(user:users!project_members_user_id_fkey(full_name, email)),
       deliverables(id, title, due_date, status)`,
    )
    .is("archived_at", null);
  if (error) {
    console.warn("loadProjects error", error);
    return [];
  }
  type DbRow = {
    id: string;
    name: string;
    status: ProjectStatus;
    job_number: string | null;
    category: string | null;
    city: string | null;
    tags: string[] | null;
    install_dates_start: string | null;
    install_dates_end: string | null;
    live_dates_start: string | null;
    live_dates_end: string | null;
    removal_dates_start: string | null;
    removal_dates_end: string | null;
    client_id: string | null;
    client:
      | { id: string; name: string | null }
      | { id: string; name: string | null }[]
      | null;
    account_managers: { user: { full_name: string | null; email: string | null } | null }[] | null;
    designers: { user: { full_name: string | null; email: string | null } | null }[] | null;
    members: { user: { full_name: string | null; email: string | null } | null }[] | null;
    deliverables: { id: string; title: string; due_date: string | null; status: string }[] | null;
  };
  return ((data ?? []) as unknown as DbRow[]).map((p) => {
    const am = (p.account_managers ?? []).map((j) => j.user).filter(Boolean);
    const ds = (p.designers ?? []).map((j) => j.user).filter(Boolean);
    const ms = (p.members ?? []).map((j) => j.user).filter(Boolean);
    const nextDeliverable = (p.deliverables ?? [])
      .filter((d) => d.due_date && d.status === "Upcoming")
      .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""))[0];
    return {
      id: p.id,
      name: p.name,
      status: p.status,
      jobNumber: p.job_number,
      category: p.category,
      city: p.city,
      tags: p.tags ?? [],
      clientId: p.client_id,
      // PostgREST sometimes returns the embed as an array even when the FK
      // is one-to-many parent-side (project -> client is single-parent).
      // Handle both shapes defensively.
      clientName: Array.isArray(p.client)
        ? (p.client[0]?.name ?? null)
        : (p.client?.name ?? null),
      installStartIso: p.install_dates_start,
      installEndIso: p.install_dates_end,
      liveStartIso: p.live_dates_start,
      liveEndIso: p.live_dates_end,
      removalStartIso: p.removal_dates_start,
      removalEndIso: p.removal_dates_end,
      nextDeliverableTitle: nextDeliverable?.title ?? null,
      nextDeliverableDueIso: nextDeliverable?.due_date ?? null,
      leadName: am[0] ? firstName(am[0]?.full_name, am[0]?.email) : null,
      designerName: ds[0] ? firstName(ds[0]?.full_name, ds[0]?.email) : null,
      leadNames: am
        .map((u) => u?.full_name?.trim() || u?.email?.split("@")[0] || "")
        .filter(Boolean),
      designerNames: ds
        .map((u) => u?.full_name?.trim() || u?.email?.split("@")[0] || "")
        .filter(Boolean),
      memberNames: ms
        .map((u) => u?.full_name?.trim() || u?.email?.split("@")[0] || "")
        .filter(Boolean),
    };
  });
}

export async function updateProjectStatus(id: string, status: ProjectStatus) {
  const { error } = await supabase.from("projects").update({ status }).eq("id", id);
  if (error) throw error;
}
