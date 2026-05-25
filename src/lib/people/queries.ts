import { supabase } from "@/integrations/supabase/client";

/**
 * Shared loaders + types for People (Phase 5.2.2 § 5.B; reshaped in
 * Phase 5.2.3 § 4.C; venues added in Phase 5.7.4 § 4.C).
 *
 * 5.2.3 changes:
 *   - `affiliations` enum array dropped (locked Q4: at most one org
 *     type per person; FK presence resolves type at query time).
 *   - `organization_id` split into nullable `client_id` + nullable
 *     `vendor_id`. DB mutex CHECK prevents both being set; UI radio
 *     enforces the same.
 *   - `is_venue_contact` boolean folded into the row by joining
 *     `venue_contact_people` so the List can resolve "Venue"
 *     type without an extra round trip.
 *
 * 5.7.4 change:
 *   - `venues: { id, name }[]` (replaces `venue_names: string[]`) so the
 *     Organization cell can hyperlink the single venue to its detail
 *     page. Order is by encounter; "{N} venues" cell render still
 *     applies when length > 1.
 *
 * Embed uses constraint-named FKs per the 5.2.2 PGRST201 lesson; without
 * them PostgREST throws when more than one FK points at the same target
 * from people.
 */

export type PersonType = "Client" | "Vendor" | "Venue" | "Unaffiliated";

export const PERSON_TYPES: PersonType[] = [
  "Client",
  "Vendor",
  "Venue",
  "Unaffiliated",
];

export type PersonListRow = {
  id: string;
  full_name: string;
  affiliation_type: PersonType;
  client_id: string | null;
  client_name: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  is_venue_contact: boolean;
  venues: { id: string; name: string }[];
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
        "id, full_name, affiliation_type, client_id, vendor_id, role_title, email, phone, tags, " +
          "client:clients!people_client_id_fkey(id, name), " +
          "vendor:vendors!people_vendor_id_fkey(id, name)",
      )
      .order("full_name", { ascending: true }),
    supabase
      .from("venue_contact_people")
      .select(
        "person_id, venue:venues!venue_contact_people_venue_id_fkey(id, name)",
      ),
  ]);

  if (peopleRes.error) {
    console.warn("people load failed", peopleRes.error);
    return [];
  }

  // Build person_id -> venues map (ordered by encounter; the source
  // venue_contact_people join order is non-deterministic but stable enough
  // for the "{N} venues" cell). is_venue_contact derives from the same map.
  const venuesByPerson = new Map<string, { id: string; name: string }[]>();
  for (const r of venueContactsRes.data ?? []) {
    const row = r as unknown as {
      person_id: string | null;
      venue: { id: string; name: string | null } | null;
    };
    if (!row.person_id || !row.venue?.id || !row.venue?.name) continue;
    const list = venuesByPerson.get(row.person_id) ?? [];
    list.push({ id: row.venue.id, name: row.venue.name });
    venuesByPerson.set(row.person_id, list);
  }

  return (peopleRes.data ?? []).map((p) => {
    const row = p as unknown as {
      id: string;
      full_name: string;
      affiliation_type: PersonType;
      client_id: string | null;
      vendor_id: string | null;
      role_title: string | null;
      email: string | null;
      phone: string | null;
      tags: string[] | null;
      client: { id: string; name: string | null } | null;
      vendor: { id: string; name: string | null } | null;
    };
    const venues = venuesByPerson.get(row.id) ?? [];
    return {
      id: row.id,
      full_name: row.full_name,
      affiliation_type: row.affiliation_type,
      client_id: row.client_id,
      client_name: row.client?.name ?? null,
      vendor_id: row.vendor_id,
      vendor_name: row.vendor?.name ?? null,
      is_venue_contact: venues.length > 0,
      venues,
      role_title: row.role_title,
      email: row.email,
      phone: row.phone,
      tags: row.tags ?? [],
    };
  });
}

/**
 * Phase 5.6.3: reads the authoritative `affiliation_type` column.
 * Previously derived from FK presence; that broke when inline edit on
 * the detail page made FK clears trivial (clearing the org would flip
 * the derived type to Unaffiliated).
 *
 * Callers may pass a bare row that doesn't include `affiliation_type`
 * (legacy code paths) — falls back to the old FK-derivation in that
 * case for backward compatibility.
 */
export function personType(p: {
  affiliation_type?: PersonType | null;
  client_id: string | null;
  vendor_id: string | null;
  is_venue_contact: boolean;
}): PersonType {
  if (p.affiliation_type) return p.affiliation_type;
  if (p.client_id) return "Client";
  if (p.vendor_id) return "Vendor";
  if (p.is_venue_contact) return "Venue";
  return "Unaffiliated";
}

// Phase 5.11.3: switched from p-primary / p-purple / p-info to the muted
// p-aff-* affiliation variants. Same hues, much lower saturation, so dense
// People-list pages don't feel candy-bright. `Unaffiliated` still uses the
// flat muted token.
export function personTypeToken(
  t: PersonType,
): "aff-client" | "aff-vendor" | "aff-venue" | "muted" {
  if (t === "Client") return "aff-client";
  if (t === "Vendor") return "aff-vendor";
  if (t === "Venue") return "aff-venue";
  return "muted";
}
