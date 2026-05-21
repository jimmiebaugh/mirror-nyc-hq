// Server-side last-line validation for the Projects importer (Phase 5.9.2).
//
// Most validation already runs client-side (MapStep / DedupeStep / ImportGrid);
// this mirrors the load-bearing rules in Deno so a hand-crafted POST can't slip
// malformed rows past the gate. The RPC itself enforces the hard invariants
// (admin, venue resolves) and rolls back on violation; this returns friendly
// per-row errors before the RPC runs.

type ValidationError = {
  row_index: number;
  column: string;
  message: string;
};

type UnresolvedRef = {
  kind: string;
  raw_value: string;
  row_indices: number[];
};

type Row = Record<string, unknown>;

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

const VALID_STATUS = new Set([
  "Approved",
  "In Production",
  "In Progress",
  "Location Scouting",
  "Install",
  "Removal",
  "Billing",
  "Queued",
  "Quoting",
  "Quote Sent",
  "Awaiting Feedback",
  "On Hold",
  "Complete",
  "Cancelled",
]);

const DATE_KEYS = [
  "live_start",
  "live_end",
  "install_start",
  "install_end",
  "removal_start",
  "removal_end",
];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function validateProjectImport(
  rows: Row[],
  _queued_refs: Record<string, Array<Record<string, unknown>>>,
): { errors: ValidationError[]; unresolved: UnresolvedRef[] } {
  const errors: ValidationError[] = [];

  rows.forEach((row, i) => {
    // Skipped rows aren't written, so don't validate them.
    if (asString(row.dedupe_action) === "skip") return;

    if (!asString(row.name)) {
      errors.push({ row_index: i, column: "name", message: "Name is required." });
    }

    const status = asString(row.status);
    if (status && !VALID_STATUS.has(status)) {
      errors.push({
        row_index: i,
        column: "status",
        message: `Unknown status "${status}".`,
      });
    }

    for (const key of DATE_KEYS) {
      const d = asString(row[key]);
      if (d && !ISO_DATE.test(d)) {
        errors.push({
          row_index: i,
          column: key,
          message: `Date must be YYYY-MM-DD (got "${d}").`,
        });
      }
    }

    const budget = asString(row.budget);
    if (budget && Number.isNaN(Number(budget))) {
      errors.push({
        row_index: i,
        column: "budget",
        message: `Budget must be numeric (got "${budget}").`,
      });
    }
  });

  // The browser resolves refs in MapStep; anything unresolved is blocked there
  // before commit. No server-side unresolved detection needed.
  return { errors, unresolved: [] };
}
