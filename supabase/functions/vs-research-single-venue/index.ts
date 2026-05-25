// vs-research-single-venue (Phase 5.12.7 Feature C)
//
// Single-venue mode of `vs-research-venues` Phase A's `enrichSheetVenue`
// shape: one Claude `fill_venue` tool call (forced `auto` tool_choice +
// web_search) plus per-field defensive patch guards that only fill empty
// columns. Used by Shortlist's pitch-toggle-on path for source='manual'
// rows: when a producer promotes a bare manual row to pitch, this fires
// asynchronously + writes recs/cons/rank + structural fields without
// blocking the toggle UX.
//
// Auth posture: verify_jwt = true. User-invoked synchronous (Claude call
// ~10-20s; sync is fine for v1; swap to EdgeRuntime.waitUntil + Realtime
// in a follow-on if latency becomes a UX problem).
//
// Cross-scout poisoning defense (load-bearing): vs_* RLS is
// open-authenticated to every authenticated user (see
// docs/auth-model.md), so function-level authorization is the ONLY thing
// that stops a producer from invoking this against any vs_candidate_venues
// row in the system. Three gates enforced inline before any Claude call:
//   1. venue.scout_id MUST equal the body's scout_id (SELECT predicate
//      filters; missing row => 404).
//   2. venue.source MUST be 'manual' OR 'hq_pool' (SELECT predicate
//      filters; both are producer-added rows that need per-brief
//      judgment fill -- manual rows from the SourcingReport manual-add
//      row, hq_pool rows from the SourcingReport HQ Venue picker that
//      land AFTER research-time Feature B enrichment ran). 'sheet' rows
//      go through vs-research-venues Phase A; 'research' rows are
//      already fully populated by Phase B.
//   3. scout.current_step MUST be one of the post-research states the
//      producer can legitimately be in when the Continue button on
//      SourcingReport fires this function (sourcing_report on click;
//      shortlist | review_selects | deck_prep on back-button re-fires).
//      Reject from researching / compiling / generating_deck so a stale
//      tab can't poison an in-flight scout's pipeline.
//
// Reuses `buildFillUserMsg` + `FILL_SYSTEM` + `FILL_TOOL` byte-for-byte
// from _shared/venueFill.ts. Apply-side patch guards mirror Pass 1 +
// Phase A: only fill empty columns so producer-entered values stay
// authoritative.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callClaude } from "../_shared/anthropic.ts";
import {
  getVenueTypesCanonicalSet,
  sanitizeMultiAgainst,
  sanitizeTagShape,
  stripPlaceholders,
} from "../_shared/venueTypes.ts";
import { validateWebsiteUrl } from "../_shared/urlValidation.ts";
import {
  buildFillUserMsg,
  FILL_SYSTEM,
  FILL_TOOL,
  type ScoutBrief,
} from "../_shared/venueFill.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Scout states from which auto-research is legitimate.
// `sourcing_report` is the primary callsite (SourcingReport's Continue
// button fires this for every unenriched producer-added row before
// transitioning to shortlist). `shortlist` / `review_selects` /
// `deck_prep` are reachable via back-button from later steps and may
// re-fire the function for any newly-added rows. Reject from
// `researching` / `compiling` / `generating_deck` so a stale tab can't
// poison an in-flight scout's pipeline.
const VALID_SCOUT_STATES = new Set([
  "sourcing_report",
  "shortlist",
  "review_selects",
  "deck_prep",
]);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  let body: { venue_id?: string; scout_id?: string };
  try {
    body = (await req.json()) as { venue_id?: string; scout_id?: string };
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const venue_id = (body.venue_id ?? "").trim();
  const scout_id = (body.scout_id ?? "").trim();
  if (!UUID_RE.test(venue_id)) {
    return jsonResponse({ error: "venue_id must be a UUID" }, 400);
  }
  if (!UUID_RE.test(scout_id)) {
    return jsonResponse({ error: "scout_id must be a UUID" }, 400);
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Authorization gates (load-bearing; see docblock). All three predicates
  // are in the SELECT itself so a forbidden invocation returns the same
  // 404 as a genuinely-missing row, surfacing nothing useful to a probe.
  const [venueResp, scoutResp] = await Promise.all([
    sb
      .from("vs_candidate_venues")
      .select(
        "id, scout_id, source, name, address, neighborhood, venue_type, website_url, notes, recommendations, considerations, rank, key_features, size_sq_ft, capacity, venue_overview, derived_attrs",
      )
      .eq("id", venue_id)
      .eq("scout_id", scout_id)
      .in("source", ["manual", "hq_pool"])
      .maybeSingle(),
    sb
      .from("vs_scouts")
      .select(
        "id, client_name, event_name, city, live_dates, budget, event_overview, brief_data, current_step",
      )
      .eq("id", scout_id)
      .maybeSingle(),
  ]);

  if (venueResp.error || !venueResp.data) {
    return jsonResponse(
      {
        ok: false,
        error:
          "Venue not found, not owned by this scout, or not a producer-added row (source must be manual or hq_pool)",
      },
      404,
    );
  }
  if (scoutResp.error || !scoutResp.data) {
    return jsonResponse(
      {
        ok: false,
        error: `Could not load scout: ${scoutResp.error?.message ?? "not found"}`,
      },
      404,
    );
  }

  const venue = venueResp.data;
  const scout = scoutResp.data;

  if (
    typeof scout.current_step !== "string" ||
    !VALID_SCOUT_STATES.has(scout.current_step)
  ) {
    return jsonResponse(
      {
        ok: false,
        error: `Invalid scout state for single-venue research: ${scout.current_step ?? "(null)"}`,
      },
      409,
    );
  }

  // "Already enriched" short-circuit: when the row's recommendations are
  // already populated, return ok with an empty patch so the client treats
  // it as a successful no-op. Mirrors the `vs-research-single-venue`
  // spec § 9.2 step 2 contract; producers who un-pitch then re-pitch a
  // previously-enriched manual row don't burn a second Claude call.
  const existingRecs = Array.isArray(venue.recommendations)
    ? (venue.recommendations as string[])
    : [];
  if (existingRecs.length > 0) {
    return jsonResponse({ ok: true, patch: {} });
  }

  // Phase 5.12.10: runtime canonical venue-types set. Threaded into
  // buildFillUserMsg (CONSTRAINT line) AND the apply guard below
  // (sanitizeMultiAgainst rejects unresolved tokens). Single SELECT per
  // request; cheap vs Claude latency.
  const canonicalSet = await getVenueTypesCanonicalSet(
    sb,
    "vs-research-single-venue",
  );

  const fillUserMsg = buildFillUserMsg(
    scout as ScoutBrief,
    {
      name: venue.name,
      address: venue.address,
      neighborhood: venue.neighborhood,
      venue_type: venue.venue_type,
      website_url: venue.website_url,
      notes: typeof venue.notes === "string" ? venue.notes : null,
      // hq_pool rows carry the HQ canonical about_venue in venue_overview
      // (set at picker insert time per Phase 5.12.7 Feature A). Surface
      // the HQ CANONICAL ABOUT block + narrower research instruction so
      // Claude focuses on per-brief judgment instead of re-researching
      // identity. Manual rows pass null (no HQ canonical reference); the
      // builder degrades to the byte-for-byte 4.10.3-port behavior.
      aboutVenue:
        venue.source === "hq_pool" &&
        typeof venue.venue_overview === "string" &&
        venue.venue_overview.trim().length > 0
          ? venue.venue_overview
          : null,
    },
    canonicalSet.names,
  );

  const fillResult = await callClaude(
    "venue_scout",
    [{ role: "user", content: fillUserMsg }],
    {
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      system: FILL_SYSTEM,
      tools: [
        FILL_TOOL,
        {
          type: "web_search_20250305",
          name: "web_search",
          max_uses: 2,
        },
      ],
      tool_choice: { type: "auto" },
      fn_name: "vs-research-single-venue:fill",
    },
  );

  if (!fillResult.ok) {
    return jsonResponse({ ok: false, error: fillResult.error }, 500);
  }

  const tu = (fillResult.content ?? []).find(
    (b: { type?: string; name?: string }) =>
      b?.type === "tool_use" && b?.name === "fill_venue",
  );
  if (!tu || typeof tu.input !== "object" || tu.input === null) {
    return jsonResponse(
      { ok: false, error: "Claude returned no fill_venue tool block" },
      500,
    );
  }
  const f = tu.input as Record<string, unknown>;

  // Per-field defensive patch (mirrors vs-compile-summaries Pass 1 +
  // vs-research-venues Phase A patch shape; producer-entered values stay
  // authoritative). Skip derived_attrs (FILL_TOOL doesn't carry the
  // scout's derived_columns IDs; same posture as Pass 1 / Phase A).
  const patch: Record<string, unknown> = {};

  if (
    (!venue.address || venue.address.trim().length === 0) &&
    typeof f.address === "string" &&
    f.address.trim().length > 0
  ) {
    patch.address = f.address.trim();
  }
  if (
    (!venue.neighborhood || venue.neighborhood.trim().length === 0) &&
    typeof f.neighborhood === "string" &&
    f.neighborhood.trim().length > 0
  ) {
    patch.neighborhood = f.neighborhood.trim();
  }
  if (
    (!venue.venue_type || venue.venue_type.trim().length === 0) &&
    typeof f.venue_type === "string"
  ) {
    // Phase 5.12.10: reject unresolved tokens via the runtime canonical
    // set (sanitizeMultiAgainst returns null on no match). Pre-5.12.10
    // the trimmed raw value landed verbatim; the apply guard now matches
    // Phase A / Pass 1 / Phase B's WRITE-strict posture.
    const cleaned = sanitizeMultiAgainst(f.venue_type, canonicalSet.names);
    if (cleaned) patch.venue_type = cleaned;
  }
  if (!venue.website_url && typeof f.website_url === "string") {
    const cleaned = await validateWebsiteUrl(f.website_url);
    if (cleaned) patch.website_url = cleaned;
  }
  if (venue.size_sq_ft == null && typeof f.size_sq_ft === "number") {
    patch.size_sq_ft = f.size_sq_ft;
  }
  if (venue.capacity == null && typeof f.capacity === "number") {
    patch.capacity = f.capacity;
  }
  const existingFeatures = Array.isArray(venue.key_features)
    ? (venue.key_features as string[])
    : [];
  if (existingFeatures.length === 0 && Array.isArray(f.key_features)) {
    // Phase 5.12.13.1: sanitizeTagShape chains on the outside to drop
    // items that violate the evergreen-tag shape (digits, > 4 words,
    // > 35 chars, case-insensitive dupes).
    const cleaned = sanitizeTagShape(stripPlaceholders(f.key_features));
    if (cleaned.length > 0) patch.key_features = cleaned;
  }
  if (existingRecs.length === 0 && Array.isArray(f.recommendations)) {
    const cleaned = stripPlaceholders(f.recommendations);
    if (cleaned.length > 0) patch.recommendations = cleaned;
  }
  const existingCons = Array.isArray(venue.considerations)
    ? (venue.considerations as string[])
    : [];
  if (existingCons.length === 0 && Array.isArray(f.considerations)) {
    const cleaned = stripPlaceholders(f.considerations);
    if (cleaned.length > 0) patch.considerations = cleaned;
  }
  if (venue.rank == null && typeof f.ranking_score === "number") {
    patch.rank = Math.round(f.ranking_score);
  }

  if (Object.keys(patch).length === 0) {
    console.log(
      `[vs-research-single-venue] scout=${scout_id} venue=${venue_id} no patch produced (Claude returned only placeholders or already-filled values)`,
    );
    return jsonResponse({ ok: true, patch: {} });
  }

  const { error: updErr } = await sb
    .from("vs_candidate_venues")
    .update(patch)
    .eq("id", venue_id);
  if (updErr) {
    return jsonResponse({ ok: false, error: updErr.message }, 500);
  }

  console.log(
    `[vs-research-single-venue] scout=${scout_id} venue=${venue_id} patched fields=${Object.keys(patch).join(",")}`,
  );
  return jsonResponse({ ok: true, patch });
});
