import { supabase } from "@/integrations/supabase/client";

/**
 * Shared loaders + types for Vendors (Phase 5.2.3 § 4.B).
 *
 * Replaces `src/lib/organizations/queries.ts` (deleted). After the
 * organizations -> vendors rename in migration 5.2.3.B, every row is a
 * Vendor: the `type` enum dropped; Internal designation lives in tags[]
 * as the literal string 'Internal Partner'. Category resolves through
 * the new `vendor_categories` lookup via category_id FK.
 *
 * `pastProjectsTouchedCount` per row is best-effort. In 5.2.3 we count
 * the venues a vendor appears in `exclusive_vendor_ids` for; a future
 * sub-phase can add a direct `project_vendors` join when that
 * relationship becomes explicit.
 */

export const INTERNAL_PARTNER_TAG = "Internal Partner";

export type VendorListRow = {
  id: string;
  name: string;
  category_id: string | null;
  category_name: string | null;
  capabilities: string[];
  city: string | null;
  website_url: string | null;
  internal_rating: number | null;
  tags: string[];
  pastProjectsTouchedCount: number;
};

export async function loadVendors(): Promise<VendorListRow[]> {
  const [vendorsRes, venuesRes] = await Promise.all([
    supabase
      .from("vendors")
      .select(
        "id, name, category_id, capabilities, city, website_url, internal_rating, tags, category:vendor_categories!vendors_category_id_fkey(id, name)",
      )
      .order("name", { ascending: true }),
    supabase
      .from("venues")
      .select("exclusive_vendor_ids"),
  ]);

  if (vendorsRes.error) {
    console.warn("vendors load failed", vendorsRes.error);
    return [];
  }

  // Count venues each vendor appears in.
  const touchedCounts = new Map<string, number>();
  for (const v of venuesRes.data ?? []) {
    const ids = (v as { exclusive_vendor_ids: string[] | null }).exclusive_vendor_ids ?? [];
    for (const id of ids) {
      touchedCounts.set(id, (touchedCounts.get(id) ?? 0) + 1);
    }
  }

  return (vendorsRes.data ?? []).map((v) => {
    const row = v as {
      id: string;
      name: string | null;
      category_id: string | null;
      capabilities: string[] | null;
      city: string | null;
      website_url: string | null;
      internal_rating: number | null;
      tags: string[] | null;
      category: { id: string; name: string | null } | null;
    };
    return {
      id: row.id,
      name: row.name ?? "Untitled",
      category_id: row.category_id,
      category_name: row.category?.name ?? null,
      capabilities: row.capabilities ?? [],
      city: row.city,
      website_url: row.website_url,
      internal_rating: row.internal_rating,
      tags: row.tags ?? [],
      pastProjectsTouchedCount: touchedCounts.get(row.id) ?? 0,
    };
  });
}

export function isInternalPartner(tags: string[] | null | undefined): boolean {
  return (tags ?? []).includes(INTERNAL_PARTNER_TAG);
}
