import { supabase } from "@/integrations/supabase/client";

/**
 * Shared loaders + types for Clients (Phase 5.2.3 § 4.A).
 *
 * Slim shape: name + contact + city + industry + website + tags + address.
 * `pastProjectCount` per row comes from one aggregate query keyed by
 * client_id rather than per-row count to stay within one round trip.
 */

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
  pastProjectCount: number;
};

export async function loadClients(): Promise<ClientListRow[]> {
  const [clientsRes, countsRes] = await Promise.all([
    supabase
      .from("clients")
      .select(
        "id, name, industry, city, contact_name, contact_email, contact_phone, primary_address, website_url, tags",
      )
      .order("name", { ascending: true }),
    supabase
      .from("projects")
      .select("client_id")
      .not("client_id", "is", null),
  ]);

  if (clientsRes.error) {
    console.warn("clients load failed", clientsRes.error);
    return [];
  }

  const counts = new Map<string, number>();
  for (const row of countsRes.data ?? []) {
    const id = (row as { client_id: string | null }).client_id;
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
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
      pastProjectCount: counts.get(row.id) ?? 0,
    };
  });
}
