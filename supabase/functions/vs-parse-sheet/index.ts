// vs-parse-sheet (Phase 4.4-port rebuild + Phase 4.10.1-port enrichment)
//
// Port of VS Pro `parse-sheet`. Lifts the XLSX parsing + pick() fuzzy header
// matcher verbatim. Swaps bucket name (sourcing-sheets -> sourcing_sheets),
// column rename (type -> venue_type), insert target (venues ->
// vs_candidate_venues), payload field rename (project_id -> scout_id), and
// adds vs-parse-brief-style storage_path validation.
//
// Phase 4.10.1-port adds an AI enrichment pass immediately after the
// parsed-row insert. Per-row callClaude(FILL_TOOL) fills the structured
// fields (venue_type, website_url, size_sq_ft, capacity, key_features,
// recommendations, considerations, rank) so SourcingReport renders sheet
// rows next to research rows without gaping holes. `derived_attrs` is
// intentionally deferred to vs-compile-summaries Pass 1 (vs_scouts.
// derived_columns doesn't exist yet at parse time). Per-row Claude
// failures are tolerated; the function returns the parsed count + an
// enriched_count + failed_count so SourcingReport / future debug UI can
// telemeter without separate logs.
//
// Replaces the failed-attempt vs-parse-sheet in the deployed-function slot.
// Same name, different behavior + shape; no separate cutover deletion needed.
//
// Signature:
//   POST { scout_id, storage_path }
//     -> { count, enriched_count, failed_count }
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
//   6. Filter to non-empty `name`.
//   7. INSERT rows with source: "sheet" + scout_id; capture inserted rows
//      (with id + every column the enrichment patch-guard reads).
//   8. UPDATE vs_scouts.sheet_storage_path = storage_path.
//   9. NEW: load scout brief context, chunk inserted rows into CHUNK_SIZE
//      batches, fire callClaude per row in parallel within each batch and
//      sequential across batches. Apply per-field patches (only fill
//      fields that were null / empty after parse).
//  10. Return { count, enriched_count, failed_count }.
//
// Auth: verify_jwt = true (default; explicit config.toml entry per the
// vs-parse-brief convention). callClaude is the only AI surface. No
// EdgeRuntime.waitUntil -- this function is synchronous by design so
// SheetUpload can navigate to /sourcing/researching after a single
// coherent "wait" state. waitUntil would let the producer click Continue
// mid-enrichment and land on SourcingReport with half-enriched rows.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";
import { callClaude } from "../_shared/anthropic.ts";
import {
  canonicalizeType,
  sanitizeWebsiteUrl,
} from "../_shared/venueTypes.ts";
import {
  buildFillUserMsg,
  FILL_SYSTEM,
  FILL_TOOL,
  type ScoutBrief,
} from "../_shared/venueFill.ts";

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

// Parallel-chunked enrichment. 15 venues in 3 batches at ~5s/call =
// ~15-20s total. Bigger sheets scale linearly: 50 venues = 10 batches
// = ~50-65s, still well under the Supabase Edge Function ~150s soft cap.
// Tuning lever if Anthropic rate-limits show up in logs: drop to 3.
const CHUNK_SIZE = 5;

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

// Multi-token canonicalization for the AI's venue_type output. Matches the
// inline helper in vs-compile-summaries (Pass 1) and vs-research-venues
// exactly; returns null if no token canonicalizes so the patch-guard skips
// the venue_type write rather than landing garbage. Distinct from the
// frontend-style canonicalizeMultiType (which returns the trimmed input on
// no-match so the matrix's TYPE_FALLBACK_STYLE can render an unknown
// pill). Server-side enrichment wants null-on-no-match because we don't
// want to persist non-canonical strings to the DB.
function canonicalizeMulti(raw: string): string | null {
  const tokens = String(raw)
    .split(/[/,]/)
    .map((t) => canonicalizeType(t.trim()))
    .filter((t): t is NonNullable<typeof t> => Boolean(t));
  return tokens.length > 0 ? tokens.join(" / ") : null;
}

// Shape captured back from the INSERT ... RETURNING. Columns mirror the
// patch-guard reads in enrichOne so we never overwrite a producer-entered
// value at enrichment time.
type InsertedRow = {
  id: string;
  name: string;
  neighborhood: string | null;
  address: string | null;
  venue_type: string | null;
  key_features: string[] | null;
  website_url: string | null;
  size_sq_ft: number | null;
  capacity: number | null;
};

async function enrichOne(
  scout_id: string,
  row: InsertedRow,
  scout: ScoutBrief,
  sb: SupabaseClient,
): Promise<{ enriched: boolean; error?: string }> {
  try {
    const userMsg = buildFillUserMsg(scout, {
      name: row.name,
      address: row.address,
      neighborhood: row.neighborhood,
      venue_type: row.venue_type,
    });

    const result = await callClaude(
      "venue_scout",
      [{ role: "user", content: userMsg }],
      {
        max_tokens: 2000,
        system: FILL_SYSTEM,
        tools: [FILL_TOOL],
        tool_choice: { type: "tool", name: "fill_venue" },
        fn_name: "vs-parse-sheet:fill",
      },
    );

    if (!result.ok) {
      console.error(
        `[vs-parse-sheet:fill] scout=${scout_id} venue=${row.id} failed: ${result.error}`,
      );
      return { enriched: false, error: result.error };
    }

    console.log(
      `[vs-parse-sheet:fill] scout=${scout_id} venue=${row.id} model=claude-sonnet-4-6 ` +
        `in=${result.usage?.input_tokens ?? "?"} ` +
        `out=${result.usage?.output_tokens ?? "?"}`,
    );

    const tu = (result.content ?? []).find(
      (b: { type?: string; name?: string }) =>
        b?.type === "tool_use" && b?.name === "fill_venue",
    );
    if (!tu || typeof tu.input !== "object" || tu.input === null) {
      console.warn(
        `[vs-parse-sheet:fill] scout=${scout_id} venue=${row.id} no tool_use`,
      );
      return { enriched: false, error: "no_tool_use" };
    }
    const f = tu.input as Record<string, unknown>;

    // Per-field guards: only write fields that were null / empty after
    // sheet parse. Producer-entered sheet values are preserved untouched.
    // Same patch-guard pattern as vs-compile-summaries Pass 1.
    const patch: Record<string, unknown> = {};

    if (!row.venue_type && typeof f.venue_type === "string") {
      const cleaned = canonicalizeMulti(f.venue_type);
      if (cleaned) patch.venue_type = cleaned;
    }

    if (!row.website_url) {
      const cleaned = sanitizeWebsiteUrl(f.website_url);
      if (cleaned) patch.website_url = cleaned;
    }

    if (row.size_sq_ft == null && typeof f.size_sq_ft === "number") {
      patch.size_sq_ft = f.size_sq_ft;
    }

    if (row.capacity == null && typeof f.capacity === "number") {
      patch.capacity = f.capacity;
    }

    const existingFeatures = Array.isArray(row.key_features)
      ? row.key_features
      : [];
    if (existingFeatures.length === 0 && Array.isArray(f.key_features)) {
      patch.key_features = f.key_features;
    }

    // Recommendations / considerations / rank don't get a "preserve
    // producer value" check because sheet rows never have them at parse
    // time. We just write whatever Claude returned (the tool schema
    // requires both arrays + ranking_score so they're always present on
    // a successful tool_use block).
    if (Array.isArray(f.recommendations)) {
      patch.recommendations = f.recommendations;
    }
    if (Array.isArray(f.considerations)) {
      patch.considerations = f.considerations;
    }
    if (typeof f.ranking_score === "number") {
      // vs_candidate_venues.rank is INTEGER; Math.round defensively in
      // case Claude returns a float (mirrors vs-compile-summaries Pass 1).
      patch.rank = Math.round(f.ranking_score);
    }

    // derived_attrs intentionally NOT filled here. vs_scouts.derived_columns
    // doesn't exist until vs-research-venues runs (next phase in the flow);
    // backfilled by vs-compile-summaries Pass 1 (extended condition in
    // Phase 4.10.1-port to fire for source='sheet' AND derived_attrs empty).

    if (Object.keys(patch).length === 0) {
      return { enriched: false, error: "no_patch" };
    }

    const { error: upErr } = await sb
      .from("vs_candidate_venues")
      .update(patch)
      .eq("id", row.id);
    if (upErr) {
      console.error(
        `[vs-parse-sheet:fill] scout=${scout_id} venue=${row.id} update failed: ${upErr.message}`,
      );
      return { enriched: false, error: upErr.message };
    }
    return { enriched: true };
  } catch (e) {
    console.error(
      `[vs-parse-sheet:fill] scout=${scout_id} venue=${row.id} threw:`,
      e,
    );
    return {
      enriched: false,
      error: e instanceof Error ? e.message : "unknown",
    };
  }
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
      return jsonResponse({ count: 0, enriched_count: 0, failed_count: 0 });
    }

    // VS Pro `venues` -> HQ `vs_candidate_venues`. VS Pro `project_id` ->
    // HQ `scout_id`. source = "sheet" so the producer's later edits in
    // Sourcing Report / Shortlist can distinguish parsed-sheet rows from
    // AI-researched rows.
    const inserts = venues.map((v) => ({ ...v, scout_id, source: "sheet" }));
    const { data: insertedData, error: insErr } = await sb
      .from("vs_candidate_venues")
      .insert(inserts)
      .select(
        "id, name, neighborhood, address, venue_type, key_features, website_url, size_sq_ft, capacity",
      );
    if (insErr) {
      return jsonResponse({ error: `Insert failed: ${insErr.message}` }, 500);
    }
    const insertedRows = (insertedData ?? []) as InsertedRow[];

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

    // === Phase 4.10.1-port: AI enrichment pass ===
    //
    // Load scout brief context once; chunk-fan-out per-row Claude calls
    // inside Promise.all. Per-row failures are tolerated (logged + counted;
    // SourcingReport renders sheet-only data for failed rows next to
    // fully-enriched siblings). compile-summaries Pass 1 (extended in
    // 4.10.1) is the eventual backfill for any rows that miss here.
    const { data: scoutData, error: scoutErr } = await sb
      .from("vs_scouts")
      .select(
        "client_name, event_name, live_dates, city, budget, event_overview, brief_data",
      )
      .eq("id", scout_id)
      .maybeSingle();

    let enrichedTotal = 0;
    let failedTotal = 0;

    if (scoutErr || !scoutData) {
      // Can't enrich without brief context. Log + skip the AI phase; the
      // parsed rows still exist with sheet-only data. compile-summaries
      // Pass 1 (extended condition) will catch them later.
      console.warn(
        `[vs-parse-sheet] scout=${scout_id} could not load brief for enrichment: ${
          scoutErr?.message ?? "not found"
        }`,
      );
      failedTotal = insertedRows.length;
    } else {
      const scout = scoutData as ScoutBrief;
      for (let i = 0; i < insertedRows.length; i += CHUNK_SIZE) {
        const chunk = insertedRows.slice(i, i + CHUNK_SIZE);
        const results = await Promise.all(
          chunk.map((row) => enrichOne(scout_id, row, scout, sb)),
        );
        for (const r of results) {
          if (r.enriched) enrichedTotal++;
          else failedTotal++;
        }
      }
    }

    console.log(
      `[vs-parse-sheet] scout=${scout_id} parsed=${venues.length} enriched=${enrichedTotal} failed=${failedTotal}`,
    );

    return jsonResponse({
      count: venues.length,
      enriched_count: enrichedTotal,
      failed_count: failedTotal,
    });
  } catch (e) {
    console.error("[vs-parse-sheet] unexpected:", e);
    return jsonResponse(
      { error: e instanceof Error ? e.message : "parse failed" },
      500,
    );
  }
});
