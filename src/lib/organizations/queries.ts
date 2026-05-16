import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

/**
 * Shared loaders + types for Organizations (Phase 5.2.2 § 5.A).
 *
 * Type filter chips on the List drive the `type` column; the
 * `pastProjectCount` per row comes from a single aggregate query keyed by
 * organization_id rather than a per-row count to stay within one round
 * trip. With the realistic-data target hitting ~40 orgs the join sits
 * comfortably client-side.
 */

export type OrgType = Database["public"]["Enums"]["org_type"];
export const ORG_TYPES: OrgType[] = ["Client", "Vendor", "Internal"];

export type OrgListRow = {
  id: string;
  name: string;
  type: OrgType;
  city: string | null;
  capabilities: string[];
  internal_rating: number | null;
  website_url: string | null;
  tags: string[];
  pastProjectCount: number;
};

export async function loadOrganizations(): Promise<OrgListRow[]> {
  const [orgsRes, countsRes] = await Promise.all([
    supabase
      .from("organizations")
      .select(
        "id, name, type, city, capabilities, internal_rating, website_url, tags",
      )
      .order("name", { ascending: true }),
    supabase
      .from("projects")
      .select("organization_id")
      .not("organization_id", "is", null),
  ]);

  if (orgsRes.error) {
    console.warn("organizations load failed", orgsRes.error);
    return [];
  }

  const counts = new Map<string, number>();
  for (const row of countsRes.data ?? []) {
    const id = (row as { organization_id: string | null }).organization_id;
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  return (orgsRes.data ?? []).map((o) => {
    const row = o as {
      id: string;
      name: string | null;
      type: OrgType;
      city: string | null;
      capabilities: string[] | null;
      internal_rating: number | null;
      website_url: string | null;
      tags: string[] | null;
    };
    return {
      id: row.id,
      name: row.name ?? "Untitled",
      type: row.type,
      city: row.city,
      capabilities: row.capabilities ?? [],
      internal_rating: row.internal_rating,
      website_url: row.website_url,
      tags: row.tags ?? [],
      pastProjectCount: counts.get(row.id) ?? 0,
    };
  });
}

export function typeToken(t: OrgType): "primary" | "purple" | "info" {
  if (t === "Client") return "primary";
  if (t === "Vendor") return "purple";
  return "info";
}
