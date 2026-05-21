import { supabase } from "@/integrations/supabase/client";
import type {
  CommitPayload,
  DedupeMatch,
  EntityConfig,
  ResolvedRow,
} from "../types";
import { enumerateUnresolvedRefs, splitMulti } from "../refEnumerate";

/**
 * Venue EntityConfig (Phase 5.9.4). Third real consumer of the 5.9.1
 * bulk-import primitive. Column keys mirror the shipped template headers
 * verbatim so parsed CSV rows flow straight through to the grid + RPC.
 *
 * Ref kinds:
 *   - venue_type -> venue_types (name match; map-to-existing or queue).
 *     Multi-value: a venue can carry many types, written through the
 *     venue_venue_types JOIN by the RPC (REPLACE on the dedupe-update path).
 *
 * city is a free-text lookup cell (novel values auto-create cities server-side
 * in the commit RPC). features is plain free-text multi-value with NO companion
 * lookup (no auto-create) — pipe-separated tokens written through to
 * venues.features[]. capacity / square_footage / total_sq_ft are numeric.
 *
 * No people-roster handling: venue staff is out of scope (same rule that gates
 * Project staff). The single contact_name/email/phone per row DOES create a
 * Venue-affiliated people row + a venue_contact_people JOIN row inside the RPC.
 *
 * exclusive_vendor_ids is NOT importable (Jimmie's call 2026-05-20): it is set
 * only on the manual VenueEdit surface, never via bulk import — not via the
 * template and not via the EntityConfig. The RPC never reads or writes the
 * column, so a dedupe-update can't clobber a venue's curated exclusive vendors.
 */

const VENUE_TYPE_CREATE_FIELDS = [
  { key: "name", label: "Name", kind: "text" as const, required: true },
];

function dedupeKeyFor(name: unknown, address: unknown): string {
  return `${String(name ?? "").trim().toLowerCase()}|${String(address ?? "").trim().toLowerCase()}`;
}

export const venueConfig: EntityConfig = {
  entity_type: "venue",
  displayName: "Venues",
  shortDescription: "Backfill venues from a CSV export. Admin-only.",
  templateFilename: "bulk-import-venues-template.csv",

  columns: [
    { key: "name", label: "Name", kind: "text", section: "Required", required: true },
    { key: "address", label: "Address", kind: "text", section: "Essentials" },
    { key: "neighborhood", label: "Neighborhood", kind: "text", section: "Essentials" },
    { key: "city", label: "City", kind: "lookup", section: "Essentials", lookupTable: "cities" },
    { key: "venue_types", label: "Venue Types", kind: "refResolved", section: "References", refKind: "venue_type", multiValue: true },
    { key: "capacity", label: "Capacity", kind: "number", section: "Essentials" },
    { key: "square_footage", label: "Square Footage", kind: "number", section: "Essentials" },
    { key: "total_sq_ft", label: "Total Sq Ft", kind: "number", section: "Essentials" },
    { key: "event_day_rate", label: "Event Day Rate", kind: "money", section: "Essentials" },
    { key: "website_url", label: "Website", kind: "text", section: "Folders & Links" },
    { key: "general_email", label: "General Email", kind: "text", section: "Essentials" },
    { key: "venue_slide_url", label: "Venue Slide", kind: "text", section: "Folders & Links" },
    { key: "contact_name", label: "Contact Name", kind: "text", section: "Essentials" },
    { key: "contact_email", label: "Contact Email", kind: "text", section: "Essentials" },
    { key: "contact_phone", label: "Contact Phone", kind: "text", section: "Essentials" },
    { key: "features", label: "Features", kind: "text", section: "Essentials", multiValue: true },
    { key: "notes", label: "Notes", kind: "longText", section: "Notes" },
  ],

  unresolvedRefConfig: {
    venue_type: {
      kind: "venue_type",
      label: "Venue Types",
      resolverTable: "venue_types",
      resolverMode: "name",
      allowCreate: true,
      createFields: VENUE_TYPE_CREATE_FIELDS,
    },
  },

  // Mirrors the template header order.
  defaultColumnKeys: [
    "name",
    "address",
    "neighborhood",
    "city",
    "venue_types",
    "capacity",
    "square_footage",
    "total_sq_ft",
    "event_day_rate",
    "website_url",
    "general_email",
    "contact_name",
    "contact_email",
    "contact_phone",
    "features",
    "notes",
    "venue_slide_url",
  ],

  dedupeKey: (row) => {
    const name = String(row.name ?? "").trim();
    if (!name) return null;
    return dedupeKeyFor(row.name, row.address);
  },

  buildUnresolved: (parsed) => enumerateUnresolvedRefs(venueConfig, parsed),

  buildDedupe: async (rows: ResolvedRow[]) => {
    const { data, error } = await supabase
      .from("venues")
      .select("id, name, address, city");
    if (error || !data) return [];
    const existing = new Map<string, { id: string; label: string }>();
    for (const v of data) {
      const key = dedupeKeyFor(v.name, v.address);
      // Keep the first hit; the RPC re-runs the match authoritatively.
      if (!existing.has(key)) {
        existing.set(key, { id: v.id, label: v.city ? `${v.name} (${v.city})` : v.name });
      }
    }
    const matches: DedupeMatch[] = [];
    for (const r of rows) {
      const name = String(r.values.name ?? "").trim();
      if (!name) continue;
      const key = dedupeKeyFor(r.values.name, r.values.address);
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
    // venue_type is the only ref kind (exclusive_vendor is not importable).
    const queuedIndex: Record<string, Map<string, string>> = {};
    for (const kind of ["venue_type"]) {
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

    const resolveName = (kind: "venue_type", token: string): string => {
      const res = mappings[kind]?.[token];
      if (res?.selection === "") return queuedIndex[kind]?.get(token) ?? token;
      if (res?.selection) return res.selection; // existing id
      return token; // pass the name through; the RPC fuzzy-matches
    };

    const rows = gridRows
      .map((row, i) => {
        return {
          name: String(row.name ?? "").trim(),
          address: String(row.address ?? "").trim(),
          neighborhood: String(row.neighborhood ?? "").trim(),
          city: String(row.city ?? "").trim(),
          venue_types: splitMulti(row.venue_types).map((t) => resolveName("venue_type", t)),
          capacity: String(row.capacity ?? "").trim(),
          square_footage: String(row.square_footage ?? "").trim(),
          total_sq_ft: String(row.total_sq_ft ?? "").trim(),
          event_day_rate: String(row.event_day_rate ?? "").trim(),
          venue_slide_url: String(row.venue_slide_url ?? "").trim(),
          website_url: String(row.website_url ?? "").trim(),
          general_email: String(row.general_email ?? "").trim(),
          contact_name: String(row.contact_name ?? "").trim(),
          contact_email: String(row.contact_email ?? "").trim(),
          contact_phone: String(row.contact_phone ?? "").trim(),
          features: splitMulti(row.features),
          notes: String(row.notes ?? "").trim(),
          dedupe_action: decisionByRow.get(i) ?? "create",
        };
      })
      // Drop entirely-empty / name-less rows (e.g. the trailing blank grid row).
      .filter((r) => r.name !== "");

    return { rows, queued_refs };
  },
};
