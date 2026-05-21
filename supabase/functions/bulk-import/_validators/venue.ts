// Server-side last-line validation for the Venues importer (Phase 5.9.4).
//
// Most validation already runs client-side (MapStep / DedupeStep / ImportGrid);
// this mirrors the load-bearing rules in Deno so a hand-crafted POST can't slip
// malformed rows past the gate. The RPC itself enforces the hard invariants
// (admin, venue_type resolve) and rolls back on violation; this returns
// friendly per-row errors before the RPC runs.

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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function checkNonNegInt(
  row: Row,
  column: string,
  i: number,
  errors: ValidationError[],
): void {
  const raw = asString(row[column]);
  if (!raw) return;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    errors.push({
      row_index: i,
      column,
      message: `${column} must be a non-negative whole number (got "${raw}").`,
    });
  }
}

function checkUrl(
  row: Row,
  column: string,
  i: number,
  errors: ValidationError[],
): void {
  const url = asString(row[column]);
  if (!url) return;
  try {
    new URL(url);
  } catch {
    errors.push({
      row_index: i,
      column,
      message: `${column} must be a valid URL (got "${url}").`,
    });
  }
}

export function validateVenueImport(
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

    checkNonNegInt(row, "capacity", i, errors);
    checkNonNegInt(row, "square_footage", i, errors);
    checkNonNegInt(row, "total_sq_ft", i, errors);
    checkNonNegInt(row, "event_day_rate", i, errors);

    const email = asString(row.contact_email);
    if (email && !EMAIL_RE.test(email)) {
      errors.push({
        row_index: i,
        column: "contact_email",
        message: `Contact email looks invalid (got "${email}").`,
      });
    }

    const generalEmail = asString(row.general_email);
    if (generalEmail && !EMAIL_RE.test(generalEmail)) {
      errors.push({
        row_index: i,
        column: "general_email",
        message: `General email looks invalid (got "${generalEmail}").`,
      });
    }

    checkUrl(row, "website_url", i, errors);
    checkUrl(row, "venue_slide_url", i, errors);

    // venue_types: zero or more entries are both valid (locked 2026-05-20:
    // admin can tag the venue with types post-import via VenueEdit if it lands
    // type-less). No minimum-count check.

    // exclusive_vendor_ids is NOT importable (set only on VenueEdit), so the
    // importer never sends or validates it.
  });

  // The browser resolves refs in MapStep; anything unresolved is blocked there
  // before commit. No server-side unresolved detection needed.
  return { errors, unresolved: [] };
}
