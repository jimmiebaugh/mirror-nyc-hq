// hq-generate-venue-about (Phase 5.10.0)
//
// Generates the "About Venue" deck-copy paragraph (venues.about_venue) for a
// single venue. User-invoked synchronous from the About Venue card on
// VenueDetail + the About Venue field on VenueEdit (Generate / Regenerate
// button).
//
// Signature:
//   POST { venue_id: string }
//     -> { ok: true, about_venue: string }
//     -> { ok: false, error: string }
//
// Flow:
//   1. Validate venue_id (UUID).
//   2. Open a user-JWT supabase-js client (forwards the caller's Authorization
//      header). All reads + the write are RLS-enforced; the caller already has
//      SELECT + UPDATE on venues (open-authenticated). No service role, no
//      SECURITY DEFINER.
//   3. SELECT the venue row + its venue_types via the venue_venue_types join.
//   4. callClaude('hq', ...) with ABOUT_VENUE_SYSTEM (the evergreen, brief-less
//      HQ prompt) and web_search enabled. TOOL-LESS: no custom tool, so Claude
//      replies with the paragraph as plain text. tool_choice 'auto' lets it run
//      web_search first when the venue row is sparse. Going tool-less removes
//      the forced-tool collapse-risk class entirely. Pause_turn continuation is
//      handled inside the wrapper.
//   5. Read the model's text reply (trimmed). Fall back to a deterministic
//      "name in city" stub if it comes back empty, so the producer always lands
//      on a non-empty, editable paragraph.
//   6. UPDATE venues.about_venue. The venues UPDATE trigger writes one
//      activity_log row automatically; no inline log needed.
//   7. Return { ok: true, about_venue }.
//
// First callClaude('hq', ...) consumer in HQ. Spend bucket 'hq' maps to the
// ANTHROPIC_API_KEY_HQ secret (set 2026-05-06). Auth posture: verify_jwt =
// true (gateway enforces the user JWT). No admin re-check inside; matches the
// vs-parse-brief / vs-generate-brief-overview posture (any authenticated user
// who can view a venue can generate).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callClaude } from "../_shared/anthropic.ts";
import {
  ABOUT_VENUE_SYSTEM,
  buildOverviewUserMsgFromVenue,
  buildStub,
  type VenueOverviewRow,
} from "../_shared/venueOverview.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Business outcomes (including EXPECTED failures: bad input, not-found, Claude
// error, RLS-denied save) return HTTP 200 with an `{ ok: false, error }`
// envelope. Reason: supabase-js `functions.invoke` surfaces a generic
// FunctionsHttpError (and nulls `data`) on any non-2xx, so the descriptive
// `error` string would never reach the caller's toast. The frontend handlers
// read `data.ok` / `data.error`, so the message only surfaces on a 200 body.
// Only the transport-level method guard below uses a non-2xx code (and it is
// unreachable from the UI, which always POSTs via invoke).
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// `buildStub` (the deterministic empty-string fallback) lives in
// `_shared/venueOverview.ts` so both this function and `vs-compile-summaries`
// share one fallback. Phase 5.12.0 lift.

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
  }

  let body: { venue_id?: string };
  try {
    body = (await req.json()) as { venue_id?: string };
  } catch {
    return jsonResponse({ ok: false, error: "Invalid JSON body" });
  }

  const venue_id = (body.venue_id ?? "").trim();
  if (!UUID_RE.test(venue_id)) {
    return jsonResponse({ ok: false, error: "venue_id must be a UUID" });
  }

  // User-JWT client: every read + the write run under the caller's session so
  // RLS is enforced. The function never escalates to service role.
  const authHeader = req.headers.get("Authorization") ?? "";
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  // Load the venue row + venue_types via the join.
  const { data: venueRow, error: venueErr } = await sb
    .from("venues")
    .select(
      "id, name, address, neighborhood, city, total_sq_ft, square_footage, capacity, website_url, features, venue_venue_types(venue_types(name))",
    )
    .eq("id", venue_id)
    .maybeSingle();

  if (venueErr) {
    return jsonResponse({
      ok: false,
      error: `Could not load venue: ${venueErr.message}`,
    });
  }
  if (!venueRow) {
    return jsonResponse({ ok: false, error: "Venue not found" });
  }

  // Flatten the joined venue_types into a string[] for the prompt builder.
  const joinRows = (venueRow as { venue_venue_types?: unknown }).venue_venue_types;
  const venueTypes: string[] = Array.isArray(joinRows)
    ? joinRows
        .map((j) => {
          const vt = (j as { venue_types?: { name?: string } | null })
            .venue_types;
          return vt?.name ?? null;
        })
        .filter((n): n is string => typeof n === "string" && n.length > 0)
    : [];

  const venue: VenueOverviewRow & { id: string } = {
    id: (venueRow as { id: string }).id,
    name: (venueRow as { name: string }).name,
    address: (venueRow as { address: string | null }).address,
    neighborhood: (venueRow as { neighborhood: string | null }).neighborhood,
    city: (venueRow as { city: string | null }).city,
    total_sq_ft: (venueRow as { total_sq_ft: number | null }).total_sq_ft,
    square_footage: (venueRow as { square_footage: number | null }).square_footage,
    capacity: (venueRow as { capacity: number | null }).capacity,
    website_url: (venueRow as { website_url: string | null }).website_url,
    features: (venueRow as { features: string[] | null }).features,
    venue_types: venueTypes,
  };

  const userMsg = buildOverviewUserMsgFromVenue(venue);

  let aboutVenue = "";
  try {
    const result = await callClaude(
      "hq",
      [{ role: "user", content: userMsg }],
      {
        max_tokens: 2000,
        system: ABOUT_VENUE_SYSTEM,
        // Tool-less: web_search is the only tool, so Claude searches when the
        // venue row is sparse, then replies with the paragraph as plain text.
        // No custom tool means there is nothing to collapse to (sidesteps the
        // feedback_tool_choice_collapse failure class). tool_choice 'auto'
        // lets the model decide whether to search.
        tools: [
          { type: "web_search_20250305", name: "web_search", max_uses: 2 },
        ],
        tool_choice: { type: "auto" },
        fn_name: "hq-generate-venue-about",
      },
    );

    if (!result.ok) {
      return jsonResponse({
        ok: false,
        error: `Generation failed: ${result.error}`,
      });
    }

    // Read the model's text reply. Fall back to a deterministic stub if it
    // came back empty so the producer always lands on an editable paragraph.
    aboutVenue = (result.text ?? "").trim() || buildStub(venue);
  } catch (e) {
    return jsonResponse({
      ok: false,
      error: `Generation error: ${e instanceof Error ? e.message : String(e)}`,
    });
  }

  // Persist. RLS-enforced UPDATE under the caller's session.
  const { error: updErr } = await sb
    .from("venues")
    .update({ about_venue: aboutVenue })
    .eq("id", venue_id);

  if (updErr) {
    return jsonResponse({
      ok: false,
      error: `Could not save paragraph: ${updErr.message}`,
    });
  }

  return jsonResponse({ ok: true, about_venue: aboutVenue });
});
