import { supabase } from "@/integrations/supabase/client";

/**
 * Shared loaders + types for Clients.
 *
 * Phase 5.6.2 reshape: the list page now surfaces three per-client
 * rollups (contacts / upcoming deliverables / active projects) instead
 * of the slim 5.2.3 industry+contact+city+pastProjectCount+tags shape.
 * Rollups load via three batched aggregate queries keyed on client_id so
 * the page still fires within one round trip per table.
 *
 *   - Contacts: every `people` row where `client_id = client.id`.
 *   - Deliverables: every `deliverables` row whose project's `client_id`
 *     matches, filtered to `due_date >= today AND status NOT IN
 *     ('Complete', 'Skipped')`. Ordered by due_date ASC.
 *   - Projects: every `projects` row where `client_id = client.id AND
 *     status NOT IN ('Complete', 'Cancelled', 'On Hold')`. Ordered by
 *     name ASC for stable list rendering.
 *
 * The columns dropped in this reshape (industry, contact_*, city, tags,
 * pastProjectCount) stay on the row type for filter / sort surfaces that
 * still consume them. The DataTable just doesn't render those keys.
 */

export type ClientRollupRef = { id: string; label: string };

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
  contacts: ClientRollupRef[];
  upcomingDeliverables: ClientRollupRef[];
  activeProjects: ClientRollupRef[];
};

const TERMINAL_DELIVERABLE_STATUSES = ["Complete", "Skipped"];
const NON_ACTIVE_PROJECT_STATUSES = ["Complete", "Cancelled", "On Hold"];

export async function loadClients(): Promise<ClientListRow[]> {
  const today = new Date().toISOString().slice(0, 10);

  const [clientsRes, peopleRes, projectsRes, deliverablesRes] = await Promise.all([
    supabase
      .from("clients")
      .select(
        "id, name, industry, city, contact_name, contact_email, contact_phone, primary_address, website_url, tags",
      )
      .order("name", { ascending: true }),
    supabase
      .from("people")
      .select("id, full_name, client_id")
      .not("client_id", "is", null)
      .order("full_name", { ascending: true }),
    supabase
      .from("projects")
      .select("id, name, client_id, status")
      .not("client_id", "is", null)
      .order("name", { ascending: true }),
    supabase
      .from("deliverables")
      .select(
        "id, title, due_date, status, project:projects!deliverables_project_id_fkey(id, client_id)",
      )
      .gte("due_date", today)
      .not("status", "in", `(${TERMINAL_DELIVERABLE_STATUSES.join(",")})`)
      .order("due_date", { ascending: true }),
  ]);

  if (clientsRes.error) {
    console.warn("clients load failed", clientsRes.error);
    return [];
  }

  const contactsByClient = new Map<string, ClientRollupRef[]>();
  for (const r of peopleRes.data ?? []) {
    const row = r as { id: string; full_name: string | null; client_id: string | null };
    if (!row.client_id) continue;
    const list = contactsByClient.get(row.client_id) ?? [];
    list.push({ id: row.id, label: row.full_name ?? "Unnamed" });
    contactsByClient.set(row.client_id, list);
  }

  const projectsByClient = new Map<string, ClientRollupRef[]>();
  for (const r of projectsRes.data ?? []) {
    const row = r as { id: string; name: string | null; client_id: string | null; status: string };
    if (!row.client_id) continue;
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
      project: { id: string; client_id: string | null } | null;
    };
    const clientId = row.project?.client_id ?? null;
    if (!clientId) continue;
    const list = deliverablesByClient.get(clientId) ?? [];
    list.push({ id: row.id, label: row.title ?? "Untitled" });
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
      contacts: contactsByClient.get(row.id) ?? [],
      upcomingDeliverables: deliverablesByClient.get(row.id) ?? [],
      activeProjects: projectsByClient.get(row.id) ?? [],
    };
  });
}
