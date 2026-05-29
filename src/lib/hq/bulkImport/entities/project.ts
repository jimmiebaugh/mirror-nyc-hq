import { supabase } from "@/integrations/supabase/client";
import { PROJECT_STATUS_VALUES } from "@/lib/projects/queries";
import type {
  CommitPayload,
  DedupeMatch,
  EntityConfig,
  ResolvedRow,
  RowValidationError,
} from "../types";
import { enumerateUnresolvedRefs, splitMulti } from "../refEnumerate";
import { asImportString, isValidMoney, normalizeMoney, pushError } from "../validation";

/**
 * Project EntityConfig (Phase 5.9.2). First real consumer of the 5.9.1
 * bulk-import primitive. Column keys mirror the shipped template headers
 * verbatim so parsed CSV rows flow straight through to the grid + RPC.
 *
 * Ref kinds:
 *   - client  -> clients   (name match; map-to-existing or queue create)
 *   - venue   -> venues    (name match; map-to-existing or queue create)
 *
 * People roster (Account Lead / Designer / Team Members) is intentionally NOT
 * importable: it's set retroactively on the project's edit page after import.
 *
 * category / city are NOT ref kinds: they're free-text lookup cells whose
 * novel values auto-create server-side inside the commit RPC (locked
 * auto-create, decisions § 5.9.2). tags is free-text multi-value.
 */

const CLIENT_CREATE_FIELDS = [
  { key: "name", label: "Name", kind: "text" as const, required: true },
  { key: "industry", label: "Industry", kind: "text" as const },
];

const VENUE_CREATE_FIELDS = [
  { key: "name", label: "Name", kind: "text" as const, required: true },
];

function dedupeKeyFor(name: unknown, jobNumber: unknown): string {
  return `${String(name ?? "").trim().toLowerCase()}|${String(jobNumber ?? "").trim()}`;
}

const DATE_KEYS = [
  "live_start",
  "live_end",
  "install_start",
  "install_end",
  "removal_start",
  "removal_end",
] as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function validateProjectRows(rows: Record<string, unknown>[]): RowValidationError[] {
  const errors: RowValidationError[] = [];
  rows.forEach((row, i) => {
    if (asImportString(row.dedupe_action) === "skip") return;

    if (!asImportString(row.name)) {
      pushError(errors, i, "name", "Name is required.");
    }

    const status = asImportString(row.status);
    if (status && !PROJECT_STATUS_VALUES.includes(status as (typeof PROJECT_STATUS_VALUES)[number])) {
      pushError(errors, i, "status", `Unknown status "${status}".`);
    }

    for (const key of DATE_KEYS) {
      const date = asImportString(row[key]);
      if (date && !ISO_DATE.test(date)) {
        pushError(errors, i, key, `Date must be YYYY-MM-DD (got "${date}").`);
      }
    }

    const budget = asImportString(row.budget);
    if (budget && !isValidMoney(budget)) {
      pushError(errors, i, "budget", `Budget must be numeric (got "${budget}").`);
    }
  });
  return errors;
}

export const projectConfig: EntityConfig = {
  entity_type: "project",
  displayName: "Projects",
  shortDescription: "Backfill past projects from a CSV export. Admin-only.",
  templateFilename: "bulk-import-projects-template.csv",

  columns: [
    { key: "name", label: "Name", kind: "text", section: "Required", required: true },
    { key: "job_number", label: "Job #", kind: "text", section: "Essentials" },
    { key: "client", label: "Client", kind: "refResolved", section: "References", refKind: "client" },
    {
      key: "status",
      label: "Status",
      kind: "enum",
      section: "Essentials",
      enumValues: PROJECT_STATUS_VALUES,
    },
    { key: "category", label: "Category", kind: "lookup", section: "Essentials", lookupTable: "project_categories" },
    { key: "city", label: "City", kind: "lookup", section: "Essentials", lookupTable: "cities" },
    { key: "tags", label: "Tags", kind: "text", section: "Essentials", multiValue: true },
    { key: "budget", label: "Budget", kind: "money", section: "Essentials" },
    { key: "live_start", label: "Live Start", kind: "date", section: "Dates & Phases" },
    { key: "live_end", label: "Live End", kind: "date", section: "Dates & Phases" },
    { key: "install_start", label: "Install Start", kind: "date", section: "Dates & Phases" },
    { key: "install_end", label: "Install End", kind: "date", section: "Dates & Phases" },
    { key: "removal_start", label: "Removal Start", kind: "date", section: "Dates & Phases" },
    { key: "removal_end", label: "Removal End", kind: "date", section: "Dates & Phases" },
    { key: "venue", label: "Venue", kind: "refResolved", section: "References", refKind: "venue", multiValue: true },
    { key: "production_folder_url", label: "Production Folder", kind: "text", section: "Folders & Links" },
    { key: "design_decks_folder_url", label: "Design Decks Folder", kind: "text", section: "Folders & Links" },
    { key: "budget_sheet_url", label: "Budget Sheet", kind: "text", section: "Folders & Links" },
    { key: "slack_channel_url", label: "Slack Channel", kind: "text", section: "Folders & Links" },
  ],

  unresolvedRefConfig: {
    client: {
      kind: "client",
      label: "Clients",
      resolverTable: "clients",
      resolverMode: "name",
      allowCreate: true,
      createFields: CLIENT_CREATE_FIELDS,
    },
    venue: {
      kind: "venue",
      label: "Venues",
      resolverTable: "venues",
      resolverMode: "name",
      allowCreate: true,
      createFields: VENUE_CREATE_FIELDS,
    },
  },

  defaultColumnKeys: [
    "name",
    "job_number",
    "client",
    "status",
    "category",
    "city",
    "tags",
    "budget",
    "live_start",
    "live_end",
    "venue",
  ],

  dedupeKey: (row) => {
    const name = String(row.name ?? "").trim();
    if (!name) return null;
    return dedupeKeyFor(row.name, row.job_number);
  },

  buildUnresolved: (parsed) => enumerateUnresolvedRefs(projectConfig, parsed),

  buildDedupe: async (rows: ResolvedRow[]) => {
    const { data, error } = await supabase
      .from("projects")
      .select("id, name, job_number")
      .is("archived_at", null);
    if (error || !data) return [];
    const existing = new Map<string, { id: string; label: string }>();
    for (const p of data) {
      const key = dedupeKeyFor(p.name, p.job_number);
      // Keep the first hit; the RPC re-runs the match authoritatively.
      if (!existing.has(key)) {
        existing.set(key, { id: p.id, label: p.job_number ? `${p.name} (#${p.job_number})` : p.name });
      }
    }
    const matches: DedupeMatch[] = [];
    for (const r of rows) {
      const name = String(r.values.name ?? "").trim();
      if (!name) continue;
      const key = dedupeKeyFor(r.values.name, r.values.job_number);
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

  validateRows: (rows) => validateProjectRows(rows),

  buildCommitPayload: (gridRows, mappings, decisions): CommitPayload => {
    const queued_refs: Record<string, Array<Record<string, string>>> = {};
    // Build queue index maps for the name-mode ref kinds (client + venue).
    const queuedIndex: Record<string, Map<string, string>> = {};
    for (const kind of ["client", "venue"]) {
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

    const resolveName = (kind: "client" | "venue", token: string): string => {
      const res = mappings[kind]?.[token];
      if (res?.selection === "") return queuedIndex[kind].get(token) ?? token;
      if (res?.selection) return res.selection; // existing id
      return token; // pass the name through; the RPC fuzzy-matches
    };

    const rows = gridRows
      .map((row, i) => {
        const clientRaw = String(row.client ?? "").trim();
        return {
          name: String(row.name ?? "").trim(),
          job_number: String(row.job_number ?? "").trim(),
          client: clientRaw ? resolveName("client", clientRaw) : "",
          status: String(row.status ?? "").trim(),
          category: String(row.category ?? "").trim(),
          city: String(row.city ?? "").trim(),
          tags: splitMulti(row.tags),
          budget: normalizeMoney(row.budget),
          live_start: String(row.live_start ?? "").trim(),
          live_end: String(row.live_end ?? "").trim(),
          install_start: String(row.install_start ?? "").trim(),
          install_end: String(row.install_end ?? "").trim(),
          removal_start: String(row.removal_start ?? "").trim(),
          removal_end: String(row.removal_end ?? "").trim(),
          production_folder_url: String(row.production_folder_url ?? "").trim(),
          design_decks_folder_url: String(row.design_decks_folder_url ?? "").trim(),
          budget_sheet_url: String(row.budget_sheet_url ?? "").trim(),
          slack_channel_url: String(row.slack_channel_url ?? "").trim(),
          venue: splitMulti(row.venue).map((t) => resolveName("venue", t)),
          dedupe_action: decisionByRow.get(i) ?? "create",
        };
      })
      // Drop entirely-empty / name-less rows (e.g. the trailing blank grid row).
      .filter((r) => r.name !== "");

    return { rows, queued_refs };
  },
};
