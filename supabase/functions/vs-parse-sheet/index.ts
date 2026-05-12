// vs-parse-sheet (Phase 4.4-port rebuild)
//
// Port of VS Pro `parse-sheet`. Lifts the XLSX parsing + pick() fuzzy header
// matcher verbatim. Swaps bucket name (sourcing-sheets -> sourcing_sheets),
// column rename (type -> venue_type), insert target (venues ->
// vs_candidate_venues), payload field rename (project_id -> scout_id), and
// adds vs-parse-brief-style storage_path validation.
//
// Replaces the failed-attempt vs-parse-sheet in the deployed-function slot.
// Same name, different behavior + shape; no separate cutover deletion needed.
//
// Signature:
//   POST { scout_id, storage_path } -> { count } | { error }
//
// Flow:
//   1. Validate scout_id UUID; storage_path prefixed with `${scout_id}/`,
//      ends with .pdf|.xlsx|.csv, no `..` traversal.
//   2. Download via service-role client from sourcing_sheets bucket.
//   3. PDF -> empty rows (naive fallback lifted from VS Pro; the frontend
//      routes to empty-sheet error when count=0).
//   4. XLSX / CSV -> XLSX.read + first-sheet sheet_to_json.
//   5. Map rows to vs_candidate_venues records via pick() fuzzy match.
//   6. Filter to non-empty `name`.
//   7. INSERT rows with source: "sheet" + scout_id.
//   8. UPDATE vs_scouts.sheet_storage_path = storage_path.
//   9. Return { count }.
//
// Auth: verify_jwt = true (default; explicit config.toml entry per the
// vs-parse-brief convention). No callClaude; no AI. No EdgeRuntime.waitUntil.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

// User-invoked synchronous only; no internal-secret path. Don't advertise
// `x-internal-secret` to the browser preflight (caught by code-reviewer
// during 4.4-port; same cleanup applied to vs-parse-brief in this commit).
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
// deno-lint-ignore no-explicit-any
function pick(row: Record<string, any>, keys: string[]): string | null {
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

    // deno-lint-ignore no-explicit-any
    let rows: Record<string, any>[] = [];
    if (ext === "pdf") {
      // Naive PDF behavior, lifted verbatim from VS Pro. Returns 0 venues;
      // the frontend routes to /sourcing/error/empty-sheet. Improving this
      // (real PDF table extraction) is out of port scope per the spec.
      rows = [];
    } else {
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      // deno-lint-ignore no-explicit-any
      rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "" });
    }

    const venues = rows
      .map((r) => ({
        name: pick(r, ["name", "venue"]),
        neighborhood: pick(r, ["neighborhood", "area", "district"]),
        address: pick(r, ["address", "location"]),
        // VS Pro `type` -> HQ `venue_type` (port plan-locked rename;
        // `type` reads as a Postgres / TS reserved word and was renamed at
        // 4.1-port migration time).
        venue_type: pick(r, ["type", "category"]),
        size_sq_ft: (() => {
          const v = pick(r, ["sq ft", "sqft", "size"]);
          if (!v) return null;
          const n = parseInt(v.replace(/[^\d]/g, ""), 10);
          return Number.isFinite(n) ? n : null;
        })(),
        key_features: (() => {
          const v = pick(r, ["features", "feature", "notes"]);
          return v
            ? v.split(/[,;|\n]/).map((s) => s.trim()).filter(Boolean)
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
    // AI-researched rows.
    const inserts = venues.map((v) => ({ ...v, scout_id, source: "sheet" }));
    const { error: insErr } = await sb.from("vs_candidate_venues").insert(inserts);
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
      // Log but don't fail the whole call -- the producer sees the parsed
      // count and can move forward.
      console.warn(
        `[vs-parse-sheet] sheet_storage_path update failed for scout ${scout_id}: ${updErr.message}`,
      );
    }

    return jsonResponse({ count: venues.length });
  } catch (e) {
    console.error("[vs-parse-sheet] unexpected:", e);
    return jsonResponse(
      { error: e instanceof Error ? e.message : "parse failed" },
      500,
    );
  }
});
