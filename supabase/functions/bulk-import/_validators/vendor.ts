// Server-side last-line validation for the Vendors importer (Phase 5.9.3).
//
// Most validation already runs client-side (MapStep / DedupeStep / ImportGrid);
// this mirrors the load-bearing rules in Deno so a hand-crafted POST can't slip
// malformed rows past the gate. The RPC itself enforces the hard invariants
// (admin, subcategory parent resolves) and rolls back on violation; this returns
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

export function validateVendorImport(
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

    const preferred = asString(row.preferred).toLowerCase();
    if (preferred && preferred !== "true" && preferred !== "false") {
      errors.push({
        row_index: i,
        column: "preferred",
        message: `Preferred must be "true" or "false" (got "${asString(row.preferred)}").`,
      });
    }

    const nationwide = asString(row.nationwide).toLowerCase();
    if (nationwide && nationwide !== "true" && nationwide !== "false") {
      errors.push({
        row_index: i,
        column: "nationwide",
        message: `Nationwide must be "true" or "false" (got "${asString(row.nationwide)}").`,
      });
    }

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

    const url = asString(row.website_url);
    if (url) {
      try {
        new URL(url);
      } catch {
        errors.push({
          row_index: i,
          column: "website_url",
          message: `Website must be a valid URL (got "${url}").`,
        });
      }
    }

    // A subcategory only resolves under a parent category. The RPC matches the
    // subcategory name against the resolved category, so a subcategory with no
    // category on the same row can never resolve.
    if (asString(row.subcategory) && !asString(row.category)) {
      errors.push({
        row_index: i,
        column: "subcategory",
        message: "Subcategory requires a Category on the same row.",
      });
    }
  });

  // The browser resolves refs in MapStep; anything unresolved is blocked there
  // before commit. No server-side unresolved detection needed.
  return { errors, unresolved: [] };
}
