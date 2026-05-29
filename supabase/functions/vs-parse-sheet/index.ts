// vs-parse-sheet (Phase 4.4-port rebuild + Phase 4.10.3-port restructure)
//
// Port of VS Pro `parse-sheet`. Lifts the XLSX parsing + pick() fuzzy header
// matcher verbatim. Swaps bucket name (sourcing-sheets -> sourcing_sheets),
// column rename (type -> venue_type), insert target (venues ->
// vs_candidate_venues), payload field rename (project_id -> scout_id), and
// adds vs-parse-brief-style storage_path validation.
//
// Phase 4.10.1-port added an AI enrichment pass after insert. Phase 4.10.3-port
// REMOVES that enrichment pass and consolidates all AI venue work into
// vs-research-venues (Phase A: per-row enrichment of source='sheet' rows;
// Phase B: existing sourcing of new venues). Justification (decisions.md):
// forced tool_choice + server-side web_search produced empty fill_venue tool
// calls on every row (out=113-139 tokens) at smoke 2026-05-13; consolidating
// into vs-research-venues removes one Claude surface, lets the sheet upload
// be instant, and centralizes web_search + validation in a single function.
//
// Phase 4.10.3-port also adds two parser improvements that stay here even
// after the AI move: (1) website_url + capacity get picked from the sheet
// (VS Pro dropped them, forcing the AI to re-find what the producer had
// already entered); (2) keyword lists expanded for natural producer header
// variants.
//
// Replaces the failed-attempt vs-parse-sheet in the deployed-function slot.
// Same name, different behavior + shape; no separate cutover deletion needed.
//
// Signature (Phase 4.10.3-port shape):
//   POST { scout_id, storage_path }
//     -> { count }
//     -> { error }
//
// Flow:
//   1. Validate scout_id UUID; storage_path prefixed with `${scout_id}/`,
//      ends with .pdf|.xlsx|.csv, no `..` traversal.
//   2. Download via service-role client from sourcing_sheets bucket.
//   3. PDF -> empty rows (naive fallback lifted from VS Pro; the frontend
//      routes to empty-sheet error when count=0).
//   4. XLSX / CSV -> XLSX.read + first-sheet sheet_to_json.
//   5. Map rows to vs_candidate_venues records via pick() fuzzy match.
//      website_url runs through sanitizeWebsiteUrl (catches search pages +
//      listing-DB bare homepages). capacity + size both digits-only parse.
//   6. Filter to non-empty `name`.
//   7. INSERT rows with source: "sheet" + scout_id.
//   8. UPDATE vs_scouts.sheet_storage_path = storage_path.
//   9. Return { count }. AI enrichment is now vs-research-venues' job.
//
// Auth: verify_jwt = true. Synchronous handshake; no waitUntil. The function
// returns in well under a second now that AI work is gone.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
// SheetJS 0.20.3 patched build, vendored locally (Phase 5.16.1.2). The npm /
// esm.sh `xlsx@0.18.5` carried unpatched prototype-pollution + ReDoS advisories
// (npm tops out at 0.18.5); SheetJS ships the patched build only via their CDN,
// which the Supabase edge bundler rejects at deploy time ("Cannot import from
// cdn.sheetjs.com:443"). So the patched ESM build is vendored under
// _shared/vendor/ and imported locally (the bundler bundles local files fine).
// Same `read` + `utils.sheet_to_json` surface used below. Provenance + update
// steps in _shared/vendor/README.md; see code-observations Edge #21.
import * as XLSX from "../_shared/vendor/xlsx.mjs";
import { sanitizeWebsiteUrl } from "../_shared/venueTypes.ts";
import { splitMultiValue } from "../_shared/multiValue.ts";

// User-invoked synchronous only; no internal-secret path.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_EXTS = new Set(["pdf", "xlsx", "csv"]);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Lifted verbatim from VS Pro parse-sheet/index.ts. Matches the first row
// key whose lowercase form contains any of the candidate substrings.
// XLSX sheet rows are open-shaped (cell values can be string/number/bool/
// Date), so the value type is genuinely `unknown`; String(v) coerces it.
function pick(row: Record<string, unknown>, keys: string[]): string | null {
  for (const k of Object.keys(row)) {
    const norm = k.toLowerCase().trim();
    if (keys.some((kk) => norm.includes(kk))) {
      const v = row[k];
      if (v != null && String(v).trim()) return String(v).trim();
    }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  let body: { scout_id?: string; storage_path?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const scout_id = (body.scout_id ?? "").trim();
  const storage_path = (body.storage_path ?? "").trim();

  if (!UUID_RE.test(scout_id)) {
    return jsonResponse({ error: "scout_id must be a UUID" }, 400);
  }
  if (!storage_path.startsWith(`${scout_id}/`)) {
    return jsonResponse(
      { error: "storage_path must live under '<scout_id>/'" },
      400,
    );
  }
  // Defense-in-depth (parallel to vs-parse-brief 4.3-port). Supabase Storage
  // is S3-backed and treats `..` as literal characters today; reject anyway
  // for any future backend that might interpret directory traversal.
  if (storage_path.includes("..")) {
    return jsonResponse({ error: "storage_path may not contain '..'" }, 400);
  }
  const ext = storage_path.toLowerCase().split(".").pop() ?? "";
  if (!ALLOWED_EXTS.has(ext)) {
    return jsonResponse({ error: "Extension must be .pdf, .xlsx, or .csv" }, 400);
  }

  // Service-role client. User JWT is verified at the gateway; we don't need
  // the user identity downstream.
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { data: file, error: dlErr } = await sb.storage
      .from("sourcing_sheets")
      .download(storage_path);
    if (dlErr || !file) {
      return jsonResponse(
        { error: `Could not read sheet: ${dlErr?.message ?? "not found"}` },
        500,
      );
    }
    const buf = new Uint8Array(await file.arrayBuffer());

    let rows: Record<string, unknown>[] = [];
    if (ext === "pdf") {
      // Naive PDF behavior, lifted verbatim from VS Pro. Returns 0 venues;
      // the frontend routes to /sourcing/error/empty-sheet. Improving this
      // (real PDF table extraction) is out of port scope per the spec.
      rows = [];
    } else {
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: "",
      });
    }

    const venues = rows
      .map((r) => ({
        // Phase 4.10.3-port: keyword lists expanded for natural producer
        // header variants. pick() is fuzzy includes() so any substring
        // match in any header lands. Collision note: keep "Venue Name"
        // left of "Venue Type" in the sheet -- pick(name) iterates row
        // keys in column order and "Venue Type" also matches "venue".
        name: pick(r, ["name", "venue"]),
        neighborhood: pick(r, [
          "neighborhood",
          "area",
          "district",
          "hood",
          "borough",
        ]),
        address: pick(r, ["address", "location"]),
        // VS Pro `type` -> HQ `venue_type` (port-locked rename; `type` is a
        // reserved word, renamed at 4.1-port). v1.0 producer contract: split the
        // producer cell on PIPE `|` only (via splitMultiValue), so a slash in a
        // type name (e.g. "Theatre/Auditorium") survives this initial parse. The
        // " / " re-join below is INTERNAL LEGACY SERIALIZATION for downstream
        // compat, NOT producer input syntax: the VS-internal `venue_type` is
        // consumed by `sanitizeMultiAgainst` + matrix `parseTypes`, which still
        // slash-split, so a canonical type name containing `/` can still split
        // later in those paths (full realign is a post-v1 refactor; see
        // code-observations Edge #34).
        venue_type: (() => {
          const v = pick(r, ["type", "category", "kind"]);
          if (!v) return v;
          const tokens = splitMultiValue(v);
          return tokens.length ? tokens.join(" / ") : v;
        })(),
        // Phase 4.10.3-port: extract producer-entered URL + capacity from
        // sheet columns. VS Pro's parse-sheet dropped both fields; the
        // enrichment pass was then forced to web_search for URLs Claude
        // could have inherited from the producer's input. sanitizeWebsiteUrl
        // (not validateWebsiteUrl) at parse time -- producer-typed URLs
        // are trusted input; no HEAD check for hundreds of rows. The
        // enrichOne pass in vs-research-venues uses validateWebsiteUrl
        // only for AI-emitted URLs.
        website_url: (() => {
          const v = pick(r, [
            "website",
            "url",
            "site",
            "link",
            "web",
            "homepage",
          ]);
          return v ? sanitizeWebsiteUrl(v) : null;
        })(),
        capacity: (() => {
          const v = pick(r, [
            "capacity",
            "occupancy",
            "max guests",
            "max",
            "guests",
            "people",
            "pax",
            "headcount",
            "attendance",
            "seats",
            "seating",
          ]);
          if (!v) return null;
          const n = parseInt(v.replace(/[^\d]/g, ""), 10);
          return Number.isFinite(n) ? n : null;
        })(),
        size_sq_ft: (() => {
          const v = pick(r, [
            "sq ft",
            "sqft",
            "size",
            "square footage",
            "footage",
            "feet",
          ]);
          if (!v) return null;
          const n = parseInt(v.replace(/[^\d]/g, ""), 10);
          return Number.isFinite(n) ? n : null;
        })(),
        key_features: (() => {
          const v = pick(r, [
            "features",
            "feature",
            "notes",
            "amenities",
            "highlights",
            "description",
            "details",
          ]);
          // v1.0: split on pipe `|` + newline only, so slash/comma feature
          // names stay intact (comma is the CSV column delimiter, not a
          // multi-value separator).
          return v
            ? v.split(/[|\n]/).map((s) => s.trim()).filter(Boolean)
            : [];
        })(),
      }))
      .filter((v) => v.name);

    if (venues.length === 0) {
      return jsonResponse({ count: 0 });
    }

    // VS Pro `venues` -> HQ `vs_candidate_venues`. VS Pro `project_id` ->
    // HQ `scout_id`. source = "sheet" so the producer's later edits in
    // Sourcing Report / Shortlist can distinguish parsed-sheet rows from
    // AI-researched rows. vs-research-venues' Phase A picks these rows up
    // and enriches them via callClaude(fill_venue + web_search).
    const inserts = venues.map((v) => ({ ...v, scout_id, source: "sheet" }));
    const { error: insErr } = await sb
      .from("vs_candidate_venues")
      .insert(inserts);
    if (insErr) {
      return jsonResponse({ error: `Insert failed: ${insErr.message}` }, 500);
    }

    // Record the source-of-truth storage path on the scout so future
    // re-parse / audit can locate the original sheet.
    const { error: updErr } = await sb
      .from("vs_scouts")
      .update({ sheet_storage_path: storage_path })
      .eq("id", scout_id);
    if (updErr) {
      // Insert succeeded; sheet_storage_path update is a soft secondary.
      console.warn(
        `[vs-parse-sheet] sheet_storage_path update failed for scout ${scout_id}: ${updErr.message}`,
      );
    }

    console.log(
      `[vs-parse-sheet] scout=${scout_id} parsed=${venues.length} (AI enrichment deferred to vs-research-venues)`,
    );

    return jsonResponse({ count: venues.length });
  } catch (e) {
    console.error("[vs-parse-sheet] unexpected:", e);
    return jsonResponse(
      { error: e instanceof Error ? e.message : "unknown" },
      500,
    );
  }
});
