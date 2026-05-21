import { supabase } from "@/integrations/supabase/client";
import type {
  CommitPayload,
  DedupeMatch,
  EntityConfig,
  ResolvedRow,
} from "../types";
import { enumerateUnresolvedRefs, splitMulti } from "../refEnumerate";

/**
 * Vendor EntityConfig (Phase 5.9.3). Second real consumer of the 5.9.1
 * bulk-import primitive. Column keys mirror the shipped template headers
 * verbatim so parsed CSV rows flow straight through to the grid + RPC.
 *
 * Ref kinds (FK columns, NOT free-text-with-lookup like Project's category):
 *   - category    -> vendor_categories     (name match; map-to-existing or queue)
 *   - subcategory -> vendor_subcategories   (name match; depends on category)
 *
 * The subcategory inline-create form carries a plain `parent_category` text
 * field (admin types the parent name). The RPC matches it against the queued
 * categories from THIS batch first, then existing categories, case-insensitive.
 * dependsOn:['category'] keeps Categories at the top of the MapStep resolution
 * list. See decisions § 5.9.3 + spec § 7.
 *
 * capabilities is NOT a ref kind: it's a free-text multi-value `lookup` cell
 * whose novel values auto-create vendor_capabilities rows server-side inside
 * the commit RPC, with the NAME written to vendors.capabilities[]. city is the
 * same lazy-lookup pattern against cities. tags is plain free-text multi-value.
 * preferred is an enum cell ('true' / 'false'); the RPC coerces it to bool.
 *
 * No people-roster handling: vendors have no vendor_account_managers analog.
 * vendor_files / vendor_ratings / project_vendors are populated via the
 * VendorEdit / VendorDetail / ProjectEdit surfaces, not at import time.
 */

const CATEGORY_CREATE_FIELDS = [
  { key: "name", label: "Name", kind: "text" as const, required: true },
];

const SUBCATEGORY_CREATE_FIELDS = [
  { key: "name", label: "Name", kind: "text" as const, required: true },
  { key: "parent_category", label: "Parent Category", kind: "text" as const, required: true },
];

function dedupeKeyFor(name: unknown, city: unknown): string {
  return `${String(name ?? "").trim().toLowerCase()}|${String(city ?? "").trim().toLowerCase()}`;
}

export const vendorConfig: EntityConfig = {
  entity_type: "vendor",
  displayName: "Vendors",
  shortDescription: "Backfill vendors from a CSV export. Admin-only.",
  templateFilename: "bulk-import-vendors-template.csv",

  columns: [
    { key: "name", label: "Name", kind: "text", section: "Required", required: true },
    { key: "category", label: "Category", kind: "refResolved", section: "References", refKind: "category" },
    { key: "subcategory", label: "Subcategory", kind: "refResolved", section: "References", refKind: "subcategory" },
    { key: "capabilities", label: "Capabilities", kind: "lookup", section: "Essentials", lookupTable: "vendor_capabilities", multiValue: true },
    { key: "city", label: "City", kind: "lookup", section: "Essentials", lookupTable: "cities" },
    { key: "primary_address", label: "Primary Address", kind: "text", section: "Essentials" },
    { key: "website_url", label: "Website", kind: "text", section: "Folders & Links" },
    { key: "general_email", label: "General Email", kind: "text", section: "Essentials" },
    { key: "contact_name", label: "Contact Name", kind: "text", section: "Essentials" },
    { key: "contact_email", label: "Contact Email", kind: "text", section: "Essentials" },
    { key: "contact_phone", label: "Contact Phone", kind: "text", section: "Essentials" },
    { key: "preferred", label: "Preferred", kind: "enum", section: "Essentials", enumValues: ["true", "false"] },
    { key: "nationwide", label: "Nationwide", kind: "enum", section: "Essentials", enumValues: ["true", "false"] },
    { key: "tags", label: "Tags", kind: "text", section: "Essentials", multiValue: true },
    { key: "legacy_notes", label: "Notes", kind: "longText", section: "Notes" },
  ],

  unresolvedRefConfig: {
    category: {
      kind: "category",
      label: "Categories",
      resolverTable: "vendor_categories",
      resolverMode: "name",
      allowCreate: true,
      createFields: CATEGORY_CREATE_FIELDS,
    },
    subcategory: {
      kind: "subcategory",
      label: "Subcategories",
      resolverTable: "vendor_subcategories",
      resolverMode: "name",
      allowCreate: true,
      createFields: SUBCATEGORY_CREATE_FIELDS,
      dependsOn: ["category"],
    },
  },

  defaultColumnKeys: [
    "name",
    "category",
    "subcategory",
    "capabilities",
    "city",
    "primary_address",
    "website_url",
    "general_email",
    "contact_name",
    "contact_email",
    "contact_phone",
    "preferred",
    "nationwide",
    "tags",
    "legacy_notes",
  ],

  dedupeKey: (row) => {
    const name = String(row.name ?? "").trim();
    if (!name) return null;
    return dedupeKeyFor(row.name, row.city);
  },

  buildUnresolved: (parsed) => enumerateUnresolvedRefs(vendorConfig, parsed),

  buildDedupe: async (rows: ResolvedRow[]) => {
    const { data, error } = await supabase
      .from("vendors")
      .select("id, name, city");
    if (error || !data) return [];
    const existing = new Map<string, { id: string; label: string }>();
    for (const v of data) {
      const key = dedupeKeyFor(v.name, v.city);
      // Keep the first hit; the RPC re-runs the match authoritatively.
      if (!existing.has(key)) {
        existing.set(key, { id: v.id, label: v.city ? `${v.name} (${v.city})` : v.name });
      }
    }
    const matches: DedupeMatch[] = [];
    for (const r of rows) {
      const name = String(r.values.name ?? "").trim();
      if (!name) continue;
      const key = dedupeKeyFor(r.values.name, r.values.city);
      const hit = existing.get(key);
      if (hit) {
        matches.push({
          row_index: r.row_index,
          match_id: hit.id,
          match_label: hit.label,
          action: "skip",
        });
      }
    }
    return matches;
  },

  buildCommitPayload: (gridRows, mappings, decisions): CommitPayload => {
    const queued_refs: Record<string, Array<Record<string, string>>> = {};
    // Build queue index maps for the name-mode ref kinds (category + subcategory).
    const queuedIndex: Record<string, Map<string, string>> = {};
    for (const kind of ["category", "subcategory"]) {
      const recs = mappings[kind] ?? {};
      const queue: Array<Record<string, string>> = [];
      const idx = new Map<string, string>();
      for (const [raw, res] of Object.entries(recs)) {
        if (res.selection === "") {
          const n = queue.length;
          queue.push({ ...res.createFields, name: res.createFields.name ?? raw });
          idx.set(raw, `_queued:${n}`);
        }
      }
      if (queue.length > 0) queued_refs[kind] = queue;
      queuedIndex[kind] = idx;
    }

    const decisionByRow = new Map<number, DedupeMatch["action"]>();
    for (const d of decisions) decisionByRow.set(d.row_index, d.action);

    const resolveName = (kind: "category" | "subcategory", token: string): string => {
      const res = mappings[kind]?.[token];
      if (res?.selection === "") return queuedIndex[kind].get(token) ?? token;
      if (res?.selection) return res.selection; // existing id
      return token; // pass the name through; the RPC fuzzy-matches
    };

    const rows = gridRows
      .map((row, i) => {
        const categoryRaw = String(row.category ?? "").trim();
        const subcategoryRaw = String(row.subcategory ?? "").trim();
        return {
          name: String(row.name ?? "").trim(),
          category: categoryRaw ? resolveName("category", categoryRaw) : "",
          subcategory: subcategoryRaw ? resolveName("subcategory", subcategoryRaw) : "",
          capabilities: splitMulti(row.capabilities),
          city: String(row.city ?? "").trim(),
          primary_address: String(row.primary_address ?? "").trim(),
          website_url: String(row.website_url ?? "").trim(),
          general_email: String(row.general_email ?? "").trim(),
          contact_name: String(row.contact_name ?? "").trim(),
          contact_email: String(row.contact_email ?? "").trim(),
          contact_phone: String(row.contact_phone ?? "").trim(),
          tags: splitMulti(row.tags),
          preferred: String(row.preferred ?? "").trim(),
          nationwide: String(row.nationwide ?? "").trim(),
          legacy_notes: String(row.legacy_notes ?? "").trim(),
          dedupe_action: decisionByRow.get(i) ?? "create",
        };
      })
      // Drop entirely-empty / name-less rows (e.g. the trailing blank grid row).
      .filter((r) => r.name !== "");

    return { rows, queued_refs };
  },
};
