import { supabase } from "@/integrations/supabase/client";

/**
 * Shared loaders + types for Venues (Phase 5.2.2 § 5.C). Venue Type lift
 * pulls one venue-types row per join in `venue_venue_types`; the list
 * Venue Type column renders one chip per entry stacked vertically per
 * wireframe Surface 09 lines 1651-1652.
 */

export type VenueListRow = {
  id: string;
  name: string;
  city: string | null;
  neighborhood: string | null;
  total_sq_ft: number | null;
  website_url: string | null;
  notes: string | null;
  features: string[];
  venueTypes: string[];
  pastProjectCount: number;
  bulkImportSessionId: string | null;
};

export async function loadVenues(): Promise<VenueListRow[]> {
  const [venuesRes, joinRes, pvRes] = await Promise.all([
    supabase
      .from("venues")
      .select(
        "id, name, city, neighborhood, total_sq_ft, website_url, notes, features, bulk_import_session_id",
      )
      .order("name", { ascending: true }),
    supabase
      .from("venue_venue_types")
      .select(
        "venue_id, venue_type:venue_types!venue_venue_types_venue_type_id_fkey(name)",
      ),
    supabase.from("project_venues").select("venue_id"),
  ]);

  if (venuesRes.error) {
    console.warn("venues load failed", venuesRes.error);
    return [];
  }

  const typesByVenue = new Map<string, string[]>();
  for (const row of (joinRes.data ?? []) as unknown as {
    venue_id: string;
    venue_type: { name: string } | null;
  }[]) {
    if (!row.venue_type?.name) continue;
    const list = typesByVenue.get(row.venue_id) ?? [];
    list.push(row.venue_type.name);
    typesByVenue.set(row.venue_id, list);
  }

  const counts = new Map<string, number>();
  for (const row of (pvRes.data ?? []) as { venue_id: string }[]) {
    counts.set(row.venue_id, (counts.get(row.venue_id) ?? 0) + 1);
  }

  return (venuesRes.data ?? []).map((v) => {
    const row = v as {
      id: string;
      name: string | null;
      city: string | null;
      neighborhood: string | null;
      total_sq_ft: number | null;
      website_url: string | null;
      notes: string | null;
      features: string[] | null;
      bulk_import_session_id: string | null;
    };
    return {
      id: row.id,
      name: row.name ?? "Untitled",
      city: row.city,
      neighborhood: row.neighborhood,
      total_sq_ft: row.total_sq_ft,
      website_url: row.website_url,
      notes: row.notes,
      features: row.features ?? [],
      venueTypes: typesByVenue.get(row.id) ?? [],
      pastProjectCount: counts.get(row.id) ?? 0,
      bulkImportSessionId: row.bulk_import_session_id,
    };
  });
}

export type VenueRate = {
  rate_kind: "event_day" | "prod_day";
  amount_usd: number;
  effective_from: string;
};

export async function loadLatestVenueRates(
  venueId: string,
): Promise<VenueRate[]> {
  const { data, error } = await supabase
    .from("venue_rate_history")
    .select("rate_kind, amount_usd, effective_from")
    .eq("venue_id", venueId)
    .order("effective_from", { ascending: false });
  if (error || !data) return [];
  const latest = new Map<string, VenueRate>();
  for (const r of data as VenueRate[]) {
    if (!latest.has(r.rate_kind)) latest.set(r.rate_kind, r);
  }
  return Array.from(latest.values());
}
