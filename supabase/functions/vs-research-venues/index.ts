// vs-research-venues (Phase 4.5-port)
//
// AI-driven venue research. Lifted from VS Pro `research-venues` with four
// locked deltas per port plan § 6:
//   1. Anthropic call goes through callClaude('venue_scout', ...) for spend
//      tracking + per-app key + cache discounts. No raw fetch.
//   2. URL handling: every Claude-emitted website_url runs through
//      validateWebsiteUrl (Phase 4.10.3-port HEAD-validation wrapper around
//      sanitizeWebsiteUrl in _shared/venueTypes.ts). Sanitize rejects search
//      pages + listing-DB homepages; HEAD check rejects fabricated listing
//      URLs that 4xx / soft-404 to a homepage.
//   3. Type handling: canonicalizeType per slash-separated token; rebuilt
//      string lands in vs_candidate_venues.venue_type.
//   4. EdgeRuntime.waitUntil divorces request lifetime from work lifetime
//      (port plan § 8.3). The function returns 200 immediately; the AI
//      work + INSERTs + completion UPDATE run in the background. The
//      Researching page learns about completion / failure via Realtime
//      on vs_scouts (or status='failed' + pipeline_error on failure).
//
// Auth posture: verify_jwt = true. User-invoked synchronous handshake; no
// self-invoke, no internal-secret path. The handshake returns before the
// AI work starts so the browser doesn't wait on a 90-second request.
//
// Model: claude-sonnet-4-6 (callClaude wrapper default). Testing 4-6 on
// the port-side function; the existing pin in memory note
// project_sourcing_model_pin is for the failed-attempt vs-start-sourcing
// function and does NOT carry over. Diagnostic log captures
// usage.input_tokens, usage.output_tokens, and server_tool_use count so
// the May 11 collapse signature (out<200 AND server_tool_uses=0) is
// visible. Pivot procedure on collapse: add `model: "claude-sonnet-4-5"`
// to the callClaude call below.
//
// VS Pro source: supabase/functions/research-venues/index.ts (~145 lines).
//
// Memory rules in force:
//   - feedback_tool_choice_collapse: don't edit SYSTEM to shape URL
//     quality. SYSTEM lifted verbatim. URL quality lever is the schema
//     description on website_url + the post-emission sanitizer.
//   - URL-quality hot patch lesson: website_url schema description is
//     positive-only with examples; no forbidden-URL list.

import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callClaude, type ClaudeTool } from "../_shared/anthropic.ts";
import { canonicalizeType } from "../_shared/venueTypes.ts";
import {
  validateWebsiteUrl,
  validateWebsiteUrls,
} from "../_shared/urlValidation.ts";
// Phase 4.10.3-port: Phase A pulls sheet-row enrichment from vs-parse-sheet
// into here so all AI venue work lives in one function. callClaude(fill_venue)
// per row in parallel chunks, web_search shared across the pass.
import {
  buildFillUserMsg,
  FILL_SYSTEM,
  FILL_TOOL,
  type ScoutBrief,
} from "../_shared/venueFill.ts";

// Parallel chunk size for Phase A enrichment. 15 sheet venues in 3 batches
// at ~5-10s/call = ~30s. Lifted from the old vs-parse-sheet enrichOne loop.
const PHASE_A_CHUNK_SIZE = 5;

// Local helper used by canonicalizeMulti-style write at Phase A patch time.
function canonicalizeMulti(raw: string): string | null {
  const tokens = String(raw)
    .split(/[/,]/)
    .map((t) => canonicalizeType(t.trim()))
    .filter((t): t is NonNullable<typeof t> => Boolean(t));
  return tokens.length > 0 ? tokens.join(" / ") : null;
}

// Shape captured from the SELECT in runPhaseA. Mirrors the patch-guard
// reads below so producer-entered values never get overwritten.
type SheetRow = {
  id: string;
  name: string;
  address: string | null;
  neighborhood: string | null;
  venue_type: string | null;
  key_features: string[] | null;
  website_url: string | null;
  size_sq_ft: number | null;
  capacity: number | null;
};

// Enrich one sheet venue: callClaude with FILL_TOOL + web_search, apply
// per-field patch guard, UPDATE the row. Returns true on a real write.
async function enrichSheetVenue(
  sb: SupabaseClient,
  scout_id: string,
  scout: ScoutBrief,
  row: SheetRow,
): Promise<{ enriched: boolean; error?: string }> {
  try {
    const userMsg = buildFillUserMsg(scout, {
      name: row.name,
      address: row.address,
      neighborhood: row.neighborhood,
      venue_type: row.venue_type,
      website_url: row.website_url,
    });

    const result = await callClaude(
      "venue_scout",
      [{ role: "user", content: userMsg }],
      {
        model: "claude-sonnet-4-5",
        max_tokens: 6000,
        system: FILL_SYSTEM,
        tools: [
          FILL_TOOL,
          { type: "web_search_20250305", name: "web_search", max_uses: 2 },
        ],
        tool_choice: { type: "tool", name: "fill_venue" },
        fn_name: "vs-research-venues:fill",
      },
    );

    if (!result.ok) {
      console.error(
        `[vs-research-venues:fill] scout=${scout_id} venue=${row.id} failed: ${result.error}`,
      );
      return { enriched: false, error: result.error };
    }

    const serverToolUses = (result.content ?? []).filter(
      (b: { type?: string }) => b?.type === "server_tool_use",
    ).length;
    console.log(
      `[vs-research-venues:fill] scout=${scout_id} venue=${row.id} ` +
        `in=${result.usage?.input_tokens ?? "?"} ` +
        `out=${result.usage?.output_tokens ?? "?"} ` +
        `server_tool_uses=${serverToolUses}`,
    );

    const tu = (result.content ?? []).find(
      (b: { type?: string; name?: string }) =>
        b?.type === "tool_use" && b?.name === "fill_venue",
    );
    if (!tu || typeof tu.input !== "object" || tu.input === null) {
      console.warn(
        `[vs-research-venues:fill] scout=${scout_id} venue=${row.id} no tool_use`,
      );
      return { enriched: false, error: "no_tool_use" };
    }
    const f = tu.input as Record<string, unknown>;

    // Per-field guards: only write fields that were null / empty on the
    // sheet row. Producer-entered values are preserved untouched.
    const patch: Record<string, unknown> = {};

    if (!row.venue_type && typeof f.venue_type === "string") {
      const cleaned = canonicalizeMulti(f.venue_type);
      if (cleaned) patch.venue_type = cleaned;
    }

    if (!row.website_url) {
      const cleaned = await validateWebsiteUrl(f.website_url);
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

    // Recs / cons / rank always written -- sheet rows never have them at
    // parse time. Tool schema requires both arrays + ranking_score so
    // they're always present on a successful tool_use block.
    if (Array.isArray(f.recommendations)) {
      patch.recommendations = f.recommendations;
    }
    if (Array.isArray(f.considerations)) {
      patch.considerations = f.considerations;
    }
    if (typeof f.ranking_score === "number") {
      patch.rank = Math.round(f.ranking_score);
    }

    // derived_attrs NOT filled here. vs_scouts.derived_columns lands at the
    // end of Phase B; backfilled by vs-compile-summaries Pass 1 (which
    // already has the extended condition for source='sheet' rows missing
    // derived_attrs).

    if (Object.keys(patch).length === 0) {
      return { enriched: false, error: "no_patch" };
    }

    const { error: upErr } = await sb
      .from("vs_candidate_venues")
      .update(patch)
      .eq("id", row.id);
    if (upErr) {
      console.error(
        `[vs-research-venues:fill] scout=${scout_id} venue=${row.id} update failed: ${upErr.message}`,
      );
      return { enriched: false, error: upErr.message };
    }
    return { enriched: true };
  } catch (e) {
    console.error(
      `[vs-research-venues:fill] scout=${scout_id} venue=${row.id} threw:`,
      e,
    );
    return {
      enriched: false,
      error: e instanceof Error ? e.message : "unknown",
    };
  }
}

// Phase A: enrich existing source='sheet' venues. Runs in parallel with
// Phase B (sourcing). Per-row failures are tolerated; vs-compile-summaries
// Pass 1 is the backstop for any rows that don't get patched here.
async function runPhaseA(
  sb: SupabaseClient,
  scout_id: string,
  scout: ScoutBrief,
): Promise<{ enriched: number; failed: number; skipped: number }> {
  const { data, error } = await sb
    .from("vs_candidate_venues")
    .select(
      "id, name, address, neighborhood, venue_type, key_features, website_url, size_sq_ft, capacity",
    )
    .eq("scout_id", scout_id)
    .eq("source", "sheet");

  if (error) {
    console.error(
      `[vs-research-venues:phase-a] scout=${scout_id} sheet-row select failed: ${error.message}`,
    );
    return { enriched: 0, failed: 0, skipped: 0 };
  }

  const rows = (data ?? []) as SheetRow[];
  if (rows.length === 0) {
    return { enriched: 0, failed: 0, skipped: 0 };
  }

  let enriched = 0;
  let failed = 0;
  for (let i = 0; i < rows.length; i += PHASE_A_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + PHASE_A_CHUNK_SIZE);
    const results = await Promise.all(
      chunk.map((row) => enrichSheetVenue(sb, scout_id, scout, row)),
    );
    for (const r of results) {
      if (r.enriched) enriched++;
      else failed++;
    }
  }
  console.log(
    `[vs-research-venues:phase-a] scout=${scout_id} sheet rows enriched=${enriched} failed=${failed} of ${rows.length}`,
  );
  return { enriched, failed, skipped: 0 };
}

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

// Hard ceiling on Claude work. Anthropic typically returns in 60-90s; if
// the call hangs past this, the function writes status='failed' so the
// page surfaces an error instead of spinning forever.
const WORK_TIMEOUT_MS = 120_000;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// SYSTEM prompt -- lifted verbatim from VS Pro per memory rule
// feedback_tool_choice_collapse. Do NOT edit to shape URL quality; that
// lever lives on the schema description + sanitizer.
const SYSTEM =
  `You are a venue researcher for Mirror NYC, an experiential creative agency that produces brand activations, launches, and pop-ups for fashion, beauty, and lifestyle clients. Your job is to surface a candidate matrix of venue options that fit a project brief.

Strongly prioritize ground-floor commercial / storefront / retail-vacancy properties — a significant share of Mirror's selected venues are empty storefronts and ground-floor commercial spaces. Reference databases like thestorefront.com, peerspace.com, propertyshark.com, loopnet.com, and crexi.com when researching, but NEVER use those listing-database URLs as a venue's website_url. Only set website_url when the venue has its own dedicated site; otherwise leave it null.

TYPE CONSTRAINT (strict): Each venue's type field must be one or more values from this exact list: Retail, Event Venue, Industrial, Warehouse, Gallery, Studio, Outdoor, Mobile. If the venue is most accurately described as a ground-floor commercial / storefront / retail vacancy, use Retail. Multiple types are allowed when accurate (e.g. a venue can be both Industrial and Warehouse). No other values permitted — do not invent descriptive types like "Ground-floor commercial unit" or "Vacant storefront".

You return ONLY a tool call to submit_research with structured venues and 3-4 derived columns picked from the brief's most important criteria.`;

const TOOL: ClaudeTool = {
  name: "submit_research",
  description: "Return derived columns and the venue candidate matrix.",
  input_schema: {
    type: "object",
    properties: {
      derived_columns: {
        type: "array",
        description:
          "3-4 column definitions derived from the most important brief criteria.",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "snake_case key" },
            label: {
              type: "string",
              description: "Short header label, 2-3 words",
            },
            criteria: {
              type: "string",
              description: "What this column evaluates",
            },
          },
          required: ["id", "label", "criteria"],
        },
      },
      venues: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            neighborhood: { type: "string" },
            address: { type: "string" },
            type: {
              type: "string",
              description:
                "Slash-separated values from the canonical list: Retail, Event Venue, Industrial, Warehouse, Gallery, Studio, Outdoor, Mobile. Example: 'Industrial / Warehouse'.",
            },
            // URL-quality schema nudge -- positive-only, examples, no
            // forbidden-URL list (per the URL-quality hot patch lesson and
            // feedback_tool_choice_collapse memory rule).
            website_url: {
              type: "string",
              description:
                "URL for this venue's individual detail page. Must be a verbatim URL from a web search result. Examples: https://parasolprojects.com (venue's own site), peerspace.com/spaces/12345 (deep link to a specific listing with its full numeric ID), thestorefront.com/listing/west-hollywood-pop-up-2024 (deep link with full slug), loopnet.com/Listing/238-N-Canon-Dr-Beverly-Hills-CA/26148335 (full path with listing ID). Do NOT fabricate URLs or guess listing IDs.",
            },
            size_sq_ft: { type: "number" },
            capacity: { type: "number" },
            key_features: { type: "array", items: { type: "string" } },
            derived_attrs: {
              type: "object",
              description: "Map column id -> 'yes'|'maybe'|'no'",
              additionalProperties: { type: "string" },
            },
            recommendations: {
              type: "array",
              description:
                "2-4 short venue-specific observations the producer can use to pitch this venue against the brief. Each is a concrete, targeted, single-clause statement (10-15 words). Focus on activation potential, brand-fit, physical features, neighborhood context.",
              items: {
                type: "string",
                description:
                  "A single specific observation tying a venue feature to the brief. Concrete and brief. Examples: 'Full window vinyl treatment visible from both directions on Beverly Blvd', 'Connected outdoor courtyard perfect to host yoga/sound bath', 'Surrounding plaza for community run assembly and post-run hang', 'Activate the sidewalk immediately outside with a small run check-in moment', 'High vaulted ceilings align with brand and campaign aesthetic'.",
                maxLength: 150,
              },
              minItems: 2,
              maxItems: 4,
            },
            considerations: {
              type: "array",
              description:
                "2-4 short limitations, gaps, or logistics flags the producer should weigh against the brief. Each is a concrete, targeted, single-clause statement (10-15 words). Focus on permits, capacity, distance, brand fit gaps, parking, programming constraints.",
              items: {
                type: "string",
                description:
                  "A single specific limitation or distance/permit fact the producer should weigh. Concrete and brief. Examples: 'Venue requires TPA for capacity the brief states (over 350)', 'Permitting required for sidewalk/parking lot activation', 'Limited parking options available nearby', 'Melrose Ave is ~4 miles from the LA Marathon finish line in the brief', 'Smaller footprint limits simultaneous multi-zone programming', 'Hotel brand presence may compete visually with brand aesthetic', 'Culver City sits ~3 miles from the brief primary target zones'.",
                maxLength: 200,
              },
              minItems: 2,
              maxItems: 4,
            },
            ranking_score: {
              type: "number",
              description: "0-100 fit score against the brief",
            },
          },
          required: [
            "name",
            "neighborhood",
            "address",
            "type",
            "key_features",
            "derived_attrs",
            "recommendations",
            "considerations",
            "ranking_score",
          ],
        },
        // NOTE: deliberately NO minItems here. The URL-quality hot-patch
        // memory lesson is that minItems on the venues array correlates
        // with empty-payload collapse under forced tool_choice.
      },
    },
    required: ["derived_columns", "venues"],
  },
};

// Two-row failure write helper. Used by every error path in `work`.
async function writeFailure(
  sb: ReturnType<typeof createClient>,
  scout_id: string,
  message: string,
): Promise<void> {
  console.error(`[vs-research-venues] scout=${scout_id} failure: ${message}`);
  await sb
    .from("vs_scouts")
    .update({
      status: "failed",
      pipeline_error: message,
      last_touched_at: new Date().toISOString(),
    })
    .eq("id", scout_id);
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

  // Load the scout + existing venues. Existing venues feed both the
  // idempotency check (sheet count -> targetNet) and the EXISTING VENUES
  // de-dupe block in the user message.
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

  // Idempotency: skip if already past the researching step (page already
  // navigated away) or if a kickoff fired recently and is still running.
  if (scout.current_step !== "researching") {
    return jsonResponse({
      ok: true,
      scout_id,
      skipped: "not_in_researching_state",
    });
  }
  const briefData = (scout.brief_data ?? {}) as Record<string, unknown>;
  const startedAtRaw = briefData.research_started_at;
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
        research_started_at: new Date().toISOString(),
      },
      pipeline_error: null,
    })
    .eq("id", scout_id);

  // Load existing venues for the de-dupe + sheet-count enrichment.
  const { data: existing } = await sb
    .from("vs_candidate_venues")
    .select("name, neighborhood, address, venue_type, source")
    .eq("scout_id", scout_id);

  const sheetVenues = (existing ?? []).filter(
    (v: { source: string | null }) => v.source === "sheet",
  );
  const targetNet =
    sheetVenues.length >= 10 ? 4 : Math.max(10 - sheetVenues.length, 5);

  // User message -- lifted from VS Pro with `project.` -> `scout.` field
  // reads. Fallback strings normalized to "(not set)" (VS Pro used en
  // dashes which violate the voice rule).
  const userMsg =
    `PROJECT BRIEF
Client: ${scout.client_name ?? "(not set)"}
Event: ${scout.event_name ?? "(not set)"}
City: ${scout.city ?? "(not set)"}
Live dates: ${scout.live_dates ?? "(not set)"}
Budget: ${scout.budget ?? "(not set)"}
Overview: ${scout.event_overview ?? "(not set)"}
Brief data: ${JSON.stringify(scout.brief_data ?? {})}

EXISTING VENUES (do not duplicate):
${(existing ?? [])
  .map(
    (v: { name: string | null; neighborhood: string | null }) =>
      `- ${v.name ?? "?"} (${v.neighborhood ?? "?"})`,
  )
  .join("\n") || "(none)"}

Return ${targetNet} net-new venue candidates (10-15 total considering the existing list). Weight ground-floor commercial / storefront / retail-vacancy spaces heavily in ranking_score. Pick 3-4 derived columns that map to the most decision-relevant brief criteria.`;

  // Background work. Returns nothing; writes success / failure straight
  // to vs_scouts so the Researching page picks them up via Realtime.
  //
  // Phase 4.10.3-port restructure: this function now runs two AI phases
  // in parallel inside one waitUntil:
  //   Phase A -- per-row enrichment of existing source='sheet' rows (was
  //              vs-parse-sheet's job; moved here so all AI venue work
  //              centralizes on one function with one web_search budget
  //              per call and one validation surface).
  //   Phase B -- existing batch sourcing of net-new research venues.
  // Phase A failures are tolerated (per-row, vs-compile-summaries Pass 1
  // backstops). Phase B failure flips the scout to status='failed'.
  const work = async () => {
    try {
      // Kick Phase A off in parallel. We start it before the Claude call
      // for Phase B so the two run concurrently; await both before the
      // final scout UPDATE. Phase A doesn't have its own timeout because
      // it's a sequence of per-row callClaude that each enforce their
      // own deadline via the wrapper; total Phase A latency scales with
      // (sheet_count / CHUNK_SIZE).
      const phaseAPromise = runPhaseA(sb, scout_id, scout as ScoutBrief);

      // 120-second ceiling via Promise.race for Phase B. Defense-in-depth
      // so a hanging Anthropic call doesn't leave the page spinning
      // forever. Capture the handle so we can clearTimeout on normal
      // completion; otherwise the orphaned timer keeps EdgeRuntime
      // .waitUntil alive for the full 120s even when Claude returns
      // in 30.
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error(`timed out after ${WORK_TIMEOUT_MS / 1000}s`)),
          WORK_TIMEOUT_MS,
        );
      });
      const callPromise = callClaude(
        "venue_scout",
        [{ role: "user", content: userMsg }],
        {
          // Phase 4.10.3-port: pivoted to claude-sonnet-4-5 per the
          // pre-authorized procedure documented above. 4-6 was emitting
          // out=2610 with server_tool_uses=0 (no web_search) on smoke
          // 2026-05-13 -- venues filled from training knowledge with no
          // URLs. 4-5 is the validated baseline for forced custom-tool
          // alongside server-side web_search.
          model: "claude-sonnet-4-5",
          max_tokens: 8000,
          system: SYSTEM,
          tools: [
            TOOL,
            { type: "web_search_20250305", name: "web_search", max_uses: 6 },
          ],
          tool_choice: { type: "tool", name: "submit_research" },
          fn_name: "vs-research-venues",
        },
      );

      const result = await Promise.race([callPromise, timeoutPromise]);
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);

      if (!result.ok) {
        await writeFailure(
          sb,
          scout_id,
          `Claude call failed: ${result.error}`,
        );
        return;
      }

      // Diagnostic log -- this is the 4-6 vs 4-5 test signal.
      const serverToolUses = (result.content ?? []).filter(
        (b: { type?: string }) => b?.type === "server_tool_use",
      ).length;
      console.log(
        `[vs-research-venues] scout=${scout_id} model=claude-sonnet-4-6 ` +
          `in=${result.usage?.input_tokens ?? "?"} ` +
          `out=${result.usage?.output_tokens ?? "?"} ` +
          `server_tool_uses=${serverToolUses}`,
      );

      const toolUse = (result.content ?? []).find(
        (b: { type?: string; name?: string }) =>
          b?.type === "tool_use" && b?.name === "submit_research",
      );
      if (!toolUse || typeof toolUse.input !== "object" || toolUse.input === null) {
        await writeFailure(
          sb,
          scout_id,
          `no structured output (stop_reason=${result.stop_reason ?? "?"})`,
        );
        return;
      }

      const { derived_columns, venues } = toolUse.input as {
        derived_columns?: unknown;
        venues?: unknown;
      };

      if (!Array.isArray(venues)) {
        await writeFailure(sb, scout_id, "tool input missing venues array");
        return;
      }

      // Sanitize. Drop nameless venues defensively. Type tokens go
      // through canonicalizeType; URL captured raw here for the deferred
      // HEAD-validation pass below (validateWebsiteUrls runs the existing
      // sanitizeWebsiteUrl internally + a HEAD-request gate against URL
      // fabrication, Phase 4.10.3-port).
      // Note column rename: VS Pro -> HQ
      //   type            -> venue_type
      //   ranking_score   -> rank
      const cleanVenues = venues
        .map((raw: unknown) => {
          const v = raw as Record<string, unknown>;
          const typeRaw = typeof v.type === "string" ? v.type : "";
          // Split on slash OR comma. Claude's tool schema example nudges
          // slash-separation but the model occasionally returns
          // "Industrial, Warehouse" instead. Without comma in the split,
          // canonicalizeType's line-28 dual-token guard returns null and
          // both types are lost. Matches the shared canonicalizeMultiType
          // split regex.
          const typeTokens = typeRaw
            .split(/[/,]/)
            .map((t) => canonicalizeType(t.trim()))
            .filter((t): t is NonNullable<typeof t> => Boolean(t));
          const venue_type = typeTokens.length > 0 ? typeTokens.join(" / ") : null;
          return {
            scout_id,
            name: typeof v.name === "string" ? v.name.trim() : "",
            neighborhood:
              typeof v.neighborhood === "string" ? v.neighborhood : null,
            address: typeof v.address === "string" ? v.address : null,
            venue_type,
            website_url:
              typeof v.website_url === "string" ? v.website_url : null,
            size_sq_ft:
              typeof v.size_sq_ft === "number" ? v.size_sq_ft : null,
            capacity: typeof v.capacity === "number" ? v.capacity : null,
            key_features: Array.isArray(v.key_features) ? v.key_features : [],
            derived_attrs:
              typeof v.derived_attrs === "object" && v.derived_attrs !== null
                ? v.derived_attrs
                : {},
            recommendations: Array.isArray(v.recommendations)
              ? v.recommendations
              : [],
            considerations: Array.isArray(v.considerations)
              ? v.considerations
              : [],
            // vs_candidate_venues.rank is INTEGER; Math.round defensively
            // in case Claude returns a float (the schema declares
            // `ranking_score: number` which allows floats). Postgres would
            // truncate silently otherwise.
            rank:
              typeof v.ranking_score === "number"
                ? Math.round(v.ranking_score)
                : null,
            source: "research" as const,
          };
        })
        .filter((v) => v.name.length > 0);

      if (cleanVenues.length === 0) {
        await writeFailure(
          sb,
          scout_id,
          "AI returned no usable venues. Try again.",
        );
        return;
      }

      // Phase 4.10.3-port: HEAD-validate each website_url in parallel so
      // fabricated listing URLs (LoopNet / Crexi / Storefront pages with
      // invented listing IDs that 4xx or soft-404 to a homepage) get
      // dropped before INSERT. ~15-20 URLs in parallel, 5s timeout each,
      // adds ~2-3s total. Network errors keep the URL (producer can edit).
      const rawUrls = cleanVenues.map((v) => v.website_url);
      const validatedUrls = await validateWebsiteUrls(rawUrls);
      const venuesForInsert = cleanVenues.map((v, i) => ({
        ...v,
        website_url: validatedUrls[i],
      }));

      const { error: insErr } = await sb
        .from("vs_candidate_venues")
        .insert(venuesForInsert);
      if (insErr) {
        await writeFailure(
          sb,
          scout_id,
          `Insert failed: ${insErr.message}`,
        );
        return;
      }

      // Await Phase A before final scout flip so the Researching page
      // navigates to a fully-enriched matrix. Phase A errors are tolerated
      // (per-row); the function call itself shouldn't reject unless the
      // table SELECT failed, which already logs above.
      const phaseAResult = await phaseAPromise;
      console.log(
        `[vs-research-venues] scout=${scout_id} phase-a sheet enrich done: ${phaseAResult.enriched} enriched, ${phaseAResult.failed} failed`,
      );

      // Last write: flip the scout state so the Realtime subscriber on
      // the Researching page navigates. Venues are already queryable
      // when this UPDATE fires.
      const { error: updErr } = await sb
        .from("vs_scouts")
        .update({
          derived_columns: Array.isArray(derived_columns) ? derived_columns : [],
          current_step: "sourcing_report",
          status: "in_progress",
          pipeline_error: null,
          last_touched_at: new Date().toISOString(),
        })
        .eq("id", scout_id);

      if (updErr) {
        await writeFailure(
          sb,
          scout_id,
          `Final scout update failed: ${updErr.message}`,
        );
        return;
      }

      console.log(
        `[vs-research-venues] scout=${scout_id} complete inserted=${cleanVenues.length}`,
      );
    } catch (e) {
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
