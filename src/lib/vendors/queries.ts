import { supabase } from "@/integrations/supabase/client";

/**
 * Shared loaders + types for Vendors.
 *
 * Replaces `src/lib/organizations/queries.ts` (deleted). After the
 * organizations -> vendors rename in migration 5.2.3.B, every row is a
 * Vendor: the `type` enum dropped; Internal designation lives in tags[]
 * as the literal string 'Internal Partner'. Category resolves through
 * the `vendor_categories` lookup via category_id FK.
 *
 * Phase 5.6.2 additions:
 *   - `subcategory_name` from the new `vendor_subcategories` join via
 *     `vendors.subcategory_id`.
 *   - `recentProjects` (up to 50, ordered by `project_vendors.created_at`
 *     DESC) replaces the `pastProjectsTouchedCount` derived from the
 *     indirect venues join. The list column on VendorsList renders the
 *     first 3 + "+N more" popover via OverflowList.
 */

export const INTERNAL_PARTNER_TAG = "Internal Partner";

export type VendorProjectLink = {
  id: string;
  name: string;
};

export type VendorListRow = {
  id: string;
  name: string;
  category_id: string | null;
  category_name: string | null;
  subcategory_id: string | null;
  subcategory_name: string | null;
  capabilities: string[];
  city: string | null;
  website_url: string | null;
  internal_rating: number | null;
  tags: string[];
  preferred: boolean;
  recentProjects: VendorProjectLink[];
};

export async function loadVendors(): Promise<VendorListRow[]> {
  const [vendorsRes, pvRes] = await Promise.all([
    supabase
      .from("vendors")
      .select(
        "id, name, category_id, subcategory_id, capabilities, city, website_url, internal_rating, tags, preferred, " +
          "category:vendor_categories!vendors_category_id_fkey(id, name), " +
          "subcategory:vendor_subcategories!vendors_subcategory_id_fkey(id, name)",
      )
      .order("name", { ascending: true }),
    supabase
      .from("project_vendors")
      .select(
        "vendor_id, created_at, project:projects!project_vendors_project_id_fkey(id, name)",
      )
      .order("created_at", { ascending: false }),
  ]);

  if (vendorsRes.error) {
    console.warn("vendors load failed", vendorsRes.error);
    return [];
  }

  const projectsByVendor = new Map<string, VendorProjectLink[]>();
  for (const r of pvRes.data ?? []) {
    const row = r as unknown as {
      vendor_id: string | null;
      project: { id: string; name: string | null } | null;
    };
    if (!row.vendor_id || !row.project) continue;
    const list = projectsByVendor.get(row.vendor_id) ?? [];
    list.push({ id: row.project.id, name: row.project.name ?? "Untitled" });
    projectsByVendor.set(row.vendor_id, list);
  }

  return (vendorsRes.data ?? []).map((v) => {
    const row = v as {
      id: string;
      name: string | null;
      category_id: string | null;
      subcategory_id: string | null;
      capabilities: string[] | null;
      city: string | null;
      website_url: string | null;
      internal_rating: number | null;
      tags: string[] | null;
      preferred: boolean | null;
      category: { id: string; name: string | null } | null;
      subcategory: { id: string; name: string | null } | null;
    };
    return {
      id: row.id,
      name: row.name ?? "Untitled",
      category_id: row.category_id,
      category_name: row.category?.name ?? null,
      subcategory_id: row.subcategory_id,
      subcategory_name: row.subcategory?.name ?? null,
      capabilities: row.capabilities ?? [],
      city: row.city,
      website_url: row.website_url,
      internal_rating: row.internal_rating,
      tags: row.tags ?? [],
      preferred: row.preferred ?? false,
      recentProjects: projectsByVendor.get(row.id) ?? [],
    };
  });
}

export function isInternalPartner(tags: string[] | null | undefined): boolean {
  return (tags ?? []).includes(INTERNAL_PARTNER_TAG);
}
