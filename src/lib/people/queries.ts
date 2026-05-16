import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

/**
 * Shared loaders + types for People (Phase 5.2.2 § 5.B). The list query
 * pulls the organization name via a single FK embed so the muted-coral
 * `<Link>` in the Organization cell can route on the org id without an
 * extra round trip.
 */

export type PersonAffiliation =
  Database["public"]["Enums"]["person_affiliation"];
export const PERSON_AFFILIATIONS: PersonAffiliation[] = [
  "Client",
  "Vendor",
  "Internal",
  "Venue",
];

export type PersonListRow = {
  id: string;
  full_name: string;
  affiliations: PersonAffiliation[];
  organization_id: string | null;
  organization_name: string | null;
  role_title: string | null;
  email: string | null;
  phone: string | null;
  tags: string[];
};

export async function loadPeople(): Promise<PersonListRow[]> {
  const { data, error } = await supabase
    .from("people")
    .select(
      "id, full_name, affiliations, organization_id, role_title, email, phone, tags, organization:organizations!people_organization_id_fkey(id, name)",
    )
    .order("full_name", { ascending: true });
  if (error) {
    console.warn("people load failed", error);
    return [];
  }
  return (data ?? []).map((p) => {
    const row = p as unknown as {
      id: string;
      full_name: string;
      affiliations: PersonAffiliation[] | null;
      organization_id: string | null;
      role_title: string | null;
      email: string | null;
      phone: string | null;
      tags: string[] | null;
      organization: { id: string; name: string | null } | null;
    };
    return {
      id: row.id,
      full_name: row.full_name,
      affiliations: row.affiliations ?? [],
      organization_id: row.organization_id,
      organization_name: row.organization?.name ?? null,
      role_title: row.role_title,
      email: row.email,
      phone: row.phone,
      tags: row.tags ?? [],
    };
  });
}

export function affiliationToken(
  a: PersonAffiliation,
): "primary" | "purple" | "info" | "muted" {
  if (a === "Client") return "primary";
  if (a === "Vendor") return "purple";
  if (a === "Internal") return "info";
  return "muted";
}
