// vs-compile-summaries (Phase 4.7.2-port + Phase 4.10.1-port refactor)
//
// Two-pass AI compile for the pitched-venue set. Lifted from VS Pro
// `compile-summaries` with these locked deltas per port plan § 6:
//   1. Both Anthropic calls go through callClaude('venue_scout', ...) for
//      spend tracking + per-app key + cache discounts. No raw fetch.
//   2. Sanitization on Pass 1 output: venue_type tokens through
//      sanitizeMultiAgainst (Phase 5.12.10 runtime canonical set),
//      website_url through validateWebsiteUrl (4.10.3-port HEAD-validation
//      wrapper around sanitizeWebsiteUrl), ranking_score -> rank
//      Math.round for INTEGER column.
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
//     prompt + schema. Single source of truth.
//   - Pass 1 needsFill condition extended to fire for source='sheet'
//     rows that are missing derived_attrs. vs-parse-sheet enrichment
//     never fills derived_attrs (vs_scouts.derived_columns doesn't
//     exist at parse time); this catch-all backfills them at compile.
//
// Phase 5.12.0: Pass 2 converged onto the HQ ABOUT_VENUE_SYSTEM path. The
// legacy VS-only OVERVIEW_TOOL + OVERVIEW_SYSTEM are gone. Pass 2 now runs
// tool-less with web_search + tool_choice auto + a prompt-cache breakpoint
// on the system block so the long evergreen prompt is billed once per
// scout, not once per venue in the sequential loop. Pass 2 user message
// is venue-data-only (no brief block) plus the optional VS producer_inputs
// block (recs + producer notes; no considerations, locked Phase 5.12.0).
// The HQ Venues match-or-insert + linked_venue_id wiring + about_venue
// write-when-blank moved out of this function to vs-generate-deck so the
// producer's last-mile edits on DeckPrep flow through.
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
//   - feedback_tool_choice_collapse: Pass 1 still forces FILL_TOOL, so do
//     NOT edit FILL_SYSTEM to shape AI-output quality (output-quality levers
//     live on schema descriptions + sanitizer). Pass 2 is tool-less now,
//     so the collapse class no longer applies there; ABOUT_VENUE_SYSTEM
//     and the user-message builder are the levers if voice drifts.
//   - URL-quality hot patch lesson: FILL_TOOL website_url has no schema
//     description; sanitizer is the only check. Matches research-venues
//     posture where sanitizer catches what schema-prompting could not.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  callClaude,
  extractWebSearchResults,
} from "../_shared/anthropic.ts";
import {
  findBestSearchResultUrl,
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Skip-the-kickoff window. MUST exceed WORK_TIMEOUT_MS so a refresh-during-
// in-flight invocation can't reacquire the kickoff while the first run is
// still applying patches (mirrors the Phase 5.12.4.2 bump on vs-generate-
// deck for the same race shape).
//
// Phase 5.12.4.2 bump 90_000 -> 300_000 (Codex adversarial review round 2;
// extends the deck-side fix to the compile surface). Pre-fix: grace 90s +
// work 240s = a 150s window where the kickoff age check expired BUT the
// first work() invocation was still mid-Pass-1/Pass-2, so a producer
// refresh during compile would acquire a fresh kickoff and start a
// SECOND compile run, double-spending Claude tokens. 300s = 240s work
// ceiling + 60s buffer for the writeFailure UPDATE to land before any
// refresh-triggered reacquisition can proceed.
const IN_FLIGHT_GRACE_MS = 300_000;

// Hard ceiling on Claude work. Phase 5.12.0 arithmetic (typical-case cap,
// NOT a worst-case buffer):
//   - Pass 1 fill (conditional, fires only for manual/sheet rows missing
//     recs / rank / type / derived_attrs): ~30s with web_search_20250305
//     + max_uses 2 + 4000 max_tokens.
//   - Pass 2 overview (web_search auto + 2000 max_tokens, prompt cache on
//     system block): ~40s on the first venue, ~25s on subsequent venues
//     in the same scout (cache reads, no system-prefix latency).
//
// Typical case (5 pitched venues, mostly research-sourced so Pass 1 fires
// for 0-1 rows): ~40s + 4 * 25s = ~140s. Worst case (5 pitched venues,
// all manual or sheet-source with all fields blank): 5 * 70s = ~350s
// against the Edge Function Pro 400s wall-clock.
//
// 240s is an INTENTIONAL expected-case cap (below the worst case): catches
// ~95% of real scouts in one run while keeping the producer-facing wait
// bounded. Worst-case all-manual scouts time out and the producer retries
// (failWithCode path already exists). Lever order if smoke surfaces real
// scouts tipping over 240s: (1) drop Pass 2 web_search max_uses from 2 to
// 1, (2) bump WORK_TIMEOUT_MS to 300_000, (3) parallelize the per-venue
// loop (out of scope here).
const WORK_TIMEOUT_MS = 240_000;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// FILL_TOOL + FILL_SYSTEM + buildFillUserMsg now live in _shared/venueFill.ts
// (Phase 4.10.1-port). vs-parse-sheet and this function both import them so
// the Pass 1 prompt + schema never drift.

// OVERVIEW_TOOL + OVERVIEW_SYSTEM now live in _shared/venueOverview.ts
// (Phase 5.10.0). Imported above; this function and hq-generate-venue-about
// share them. Lift was verbatim per feedback_tool_choice_collapse.

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

  // Phase 5.12.10: per-request runtime canonical venue-types set. Threaded
  // into Pass 1's buildFillUserMsg + sanitizeMultiAgainst apply guard.
  // Single SELECT per request; cheap vs Claude latency.
  const canonicalSet = await getVenueTypesCanonicalSet(
    sb,
    "vs-compile-summaries",
  );

  // Phase 5.12.0: the per-row Pass 2 user message no longer carries a brief
  // block. ABOUT_VENUE_SYSTEM is brief-less; the overview is evergreen and
  // reused across decks, so the per-scout brief intentionally falls out of
  // the prompt. Pass 1 still gets the brief through `buildFillUserMsg`,
  // which builds its OWN brief block inside `_shared/venueFill.ts` from the
  // scout argument; the local brief block this function used to construct
  // was Pass-2-only and is dropped along with the legacy overview path.

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
      // Audit pass 2 item 3: re-SELECT brief_data right at the top so the
      // local copy reflects the kickoff write's compile_started_at (the
      // handler's briefData was captured BEFORE the kickoff write at
      // lines 243-252 and is missing that field). Every progress_step
      // write below merges against the latest in-memory liveBriefData,
      // then writes back, so the kickoff timestamp + any other ad-hoc
      // state survive intact.
      const { data: refreshedScout } = await sb
        .from("vs_scouts")
        .select("brief_data")
        .eq("id", scout_id)
        .maybeSingle();
      let liveBriefData =
        (refreshedScout?.brief_data ?? briefData) as Record<string, unknown>;
      // Progress-step writer. UX-only signal driving the Compiling page's
      // step list via Realtime. Failure warn-and-continues so a misbehaving
      // progress write can never sink the pipeline. CAS-guarded columns
      // (current_step + pipeline_error) are NOT touched.
      const writeProgress = async (key: string) => {
        liveBriefData = { ...liveBriefData, progress_step: key };
        const { error: progressErr } = await sb
          .from("vs_scouts")
          .update({ brief_data: liveBriefData })
          .eq("id", scout_id);
        if (progressErr) {
          console.warn(
            `[vs-compile-summaries] scout=${scout_id} progress_step=${key} write failed: ${progressErr.message}`,
          );
        }
      };
      await writeProgress("loading_pitched");

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

      await writeProgress("pass_1_fill");

      // Audit pass 2 item 3: gate the pass_2_overview write to the first
      // iteration's overview block. Pass 1 + Pass 2 are interleaved within
      // this single venue loop (not separate loops), so emitting a single
      // mid-loop transition on the first venue's overview keeps the
      // progress signal honest without bombarding Realtime with one write
      // per venue.
      let emittedPass2 = false;

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
        const consArr = Array.isArray(v.considerations)
          ? v.considerations
          : [];
        const derivedAttrsEmpty =
          !v.derived_attrs ||
          Object.keys(v.derived_attrs as Record<string, unknown>).length === 0;
        // Phase 5.12.4 thread (a): hq_pool rows now fire Pass 1 when recs /
        // cons / rank are missing so per-brief judgment lands on HQ-sourced
        // rows. The derived_attrs-only branch does NOT fire Pass 1 for
        // hq_pool rows: Pass 1 has no access to the scout's derived_columns
        // config so Claude would invent its own keys (mismatch the matrix
        // UI's column IDs); the keys would land but never render. Skip
        // cleanly for now; revisit when derived_columns gets passed into
        // FILL_TOOL (out of 5.12.4 scope).
        //
        // The hq_pool branch also gates on consArr.length === 0 so that
        // 5.12.3.1 seed-then-drop rows -- which already carry recs + cons +
        // rank from Claude's research -- do NOT trigger a wasteful re-fire.
        // Pure-fit-filter hq_pool inserts have all three null, so the
        // predicate fires correctly on the path that needs it.
        //
        // Pre-5.12.4 comment kept for context: the original 5.12.1 design
        // excluded hq_pool entirely because admin-curated structured fields
        // were canonical. Per-field apply-side guards below preserve any
        // existing populated field, so writes only ever land on empty
        // columns; the hq_pool widening doesn't risk overwriting curated
        // data. derived_attrs is the only exception (guard added below).
        const isManualOrSheet = v.source === "manual" || v.source === "sheet";
        const isHqPool = v.source === "hq_pool";
        const needsFill =
          (isManualOrSheet &&
            (recsArr.length === 0 || v.rank == null || derivedAttrsEmpty)) ||
          (isHqPool &&
            (recsArr.length === 0 || consArr.length === 0 || v.rank == null));
        if (needsFill) {
          // Pass 1 user message comes from the shared builder so
          // vs-parse-sheet's enrichment and this backfill stay in lock
          // step. Producer notes go through too (manual rows collect
          // them; sheet rows pre-pitch typically don't have notes yet).
          const fillUserMsg = buildFillUserMsg(
            scout as ScoutBrief,
            {
              name: v.name,
              address: v.address,
              neighborhood: v.neighborhood,
              venue_type: v.venue_type,
              // Phase 4.10.3-port: forward producer-set URL so backfill
              // research uses it as primary source.
              website_url: v.website_url,
              notes: v.notes,
              // Phase 5.12.4 thread (a): hq_pool rows carry the HQ
              // about_venue in venue_overview (set at INSERT time per
              // 5.12.1 / 5.12.3.1 deterministic-keep path / 5.12.3.1
              // cross-rail seed-then-drop). When present, Claude sees the
              // HQ CANONICAL ABOUT block in the user message and skips
              // redundant identity research, focusing on per-brief
              // judgment.
              aboutVenue:
                v.source === "hq_pool"
                  ? typeof v.venue_overview === "string"
                    ? v.venue_overview
                    : null
                  : null,
            },
            canonicalSet.names,
          );

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

                // venue_type: sanitizeMultiAgainst runs each token
                // through the runtime canonical set (Phase 5.12.10).
                // Returns null when nothing resolves; only set if the
                // venue doesn't already have a type.
                if (!v.venue_type && typeof f.venue_type === "string") {
                  const cleaned = sanitizeMultiAgainst(
                    f.venue_type,
                    canonicalSet.names,
                  );
                  if (cleaned) patch.venue_type = cleaned;
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
                  // Phase 5.12.13.1: sanitizeTagShape chains on the
                  // outside to drop items that violate the evergreen-
                  // tag shape (digits, > 4 words, > 35 chars, case-
                  // insensitive dupes).
                  const cleaned = sanitizeTagShape(
                    stripPlaceholders(f.key_features),
                  );
                  if (cleaned.length > 0) patch.key_features = cleaned;
                }

                const existingDerived = (v.derived_attrs ?? {}) as Record<
                  string,
                  unknown
                >;
                // Phase 5.12.4 thread (a): skip derived_attrs writes for
                // hq_pool rows. Pass 1's needsFill predicate already excludes
                // the derived_attrs-only trigger for hq_pool, but a recs /
                // cons / rank trigger on a row whose derived_attrs is also
                // empty would still land Claude's invented keys without this
                // guard. FILL_TOOL doesn't carry the scout's derived_columns
                // IDs, so the invented keys mismatch the matrix UI's column
                // IDs and would never render. Revisit when derived_columns
                // gets passed into FILL_TOOL (out of 5.12.4 scope).
                if (
                  v.source !== "hq_pool" &&
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

                // consArr declared at the top of the loop (5.12.4) for use
                // in the needsFill predicate; reused here as the apply-side
                // guard.
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

        // Pass 2 (Phase 5.12.0 convergence): tool-less + web_search +
        // prompt-cache breakpoint on the system block. Same prompt
        // (ABOUT_VENUE_SYSTEM) as hq-generate-venue-about; user message is
        // venue-data-only plus the optional <producer_inputs> block
        // (recommendations + producer notes; no considerations). Always
        // overwrites venue_overview; producer can edit on DeckPrep later
        // and the value flows through to venues.about_venue via the HQ
        // push at the top of vs-generate-deck. Merge the Pass 1 patch into
        // the venue snapshot so the overview sees the newly-filled fields.
        const merged = { ...v, ...patch } as typeof v;

        // Phase 5.12.1: hq_pool rows are pre-filled with `venue_overview`
        // from `venues.about_venue` at research time (vs-research-venues
        // § 8.1 INSERT). If the producer hasn't blanked it on Review /
        // DeckPrep, the paragraph is canonical HQ copy and Pass 2 must not
        // regenerate it. A blank or whitespace-only value triggers regen as
        // a recovery path (e.g., admin cleared about_venue but the producer
        // wants a fresh paragraph). Mirrors the write-when-blank logic on
        // the HQ side.
        const skipOverviewForHqPool =
          v.source === "hq_pool" &&
          typeof v.venue_overview === "string" &&
          v.venue_overview.trim().length > 0;
        if (skipOverviewForHqPool) {
          console.log(
            `[vs-compile-summaries] scout=${scout_id} venue=${v.id} pass=overview skipped (hq_pool prefilled)`,
          );
        } else {
          if (!emittedPass2) {
            emittedPass2 = true;
            await writeProgress("pass_2_overview");
          }
          const overviewUserMsg = buildOverviewUserMsgForVsRow(
            {
              name: merged.name,
              address: merged.address,
              neighborhood: merged.neighborhood,
              venue_type: merged.venue_type,
              size_sq_ft: merged.size_sq_ft,
              capacity: merged.capacity,
              website_url: merged.website_url,
              key_features: Array.isArray(merged.key_features)
                ? (merged.key_features as string[])
                : null,
              recommendations: Array.isArray(merged.recommendations)
                ? (merged.recommendations as string[])
                : null,
              notes: typeof v.notes === "string" ? v.notes : null,
            },
            scout.city as string | null,
          );

          try {
            const overviewResult = await callClaude(
              "venue_scout",
              [{ role: "user", content: overviewUserMsg }],
              {
                // Testing claude-sonnet-4-6 (wrapper default). Pass 2 is
                // tool-less now (no forced custom tool) so the
                // feedback_tool_choice_collapse failure class does not
                // apply here; if voice drifts, the lever is
                // ABOUT_VENUE_SYSTEM in _shared/venueOverview.ts.
                max_tokens: 2000,
                system: [
                  {
                    type: "text",
                    text: ABOUT_VENUE_SYSTEM,
                    // 1-hour ephemeral cache so the long evergreen system
                    // prefix is billed once per scout. The sequential
                    // per-venue loop reads from cache from venue 2 onward.
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
                  `out=${overviewResult.usage?.output_tokens ?? "?"} ` +
                  `cache_read=${overviewResult.usage?.cache_read_input_tokens ?? 0} ` +
                  `cache_write=${overviewResult.usage?.cache_creation_input_tokens ?? 0}`,
              );
              const aboutVenue = (overviewResult.text ?? "").trim();
              patch.venue_overview =
                aboutVenue.length > 0
                  ? aboutVenue
                  : buildStub({
                      name: merged.name as string,
                      city: scout.city as string | null,
                    });
            }
          } catch (e) {
            console.error(
              `[vs-compile-summaries] scout=${scout_id} venue=${v.id} pass=overview threw:`,
              e,
            );
          }
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

      await writeProgress("handoff");

      // Final write: flip the scout state so the Realtime subscriber on
      // the Compiling page navigates. All per-venue UPDATEs already
      // landed before this fires.
      //
      // Phase 5.12.4.2 (Codex round 2 finding 2): CAS-guard on
      // `pipeline_error IS NULL` so a late-resolving compileWork() can't
      // overwrite a writeFailure stamp. Promise.race() can reject on
      // timeout while compileWork is still mid-Claude-call; if Claude
      // resolves after the timeout (plausible under web_search latency
      // + the 180s wrapper ceiling + pause_turn continuation), the
      // pre-5.12.4.2 final UPDATE had no guard against overwriting the
      // failure state with `current_step='deck_prep', status='in_progress'`.
      // The writeFailure path stamps a non-null pipeline_error, so this
      // predicate fails cleanly when the failure already landed; the
      // late-success write becomes a 0-row no-op. The kickoff RPC clears
      // pipeline_error at acquisition time, so the happy-path runs always
      // see NULL when this CAS fires. Also guard on
      // current_step='compiling' for defense-in-depth against any external
      // step advancement.
      const { error: scoutUpdErr, count: scoutUpdCount } = await sb
        .from("vs_scouts")
        .update(
          {
            current_step: "deck_prep",
            status: "in_progress",
            pipeline_error: null,
            last_touched_at: new Date().toISOString(),
          },
          { count: "exact" },
        )
        .eq("id", scout_id)
        .eq("current_step", "compiling")
        .is("pipeline_error", null);

      if (scoutUpdErr) {
        throw new Error(`Final scout update failed: ${scoutUpdErr.message}`);
      }
      if (scoutUpdCount === 0) {
        // The CAS no-op'd. Either a writeFailure already stamped failure
        // (timeout race) or another invocation advanced current_step.
        // Both are terminal states from this work()'s perspective; log
        // and return cleanly without raising so the late-success path
        // doesn't trip the outer catch + double-write writeFailure on top
        // of the prior failure.
        console.warn(
          `[vs-compile-summaries] scout=${scout_id} final UPDATE no-op (CAS failed; likely timeout already wrote failure or another invocation advanced state)`,
        );
        return;
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
