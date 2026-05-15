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
  clientName: string | null;
  liveStartIso: string | null;
  liveEndIso: string | null;
  leadName: string | null;
  designerName: string | null;
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
      `id, name, status, live_dates_start, live_dates_end,
       client:clients(name),
       account_managers:project_account_managers(user:users(full_name, email)),
       designers:project_designers(user:users(full_name, email))`,
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
    live_dates_start: string | null;
    live_dates_end: string | null;
    client: { name: string | null } | null;
    account_managers: { user: { full_name: string | null; email: string | null } | null }[] | null;
    designers: { user: { full_name: string | null; email: string | null } | null }[] | null;
  };
  return ((data ?? []) as unknown as DbRow[]).map((p) => {
    const am = (p.account_managers ?? []).map((j) => j.user).filter(Boolean);
    const ds = (p.designers ?? []).map((j) => j.user).filter(Boolean);
    return {
      id: p.id,
      name: p.name,
      status: p.status,
      clientName: p.client?.name ?? null,
      liveStartIso: p.live_dates_start,
      liveEndIso: p.live_dates_end,
      leadName: am[0] ? firstName(am[0]?.full_name, am[0]?.email) : null,
      designerName: ds[0] ? firstName(ds[0]?.full_name, ds[0]?.email) : null,
    };
  });
}

export async function updateProjectStatus(id: string, status: ProjectStatus) {
  const { error } = await supabase.from("projects").update({ status }).eq("id", id);
  if (error) throw error;
}
