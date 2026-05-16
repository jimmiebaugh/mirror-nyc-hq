import { supabase } from "@/integrations/supabase/client";

/**
 * Shared loaders + types for People (Phase 5.2.2 § 5.B; reshaped in
 * Phase 5.2.3 § 4.C).
 *
 * 5.2.3 changes:
 *   - `affiliations` enum array dropped (locked Q4: at most one org
 *     type per person; FK presence resolves type at query time).
 *   - `organization_id` split into nullable `client_id` + nullable
 *     `vendor_id`. DB mutex CHECK prevents both being set; UI radio
 *     enforces the same.
 *   - `is_venue_contact` boolean folded into the row by joining
 *     `venue_contact_people` so the List can resolve "Venue contact"
 *     type without an extra round trip.
 *
 * Embed uses constraint-named FKs per the 5.2.2 PGRST201 lesson; without
 * them PostgREST throws when more than one FK points at the same target
 * from people.
 */

export type PersonType = "Client" | "Vendor" | "Venue contact" | "Unaffiliated";

export const PERSON_TYPES: PersonType[] = [
  "Client",
  "Vendor",
  "Venue contact",
  "Unaffiliated",
];

export type PersonListRow = {
  id: string;
  full_name: string;
  client_id: string | null;
  client_name: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  is_venue_contact: boolean;
  role_title: string | null;
  email: string | null;
  phone: string | null;
  tags: string[];
};

export async function loadPeople(): Promise<PersonListRow[]> {
  const [peopleRes, venueContactsRes] = await Promise.all([
    supabase
      .from("people")
      .select(
        "id, full_name, client_id, vendor_id, role_title, email, phone, tags, " +
          "client:clients!people_client_id_fkey(id, name), " +
          "vendor:vendors!people_vendor_id_fkey(id, name)",
      )
      .order("full_name", { ascending: true }),
    supabase.from("venue_contact_people").select("person_id"),
  ]);

  if (peopleRes.error) {
    console.warn("people load failed", peopleRes.error);
    return [];
  }

  const venueContactSet = new Set<string>();
  for (const r of venueContactsRes.data ?? []) {
    const pid = (r as { person_id: string | null }).person_id;
    if (pid) venueContactSet.add(pid);
  }

  return (peopleRes.data ?? []).map((p) => {
    const row = p as unknown as {
      id: string;
      full_name: string;
      client_id: string | null;
      vendor_id: string | null;
      role_title: string | null;
      email: string | null;
      phone: string | null;
      tags: string[] | null;
      client: { id: string; name: string | null } | null;
      vendor: { id: string; name: string | null } | null;
    };
    return {
      id: row.id,
      full_name: row.full_name,
      client_id: row.client_id,
      client_name: row.client?.name ?? null,
      vendor_id: row.vendor_id,
      vendor_name: row.vendor?.name ?? null,
      is_venue_contact: venueContactSet.has(row.id),
      role_title: row.role_title,
      email: row.email,
      phone: row.phone,
      tags: row.tags ?? [],
    };
  });
}

export function personType(p: {
  client_id: string | null;
  vendor_id: string | null;
  is_venue_contact: boolean;
}): PersonType {
  if (p.client_id) return "Client";
  if (p.vendor_id) return "Vendor";
  if (p.is_venue_contact) return "Venue contact";
  return "Unaffiliated";
}

export function personTypeToken(
  t: PersonType,
): "primary" | "purple" | "info" | "muted" {
  if (t === "Client") return "primary";
  if (t === "Vendor") return "purple";
  if (t === "Venue contact") return "info";
  return "muted";
}
