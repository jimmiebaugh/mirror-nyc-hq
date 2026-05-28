// vs-regenerate-venue-overview (Phase 5.12.15)
//
// Single-venue regenerate of the `vs_candidate_venues.venue_overview`
// paragraph. Used by the consolidated Review surface's per-card
// Regenerate Overview button. Synchronous (Claude call ~10-20s);
// returns { ok, venue_overview } on success.
//
// Auth posture: verify_jwt = true (default; no config.toml entry).
// User-invoked synchronous; no self-invoke.
//
// Cross-scout poisoning defense (load-bearing): vs_* RLS is
// open-authenticated to every authenticated user (see
// docs/auth-model.md), so function-level authorization is the ONLY
// thing that stops a producer from invoking this against any
// vs_candidate_venues row in the system. Two gates enforced inline
// before any Claude call:
//   1. venue.scout_id MUST equal the body's scout_id (SELECT
//      predicate filters; missing row -> 404).
//   2. scout.current_step MUST equal 'deck_prep' (in-fn check; reject
//      from any other state so a stale tab can't poison an in-flight
//      scout's compile / generate pipeline).
//
// Both gate misses return 404 (not 403) so a probe surfaces no useful
// signal about whether the row or the state is the failing predicate.
// Mirrors the vs-research-single-venue 404-on-miss pattern.
//
// The source filter that vs-research-single-venue carries
// (`venue.source ∈ {'manual', 'hq_pool'}`) does NOT apply to the
// regen path: every pitched venue regardless of source has a
// venue_overview that the producer may want to re-roll.
//
// Call body lifts vs-compile-summaries Pass 2 byte-for-byte
// (tool-less + web_search + ABOUT_VENUE_SYSTEM with 1h ephemeral
// prompt cache). The synthetic row passed to
// buildOverviewUserMsgForVsRow substitutes the request body's `notes`
// value into venue.notes so the existing <producer_inputs> block
// picks it up without a shared-module signature change. Frontend
// passes notes explicitly so producer-edit-then-immediately-regenerate
// doesn't race the 600ms notes debounce on the client.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callClaude } from "../_shared/anthropic.ts";
import {
  ABOUT_VENUE_SYSTEM,
  buildOverviewUserMsgForVsRow,
  buildStub,
} from "../_shared/venueOverview.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  let body: { venue_id?: string; scout_id?: string; notes?: string | null };
  try {
    body = (await req.json()) as {
      venue_id?: string;
      scout_id?: string;
      notes?: string | null;
    };
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
  const notes =
    typeof body.notes === "string" && body.notes.trim().length > 0
      ? body.notes
      : null;

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Gate 1: venue.scout_id === scout_id (SELECT predicate; missing
  // row -> 404). Gate 2: scout.current_step === 'deck_prep' (in-fn
  // check). Both gates 404 on miss per the vs-research-single-venue
  // probe-defense pattern.
  const [venueResp, scoutResp] = await Promise.all([
    sb
      .from("vs_candidate_venues")
      .select(
        "id, scout_id, name, address, neighborhood, venue_type, size_sq_ft, capacity, website_url, venue_overview, key_features, recommendations",
      )
      .eq("id", venue_id)
      .eq("scout_id", scout_id)
      .maybeSingle(),
    sb
      .from("vs_scouts")
      .select("id, current_step, city")
      .eq("id", scout_id)
      .maybeSingle(),
  ]);

  if (venueResp.error || !venueResp.data) {
    return jsonResponse({ ok: false, error: "not_found" }, 404);
  }
  if (
    scoutResp.error ||
    !scoutResp.data ||
    scoutResp.data.current_step !== "deck_prep"
  ) {
    return jsonResponse({ ok: false, error: "not_found" }, 404);
  }

  const venue = venueResp.data;
  const scout = scoutResp.data;

  const userMsg = buildOverviewUserMsgForVsRow(
    {
      name: venue.name as string,
      address: venue.address as string | null,
      neighborhood: venue.neighborhood as string | null,
      venue_type: venue.venue_type as string | null,
      size_sq_ft: venue.size_sq_ft as number | null,
      capacity: venue.capacity as number | null,
      website_url: venue.website_url as string | null,
      key_features: Array.isArray(venue.key_features)
        ? (venue.key_features as string[])
        : null,
      recommendations: Array.isArray(venue.recommendations)
        ? (venue.recommendations as string[])
        : null,
      // Frontend passes notes explicitly; the function never reads
      // vs_candidate_venues.notes directly so a producer who types
      // and immediately clicks Regenerate doesn't race the 600ms
      // debounce on the client.
      notes,
    },
    scout.city as string | null,
  );

  let paragraph: string;
  try {
    const overviewResult = await callClaude(
      "venue_scout",
      [{ role: "user", content: userMsg }],
      {
        // Pass 2 callsite lift from vs-compile-summaries: tool-less,
        // ABOUT_VENUE_SYSTEM with 1-hour ephemeral cache, web_search
        // auto with max_uses=2, max_tokens 2000.
        max_tokens: 2000,
        system: [
          {
            type: "text",
            text: ABOUT_VENUE_SYSTEM,
            cache_control: { type: "ephemeral", ttl: "1h" },
          },
        ],
        anthropic_beta: [
          "prompt-caching-2024-07-31",
          "extended-cache-ttl-2025-04-11",
        ],
        tools: [
          { type: "web_search_20250305", name: "web_search", max_uses: 2 },
        ],
        tool_choice: { type: "auto" },
        fn_name: "vs-regenerate-venue-overview",
        scout_id,
      },
    );

    if (!overviewResult.ok) {
      return jsonResponse(
        { ok: false, error: overviewResult.error ?? "claude_failed" },
        500,
      );
    }

    console.log(
      `[vs-regenerate-venue-overview] scout=${scout_id} venue=${venue_id} model=claude-sonnet-4-6 ` +
        `in=${overviewResult.usage?.input_tokens ?? "?"} ` +
        `out=${overviewResult.usage?.output_tokens ?? "?"} ` +
        `cache_read=${overviewResult.usage?.cache_read_input_tokens ?? 0} ` +
        `cache_write=${overviewResult.usage?.cache_creation_input_tokens ?? 0}`,
    );

    const text = (overviewResult.text ?? "").trim();
    paragraph =
      text.length > 0
        ? text
        : buildStub({
            name: venue.name as string,
            city: scout.city as string | null,
          });
  } catch (e) {
    return jsonResponse(
      {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      },
      500,
    );
  }

  const { error: updateErr } = await sb
    .from("vs_candidate_venues")
    .update({ venue_overview: paragraph })
    .eq("id", venue_id);
  if (updateErr) {
    return jsonResponse({ ok: false, error: updateErr.message }, 500);
  }

  return jsonResponse({ ok: true, venue_overview: paragraph });
});
