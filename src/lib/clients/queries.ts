import { supabase } from "@/integrations/supabase/client";

/**
 * Shared loaders + types for Clients.
 *
 * Phase 5.7.4 reshape: list page now surfaces Projects / Deliverables /
 * Primary Contact. The earlier 5.6.2 contacts rollup is dropped.
 *
 *   - Deliverables: every `deliverables` row whose project's `client_id`
 *     matches, filtered to `due_date >= today AND status NOT IN
 *     ('Complete', 'Skipped')`. Ordered by due_date ASC.
 *   - Projects: every `projects` row where `client_id = client.id AND
 *     status NOT IN ('Complete', 'Cancelled', 'On Hold')`. Ordered by
 *     name ASC for stable list rendering.
 *   - Primary Contact: the denormalized `contact_name` text column.
 */

export type ClientRollupRef = {
  id: string;
  label: string;
  /**
   * Phase 5.7.4 smoke followup: optional secondary label rendered stacked
   * beneath the primary label. Set to the parent project name on the
   * Deliverables rollup so the cell reads
   *   <Deliverable title>
   *   <Project title>
   * Null for Projects (already self-describing).
   */
  subLabel?: string | null;
};

export type ClientListRow = {
  id: string;
  name: string;
  industry: string | null;
  city: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  primary_address: string | null;
  website_url: string | null;
  tags: string[];
  upcomingDeliverables: ClientRollupRef[];
  activeProjects: ClientRollupRef[];
  // Phase 5.11.3: total project count per client (active + non-active).
  // Separate from `activeProjects` so a future "On Hold lifecycle" can
  // re-bucket without re-querying.
  totalProjectCount: number;
};

const TERMINAL_DELIVERABLE_STATUSES = ["Complete", "Skipped"];
const NON_ACTIVE_PROJECT_STATUSES = ["Complete", "Cancelled", "On Hold"];

export async function loadClients(): Promise<ClientListRow[]> {
  const today = new Date().toISOString().slice(0, 10);

  const [clientsRes, projectsRes, deliverablesRes] = await Promise.all([
    supabase
      .from("clients")
      .select(
        "id, name, industry, city, contact_name, contact_email, contact_phone, primary_address, website_url, tags",
      )
      .order("name", { ascending: true }),
    supabase
      .from("projects")
      .select("id, name, client_id, status")
      .not("client_id", "is", null)
      .order("name", { ascending: true }),
    supabase
      .from("deliverables")
      .select(
        "id, title, due_date, status, project:projects!deliverables_project_id_fkey(id, name, client_id)",
      )
      .gte("due_date", today)
      .not("status", "in", `(${TERMINAL_DELIVERABLE_STATUSES.join(",")})`)
      .order("due_date", { ascending: true }),
  ]);

  if (clientsRes.error) {
    console.warn("clients load failed", clientsRes.error);
    return [];
  }

  const projectsByClient = new Map<string, ClientRollupRef[]>();
  const totalProjectsByClient = new Map<string, number>();
  for (const r of projectsRes.data ?? []) {
    const row = r as { id: string; name: string | null; client_id: string | null; status: string };
    if (!row.client_id) continue;
    totalProjectsByClient.set(
      row.client_id,
      (totalProjectsByClient.get(row.client_id) ?? 0) + 1,
    );
    if (NON_ACTIVE_PROJECT_STATUSES.includes(row.status)) continue;
    const list = projectsByClient.get(row.client_id) ?? [];
    list.push({ id: row.id, label: row.name ?? "Untitled" });
    projectsByClient.set(row.client_id, list);
  }

  const deliverablesByClient = new Map<string, ClientRollupRef[]>();
  for (const r of deliverablesRes.data ?? []) {
    const row = r as unknown as {
      id: string;
      title: string | null;
      project: { id: string; name: string | null; client_id: string | null } | null;
    };
    const clientId = row.project?.client_id ?? null;
    if (!clientId) continue;
    const list = deliverablesByClient.get(clientId) ?? [];
    list.push({
      id: row.id,
      label: row.title ?? "Untitled",
      subLabel: row.project?.name ?? null,
    });
    deliverablesByClient.set(clientId, list);
  }

  return (clientsRes.data ?? []).map((c) => {
    const row = c as {
      id: string;
      name: string | null;
      industry: string | null;
      city: string | null;
      contact_name: string | null;
      contact_email: string | null;
      contact_phone: string | null;
      primary_address: string | null;
      website_url: string | null;
      tags: string[] | null;
    };
    return {
      id: row.id,
      name: row.name ?? "Untitled",
      industry: row.industry,
      city: row.city,
      contact_name: row.contact_name,
      contact_email: row.contact_email,
      contact_phone: row.contact_phone,
      primary_address: row.primary_address,
      website_url: row.website_url,
      tags: row.tags ?? [],
      upcomingDeliverables: deliverablesByClient.get(row.id) ?? [],
      activeProjects: projectsByClient.get(row.id) ?? [],
      totalProjectCount: totalProjectsByClient.get(row.id) ?? 0,
    };
  });
}
