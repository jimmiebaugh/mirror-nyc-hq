// vs-compile-summaries (Phase 4.7.2-port + Phase 4.10.1-port refactor)
//
// Two-pass AI compile for the pitched-venue set. Lifted from VS Pro
// `compile-summaries` with these locked deltas per port plan § 6:
//   1. Both Anthropic calls go through callClaude('venue_scout', ...) for
//      spend tracking + per-app key + cache discounts. No raw fetch.
//   2. Sanitization on Pass 1 output: venue_type tokens through
//      canonicalizeType, website_url through validateWebsiteUrl (4.10.3-port
//      HEAD-validation wrapper around sanitizeWebsiteUrl), ranking_score ->
//      rank Math.round for INTEGER column.
//   3. EdgeRuntime.waitUntil divorces request lifetime from work lifetime
//      (port plan § 8.3). The function returns 200 immediately; the AI
//      work + per-venue UPDATEs + final UPDATE run in the background. The
//      Compiling page learns about completion / failure via Realtime on
//      vs_scouts.
//   4. Payload simplified from VS Pro's { project_id, venue_ids } to
//      { scout_id }; function queries pitched venues itself. Notes flow
//      collapsed: producer notes come back inline from vs_candidate_venues.
//
// Phase 4.10.1-port refactor:
//   - FILL_TOOL + FILL_SYSTEM + buildFillUserMsg moved to
//     _shared/venueFill.ts so vs-parse-sheet (4.10.1) reuses the same
//     prompt + schema. Single source of truth. OVERVIEW_TOOL +
//     OVERVIEW_SYSTEM stay local; only compile-summaries uses them.
//   - Pass 1 needsFill condition extended to fire for source='sheet'
//     rows that are missing derived_attrs. vs-parse-sheet enrichment
//     never fills derived_attrs (vs_scouts.derived_columns doesn't
//     exist at parse time); this catch-all backfills them at compile.
//
// Auth posture: verify_jwt = true. User-invoked synchronous handshake; no
// self-invoke. The handshake returns before the AI work starts so the
// browser doesn't wait on a 90-second request.
//
// Model: claude-sonnet-4-6 (callClaude wrapper default). Testing 4-6 on
// the port-side function (independent test from 4.5-port research-venues;
// different prompts may behave differently). Diagnostic log captures
// usage.input_tokens, usage.output_tokens per venue per pass so the
// collapse signature (out<200) is visible. Pivot procedure on collapse:
// add `model: "claude-sonnet-4-5"` to the relevant callClaude call below.
//
// VS Pro source: supabase/functions/compile-summaries/index.ts (~189 lines).
//
// Memory rules in force:
//   - feedback_tool_choice_collapse: do NOT edit FILL_SYSTEM or
//     OVERVIEW_SYSTEM to shape AI-output quality. SYSTEMs lifted verbatim.
//     Output-quality levers live on schema descriptions + sanitizer.
//   - URL-quality hot patch lesson: FILL_TOOL website_url has no schema
//     description; sanitizer is the only check. Matches research-venues
//     posture where sanitizer catches what schema-prompting could not.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  callClaude,
  extractWebSearchResults,
  type ClaudeTool,
} from "../_shared/anthropic.ts";
import {
  canonicalizeType,
  findBestSearchResultUrl,
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Skip-the-kickoff window. If a previous invocation kicked off less than
// this many ms ago and is still mid-flight, the new invocation no-ops to
// prevent double-charging on a page hard-refresh.
const IN_FLIGHT_GRACE_MS = 90_000;

// Hard ceiling on Claude work. Compile arithmetic: each pitched venue
// may trigger up to two Claude calls (Pass 1 fill conditional, Pass 2
// overview always). 5 venues with all manual rows = up to 10 calls at
// ~15s each = ~150s. Ceiling at 180s with a 30s buffer.
const WORK_TIMEOUT_MS = 180_000;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// FILL_TOOL + FILL_SYSTEM + buildFillUserMsg now live in _shared/venueFill.ts
// (Phase 4.10.1-port). vs-parse-sheet and this function both import them so
// the Pass 1 prompt + schema never drift.

// Phase 4.10.4-port: OVERVIEW_TOOL tuned to produce shorter, better-targeted
// overviews. Per feedback_tool_choice_collapse memory rule, the levers are
// the tool description + the venue_overview property description + maxLength.
// OVERVIEW_SYSTEM stays untouched.
//
// Targets:
//   - 3-4 sentences, ~80 words (down from 5-8 sentences, ~150 words).
//   - Surface standout physical / experiential features + immediate
//     neighborhood character + at most one critical consideration.
//   - Don't itemize every amenity; don't pad with marketing fluff.
//
// `maxLength: 600` is a soft signal -- Claude generally honors but does not
// strictly truncate. ~120 words is ~600-700 characters depending on prose;
// the cap aligns with the ~45-50% length reduction target.
//
// Diagnostic: if smoke output is still too long, tighten maxLength to 500
// or 450 first. If output is still un-targeted, add more concrete examples
// to the property description. Do NOT edit OVERVIEW_SYSTEM.
const OVERVIEW_TOOL: ClaudeTool = {
  name: "write_overview",
  description:
    "Write a single-paragraph venue overview (3-4 sentences, ~80 words) tied to the brief. Focus on standout physical / experiential features, the immediate neighborhood character around the venue, and only the MOST critical considerations. Skip the nitty-gritty.",
  input_schema: {
    type: "object",
    properties: {
      venue_overview: {
        type: "string",
        description:
          "A single producer-tone paragraph of 3-4 sentences (~80 words, max ~120). Structure: (1) one-sentence identity + standout physical or experiential feature; (2) what the space offers programmatically (zones, sightlines, infrastructure, outdoor connections, flexibility); (3) one sentence on the surrounding neighborhood and the cultural / commercial context; (4) optionally, one sentence on what it's best suited for OR one critical consideration. Examples of standout features worth surfacing: 'Extremely large, contiguous floors with high ceilings'; 'Strong ability to separate zones and mitigate sound bleed'; 'Industrial aesthetic with a clean, modernized interior'; 'Robust infrastructure for load-in, power, and large-scale production'; 'Rising cultural hub already hosting CFDA / NYFW shifts'; 'Proximity to Meatpacking, Chelsea galleries, High Line'; 'Brooklyn industrial aesthetic'; 'Multiple outdoor areas (courtyard + intimate garden)'; 'Casual, communal layout supports networking and social engagement'; 'Branding opportunities, prime advertising frontage'; 'High ceilings and multiple entrances; rigging points and truss'; 'Mezzanine great for another programming area'. Examples of well-calibrated overviews: 'The Sunset is a storefront for lease that is situated on the Sunset Strip in the heart of West Hollywood. This prime retail space is within walking distance of everything and has unparalleled access to premier destinations.' / 'Chelsea Industrial is a large, industrial-style event space in West Chelsea known for hosting high-production corporate events, brand activations, and conferences. The venue features a wide-open floor plan with high ceilings, offering a flexible canvas for custom builds and large-scale programming. Its industrial aesthetic and neutral interior lend themselves well to contemporary, tech-forward events, while the surrounding neighborhood provides easy access to transportation, hotels, and production resources.' / 'Platform is a vibrant, design-forward cultural destination. Developed on a repurposed industrial site, the 50,000 sq ft campus blends boutique retail, elevated restaurants and creative community experiences. Situated in Culver City, it sits in the heart of LA art galleries, studios and tech offices.' Do NOT itemize every amenity, do NOT pad with marketing fluff, do NOT exceed ~120 words.",
        maxLength: 600,
      },
    },
    required: ["venue_overview"],
  },
};

// OVERVIEW_SYSTEM lifted verbatim from VS Pro. Do NOT edit per
// feedback_tool_choice_collapse memory rule. Output quality levers live
// on schema descriptions and post-emission sanitization (compile-only;
// FILL_SYSTEM is in _shared/venueFill.ts under the same rule).
const OVERVIEW_SYSTEM =
  `You are a producer at Mirror NYC writing venue summaries for a pitch deck. Tone: declarative, third-person, specific to the brief. 5-8 sentences. Mention how the venue serves the specific event (foot traffic, back-of-house, capacity, neighborhood fit). No marketing fluff. Forbidden words: "perfect", "ideal", "premier", "elevated experience", "world-class", "stunning", "amazing".`;

// Two-row failure write helper. Used by the outer catastrophic catch.
// Per-venue Claude errors are logged + skipped (matches VS Pro tolerance);
// only framework-level errors (DB, timeout) flip status='failed'.
//
// Post-4.10.4 hot patch round 9: guard against overwriting a prior
// success. .eq("current_step", "compiling") makes the UPDATE a CAS
// that no-ops if another invocation has already advanced the scout
// past 'compiling' (e.g., succeeded to 'deck_prep'). Same pattern
// applied to vs-research-venues.writeFailure.
async function writeFailure(
  sb: ReturnType<typeof createClient>,
  scout_id: string,
  message: string,
): Promise<void> {
  console.error(`[vs-compile-summaries] scout=${scout_id} failure: ${message}`);
  const { error } = await sb
    .from("vs_scouts")
    .update({
      status: "failed",
      pipeline_error: message,
      last_touched_at: new Date().toISOString(),
    })
    .eq("id", scout_id)
    .eq("current_step", "compiling");
  if (error) {
    console.error(
      `[vs-compile-summaries] scout=${scout_id} writeFailure update error: ${error.message}`,
    );
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  let body: { scout_id?: string };
  try {
    body = (await req.json()) as { scout_id?: string };
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const scout_id = (body.scout_id ?? "").trim();
  if (!UUID_RE.test(scout_id)) {
    return jsonResponse({ error: "scout_id must be a UUID" }, 400);
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Load scout. Need brief fields + current_step + brief_data for
  // idempotency stamp.
  const { data: scout, error: scoutErr } = await sb
    .from("vs_scouts")
    .select(
      "id, client_name, event_name, city, live_dates, budget, event_overview, brief_data, current_step",
    )
    .eq("id", scout_id)
    .maybeSingle();

  if (scoutErr || !scout) {
    return jsonResponse(
      { error: `Could not load scout: ${scoutErr?.message ?? "not found"}` },
      404,
    );
  }

  // Idempotency: skip if already past the compiling step (page already
  // navigated away) or if a kickoff fired recently and is still running.
  if (scout.current_step !== "compiling") {
    return jsonResponse({
      ok: true,
      scout_id,
      skipped: "not_in_compiling_state",
    });
  }
  const briefData = (scout.brief_data ?? {}) as Record<string, unknown>;
  const startedAtRaw = briefData.compile_started_at;
  if (typeof startedAtRaw === "string") {
    const ageMs = Date.now() - new Date(startedAtRaw).getTime();
    if (Number.isFinite(ageMs) && ageMs < IN_FLIGHT_GRACE_MS) {
      return jsonResponse({ ok: true, scout_id, skipped: "in_flight" });
    }
  }

  // Record the kickoff timestamp + clear any prior failure state so a
  // retry from a failed run starts clean.
  await sb
    .from("vs_scouts")
    .update({
      brief_data: {
        ...briefData,
        compile_started_at: new Date().toISOString(),
      },
      pipeline_error: null,
    })
    .eq("id", scout_id);

  // Load pitched venues (notes inline per 4.3-port).
  const { data: venuesData, error: venuesErr } = await sb
    .from("vs_candidate_venues")
    .select(
      "id, name, address, neighborhood, venue_type, website_url, size_sq_ft, capacity, key_features, derived_attrs, recommendations, considerations, rank, source, notes, venue_overview",
    )
    .eq("scout_id", scout_id)
    .eq("pitched", true);

  if (venuesErr) {
    return jsonResponse(
      { error: `Could not load pitched venues: ${venuesErr.message}` },
      500,
    );
  }

  const venues = venuesData ?? [];

  // Brief block for Pass 2 overview user messages. Pass 1's brief block is
  // built inside _shared/venueFill.ts buildFillUserMsg (Phase 4.10.1-port
  // extraction); fallback strings stay aligned with this block to keep
  // both passes seeing the same brief shape. Fallback strings normalized
  // to "(not set)" (VS Pro used em dashes which violate the voice rule).
  //
  // Post-4.10.4 hot patch round 11: trimmed Brief block. Replaced the
  // full `Brief: ${JSON.stringify(scout.brief_data)}` dump with selective
  // field extraction so the per-venue prompt isn't inflated with internal
  // state flags (research_started_at / compile_started_at /
  // deck_generation_started_at / uploaded_files). Matches the trim
  // applied to vs-research-venues Phase B + venueFill.buildFillUserMsg.
  const briefDataObj = (scout.brief_data ?? {}) as Record<string, unknown>;
  const briefDataGuests = briefDataObj.expected_guest_count;
  const briefDataNotes = briefDataObj.notes;
  const briefBlock =
    `Client: ${scout.client_name ?? "(not set)"}
Event: ${scout.event_name ?? "(not set)"}
City: ${scout.city ?? "(not set)"}
Live dates: ${scout.live_dates ?? "(not set)"}
Budget: ${scout.budget ?? "(not set)"}
Expected guests: ${
      typeof briefDataGuests === "number" || typeof briefDataGuests === "string"
        ? String(briefDataGuests)
        : "(not set)"
    }
Overview: ${scout.event_overview ?? "(not set)"}
Additional brief notes: ${
      typeof briefDataNotes === "string" && briefDataNotes.trim().length > 0
        ? briefDataNotes.trim()
        : "(none)"
    }`;

  // Background work. Returns nothing; writes success / failure straight
  // to vs_scouts so the Compiling page picks them up via Realtime.
  const work = async () => {
    // 180-second ceiling via Promise.race. Defense-in-depth so a hanging
    // Anthropic call (or arithmetic of many manual venues) doesn't leave
    // the page spinning forever. Capture the handle so we can clearTimeout
    // on normal completion; otherwise the orphaned timer keeps
    // EdgeRuntime.waitUntil alive for the full 180s window.
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(
        () =>
          reject(
            new Error(`timed out after ${WORK_TIMEOUT_MS / 1000}s`),
          ),
        WORK_TIMEOUT_MS,
      );
    });

    const compileWork = async () => {
      // If no pitched venues, still flip current_step so the page
      // navigates instead of spinning forever. Producer can recover by
      // going back to Shortlist.
      if (venues.length === 0) {
        await sb
          .from("vs_scouts")
          .update({
            current_step: "deck_prep",
            status: "in_progress",
            pipeline_error: null,
            last_touched_at: new Date().toISOString(),
          })
          .eq("id", scout_id);
        console.log(
          `[vs-compile-summaries] scout=${scout_id} complete pitched=0 (no-op)`,
        );
        return;
      }

      for (const v of venues) {
        const patch: Record<string, unknown> = {};

        // Pass 1: fill missing structured fields.
        //
        // Original (4.7.2-port): only manual venues missing recs or rank
        // (research-sourced venues already have all fields from
        // vs-research-venues).
        //
        // Extended (4.10.1-port): also fire for sheet-source venues
        // missing derived_attrs. vs-parse-sheet's enrichment never fills
        // derived_attrs because vs_scouts.derived_columns doesn't exist
        // at parse time. Pass 1's per-field guards prevent overwriting
        // the already-enriched recs / rank / type / etc.; only the
        // derived_attrs slot lands in the typical sheet-row case. Also
        // catches sheet rows whose parse-time enrichment failed
        // mid-flight (recs empty or rank null) as a fallback recovery.
        const recsArr = Array.isArray(v.recommendations)
          ? v.recommendations
          : [];
        const derivedAttrsEmpty =
          !v.derived_attrs ||
          Object.keys(v.derived_attrs as Record<string, unknown>).length === 0;
        const needsFill =
          (v.source === "manual" || v.source === "sheet") &&
          (recsArr.length === 0 || v.rank == null || derivedAttrsEmpty);
        if (needsFill) {
          // Pass 1 user message comes from the shared builder so
          // vs-parse-sheet's enrichment and this backfill stay in lock
          // step. Producer notes go through too (manual rows collect
          // them; sheet rows pre-pitch typically don't have notes yet).
          const fillUserMsg = buildFillUserMsg(scout as ScoutBrief, {
            name: v.name,
            address: v.address,
            neighborhood: v.neighborhood,
            venue_type: v.venue_type,
            // Phase 4.10.3-port: forward producer-set URL so backfill
            // research uses it as primary source.
            website_url: v.website_url,
            notes: v.notes,
          });

          try {
            const fillResult = await callClaude(
              "venue_scout",
              [{ role: "user", content: fillUserMsg }],
              {
                // Post-4.10.4 hot patch (2026-05-13 evening): pivoted from
                // claude-sonnet-4-5 + web_search_20250305 to
                // claude-sonnet-4-6 + web_search_20260209. Mirror the same
                // pivot applied to vs-research-venues Phase A + B after
                // smoke logs showed server_tool_uses=0 across all 4-5 +
                // 20250305 calls. Anthropic docs list Sonnet 4.6 / 4.7 /
                // Opus 4.6+ / Mythos as the supported model set for the
                // newer web_search_20260209; Sonnet 4.5 isn't on that
                // list. Max tokens stays at 6000 for web_search content
                // headroom.
                model: "claude-sonnet-4-6",
                max_tokens: 4000,
                system: FILL_SYSTEM,
                // Round 12 hot patch: mirror vs-research-venues Phase A
                // pivot from web_search_20260209 -> 20250305. Lighter
                // per-turn context, no code_execution sandbox.
                tools: [
                  FILL_TOOL,
                  { type: "web_search_20250305", name: "web_search", max_uses: 2 },
                ],
                tool_choice: { type: "auto" },
                fn_name: "vs-compile-summaries:fill",
              },
            );

            if (!fillResult.ok) {
              console.error(
                `[vs-compile-summaries] scout=${scout_id} venue=${v.id} pass=fill failed: ${fillResult.error}`,
              );
            } else {
              console.log(
                `[vs-compile-summaries] scout=${scout_id} venue=${v.id} pass=fill model=claude-sonnet-4-6 ` +
                  `in=${fillResult.usage?.input_tokens ?? "?"} ` +
                  `out=${fillResult.usage?.output_tokens ?? "?"}`,
              );
              const tu = (fillResult.content ?? []).find(
                (b: { type?: string; name?: string }) =>
                  b?.type === "tool_use" && b?.name === "fill_venue",
              );
              if (tu && typeof tu.input === "object" && tu.input !== null) {
                const f = tu.input as Record<string, unknown>;

                // Round 15 hot patch: address + neighborhood are now in
                // FILL_TOOL. Mirror Phase A's patch guard -- only fill
                // when the existing row value is null/empty so producer
                // values stay authoritative.
                if (
                  (!v.address || v.address.trim().length === 0) &&
                  typeof f.address === "string" &&
                  f.address.trim().length > 0
                ) {
                  patch.address = f.address.trim();
                }

                if (
                  (!v.neighborhood || v.neighborhood.trim().length === 0) &&
                  typeof f.neighborhood === "string" &&
                  f.neighborhood.trim().length > 0
                ) {
                  patch.neighborhood = f.neighborhood.trim();
                }

                // venue_type: canonicalizeType per slash/comma-separated
                // token. Only set if the venue doesn't already have a
                // type.
                if (!v.venue_type && typeof f.venue_type === "string") {
                  const tokens = f.venue_type
                    .split(/[/,]/)
                    .map((t: string) => canonicalizeType(t.trim()))
                    .filter((t): t is NonNullable<typeof t> => Boolean(t));
                  if (tokens.length) patch.venue_type = tokens.join(" / ");
                }

                if (!v.website_url) {
                  // Phase 4.10.3-port: HEAD-validated. Same per-row sequential
                  // pattern as vs-parse-sheet's enrichOne; Pass 1 runs CHUNK_SIZE
                  // rows in parallel so per-chunk latency stays bounded.
                  const cleaned = await validateWebsiteUrl(f.website_url);
                  if (cleaned) {
                    patch.website_url = cleaned;
                  } else {
                    // Round 13 hot patch: fallback. Mirror Phase A in
                    // vs-research-venues -- pull a URL out of the
                    // web_search results blocks if Claude's tool output
                    // didn't include a usable one.
                    const searchResults = extractWebSearchResults(
                      fillResult.content ?? [],
                    );
                    const fallbackUrl = findBestSearchResultUrl(
                      v.name,
                      searchResults,
                    );
                    if (fallbackUrl) {
                      const validated = await validateWebsiteUrl(fallbackUrl);
                      if (validated) {
                        patch.website_url = validated;
                        console.log(
                          `[vs-compile-summaries] scout=${scout_id} venue=${v.id} website_url fallback from search results: ${validated}`,
                        );
                      }
                    }
                  }
                }

                if (v.size_sq_ft == null && typeof f.size_sq_ft === "number") {
                  patch.size_sq_ft = f.size_sq_ft;
                }

                if (v.capacity == null && typeof f.capacity === "number") {
                  patch.capacity = f.capacity;
                }

                const existingFeatures = Array.isArray(v.key_features)
                  ? v.key_features
                  : [];
                if (
                  existingFeatures.length === 0 &&
                  Array.isArray(f.key_features)
                ) {
                  // Round 7 hot patch: strip placeholder tokens
                  // ('<UNKNOWN>', 'TBD', 'N/A') Claude falls back to
                  // under schema pressure. If the cleaned array is
                  // empty, skip the write so the row keeps its null
                  // state rather than getting a junk-filled column.
                  const cleaned = stripPlaceholders(f.key_features);
                  if (cleaned.length > 0) patch.key_features = cleaned;
                }

                const existingDerived = (v.derived_attrs ?? {}) as Record<
                  string,
                  unknown
                >;
                if (
                  Object.keys(existingDerived).length === 0 &&
                  typeof f.derived_attrs === "object" &&
                  f.derived_attrs !== null
                ) {
                  patch.derived_attrs = f.derived_attrs;
                }

                if (recsArr.length === 0 && Array.isArray(f.recommendations)) {
                  const cleaned = stripPlaceholders(f.recommendations);
                  if (cleaned.length > 0) patch.recommendations = cleaned;
                }

                const consArr = Array.isArray(v.considerations)
                  ? v.considerations
                  : [];
                if (consArr.length === 0 && Array.isArray(f.considerations)) {
                  const cleaned = stripPlaceholders(f.considerations);
                  if (cleaned.length > 0) patch.considerations = cleaned;
                }

                if (v.rank == null && typeof f.ranking_score === "number") {
                  // vs_candidate_venues.rank is INTEGER; Math.round
                  // defensively in case Claude returns a float.
                  patch.rank = Math.round(f.ranking_score);
                }
              }
            }
          } catch (e) {
            console.error(
              `[vs-compile-summaries] scout=${scout_id} venue=${v.id} pass=fill threw:`,
              e,
            );
          }
        }

        // Pass 2: always overwrite venue_overview. Producer can manually
        // edit the field on Review later if Claude's output is off.
        // Merge the Pass 1 patch into the venue snapshot so the overview
        // sees the newly-filled fields.
        const merged: Record<string, unknown> = { ...v, ...patch };
        const overviewUserMsg =
          `BRIEF
${briefBlock}

VENUE
Name: ${merged.name}
Address: ${merged.address ?? "?"}
Neighborhood: ${merged.neighborhood ?? "?"}
Type: ${merged.venue_type ?? "?"}
Size: ${merged.size_sq_ft ?? "?"} sq ft
Capacity: ${merged.capacity ?? "?"}
Key features: ${(Array.isArray(merged.key_features) ? merged.key_features : []).join("; ") || "(not set)"}
Recommendations: ${(Array.isArray(merged.recommendations) ? merged.recommendations : []).join("; ") || "(not set)"}
Considerations: ${(Array.isArray(merged.considerations) ? merged.considerations : []).join("; ") || "(not set)"}
Producer notes: ${v.notes ?? "(none)"}

Write the venue_overview paragraph.`;

        try {
          const overviewResult = await callClaude(
            "venue_scout",
            [{ role: "user", content: overviewUserMsg }],
            {
              // Testing claude-sonnet-4-6 (wrapper default). If the
              // diagnostic log shows out<200 on Pass 2 (overview is real
              // prose so collapse-signature out<200 is the strong
              // tell), pivot to 4-5 by adding
              //   model: "claude-sonnet-4-5",
              // here.
              max_tokens: 800,
              system: OVERVIEW_SYSTEM,
              tools: [OVERVIEW_TOOL],
              tool_choice: { type: "tool", name: "write_overview" },
              fn_name: "vs-compile-summaries:overview",
            },
          );

          if (!overviewResult.ok) {
            console.error(
              `[vs-compile-summaries] scout=${scout_id} venue=${v.id} pass=overview failed: ${overviewResult.error}`,
            );
          } else {
            console.log(
              `[vs-compile-summaries] scout=${scout_id} venue=${v.id} pass=overview model=claude-sonnet-4-6 ` +
                `in=${overviewResult.usage?.input_tokens ?? "?"} ` +
                `out=${overviewResult.usage?.output_tokens ?? "?"}`,
            );
            const tu = (overviewResult.content ?? []).find(
              (b: { type?: string; name?: string }) =>
                b?.type === "tool_use" && b?.name === "write_overview",
            );
            if (
              tu &&
              typeof tu.input === "object" &&
              tu.input !== null &&
              typeof (tu.input as Record<string, unknown>).venue_overview ===
                "string"
            ) {
              patch.venue_overview = (tu.input as Record<string, unknown>)
                .venue_overview as string;
            }
          }
        } catch (e) {
          console.error(
            `[vs-compile-summaries] scout=${scout_id} venue=${v.id} pass=overview threw:`,
            e,
          );
        }

        // Apply patch. Per-venue UPDATE so partial progress is visible
        // if the function dies mid-loop.
        if (Object.keys(patch).length) {
          const { error: updErr } = await sb
            .from("vs_candidate_venues")
            .update(patch)
            .eq("id", v.id);
          if (updErr) {
            console.error(
              `[vs-compile-summaries] scout=${scout_id} venue=${v.id} update failed: ${updErr.message}`,
            );
          }
        }
      }

      // Final write: flip the scout state so the Realtime subscriber on
      // the Compiling page navigates. All per-venue UPDATEs already
      // landed before this fires.
      const { error: scoutUpdErr } = await sb
        .from("vs_scouts")
        .update({
          current_step: "deck_prep",
          status: "in_progress",
          pipeline_error: null,
          last_touched_at: new Date().toISOString(),
        })
        .eq("id", scout_id);

      if (scoutUpdErr) {
        throw new Error(`Final scout update failed: ${scoutUpdErr.message}`);
      }

      console.log(
        `[vs-compile-summaries] scout=${scout_id} complete pitched=${venues.length}`,
      );
    };

    try {
      await Promise.race([compileWork(), timeoutPromise]);
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    } catch (e) {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      const msg = e instanceof Error ? e.message : String(e);
      await writeFailure(sb, scout_id, msg);
    }
  };

  // EdgeRuntime.waitUntil keeps the function alive past the response so
  // the AI work can finish in the background. Available on Supabase
  // Edge Runtime; local dev fallback awaits the work synchronously so
  // tests behave deterministically.
  // deno-lint-ignore no-explicit-any
  const erAny = (globalThis as any).EdgeRuntime;
  if (erAny && typeof erAny.waitUntil === "function") {
    erAny.waitUntil(work());
  } else {
    await work();
  }

  return jsonResponse({ ok: true, scout_id });
});
