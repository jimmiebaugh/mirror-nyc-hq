import { supabase } from "@/integrations/supabase/client";

export type DeliverableStatus = "Upcoming" | "In Progress" | "Complete" | "Skipped";
export const DELIVERABLE_STATUS_VALUES: DeliverableStatus[] = [
  "Upcoming",
  "In Progress",
  "Complete",
  "Skipped",
];

export type DeliverableListRow = {
  id: string;
  title: string;
  type: string | null;
  status: DeliverableStatus;
  due_date: string | null;
  assigned_user_ids: string[];
  notes: string | null;
  project: { id: string; name: string; organization: { id: string; name: string | null } | null } | null;
};

export async function loadDeliverables(): Promise<DeliverableListRow[]> {
  const { data, error } = await supabase
    .from("deliverables")
    .select(
      `id, title, type, status, due_date, assigned_user_ids, notes,
       project:projects(id, name, organization:organizations(id, name))`,
    )
    .order("due_date", { ascending: true, nullsFirst: false });
  if (error) {
    console.warn("loadDeliverables error", error);
    return [];
  }
  return (data ?? []) as unknown as DeliverableListRow[];
}

export async function updateDeliverableStatus(id: string, status: DeliverableStatus) {
  const { error } = await supabase.from("deliverables").update({ status }).eq("id", id);
  if (error) throw error;
}
