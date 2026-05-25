// vs-research-venues (Phase 4.5-port)
//
// Phase 5.12.7 Feature B note: an `enrichHqPoolForResearch` helper now
// runs sequentially after Phase A, before the final UPDATE flipping
// current_step='sourcing_report'. It fires the same Pass 1 needsFill
// shape `vs-compile-summaries` uses for hq_pool rows, so the sourcing
// matrix renders fully populated on first view instead of carrying bare
// recs/cons/rank cells until compile time. Best-effort: every failure
// path warn-logs + skips, never writeFailure. See helper docblock for
// the timeout-budget + composition rationale.
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
// Model: claude-sonnet-4-6 + web_search_20260209 (post-4.10.4 hot patch).
// The 4.10.3 spec pivoted to claude-sonnet-4-5 + web_search_20250305 on
// the assumption that 4-6 collapsed (out=2610, server_tool_uses=0), but
// the diagnostic log lines hardcoded `model=claude-sonnet-4-6` so the
// pivot was logging-invisible -- we never actually verified 4-6 was the
// failure source. Post-4.10.4 smoke (2026-05-13 evening) on 4-5 surfaced
// server_tool_uses=0 on ALL 9 Claude calls (7 per-row Phase A + 2 batch
// Phase B). Anthropic docs explicitly support Sonnet 4.6 / 4.7 / Opus
// 4.6+ / Mythos with the newer web_search_20260209 (dynamic filtering);
// Sonnet 4.5 is not on that list. Combined with web_search enabled in
// the org Console, the 4-6 + 20260209 combo should restore live URL
// fetch. Diagnostic log captures usage.input_tokens, usage.output_tokens,
// and server_tool_use count so any future collapse is visible. Pivot
// procedure on collapse: try `model: "claude-opus-4-7"` first (same new
// web_search version supports it), then escalate.
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
import {
  callClaude,
  extractWebSearchResults,
  findVenueWebsite,
  type ClaudeTool,
} from "../_shared/anthropic.ts";
import {
  findBestSearchResultUrl,
  getVenueTypesCanonicalSet,
  sanitizeMultiAgainst,
  sanitizeTagShape,
  stripPlaceholders,
} from "../_shared/venueTypes.ts";
import {
  validateWebsiteUrl,
  validateWebsiteUrls,
} from "../_shared/urlValidation.ts";
// Phase 5.12.1: cross-rail dedupe against `source='hq_pool'` rows seeded
// at the top of the request handler. Shared helper extracted from the
// 5.12.0 vs-generate-deck inline cascade so both consumers run the same
// name -> address -> website ladder with cross-field disambiguation.
import { findVenueDedupeMatch } from "../_shared/venueDedupe.ts";
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

// Phase 5.12.10: local canonicalizeMulti helper deleted. Phase A + Phase B
// post-emit paths now use the shared sanitizeMultiAgainst(raw, canonicalSet)
// from _shared/venueTypes.ts. canonicalSet is fetched once per request via
// getVenueTypesCanonicalSet and threaded into enrichSheetVenue +
// enrichHqPoolForResearch + Phase B work().

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
  canonicalSet: readonly string[],
): Promise<{ enriched: boolean; error?: string }> {
  try {
    const userMsg = buildFillUserMsg(
      scout,
      {
        name: row.name,
        address: row.address,
        neighborhood: row.neighborhood,
        venue_type: row.venue_type,
        website_url: row.website_url,
      },
      canonicalSet,
    );

    const result = await callClaude(
      "venue_scout",
      [{ role: "user", content: userMsg }],
      {
        // Post-4.10.4 hot patch (2026-05-13 evening): pivoted from
        // claude-sonnet-4-5 + web_search_20250305 to claude-sonnet-4-6 +
        // web_search_20260209 (the official Sonnet 4.6 / Opus 4.6+ pair).
        //
        // Round 12 hot patch: pivoted web_search_20260209 -> 20250305.
        // The newer 20260209 tool with dynamic filtering runs a
        // code_execution sandbox per use, and Anthropic bills cumulative
        // context on every multi-turn round (each search adds ~7-8k
        // tokens to the next turn's input). Round 11's brief_data trim
        // helped (215k -> 80k) but the bulk is still web_search results.
        // The simpler 20250305 tool (no dynamic filtering, no
        // code_execution sandbox) has lighter per-use overhead. Docs
        // confirm 20250305 remains GA and works with Sonnet 4.6.
        model: "claude-sonnet-4-6",
        max_tokens: 4000,
        system: FILL_SYSTEM,
        tools: [
          FILL_TOOL,
          { type: "web_search_20250305", name: "web_search", max_uses: 2 },
        ],
        tool_choice: { type: "auto" },
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

    // Round 15 hot patch: address + neighborhood are now in FILL_TOOL.
    // Fill them when the producer left them blank. Common case: the
    // producer enters just an address-style venue NAME (e.g. "238 N
    // Canon Drive") without the address column populated; web_search
    // resolves the full canonical address from the brief's city.
    if (
      (!row.address || row.address.trim().length === 0) &&
      typeof f.address === "string" &&
      f.address.trim().length > 0
    ) {
      patch.address = f.address.trim();
    }

    if (
      (!row.neighborhood || row.neighborhood.trim().length === 0) &&
      typeof f.neighborhood === "string" &&
      f.neighborhood.trim().length > 0
    ) {
      patch.neighborhood = f.neighborhood.trim();
    }

    if (!row.venue_type && typeof f.venue_type === "string") {
      const cleaned = sanitizeMultiAgainst(f.venue_type, canonicalSet);
      if (cleaned) patch.venue_type = cleaned;
    }

    if (!row.website_url) {
      const cleaned = await validateWebsiteUrl(f.website_url);
      if (cleaned) {
        patch.website_url = cleaned;
      } else {
        // Round 13 hot patch: fallback. If Claude's tool output didn't
        // include a usable website_url, try to recover one from the
        // web_search results blocks themselves. They're already
        // surfaced in the response content; we just need to read them.
        const searchResults = extractWebSearchResults(result.content ?? []);
        const fallbackUrl = findBestSearchResultUrl(row.name, searchResults);
        if (fallbackUrl) {
          // HEAD-validate the fallback so we don't insert dead URLs.
          const validated = await validateWebsiteUrl(fallbackUrl);
          if (validated) {
            patch.website_url = validated;
            console.log(
              `[vs-research-venues:fill] scout=${scout_id} venue=${row.id} website_url fallback from search results: ${validated}`,
            );
          }
        }
      }
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
      // Round 7 hot patch: strip placeholder tokens ('<UNKNOWN>', 'TBD',
      // 'N/A', etc.) Claude falls back to when uncertain. If the
      // resulting array is empty, skip the write so the row keeps its
      // null / empty state instead of getting a junk-filled column.
      // Phase 5.12.13.1: sanitizeTagShape chains on the outside to drop
      // items that violate the evergreen-tag shape (digits, > 4 words,
      // > 35 chars, case-insensitive dupes).
      const cleaned = sanitizeTagShape(stripPlaceholders(f.key_features));
      if (cleaned.length > 0) patch.key_features = cleaned;
    }

    // Recs / cons / rank always written -- sheet rows never have them at
    // parse time. Tool schema requires both arrays + ranking_score so
    // they're always present on a successful tool_use block.
    //
    // Round 7 hot patch: same placeholder strip as key_features. Schema
    // minItems pushes Claude to fill these even when uncertain, and the
    // fallback is sometimes a placeholder array; this filter ensures the
    // producer sees actual research, not Claude's "I don't know" tokens.
    if (Array.isArray(f.recommendations)) {
      const cleaned = stripPlaceholders(f.recommendations);
      if (cleaned.length > 0) patch.recommendations = cleaned;
    }
    if (Array.isArray(f.considerations)) {
      const cleaned = stripPlaceholders(f.considerations);
      if (cleaned.length > 0) patch.considerations = cleaned;
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
  canonicalSet: readonly string[],
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
      chunk.map((row) =>
        enrichSheetVenue(sb, scout_id, scout, row, canonicalSet),
      ),
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

// Phase 5.12.7 Feature B: research-time enrichment of hq_pool rows that
// landed BARE (no recommendations / considerations / rank) via either the
// deterministic-keep INSERT path in `loadHqVenuesIntoPool` or the rescue
// INSERT path in `rescueHqPoolFitVetoedVenues`. Pre-5.12.7, per-brief
// judgment for these rows arrived only at compile time via
// `vs-compile-summaries` Pass 1's hq_pool branch (post-5.12.4 thread (a));
// the matrix's first render therefore showed those rows visibly bare next
// to research + sheet rows that already carried Claude judgment. This
// helper invokes the SAME Pass 1 `needsFill` enrichment shape
// (buildFillUserMsg + FILL_SYSTEM + FILL_TOOL byte-for-byte) at research
// time so the matrix renders fully populated on first view.
//
// Placement (load-bearing per spec § 8.2): sequential inside work() after
// `await phaseAPromise` and before the final UPDATE flipping
// current_step='sourcing_report'. Concurrent placement alongside Phase A
// + rescue was rejected: this leg is the shortest of the three and
// concurrent execution gains no real latency while pushing the worst-
// case Promise.race ceiling closer to the kickoff grace window.
//
// Independent timeout budget (load-bearing per spec § 8.2): wraps the
// chunk loop in an explicit 60s deadline so a Phase B that burns close to
// WORK_TIMEOUT_MS (360s) combined with a slow enrichment chunk cannot
// push the function past Supabase's platform wall before the final
// CAS-guarded UPDATE commits. If the cap hits mid-loop, the in-flight
// chunk completes (Promise.all already in flight), remaining chunks skip
// with a warn-log + `timed_out` accounting, and the final UPDATE
// proceeds.
//
// Failure mode (load-bearing): every failure path warn-logs + skips.
// NEVER `writeFailure`. The final scout UPDATE CAS-guards on
// `pipeline_error IS NULL`; a writeFailure here would CAS-no-op the
// success transition and leave the scout stuck rendering bare-matrix
// without navigating off the Researching page. Compile-time Pass 1
// hq_pool branch is the defense-in-depth backstop for any rows this leg
// skipped.
//
// Disjoint with rescue (5.12.4 thread b) in steady state: rescue inserts
// land with recs/cons/rank still empty (rescue's Claude call only emits
// the keep/drop verdict), so rescued rows are picked up here on the same
// pass as deterministic-keep bare-insert rows. The two helpers compose:
// rescue runs first inside work() before Phase A resolves; enrichment
// runs after Phase A resolves.
//
// Cache shape: reuses `vs-compile-summaries` Pass 1's prompt-cache
// breakpoints. FILL_SYSTEM is the evergreen 1h cache; the brief block
// (per-scout) is the second cache breakpoint at user-message level.
async function enrichHqPoolForResearch(
  sb: SupabaseClient,
  scout_id: string,
  scout: ScoutBrief,
  canonicalSet: readonly string[],
): Promise<{
  candidates: number;
  enriched: number;
  failed: number;
  timedOut: number;
}> {
  const { data, error } = await sb
    .from("vs_candidate_venues")
    .select(
      "id, name, address, neighborhood, venue_type, website_url, notes, venue_overview, recommendations, considerations, rank, source, key_features",
    )
    .eq("scout_id", scout_id)
    .eq("source", "hq_pool");
  if (error) {
    console.warn(
      `[hqPoolResearchEnrich] scout=${scout_id} SELECT failed: ${error.message} (skipping)`,
    );
    return { candidates: 0, enriched: 0, failed: 0, timedOut: 0 };
  }

  type HqPoolRow = {
    id: string;
    name: string;
    address: string | null;
    neighborhood: string | null;
    venue_type: string | null;
    website_url: string | null;
    notes: string | null;
    venue_overview: string | null;
    recommendations: string[] | null;
    considerations: string[] | null;
    rank: number | null;
    key_features: string[] | null;
  };
  const eligible = ((data ?? []) as HqPoolRow[]).filter((v) => {
    const recsArr = Array.isArray(v.recommendations) ? v.recommendations : [];
    const consArr = Array.isArray(v.considerations) ? v.considerations : [];
    return recsArr.length === 0 || consArr.length === 0 || v.rank == null;
  });
  if (eligible.length === 0) {
    console.log(
      `[hqPoolResearchEnrich] scout=${scout_id} candidates=0 (no eligible hq_pool rows)`,
    );
    return { candidates: 0, enriched: 0, failed: 0, timedOut: 0 };
  }

  let enriched = 0;
  let failed = 0;
  let timedOut = 0;
  const CHUNK_SIZE = PHASE_A_CHUNK_SIZE;
  const ENRICH_TIMEOUT_MS = 60_000;
  const deadline = Date.now() + ENRICH_TIMEOUT_MS;

  for (let i = 0; i < eligible.length; i += CHUNK_SIZE) {
    if (Date.now() >= deadline) {
      const remaining = eligible.length - i;
      timedOut += remaining;
      console.warn(
        `[hqPoolResearchEnrich] scout=${scout_id} timeout budget exhausted: ${remaining} rows skipped (compile-time Pass 1 will backfill)`,
      );
      break;
    }
    const chunk = eligible.slice(i, i + CHUNK_SIZE);
    const results = await Promise.all(
      chunk.map(async (v) => {
        try {
          const fillUserMsg = buildFillUserMsg(
            scout,
            {
              name: v.name,
              address: v.address,
              neighborhood: v.neighborhood,
              venue_type: v.venue_type,
              website_url: v.website_url,
              notes: v.notes,
              aboutVenue:
                typeof v.venue_overview === "string"
                  ? v.venue_overview
                  : null,
            },
            canonicalSet,
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
              fn_name: "vs-research-venues:hq-pool-enrich",
            },
          );
          if (!fillResult.ok) {
            console.warn(
              `[hqPoolResearchEnrich] scout=${scout_id} venue=${v.id} claude failed: ${fillResult.error} (skipping row)`,
            );
            return { ok: false };
          }
          const tu = (fillResult.content ?? []).find(
            (b: { type?: string; name?: string }) =>
              b?.type === "tool_use" && b?.name === "fill_venue",
          );
          if (!tu || typeof tu.input !== "object" || tu.input === null) {
            console.warn(
              `[hqPoolResearchEnrich] scout=${scout_id} venue=${v.id} no tool_use block (skipping row)`,
            );
            return { ok: false };
          }
          const f = tu.input as Record<string, unknown>;
          // Apply-side guards mirror vs-compile-summaries Pass 1 hq_pool
          // branch byte-for-byte: only fill when the existing column is
          // null/empty. Skip address/neighborhood/venue_type/website_url/
          // size_sq_ft/capacity (HQ rows already carry canonical values;
          // defensive writes here would no-op but skip explicitly for
          // clarity). Skip derived_attrs (FILL_TOOL doesn't carry the
          // scout's derived_columns IDs; same posture as Pass 1).
          //
          // Phase 5.12.13.1: key_features now fills when the HQ row's
          // existing key_features is null/empty. Never overwrites and
          // never appends to an existing tag set; the empty-gate keeps
          // HQ-curated values authoritative.
          const patch: Record<string, unknown> = {};
          const existingFeatures = Array.isArray(v.key_features)
            ? v.key_features
            : [];
          if (existingFeatures.length === 0 && Array.isArray(f.key_features)) {
            const cleaned = sanitizeTagShape(stripPlaceholders(f.key_features));
            if (cleaned.length > 0) patch.key_features = cleaned;
          }
          const recsArr = Array.isArray(v.recommendations)
            ? v.recommendations
            : [];
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
            patch.rank = Math.round(f.ranking_score);
          }
          if (Object.keys(patch).length === 0) {
            // Claude returned nothing fillable; nothing to write. Still
            // counts as not-failed (the per-row Claude leg ran cleanly).
            return { ok: true };
          }
          const { error: updErr } = await sb
            .from("vs_candidate_venues")
            .update(patch)
            .eq("id", v.id);
          if (updErr) {
            console.warn(
              `[hqPoolResearchEnrich] scout=${scout_id} venue=${v.id} UPDATE failed: ${updErr.message} (skipping row)`,
            );
            return { ok: false };
          }
          return { ok: true };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn(
            `[hqPoolResearchEnrich] scout=${scout_id} venue=${v.id} threw: ${msg} (skipping row)`,
          );
          return { ok: false };
        }
      }),
    );
    enriched += results.filter((r) => r.ok).length;
    failed += results.filter((r) => !r.ok).length;
  }

  console.log(
    `[hqPoolResearchEnrich] scout=${scout_id} candidates=${eligible.length} enriched=${enriched} failed=${failed} timed_out=${timedOut}`,
  );
  if (enriched + failed + timedOut !== eligible.length) {
    // Mirrors the 5.12.3.1 [hqPoolFilter:accounting] + 5.12.4
    // [hqPoolRescue:accounting] accounting-identity warn shape. Should
    // never fire under healthy paths; presence signals a leaked counter.
    console.warn(
      `[hqPoolResearchEnrich:accounting] scout=${scout_id} counter drift: ${enriched + failed + timedOut} vs ${eligible.length} candidates`,
    );
  }

  return {
    candidates: eligible.length,
    enriched,
    failed,
    timedOut,
  };
}

// Phase 5.12.1 (introduced) + Phase 5.12.3.1 (fit filter rewrite): HQ
// Venues pool helper. Reads master HQ `venues` rows that match the scout's
// city, filters out venues already linked to this scout, scores every
// remaining (unlinked) city-match against the scout brief on five signals
// per `scoreVenueFitForBrief` (venue_type + neighborhood + ideal_features
// + sq_ft + capacity; threshold 40 `>=`), drops venues that veto on
// wrong_type / below_sq_ft_min / below_capacity / aggregate_gaps, sorts
// the kept set by score DESC then alphabetical ASC,
// caps at 10, and INSERTs each as `source='hq_pool'` vs_candidate_venues
// rows. The rows are linked to the matching `venues.id` at insert time
// (`linked_venue_id` set), so `vs-generate-deck`'s 5.12.0 push naturally
// short-circuits the dedupe cascade for these rows and only runs the
// about_venue write-when-blank.
//
// Pipeline ORDER is load-bearing (spec § 9.1):
//   1. SELECT city-matches from `venues`.
//   2. SELECT existing hq_pool linked_venue_ids for this scout.
//   3. Filter already-linked OUT before scoring (idempotency runs BEFORE
//      scoring + cap so newly-qualifying venues on re-run can land even
//      when the previous run filled the cap).
//   4. Compute applicability once per scout (which brief signals carry data).
//   5. Score each remaining venue (per-venue try / catch defensive).
//   6. Filter to `decision === "keep"`.
//   7. Sort score DESC then alphabetical ASC (score already carries
//      neighborhood + type signals so re-sorting on them is redundant).
//   8. Slice top 10 (per-run cap, not lifetime; matrix grows beyond 10
//      across re-runs by design).
//   9. INSERT loop (per-row try / catch).
//  10. Summary log + accounting identity check.
//
// Idempotency on re-run: already-linked HQ venues skip without re-scoring
// (producer-edits-survive-across-runs guarantee). Re-run with a CHANGED
// brief adds newly-qualifying venues; venues that would no longer clear
// threshold on re-run STAY in the matrix (the helper doesn't delete
// existing rows).
//
// Best-effort: any SELECT or per-row INSERT failure logs + continues.
type VenueTypesJoinRow = { venue_types?: { name?: string | null } | null };
type HqVenueRowRaw = {
  id: string;
  name: string;
  address: string | null;
  neighborhood: string | null;
  city: string | null;
  website_url: string | null;
  features: string[] | null;
  total_sq_ft: number | null;
  square_footage: number | null;
  capacity: number | null;
  about_venue: string | null;
  venue_venue_types: VenueTypesJoinRow[] | null;
};

function asArr(v: unknown): string[] {
  return Array.isArray(v)
    ? v
        .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        .map((x) => x.trim())
    : [];
}

// Phase 5.12.5: tag-array reader for brief_data keys that flipped from string
// to string[] (target_audience + vibe_aesthetic). Accepts both shapes so a
// legacy-string brief_data value (pre-§5-migration hand-edit, or any future
// JSON hand-edit) surfaces as a single-element array. Same coercion as
// hashAsStringArray (vs-generate-brief-overview) + normalizeTagArray
// (briefForm.ts); the three stay in lockstep on shape semantics.
function asTagArr(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v
      .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      .map((x) => x.trim());
  }
  if (typeof v === "string" && v.trim().length > 0) {
    return [v.trim()];
  }
  return [];
}

function hqVenueTypesToSlashJoined(hq: HqVenueRowRaw): string | null {
  const tokens = (hq.venue_venue_types ?? [])
    .map((j) => j?.venue_types?.name ?? null)
    .filter((n): n is string => Boolean(n))
    .map((n) => n.trim())
    .filter((n) => n.length > 0);
  // Dedupe preserving order (admin-typed casing is canonical for HQ names).
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const t of tokens) {
    const key = t.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(t);
    }
  }
  return unique.length > 0 ? unique.join(" / ") : null;
}

// Phase 5.12.3.1 helpers: HQ pool fit filter.
//
// Replaces the 5.12.1 "every city-match in, soft signals as sort keys only,
// cap at 10" pipeline with a score + threshold + veto pass. Helpers are
// PURE (no scout_id, no logging, no IO). The caller (loadHqVenuesIntoPool)
// owns telemetry. Spec: OUTPUTS/phase-5-12-3-1-spec.md.
type SignalApplicability = {
  // Which brief signals are populated (= applicable). Computed once per
  // call, shared across every venue evaluated for this scout.
  venue_types: boolean;
  neighborhoods: boolean;
  ideal_features: boolean;
  sq_ft: boolean;
  capacity: boolean;
  applicableCount: number;
};

type VenueFitVeto =
  | "wrong_type"
  | "below_sq_ft_min"
  | "below_capacity"
  | "aggregate_gaps";

type VenueFitResult = {
  decision: "keep" | "drop_below_threshold" | "drop_veto";
  veto: VenueFitVeto | null;
  score: {
    venue_type: number;
    neighborhood: number;
    ideal_features: number;
    sq_ft: number;
    capacity: number;
    total: number;
    threshold: number;
    applicable: number;
    unscored: number;
  };
  reason: string;
};

function isApplicableArray(v: unknown): boolean {
  return (
    Array.isArray(v) &&
    v.filter((x) => typeof x === "string" && x.trim().length > 0).length > 0
  );
}

function isApplicableFiniteNumber(v: unknown): boolean {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

function computeApplicability(
  briefData: Record<string, unknown>,
): SignalApplicability {
  const venue_types = isApplicableArray(briefData.venue_types);
  const neighborhoods = isApplicableArray(briefData.target_neighborhoods);
  const ideal_features = isApplicableArray(briefData.ideal_features);
  // Phase 5.12.14.3 R4 amendment v2 § D: sq_ft_min + sq_ft_max retired;
  // sq_ft_minimum is the sole below-threshold driver. above_sq_ft_max veto
  // is also retired alongside. R6 § M.3: legacy `sq_ft_min` (pre-R4 jsonb
  // key) falls back into the applicability check so scouts created before
  // the R4 amendment still trigger the size-floor veto.
  const sqFtMinimumApplicability =
    briefData.sq_ft_minimum ?? briefData.sq_ft_min;
  const sq_ft = isApplicableFiniteNumber(sqFtMinimumApplicability);
  const capacity = isApplicableFiniteNumber(briefData.expected_guest_count);
  const applicableCount =
    (venue_types ? 1 : 0) +
    (neighborhoods ? 1 : 0) +
    (ideal_features ? 1 : 0) +
    (sq_ft ? 1 : 0) +
    (capacity ? 1 : 0);
  return {
    venue_types,
    neighborhoods,
    ideal_features,
    sq_ft,
    capacity,
    applicableCount,
  };
}

// Pure scorer. No scout_id, no logging, no IO. Returns the fit verdict for
// one venue against one brief. Out-of-band vetoes fire on the disqualifying
// signals (wrong_type / below_sq_ft_min / below_capacity); the aggregate-gap
// veto fires when more than half of the applicable brief signals are unscored
// on the venue side (strictly more than half). Threshold defaults to 40 (>=
// keeps); locked weights from spec § 8.2.
function scoreVenueFitForBrief(
  hq: HqVenueRowRaw,
  briefData: Record<string, unknown>,
  applicability: SignalApplicability,
  options?: { threshold?: number },
): VenueFitResult {
  const threshold = options?.threshold ?? 40;

  // Venue-side tokenization (lowercase + trim + drop empty).
  const hqTypeTokens = (hq.venue_venue_types ?? [])
    .map((j) => j?.venue_types?.name ?? null)
    .filter((n): n is string => Boolean(n))
    .map((n) => n.toLowerCase().trim())
    .filter((n) => n.length > 0);
  const hqNeighborhood = (hq.neighborhood ?? "").toLowerCase().trim();
  const hqFeatureSet = new Set(
    Array.isArray(hq.features)
      ? hq.features
          .filter(
            (x): x is string => typeof x === "string" && x.trim().length > 0,
          )
          .map((x) => x.toLowerCase().trim())
      : [],
  );

  // Brief-side sq_ft lower bound. Round 4 amendment v2 § D retired
  // sq_ft_min/sq_ft_max; sq_ft_minimum is the sole input now. R6 § M.3:
  // legacy `sq_ft_min` (pre-R4 jsonb key) falls back so scouts created
  // before the R4 amendment still register a below-floor veto.
  const sqFtMinimumSource =
    briefData.sq_ft_minimum ?? briefData.sq_ft_min;
  const sqFtMin = isApplicableFiniteNumber(sqFtMinimumSource)
    ? (sqFtMinimumSource as number)
    : null;
  const expectedGuestCount = isApplicableFiniteNumber(
    briefData.expected_guest_count,
  )
    ? (briefData.expected_guest_count as number)
    : null;

  let unscored = 0;

  // venue_type signal (30 on overlap; veto on brief-set + venue-has-types +
  // zero overlap; unscored when venue has no types at all).
  let venue_type = 0;
  let venueTypeVeto: VenueFitVeto | null = null;
  if (applicability.venue_types) {
    if (hqTypeTokens.length === 0) {
      unscored++;
    } else {
      const briefTypeSet = new Set(
        asArr(briefData.venue_types).map((t) => t.toLowerCase()),
      );
      const hasOverlap = hqTypeTokens.some((t) => briefTypeSet.has(t));
      if (hasOverlap) {
        venue_type = 30;
      } else {
        venueTypeVeto = "wrong_type";
      }
    }
  }

  // neighborhood signal (20 on match; no veto; unscored when venue
  // neighborhood is null/empty per spec § 8.4).
  let neighborhood = 0;
  if (applicability.neighborhoods) {
    if (!hqNeighborhood) {
      unscored++;
    } else {
      const briefNeighborhoodSet = new Set(
        asArr(briefData.target_neighborhoods).map((n) => n.toLowerCase()),
      );
      if (briefNeighborhoodSet.has(hqNeighborhood)) {
        neighborhood = 20;
      }
    }
  }

  // ideal_features signal (5 per match, cap 25; no veto; unscored when venue
  // features array is empty).
  let ideal_features = 0;
  if (applicability.ideal_features) {
    if (hqFeatureSet.size === 0) {
      unscored++;
    } else {
      const briefFeatureSet = new Set(
        asArr(briefData.ideal_features).map((f) => f.toLowerCase()),
      );
      let matchCount = 0;
      for (const tok of briefFeatureSet) {
        if (hqFeatureSet.has(tok)) matchCount++;
      }
      ideal_features = Math.min(25, matchCount * 5);
    }
  }

  // sq_ft signal (15 when venue.total_sq_ft meets the brief's minimum; veto
  // when below; unscored when venue.total_sq_ft is null). Legacy
  // `square_footage` is NOT consulted here; scorer keys off total_sq_ft only
  // (spec § 8.4 unscored predicates). Round 4 amendment v2 § D retired the
  // above_sq_ft_max veto alongside the sq_ft_min/sq_ft_max intake range.
  let sq_ft = 0;
  let sqFtVeto: VenueFitVeto | null = null;
  if (applicability.sq_ft) {
    if (hq.total_sq_ft == null) {
      unscored++;
    } else {
      const v = hq.total_sq_ft;
      if (sqFtMin != null && v < sqFtMin) {
        sqFtVeto = "below_sq_ft_min";
      } else {
        sq_ft = 15;
      }
    }
  }

  // capacity signal (10 when venue.capacity >= expected; veto when capacity
  // is set + positive + short; unscored when venue.capacity is null or 0).
  // The `<= 0` guard treats explicit zero-capacity HQ rows as no-data rather
  // than "fits 0 guests" (spec § 8.2 rationale).
  let capacity = 0;
  let capacityVeto: VenueFitVeto | null = null;
  if (applicability.capacity) {
    if (hq.capacity == null || hq.capacity <= 0) {
      unscored++;
    } else if (expectedGuestCount != null) {
      if (hq.capacity < expectedGuestCount) {
        capacityVeto = "below_capacity";
      } else {
        capacity = 10;
      }
    }
  }

  // Out-of-band veto precedence: venue_type -> sq_ft -> capacity. Mirrors
  // the spec § 8.2 table order; wrong_type is loudest.
  const outOfBandVeto: VenueFitVeto | null =
    venueTypeVeto ?? sqFtVeto ?? capacityVeto ?? null;

  let veto: VenueFitVeto | null = outOfBandVeto;

  // Aggregate-gap veto: strictly more than half of applicable signals are
  // unscored on the venue side. `0 > 0` is false, so a zero-applicable
  // brief never trips this; threshold check downstream catches that case
  // and drops everything (the v1 strict empty-pool behavior in spec § 8.4).
  if (
    !veto &&
    applicability.applicableCount > 0 &&
    unscored > applicability.applicableCount / 2
  ) {
    veto = "aggregate_gaps";
  }

  const total =
    venue_type + neighborhood + ideal_features + sq_ft + capacity;

  let decision: "keep" | "drop_below_threshold" | "drop_veto";
  let reason: string;
  if (veto) {
    decision = "drop_veto";
    reason = `veto=${veto}`;
  } else if (total >= threshold) {
    decision = "keep";
    reason = `score ${total} >= ${threshold}`;
  } else {
    decision = "drop_below_threshold";
    reason = `score ${total} < ${threshold}`;
  }

  return {
    decision,
    veto,
    score: {
      venue_type,
      neighborhood,
      ideal_features,
      sq_ft,
      capacity,
      total,
      threshold,
      applicable: applicability.applicableCount,
      unscored,
    },
    reason,
  };
}

// Phase 5.12.4 thread (b): loadHqVenuesIntoPool returns its scored
// intermediate state so the rescue helper can consume the same city pool +
// alreadyLinkedSet + applicability + scored entries without re-querying.
// The pure helpers (computeApplicability, scoreVenueFitForBrief,
// isApplicableArray, isApplicableFiniteNumber) stay pure; only the IO-
// wrapping helper changes shape. Return null on any early-exit path
// (no city, hq SELECT error, link SELECT error) so the caller can skip
// rescue cleanly; null is the same "no rescue" signal that the existing
// "no city" / "no rows" / SELECT-failure paths used.
type ScoredEntry = { venue: HqVenueRowRaw; fit: VenueFitResult };
type HqPoolLoadResult = {
  hqRows: HqVenueRowRaw[];
  alreadyLinkedSet: Set<string>;
  applicability: SignalApplicability;
  scored: ScoredEntry[];
};

// Phase 5.12.3.1: rewrite from "every city-match in, soft signals as sort
// keys only, cap at 10" to "filter already-linked OUT before scoring, score
// every remaining city-match, drop on veto / below threshold, keep top 10
// by score". Pipeline ORDER is load-bearing: idempotency (existing-link
// filter) runs BEFORE scoring so newly-qualifying venues on re-run can
// land even when the previous run filled the cap. The 10-row cap is
// per-run, not lifetime; the matrix grows beyond 10 across re-runs by
// design (additive guarantee, spec § 8.8 + § 8.9). Best-effort: SELECT or
// per-row failures warn + continue; scorer is defended by a per-venue
// try/catch.
//
// Phase 5.12.4 thread (b): returns HqPoolLoadResult so the rescue helper
// can reuse the city pool + alreadyLinkedSet + applicability + scored
// state. Inserts the deterministic-keep set as a side effect, same as
// 5.12.3.1.
async function loadHqVenuesIntoPool(
  sb: SupabaseClient,
  scout_id: string,
  scout: { city?: string | null },
  briefData: Record<string, unknown>,
): Promise<HqPoolLoadResult | null> {
  const scoutCity = (scout.city ?? "").trim();
  if (!scoutCity) return null;

  // Step 1: SELECT venues by city.
  //
  // `.ilike` is case-insensitive equality (no wildcards) so "New York" and
  // "new york" agree. HQ venues whose `city` is NULL never match (that's
  // intentional; the pool is city-anchored).
  const { data: hqRowsRaw, error: hqErr } = await sb
    .from("venues")
    .select(
      "id, name, address, neighborhood, city, website_url, features, total_sq_ft, square_footage, capacity, about_venue, venue_venue_types(venue_types(name))",
    )
    .ilike("city", scoutCity);

  if (hqErr) {
    console.warn(
      `[vs-research-venues] scout=${scout_id} hq-pool venues SELECT failed: ${hqErr.message} (continuing without pool)`,
    );
    return null;
  }
  const hqRows = (hqRowsRaw ?? []) as HqVenueRowRaw[];
  if (hqRows.length === 0) {
    // No city-matches at all. Return an empty result so the rescue helper
    // can still be called (it will short-circuit on an empty scored set).
    return {
      hqRows: [],
      alreadyLinkedSet: new Set<string>(),
      applicability: computeApplicability(briefData),
      scored: [],
    };
  }

  // Step 2: SELECT existing hq_pool links for this scout. Moved UP from
  // post-sort idempotency in 5.12.1: newly-qualifying venues on re-run
  // must be able to land even when the previous run filled the cap (the
  // bug Codex flagged in spec review). Filtering already-linked rows out
  // before scoring also avoids spending the scorer cycles on rows that
  // are already in the matrix.
  const { data: existingLinks, error: linkErr } = await sb
    .from("vs_candidate_venues")
    .select("linked_venue_id")
    .eq("scout_id", scout_id)
    .eq("source", "hq_pool");
  if (linkErr) {
    console.warn(
      `[vs-research-venues] scout=${scout_id} hq-pool existing-link SELECT failed: ${linkErr.message} (continuing without pool)`,
    );
    return null;
  }
  const alreadyLinkedSet = new Set(
    (existingLinks ?? [])
      .map((r) => r.linked_venue_id as string | null)
      .filter((id): id is string => typeof id === "string"),
  );

  // Step 3: filter already-linked venues OUT before scoring. Already-linked
  // rows do NOT emit per-row `[hqPoolFilter]` log lines; they're counted
  // separately as `already_linked` in the summary.
  const unlinked = hqRows.filter((hq) => !alreadyLinkedSet.has(hq.id));
  const alreadyLinked = hqRows.length - unlinked.length;

  // Step 4: compute applicability once per scout.
  const applicability = computeApplicability(briefData);

  // Step 5: score each remaining venue. Per-venue try/catch so one
  // malformed row doesn't sink the whole pool (defensive only; scalar
  // arithmetic on type-narrowed input should not throw). ScoredEntry hoisted
  // to module scope (Phase 5.12.4) so the rescue helper can consume the
  // same shape.
  const scored: ScoredEntry[] = [];
  let vetoed = 0;
  let droppedBelow = 0;
  for (const hq of unlinked) {
    let result: VenueFitResult;
    try {
      result = scoreVenueFitForBrief(hq, briefData, applicability);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[vs-research-venues] scout=${scout_id} hq-pool scorer threw on venue "${hq.name}" (${hq.id}): ${msg} (treating as drop_veto)`,
      );
      result = {
        decision: "drop_veto",
        veto: null,
        score: {
          venue_type: 0,
          neighborhood: 0,
          ideal_features: 0,
          sq_ft: 0,
          capacity: 0,
          total: 0,
          threshold: 40,
          applicable: applicability.applicableCount,
          unscored: 0,
        },
        reason: `scorer threw: ${msg}`,
      };
    }
    console.log(
      `[hqPoolFilter] scout=${scout_id} venue=${hq.id} name="${hq.name}" ` +
        `score=type:${result.score.venue_type}+neigh:${result.score.neighborhood}+features:${result.score.ideal_features}+sqft:${result.score.sq_ft}+capacity:${result.score.capacity}=${result.score.total} ` +
        `applicable=${result.score.applicable} unscored=${result.score.unscored} ` +
        `threshold=${result.score.threshold} ` +
        `decision=${result.decision}${result.veto ? ` veto=${result.veto}` : ""}`,
    );
    if (result.decision === "drop_veto") vetoed++;
    else if (result.decision === "drop_below_threshold") droppedBelow++;
    scored.push({ venue: hq, fit: result });
  }

  // Steps 6-7: filter to keep + sort score DESC, alphabetical ASC. Score
  // already captures neighborhood + type signals; re-sorting on them after
  // the score would push lower-scored type-matches above higher-scored
  // full-fit venues (replaces the 5.12.1 neighborhoodMatch / typeMatch /
  // alphabetical chain per spec § 8.7).
  const kept = scored
    .filter((entry) => entry.fit.decision === "keep")
    .sort((a, b) => {
      if (a.fit.score.total !== b.fit.score.total) {
        return b.fit.score.total - a.fit.score.total;
      }
      return (a.venue.name ?? "")
        .toLowerCase()
        .localeCompare((b.venue.name ?? "").toLowerCase());
    });

  // Step 8: slice top 10. Over-cap remainder is counted separately so the
  // accounting identity holds (spec § 8.6).
  const toInsert = kept.slice(0, 10);
  const overCap = kept.length > 10 ? kept.length - 10 : 0;

  // Step 9: INSERT loop. Per-row try / catch preserved from 5.12.1; the
  // 5.12.1 `skipped` counter is renamed to `insert_failed` for clarity
  // (spec § 8.6).
  let inserted = 0;
  let insertFailed = 0;
  for (const entry of toInsert) {
    const hq = entry.venue;
    const venueType = hqVenueTypesToSlashJoined(hq);
    const sizeSqFt = hq.total_sq_ft ?? hq.square_footage ?? null;
    const features = Array.isArray(hq.features) ? hq.features : [];
    const { error: insErr } = await sb.from("vs_candidate_venues").insert({
      scout_id,
      name: hq.name,
      address: hq.address,
      neighborhood: hq.neighborhood,
      venue_type: venueType,
      website_url: hq.website_url,
      size_sq_ft: sizeSqFt,
      capacity: hq.capacity,
      key_features: features,
      venue_overview: hq.about_venue,
      linked_venue_id: hq.id,
      source: "hq_pool",
    });
    if (insErr) {
      // Per-row INSERT failures are best-effort: log + continue. A failed
      // FK / CHECK / unique constraint shouldn't sink the scout's research.
      console.warn(
        `[vs-research-venues] scout=${scout_id} hq-pool insert failed "${hq.name}" (${hq.id}): ${insErr.message}`,
      );
      insertFailed++;
      continue;
    }
    inserted++;
  }

  // Step 10: summary log + accounting identity check.
  //
  // inserted + insert_failed + over_cap + dropped_below_threshold + vetoed
  //   + already_linked === hqRows.length
  //
  // The unconditional warn defends against silent counter drift in prod
  // (spec § 11.3.23). It's a cheap arithmetic check on six integers; the
  // summary line still emits regardless.
  const accountingSum =
    inserted + insertFailed + overCap + droppedBelow + vetoed + alreadyLinked;
  if (accountingSum !== hqRows.length) {
    console.warn(
      `[hqPoolFilter:accounting] scout=${scout_id} counter drift: ${accountingSum} vs ${hqRows.length} city-matches ` +
        `(inserted=${inserted} insert_failed=${insertFailed} over_cap=${overCap} ` +
        `dropped_below_threshold=${droppedBelow} vetoed=${vetoed} already_linked=${alreadyLinked})`,
    );
  }
  console.log(
    `[vs-research-venues] scout=${scout_id} hq-pool inserted=${inserted} ` +
      `insert_failed=${insertFailed} over_cap=${overCap} ` +
      `dropped_below_threshold=${droppedBelow} vetoed=${vetoed} ` +
      `already_linked=${alreadyLinked} of ${hqRows.length} city-matches ` +
      `(${applicability.applicableCount} applicable brief signals)`,
  );

  // Phase 5.12.4 thread (b): return the scored intermediate state so the
  // rescue helper can consume the same city pool + alreadyLinkedSet +
  // applicability + scored entries without re-querying. `scored` includes
  // every unlinked-and-evaluated venue (keeps + drops + vetos); the rescue
  // helper filters down to drop_below_threshold + drop_veto on soft-fit
  // vetoes.
  return {
    hqRows,
    alreadyLinkedSet,
    applicability,
    scored,
  };
}

// Phase 5.12.4 thread (b): about_venue-driven fit rescue.
//
// The deterministic fit filter in loadHqVenuesIntoPool (5.12.3.1) decides
// the first tier of HQ venues. The cross-rail seed-then-drop (also
// 5.12.3.1) is the second lane: it catches HQ venues whose structured
// fields don't fit the brief deterministically but whose narrative + brief
// alignment Claude's Phase B research INDEPENDENTLY discovers. The rescue
// pass is the third lane: it catches HQ venues whose structured fields
// don't fit AND that Claude's Phase B doesn't independently surface, by
// sending each soft-fit-vetoed venue's about_venue paragraph to Claude
// and asking for a keep / drop verdict.
//
// Composition: deterministic keeps stay; rescue is purely additive. Hard
// physical vetoes (below_sq_ft_min / below_capacity) are NEVER
// rescue-eligible (no narrative can overcome a 800 sq ft venue
// for a 2000 sq ft brief). Already-linked venues skip idempotently
// (producer-edits-survive-across-runs guarantee mirroring 5.12.3.1 § 8.9).
// Venues with null/empty about_venue skip (no rescue signal).
//
// Failure mode: every rescue failure path is best-effort. Claude timeout /
// 5xx / no tool_use / malformed verdicts: warn-log + skip rescue + continue
// research. Per-verdict defensiveness: hallucinated venue_id drops only
// that verdict; per-row INSERT failure increments insert_failed counter;
// missing verdicts treated as drop.
//
// Idempotency on re-run: already-linked venues filter out (line below).
// Re-runs add newly-qualifying rescues additively. Venues that no longer
// rescue on re-run STAY in the matrix (no DELETE in this helper).
//
// Telemetry: [hqPoolRescue] per verdict + summary line with accounting
// identity (rescued + dropped + verdicts_missing + insert_failed ===
// candidates). Unconditional [hqPoolRescue:accounting] warn on counter
// drift mirrors the 5.12.3.1 [hqPoolFilter:accounting] pattern.
const RESCUE_INPUT_CAP = 20;

const FIT_RESCUE_SYSTEM =
  `You are a producer at Mirror NYC, an experiential creative agency. Your job: read each candidate venue's "about" paragraph and structured facts, compare to the project brief, and decide whether the venue fits the brief well enough to surface to the producer for consideration.

The candidates you receive have ALREADY been deterministically scored against the brief on five structured signals (venue type overlap, neighborhood overlap, ideal_features overlap, sq_ft fit, capacity fit) and either fell below the fit threshold or were vetoed on a soft signal (wrong type tag, or too many empty structured fields). Your job is to read the "about" paragraph and recover venues whose narrative context aligns with the brief in ways the structured fields don't capture. A venue tagged as "Event Venue" in HQ but whose "about" paragraph describes ground-floor retail frontage and storefront windows IS a Retail fit. A venue with no neighborhood tag but whose "about" paragraph anchors it in the brief's target neighborhood IS a neighborhood match.

Be willing to rescue venues whose tagging is incomplete but whose "about" content clearly fits. Be willing to drop venues whose "about" content makes clear they don't fit (wrong scale, wrong vibe, wrong audience). When in doubt, drop: producers tolerate a smaller matrix of high-fit options better than a wider matrix of low-fit noise.

Return a verdict per venue via the submit_fit_evaluation tool. Each verdict carries the venue_id (echo what you receive), a boolean keep, and a one-sentence reason (10-25 words). The reason should anchor in either the about paragraph or a specific structured field.`;

const FIT_RESCUE_TOOL: ClaudeTool = {
  name: "submit_fit_evaluation",
  description:
    "Return a per-venue keep/drop verdict for each candidate venue.",
  input_schema: {
    type: "object",
    properties: {
      verdicts: {
        type: "array",
        description:
          "One entry per candidate venue, in the same order as the input. Echo the venue_id verbatim so the caller can match verdicts back to venues.",
        items: {
          type: "object",
          properties: {
            venue_id: {
              type: "string",
              description:
                "Echo the venue_id from the input list verbatim. UUID string.",
            },
            keep: {
              type: "boolean",
              description:
                "True if this venue's about paragraph + structured fields clearly fit the brief. False otherwise.",
            },
            reason: {
              type: "string",
              description:
                "One-sentence justification, 10-25 words. Anchor in either the about paragraph or a specific structured field. Example keeps: 'About paragraph confirms ground-floor retail frontage in Culver City matching brief target neighborhood.' Example drops: 'About paragraph describes corporate AV-heavy venue; brief calls for intimate boutique storefront.'",
            },
          },
          required: ["venue_id", "keep", "reason"],
        },
      },
    },
    required: ["verdicts"],
  },
};

// Scout fields the rescue helper reads. Matches the SELECT shape the
// handler already loads.
type RescueScout = {
  city?: string | null;
  client_name?: string | null;
  event_name?: string | null;
  live_dates?: string | null;
  budget?: number | string | null;
  event_overview?: string | null;
};

async function rescueHqPoolFitVetoedVenues(
  sb: SupabaseClient,
  scout_id: string,
  scout: RescueScout,
  briefData: Record<string, unknown>,
  loadResult: HqPoolLoadResult,
): Promise<void> {
  // Step 1: build the eligible set.
  //
  // Include drop_below_threshold + drop_veto where veto is wrong_type or
  // aggregate_gaps. EXCLUDE drop_veto where veto is below_sq_ft_min or
  // below_capacity (hard physical disqualifiers).
  // EXCLUDE deterministic keeps. EXCLUDE already-linked (the scored
  // entries already exclude already-linked because loadHqVenuesIntoPool
  // step 3 filters them out before scoring; the alreadyLinkedSet filter
  // here is belt-and-suspenders against future refactors). EXCLUDE venues
  // whose about_venue is null or trim-empty (no rescue signal).
  const eligibleAll = loadResult.scored.filter((entry) => {
    const fit = entry.fit;
    if (fit.decision === "keep") return false;
    if (
      fit.decision === "drop_veto" &&
      fit.veto !== "wrong_type" &&
      fit.veto !== "aggregate_gaps"
    ) {
      return false;
    }
    if (loadResult.alreadyLinkedSet.has(entry.venue.id)) return false;
    const about = entry.venue.about_venue;
    if (typeof about !== "string" || about.trim().length === 0) return false;
    return true;
  });

  if (eligibleAll.length === 0) {
    console.log(
      `[hqPoolRescue] scout=${scout_id} candidates=0 (no rescue needed)`,
    );
    return;
  }

  // Step 2: cap at RESCUE_INPUT_CAP. Sort by about_venue length DESC, name
  // ASC so the highest-signal candidates win the slots when the cap binds.
  const eligibleSorted = [...eligibleAll].sort((a, b) => {
    const al = (a.venue.about_venue ?? "").length;
    const bl = (b.venue.about_venue ?? "").length;
    if (al !== bl) return bl - al;
    return (a.venue.name ?? "")
      .toLowerCase()
      .localeCompare((b.venue.name ?? "").toLowerCase());
  });
  const eligible = eligibleSorted.slice(0, RESCUE_INPUT_CAP);
  const overCap = eligibleSorted.length > RESCUE_INPUT_CAP
    ? eligibleSorted.length - RESCUE_INPUT_CAP
    : 0;

  // Step 3: build the brief block + the venueRequirements block.
  //
  // Defensive predicates around brief_data jsonb reads (matches the Phase
  // B userMsg builder shape so the framing is consistent). brand rules in
  // force: no em dashes, declarative, "(not set)" / "(none)" fallbacks.
  const asArrLocal = (v: unknown): string[] =>
    Array.isArray(v)
      ? v
          .filter(
            (x): x is string => typeof x === "string" && x.trim().length > 0,
          )
          .map((x) => x.trim())
      : [];
  const asNumLocal = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const asStrLocal = (v: unknown): string =>
    typeof v === "string" ? v.trim() : "";

  const expectedGuests = briefData.expected_guest_count;
  const briefNotes = briefData.notes;
  const targetNeighborhoods = asArrLocal(briefData.target_neighborhoods);
  const strictNeighborhoods = briefData.strict_neighborhoods_only === true;
  const venueTypes = asArrLocal(briefData.venue_types);
  const idealFeatures = asArrLocal(briefData.ideal_features);
  const priorityLocation = briefData.priority_location;
  const priorityCost = briefData.priority_cost;
  // R6 § M.3: legacy `sq_ft_min` (pre-R4 jsonb key) falls back so scouts
  // created before the R4 amendment still surface the size guidance in the
  // Phase A prompt.
  const sqFtMinimum =
    asNumLocal(briefData.sq_ft_minimum) ?? asNumLocal(briefData.sq_ft_min);
  // Phase 5.12.5: target_audience + vibe_aesthetic flipped from string to
  // string[]. asTagArr is the shape-coercion shim (covers legacy strings as
  // single-element arrays for defense-in-depth).
  const targetAudience = asTagArr(briefData.target_audience);
  const vibeAesthetic = asTagArr(briefData.vibe_aesthetic);

  const requirementLines: string[] = [];
  if (targetNeighborhoods.length > 0) {
    requirementLines.push(
      strictNeighborhoods
        ? `Restrict candidates to these neighborhoods: ${targetNeighborhoods.join(", ")}. You MAY include at most 1-2 venues from immediately adjacent neighborhoods, but no further.`
        : `Prefer candidates in these neighborhoods: ${targetNeighborhoods.join(", ")}. Adjacent neighborhoods and a reasonable radius within the city are acceptable; do not exclude a venue that aligns strongly with every other brief criterion solely on neighborhood.`,
    );
  }
  if (venueTypes.length > 0) {
    requirementLines.push(
      `Candidate venue should be one of these types: ${venueTypes.join(", ")}. You MAY include 1-2 strong outliers from outside this list ONLY when the venue ranks very high on the brief's other criteria (neighborhood, scale, brand fit, vibe) such that the type mismatch is clearly overcome. Default to within-type.`,
    );
  }
  if (idealFeatures.length > 0) {
    requirementLines.push(
      `Prioritize venues with these features: ${idealFeatures.join(", ")}.`,
    );
  }
  const priorityParts: string[] = [];
  if (priorityLocation === "high_foot_traffic") {
    priorityParts.push("Location: high foot traffic");
  } else if (priorityLocation === "intimate_destination") {
    priorityParts.push("Location: intimate destination");
  }
  if (priorityCost === "lower_cost") priorityParts.push("Cost: lower-cost");
  else if (priorityCost === "premium") priorityParts.push("Cost: premium");
  if (priorityParts.length > 0) {
    requirementLines.push(`Sourcing priorities: ${priorityParts.join(". ")}.`);
  }
  if (sqFtMinimum !== null) {
    requirementLines.push(
      `Hard floor: do not surface venues smaller than ${sqFtMinimum.toLocaleString()} sq ft.`,
    );
  }
  const venueRequirementsBlock =
    requirementLines.length > 0
      ? `\n\nVENUE REQUIREMENTS:\n${requirementLines.map((l) => `- ${l}`).join("\n")}`
      : "";

  const briefBlock =
    `PROJECT BRIEF
Client: ${scout.client_name ?? "(not set)"}
Event: ${scout.event_name ?? "(not set)"}
City: ${scout.city ?? "(not set)"}
Live dates: ${scout.live_dates ?? "(not set)"}
Budget: ${scout.budget ?? "(not set)"}
Expected guests: ${
      typeof expectedGuests === "number" || typeof expectedGuests === "string"
        ? String(expectedGuests)
        : "(not set)"
    }
Overview: ${scout.event_overview ?? "(not set)"}
Target audience: ${targetAudience.length > 0 ? targetAudience.join(", ") : "(not set)"}
Vibe / aesthetic: ${vibeAesthetic.length > 0 ? vibeAesthetic.join(", ") : "(not set)"}
Additional brief notes: ${
      typeof briefNotes === "string" && briefNotes.trim().length > 0
        ? briefNotes.trim()
        : "(none)"
    }${venueRequirementsBlock}`;

  // Step 4: build the candidate venues block. Deterministic order (name ASC)
  // for stability across runs; the Claude verdicts come back in any order
  // and are matched by venue_id, so the input order does not affect dedup.
  const candidatesForPrompt = [...eligible].sort((a, b) =>
    (a.venue.name ?? "")
      .toLowerCase()
      .localeCompare((b.venue.name ?? "").toLowerCase()),
  );
  const candidateBlock =
    `CANDIDATE VENUES TO EVALUATE:\n` +
    candidatesForPrompt
      .map((entry, idx) => {
        const hq = entry.venue;
        const typeStr = hqVenueTypesToSlashJoined(hq) ?? "(no types tagged)";
        const sizeStr =
          hq.total_sq_ft != null
            ? `${hq.total_sq_ft.toLocaleString()} sq ft`
            : hq.square_footage != null
              ? `${hq.square_footage.toLocaleString()} sq ft (legacy column)`
              : "(unknown)";
        const capStr =
          hq.capacity != null && hq.capacity > 0
            ? `${hq.capacity.toLocaleString()}`
            : "(unknown)";
        const featuresStr =
          Array.isArray(hq.features) && hq.features.length > 0
            ? hq.features.join(", ")
            : "(none)";
        return `${idx + 1}. venue_id: ${hq.id}
   Name: ${hq.name}
   Address: ${hq.address ?? "(unknown)"}
   Neighborhood: ${hq.neighborhood ?? "(unknown)"}
   Type: ${typeStr}
   Size (sq ft): ${sizeStr}
   Capacity: ${capStr}
   Key features: ${featuresStr}
   Reason this venue scored below threshold deterministically: ${entry.fit.reason}
   ABOUT:
   ${(hq.about_venue ?? "").trim()}`;
      })
      .join("\n\n");

  const finalInstruction =
    `For each candidate, decide keep or drop based on whether the about paragraph + structured facts together clearly fit the brief. Return verdicts via submit_fit_evaluation in the same order.`;

  // Step 5: call Claude. Two ephemeral cache breakpoints (FIT_RESCUE_SYSTEM
  // in system + brief block in first user content block). 5-minute TTL is
  // GA and does not need an anthropic_beta header (matches the ts-
  // evaluate-candidate pattern where only 1h TTL requires the beta).
  // Forced tool_choice on submit_fit_evaluation: no server tools to compete
  // with (no web_search), so the feedback_tool_choice_collapse class does
  // not apply.
  let result: Awaited<ReturnType<typeof callClaude>>;
  try {
    result = await callClaude(
      "venue_scout",
      [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: briefBlock,
              cache_control: { type: "ephemeral", ttl: "5m" },
            },
            { type: "text", text: candidateBlock },
            { type: "text", text: finalInstruction },
          ],
        },
      ],
      {
        model: "claude-sonnet-4-6",
        max_tokens: 4000,
        system: [
          {
            type: "text",
            text: FIT_RESCUE_SYSTEM,
            cache_control: { type: "ephemeral", ttl: "5m" },
          },
        ],
        tools: [FIT_RESCUE_TOOL],
        tool_choice: { type: "tool", name: "submit_fit_evaluation" },
        fn_name: "vs-research-venues:fit-rescue",
      },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(
      `[hqPoolRescue] scout=${scout_id} claude failed: ${msg} (skipping rescue, deterministic pool stands)`,
    );
    return;
  }

  if (!result.ok) {
    console.warn(
      `[hqPoolRescue] scout=${scout_id} claude failed: ${result.error} (skipping rescue, deterministic pool stands)`,
    );
    return;
  }

  // Step 6: extract verdicts. Defensive against missing tool_use block,
  // wrong shape, or missing verdicts array. Each defensive failure mode
  // logs a warn + skips rescue (deterministic pool stands).
  const toolUse = (result.content ?? []).find(
    (b: { type?: string; name?: string }) =>
      b?.type === "tool_use" && b?.name === "submit_fit_evaluation",
  );
  if (!toolUse || typeof toolUse.input !== "object" || toolUse.input === null) {
    console.warn(
      `[hqPoolRescue] scout=${scout_id} no tool_use block in response (stop_reason=${result.stop_reason ?? "?"}, skipping rescue)`,
    );
    return;
  }
  const rawVerdicts = (toolUse.input as Record<string, unknown>).verdicts;
  if (!Array.isArray(rawVerdicts)) {
    console.warn(
      `[hqPoolRescue] scout=${scout_id} verdicts is not an array (skipping rescue)`,
    );
    return;
  }

  // Build venue_id -> entry lookup so we can validate the verdicts. Built
  // off the prompt-ordered slice (eligible) so candidates outside the
  // RESCUE_INPUT_CAP slice aren't reachable from a hallucinated id either.
  const eligibleById = new Map(eligible.map((entry) => [entry.venue.id, entry]));

  // Diagnostic log: usage + token shape.
  const cacheRead = result.usage?.cache_read_input_tokens ?? 0;
  const cacheWrite = result.usage?.cache_creation_input_tokens ?? 0;
  console.log(
    `[hqPoolRescue] scout=${scout_id} model=claude-sonnet-4-6 ` +
      `in=${result.usage?.input_tokens ?? "?"} ` +
      `out=${result.usage?.output_tokens ?? "?"} ` +
      `cache_read=${cacheRead} cache_write=${cacheWrite} ` +
      `stop_reason=${result.stop_reason ?? "?"} ` +
      `candidates=${eligible.length} over_cap=${overCap}`,
  );

  // Step 7: apply verdicts.
  //
  // Per-verdict shape check: venue_id is a string + matches an eligible
  // candidate; keep is a boolean; reason is a string. Per-verdict shape
  // failures drop only that verdict (warn-log, increment a counter); the
  // rest still apply.
  //
  // Keep verdicts INSERT vs_candidate_venues with the same row shape
  // loadHqVenuesIntoPool's deterministic-keep INSERT uses. Per-row INSERT
  // failure increments insert_failed; the rest still apply.
  //
  // Missing verdicts (candidates without a verdict from Claude) get warn-
  // logged + treated as drop (no INSERT). Accounting:
  //   rescued + dropped + verdicts_missing + insert_failed === candidates
  const seenIds = new Set<string>();
  let rescued = 0;
  let dropped = 0;
  let insertFailed = 0;
  let hallucinatedVerdicts = 0;
  let malformedVerdicts = 0;
  for (const raw of rawVerdicts) {
    if (raw === null || typeof raw !== "object") {
      console.warn(
        `[hqPoolRescue] scout=${scout_id} malformed verdict (not an object); skipping`,
      );
      malformedVerdicts++;
      continue;
    }
    const v = raw as Record<string, unknown>;
    const venueId = typeof v.venue_id === "string" ? v.venue_id : null;
    const keep = typeof v.keep === "boolean" ? v.keep : null;
    const reason = typeof v.reason === "string" ? v.reason.trim() : "";
    if (!venueId || keep === null) {
      console.warn(
        `[hqPoolRescue] scout=${scout_id} malformed verdict (venue_id or keep missing/wrong type): ${JSON.stringify(v).slice(0, 200)}`,
      );
      malformedVerdicts++;
      continue;
    }
    const entry = eligibleById.get(venueId);
    if (!entry) {
      console.warn(
        `[hqPoolRescue] scout=${scout_id} hallucinated venue_id=${venueId} (not in candidate set); dropping verdict`,
      );
      hallucinatedVerdicts++;
      continue;
    }
    if (seenIds.has(venueId)) {
      // Duplicate verdict for the same venue. Take the first, warn on the
      // duplicate.
      console.warn(
        `[hqPoolRescue] scout=${scout_id} venue=${venueId} duplicate verdict ignored`,
      );
      continue;
    }
    seenIds.add(venueId);

    const hq = entry.venue;
    if (keep) {
      const venueType = hqVenueTypesToSlashJoined(hq);
      const sizeSqFt = hq.total_sq_ft ?? hq.square_footage ?? null;
      const features = Array.isArray(hq.features) ? hq.features : [];
      const { error: insErr } = await sb.from("vs_candidate_venues").insert({
        scout_id,
        name: hq.name,
        address: hq.address,
        neighborhood: hq.neighborhood,
        venue_type: venueType,
        website_url: hq.website_url,
        size_sq_ft: sizeSqFt,
        capacity: hq.capacity,
        key_features: features,
        venue_overview: hq.about_venue,
        linked_venue_id: hq.id,
        source: "hq_pool",
      });
      if (insErr) {
        console.warn(
          `[hqPoolRescue] scout=${scout_id} venue=${hq.id} name="${hq.name}" insert failed: ${insErr.message}`,
        );
        insertFailed++;
        continue;
      }
      rescued++;
      console.log(
        `[hqPoolRescue] scout=${scout_id} venue=${hq.id} name="${hq.name}" verdict=keep reason="${reason}"`,
      );
    } else {
      dropped++;
      console.log(
        `[hqPoolRescue] scout=${scout_id} venue=${hq.id} name="${hq.name}" verdict=drop reason="${reason}"`,
      );
    }
  }

  // Step 8: verdicts_missing = candidates without any verdict (keep or drop)
  // returned by Claude. Treated as drop per § 8.4.
  let verdictsMissing = 0;
  for (const entry of eligible) {
    if (!seenIds.has(entry.venue.id)) {
      verdictsMissing++;
      console.warn(
        `[hqPoolRescue] scout=${scout_id} venue=${entry.venue.id} name="${entry.venue.name}" verdict missing (Claude returned no verdict for this candidate; treating as drop)`,
      );
    }
  }

  // Accounting identity check (cheap arithmetic; defends against silent
  // counter drift). The sum includes malformed + hallucinated as their own
  // observability counters but those do NOT count toward the eligible-set
  // total since they reference no eligible candidate. The identity
  // (rescued + dropped + verdicts_missing + insert_failed === candidates)
  // covers every eligible candidate.
  const accountingSum =
    rescued + dropped + verdictsMissing + insertFailed;
  if (accountingSum !== eligible.length) {
    console.warn(
      `[hqPoolRescue:accounting] scout=${scout_id} counter drift: ${accountingSum} vs ${eligible.length} candidates ` +
        `(rescued=${rescued} dropped=${dropped} verdicts_missing=${verdictsMissing} insert_failed=${insertFailed})`,
    );
  }
  console.log(
    `[hqPoolRescue] scout=${scout_id} candidates=${eligible.length} ` +
      `rescued=${rescued} dropped=${dropped} ` +
      `verdicts_missing=${verdictsMissing} insert_failed=${insertFailed}` +
      (overCap > 0 ? ` over_cap=${overCap}` : "") +
      (hallucinatedVerdicts > 0
        ? ` hallucinated_verdicts=${hallucinatedVerdicts}`
        : "") +
      (malformedVerdicts > 0
        ? ` malformed_verdicts=${malformedVerdicts}`
        : ""),
  );
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Skip-the-kickoff window. MUST exceed WORK_TIMEOUT_MS so a refresh-during-
// in-flight invocation can't reacquire the kickoff while the first run is
// still mid-Phase-A/B.
//
// Phase 5.12.4.2 bump 360_000 -> 420_000 (Codex adversarial review round 2;
// extends the deck-side fix to research). Pre-fix: grace 360s EQUAL TO
// work 360s left a hairline race: the kickoff RPC's age check uses `<`,
// so age=360 reacquires. The 60s bump gives the writeFailure UPDATE
// breathing room before any refresh-triggered reacquisition can proceed.
// Producer's explicit Re-Generate path is not affected (reset RPC
// clears the timestamp directly).
//
// Sizing rationale: Phase B with tool_choice: auto + web_search max_uses=6
// can spend 3-5s per search call + significant model thinking on the
// batch submit_research schema. Thorough sourcing runs land around
// 90-180s; 360s work + 60s grace buffer gives substantial headroom for
// cold-sourcing cases that need many follow-up searches.
const IN_FLIGHT_GRACE_MS = 420_000;

// Hard app-level ceiling on Claude work, sized to fire ~40s before the
// Supabase Pro 400s platform wall clock so writeFailure lands cleanly
// before the platform pulls the function.
const WORK_TIMEOUT_MS = 360_000;

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

Mirror often books ground-floor commercial / storefront / retail-vacancy properties, so surface them when the brief allows. Equal-weight the other canonical venue types (provided in the user message) when they fit the brief. Reference databases like thestorefront.com, peerspace.com, propertyshark.com, loopnet.com, and crexi.com when researching, but NEVER use those listing-database URLs as a venue's website_url. Only set website_url when the venue has its own dedicated site; otherwise leave it null.

TYPE CONSTRAINT (strict): Each venue's type field must be one or more values from the canonical venue-types list provided in the user message. Multiple types are allowed when accurate (e.g. a venue can be both Industrial and Warehouse). No other values permitted; do not invent descriptive types like "Ground-floor commercial unit" or "Vacant storefront".

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
            name: {
              type: "string",
              description:
                "Just the venue's actual name. Use the venue's brand / property name as it appears in directories or on its own site. Do NOT add descriptive suffixes like 'Storefront', 'Vacancy', 'Vacant Retail', 'Ground-Floor Retail', 'Ground-Floor Storefront', 'Retail Vacancy', 'Event Suite', or any other modifier that describes WHAT the space is. Those belong in venue_type / key_features. Examples of good: 'Palihouse West Hollywood', 'Westfield Century City', 'The Sunset', 'Platform Culver City'. Examples of BAD: 'Palihouse West Hollywood - Ground-Floor Event Suite', 'Westfield Century City - Ground Level Retail Space', 'Vacant Retail - Larchmont Village Storefront'. If the property is genuinely an unbranded vacancy with no name, use just the address (e.g. '10250 Santa Monica Blvd').",
            },
            neighborhood: { type: "string" },
            address: { type: "string" },
            type: {
              type: "string",
              description:
                "Slash-separated values from the canonical venue-types list provided in the user message. Example: 'Industrial / Warehouse'.",
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
            key_features: {
              type: "array",
              description:
                "Array of 2-10 short, evergreen tags describing physical or experiential features of this venue. 1-4 words each (usually 1-2). Use the canonical examples below as the reference shape; tags not on the list are fine if they match the shape. Examples: Courtyard, Skylight, High Ceilings, Garage Doors, Ground Floor, Multi-Level, Waterfront, Rooftop, Garden, Wood Floors, Exposed Brick, Balcony, Storefront, Vaulted Ceilings, Multiple Stages, Outdoor, Floor-to-Ceiling Windows. Capitalize as title case. Do NOT include: specific named neighborhoods, streets, addresses, landmarks, architects; numbers, units, square footage, walk scores; narrative sentences (more than 4 words); marketing fluff; placeholder tokens. Items violating these rules will be stripped post-emission and the field treated as missing.",
              items: {
                type: "string",
                description: "A single 1-4 word evergreen feature tag.",
                maxLength: 35,
              },
              minItems: 2,
              maxItems: 10,
            },
            derived_attrs: {
              type: "object",
              description: "Map column id -> 'yes'|'maybe'|'no'",
              additionalProperties: { type: "string" },
            },
            recommendations: {
              type: "array",
              description:
                "2-4 short venue-specific observations the producer can use to pitch this venue against the brief. Each is a concrete, targeted, single-clause statement (10-15 words). Focus on activation potential, brand-fit, physical features, neighborhood context. CRITICAL: do NOT use placeholder tokens like '<UNKNOWN>', 'TBD', 'N/A', 'None', 'Not Available', 'TODO' -- placeholder strings will be stripped and the field treated as missing. web_search the venue first to find real observations.",
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
                "2-4 short limitations, gaps, or logistics flags the producer should weigh against the brief. Each is a concrete, targeted, single-clause statement (10-15 words). Focus on permits, capacity, distance, brand fit gaps, parking, programming constraints. CRITICAL: do NOT use placeholder tokens like '<UNKNOWN>', 'TBD', 'N/A', 'None', 'Not Available', 'TODO' -- placeholder strings will be stripped and the field treated as missing. web_search the venue first to find real constraints.",
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
  // Post-4.10.4 hot patch round 9: guard against overwriting a prior
  // success. Smoke 2026-05-13 surfaced a case where two parallel
  // invocations both ran Phase A + B; the first succeeded
  // (current_step='sourcing_report'), the second failed (pause_turn),
  // and the second's writeFailure overwrote the first's success state.
  // Now we only write failure if the scout is still 'researching' --
  // i.e., no prior invocation has already advanced it past this step.
  // The .eq("current_step", "researching") filter makes the UPDATE a
  // CAS that no-ops if another invocation already won.
  const { error } = await sb
    .from("vs_scouts")
    .update({
      status: "failed",
      pipeline_error: message,
      last_touched_at: new Date().toISOString(),
    })
    .eq("id", scout_id)
    .eq("current_step", "researching");
  if (error) {
    console.error(
      `[vs-research-venues] scout=${scout_id} writeFailure update error: ${error.message}`,
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

  // Phase 5.12.1: atomic kickoff acquisition via the new
  // `vs_research_try_acquire_kickoff` RPC. The pre-5.12.1 inline path
  // (check `brief_data.research_started_at` against IN_FLIGHT_GRACE_MS, then
  // non-atomically UPDATE the timestamp) had a confirmed-live race: two
  // concurrent invocations both passed the check before either committed
  // its timestamp, double-spending Claude tokens. The RPC uses
  // `pg_try_advisory_xact_lock` + a same-transaction read-and-write to make
  // the check + stamp atomic. See code-observations Edge #1 + the migration
  // `20260603160000_phase_5_12_1_hq_pool_source_and_research_kickoff_lock.sql`.
  //
  // Grace seconds matches IN_FLIGHT_GRACE_MS / 1000 so the RPC's age check
  // matches the prior window's behavior (subsequent boots within the grace
  // window still no-op).
  const { data: acquired, error: kickoffErr } = await sb.rpc(
    "vs_research_try_acquire_kickoff",
    {
      target_scout_id: scout_id,
      grace_seconds: Math.round(IN_FLIGHT_GRACE_MS / 1000),
    },
  );
  if (kickoffErr) {
    return jsonResponse(
      { error: `Could not acquire research kickoff: ${kickoffErr.message}` },
      500,
    );
  }
  if (!acquired) {
    return jsonResponse({ ok: true, scout_id, skipped: "in_flight" });
  }
  // We hold the kickoff; the RPC stamped `brief_data.research_started_at`
  // and cleared `pipeline_error` in its own transaction.

  // Phase 5.12.10: per-request runtime canonical venue-types set. Threaded
  // into Phase A enrichSheetVenue + enrichHqPoolForResearch + Phase B
  // (user-message constraint line + post-emit sanitizeMultiAgainst). Single
  // SELECT per request; cheap (~50ms) vs Claude latency.
  const canonicalSet = await getVenueTypesCanonicalSet(
    sb,
    "vs-research-venues",
  );

  // Phase 5.12.1: HQ Venues pool. Pull venues matching the scout's city out
  // of the master `venues` table, score by (neighborhood overlap, venue_type
  // overlap, alphabetical name) and INSERT the top 10 as `source='hq_pool'`
  // vs_candidate_venues rows BEFORE the existing-venues SELECT inside
  // work(). Why-before: the same SELECT seeds the Phase B EXISTING VENUES
  // block; hq_pool rows landing here automatically surface in that block so
  // Claude doesn't re-source them as net-new. Best-effort: errors warn-and-
  // continue (the scout's research still runs without the pool). Skip when
  // scout.city is empty since the filter is city-anchored.
  //
  // Phase 5.12.4 thread (b): loadHqVenuesIntoPool now returns its scored
  // intermediate state in HqPoolLoadResult. The closure-captured variable
  // travels into work() where rescueHqPoolFitVetoedVenues consumes it
  // concurrent with Phase A. Null result (no city / SELECT failure / hq
  // SELECT failure) signals "skip rescue".
  let hqPoolLoadResult: HqPoolLoadResult | null = null;
  if (typeof scout.city === "string" && scout.city.trim().length > 0) {
    hqPoolLoadResult = await loadHqVenuesIntoPool(
      sb,
      scout_id,
      scout,
      briefData,
    );
  }

  // Phase 5.12.4 thread (b): the existing-venues SELECT + curatedExistingCount
  // + targetNet computation moved INTO work() (below) so rescued + already-
  // seeded hq_pool rows are visible when Phase B builds its EXISTING VENUES
  // block. The SELECT runs after rescue resolves but before the Phase B
  // Claude call.

  // User message -- lifted from VS Pro with `project.` -> `scout.` field
  // reads. Fallback strings normalized to "(not set)" (VS Pro used en
  // dashes which violate the voice rule).
  //
  // Post-4.10.4 hot patch round 11: replaced the full `Brief data:
  // ${JSON.stringify(scout.brief_data)}` dump with selective field
  // extraction (expected_guest_count + brief_data.notes). The dump was
  // including internal state flags (research_started_at /
  // compile_started_at / deck_generation_started_at /
  // uploaded_files file-metadata) that are pure noise to Claude and
  // inflated the input token count for every Phase B call. Trimmed
  // version focuses Claude on the search-relevant subset.
  //
  // Phase 4 Revision - Intake: the brief intake now collects venue-side
  // fields (target_neighborhoods + strict flag, venue_types, ideal_features,
  // priority_location / priority_cost, sq_ft_minimum, activations_count,
  // target_audience, vibe_aesthetic). Inject them into the user message so
  // the AI sourcing actually uses them. Still a user-message change only --
  // SYSTEM stays frozen per feedback_tool_choice_collapse. Phase 5.12.14.3
  // R4 amendment v2 § D retired sq_ft_min/sq_ft_max + above_sq_ft_max veto;
  // sq_ft_minimum is the sole below-floor driver.
  const phaseBBriefData =
    (scout.brief_data ?? {}) as Record<string, unknown>;
  const phaseBExpectedGuests = phaseBBriefData.expected_guest_count;
  const phaseBNotes = phaseBBriefData.notes;

  const asArr = (v: unknown): string[] =>
    Array.isArray(v)
      ? v
          .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
          .map((x) => x.trim())
      : [];
  const asNum = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const asStr = (v: unknown): string =>
    typeof v === "string" ? v.trim() : "";

  const targetNeighborhoods = asArr(phaseBBriefData.target_neighborhoods);
  const strictNeighborhoods = phaseBBriefData.strict_neighborhoods_only === true;
  const venueTypes = asArr(phaseBBriefData.venue_types);
  const idealFeatures = asArr(phaseBBriefData.ideal_features);
  const priorityLocation = phaseBBriefData.priority_location;
  const priorityCost = phaseBBriefData.priority_cost;
  // R6 § M.3: legacy `sq_ft_min` fallback so scouts pre-R4 still surface
  // size guidance in the Phase B sourcing prompt.
  const sqFtMinimum =
    asNum(phaseBBriefData.sq_ft_minimum) ?? asNum(phaseBBriefData.sq_ft_min);
  const activationsCount = asNum(phaseBBriefData.activations_count);
  // Phase 5.12.5: target_audience + vibe_aesthetic flipped from string to
  // string[]. asTagArr (module-level) coerces both shapes.
  const targetAudience = asTagArr(phaseBBriefData.target_audience);
  const vibeAesthetic = asTagArr(phaseBBriefData.vibe_aesthetic);

  const requirementLines: string[] = [];
  if (targetNeighborhoods.length > 0) {
    requirementLines.push(
      strictNeighborhoods
        ? `Restrict candidates to these neighborhoods: ${targetNeighborhoods.join(", ")}. You MAY include at most 1-2 venues from immediately adjacent neighborhoods, but no further.`
        : `Prefer candidates in these neighborhoods: ${targetNeighborhoods.join(", ")}. Adjacent neighborhoods and a reasonable radius within the city are acceptable; do not exclude a venue that aligns strongly with every other brief criterion solely on neighborhood.`,
    );
  }
  if (venueTypes.length > 0) {
    requirementLines.push(
      `Candidate venue should be one of these types: ${venueTypes.join(", ")}. You MAY include 1-2 strong outliers from outside this list ONLY when the venue ranks very high on the brief's other criteria (neighborhood, scale, brand fit, vibe) such that the type mismatch is clearly overcome. Default to within-type.`,
    );
  }
  if (idealFeatures.length > 0) {
    requirementLines.push(
      `Prioritize venues with these features: ${idealFeatures.join(", ")}.`,
    );
  }
  const priorityParts: string[] = [];
  if (priorityLocation === "high_foot_traffic") {
    priorityParts.push("Location: high foot traffic");
  } else if (priorityLocation === "intimate_destination") {
    priorityParts.push("Location: intimate destination");
  }
  if (priorityCost === "lower_cost") priorityParts.push("Cost: lower-cost");
  else if (priorityCost === "premium") priorityParts.push("Cost: premium");
  if (priorityParts.length > 0) {
    requirementLines.push(`Sourcing priorities: ${priorityParts.join(". ")}.`);
  }
  if (sqFtMinimum !== null) {
    requirementLines.push(
      `Hard floor: do not surface venues smaller than ${sqFtMinimum.toLocaleString()} sq ft.`,
    );
  }
  if (activationsCount !== null) {
    requirementLines.push(
      `The event needs roughly ${activationsCount} distinct spaces / locations; surface options that can support that.`,
    );
  }
  const venueRequirementsBlock =
    requirementLines.length > 0
      ? `\n\nVENUE REQUIREMENTS:\n${requirementLines.map((l) => `- ${l}`).join("\n")}`
      : "";

  // Phase 5.12.4 thread (b): split the userMsg into a brief prefix (no
  // dependency on the existing-venues SELECT, computed at handler level
  // for closure capture) and a tail (EXISTING VENUES block + Return X
  // line, both depend on `existing` and `targetNet` which are computed
  // inside work() after the rescue pass resolves so rescued rows are
  // visible to Phase B).
  const userMsgBriefPrefix =
    `PROJECT BRIEF
Client: ${scout.client_name ?? "(not set)"}
Event: ${scout.event_name ?? "(not set)"}
City: ${scout.city ?? "(not set)"}
Live dates: ${scout.live_dates ?? "(not set)"}
Budget: ${scout.budget ?? "(not set)"}
Expected guests: ${
      typeof phaseBExpectedGuests === "number" ||
      typeof phaseBExpectedGuests === "string"
        ? String(phaseBExpectedGuests)
        : "(not set)"
    }
Overview: ${scout.event_overview ?? "(not set)"}
Target audience: ${targetAudience.length > 0 ? targetAudience.join(", ") : "(not set)"}
Vibe / aesthetic: ${vibeAesthetic.length > 0 ? vibeAesthetic.join(", ") : "(not set)"}
Additional brief notes: ${
      typeof phaseBNotes === "string" && phaseBNotes.trim().length > 0
        ? phaseBNotes.trim()
        : "(none)"
    }${venueRequirementsBlock}`;

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
    // Audit pass 2 item 3: re-SELECT brief_data right at the top of work()
    // so the local copy reflects the kickoff RPC's server-side stamp of
    // research_started_at (the handler's briefData was captured BEFORE the
    // RPC ran and is missing that field). Every progress_step write below
    // merges against the latest in-memory liveBriefData, then writes back,
    // so the kickoff timestamp + any other ad-hoc state survive intact.
    const { data: refreshedScout } = await sb
      .from("vs_scouts")
      .select("brief_data")
      .eq("id", scout_id)
      .maybeSingle();
    let liveBriefData =
      (refreshedScout?.brief_data ?? briefData) as Record<string, unknown>;
    // Progress-step writer. UX-only signal driving the Researching page's
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
          `[vs-research-venues] scout=${scout_id} progress_step=${key} write failed: ${progressErr.message}`,
        );
      }
    };
    await writeProgress("brief_loaded");

    try {
      await writeProgress("phase_a_enrichment");
      // Kick Phase A off in parallel. We start it before the Claude call
      // for Phase B so the two run concurrently; await both before the
      // final scout UPDATE. Phase A doesn't have its own timeout because
      // it's a sequence of per-row callClaude that each enforce their
      // own deadline via the wrapper; total Phase A latency scales with
      // (sheet_count / CHUNK_SIZE).
      const phaseAPromise = runPhaseA(
        sb,
        scout_id,
        scout as ScoutBrief,
        canonicalSet.names,
      );

      // Phase 5.12.4 thread (b): rescue runs concurrent with Phase A
      // (Phase A is ~30-60s, rescue is ~10-20s, so the await here mostly
      // overlaps with Phase A). Net latency overhead near-zero when Phase
      // A is the longer leg. Phase B only waits for rescue, not Phase A.
      //
      // hqPoolLoadResult is null when scout.city is empty, when the hq
      // SELECT failed, or when the link SELECT failed (best-effort: the
      // deterministic pool already short-circuited too in those cases).
      // Skip rescue cleanly so we don't burn a Claude call on nothing.
      if (hqPoolLoadResult !== null) {
        await rescueHqPoolFitVetoedVenues(
          sb,
          scout_id,
          scout,
          briefData,
          hqPoolLoadResult,
        );
      }

      // Phase 5.12.4 thread (b): existing-venues SELECT moved into work()
      // so rescued + deterministic-keep hq_pool rows land in Phase B's
      // EXISTING VENUES block. Was a synchronous handler-path SELECT
      // before 5.12.4.
      const { data: existing } = await sb
        .from("vs_candidate_venues")
        .select("name, neighborhood, address, venue_type, source")
        .eq("scout_id", scout_id);

      // Phase 5.12.1: count BOTH sheet rows AND hq_pool rows toward the
      // existing-curated total. Pre-5.12.1 only sheet rows counted, but
      // the pre-Phase-B HQ pool insert (§ 8.1) can land up to 10 admin-
      // curated venues (plus 5.12.4 rescued venues) that Claude would
      // otherwise oversource on top of. The intent of targetNet is "how
      // many net-new picks land the matrix at 10-15 total"; an HQ pool
      // venue is just as much an existing curated row as a producer-
      // uploaded sheet row, so it has to count.
      const curatedExistingCount = (existing ?? []).filter(
        (v: { source: string | null }) =>
          v.source === "sheet" || v.source === "hq_pool",
      ).length;
      const targetNet =
        curatedExistingCount >= 10
          ? 4
          : Math.max(10 - curatedExistingCount, 5);

      // Phase 5.12.10: canonical venue-types list rides in the per-call user
      // message (schema descriptions + Phase B SYSTEM stay static for
      // prompt-cache stability per feedback_tool_choice_collapse).
      const canonicalLine =
        canonicalSet.names.length > 0
          ? `\n\nCANONICAL VENUE TYPES (CONSTRAINT for each venue's "type" field): ${canonicalSet.names.join(", ")}. Use ONLY values from this list; multiple types separated by " / " allowed.`
          : "";

      // Compose the Phase B userMsg from the handler-built prefix + the
      // canonical-types line + the existing-venues block + the targetNet-
      // dependent Return line.
      const userMsg = `${userMsgBriefPrefix}${canonicalLine}

EXISTING VENUES (do not duplicate):
${(existing ?? [])
  .map(
    (v: { name: string | null; neighborhood: string | null }) =>
      `- ${v.name ?? "?"} (${v.neighborhood ?? "?"})`,
  )
  .join("\n") || "(none)"}

Return ${targetNet} net-new venue candidates (10-15 total considering the existing list). Rank against the brief's stated criteria; do not over-weight any single venue type when scoring. Pick 3-4 derived columns that map to the most decision-relevant brief criteria.`;

      await writeProgress("phase_b_research");

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
          // Post-4.10.4 hot patch round 1 (2026-05-13 evening): pivoted
          // model + web_search version from claude-sonnet-4-5 +
          // web_search_20250305 to claude-sonnet-4-6 + web_search_20260209.
          // Smoke surfaced 3/7 Phase A per-row calls now invoke web_search
          // (vs 0/7 before), confirming the pivot is the right direction.
          // BUT this same batch call still returned server_tool_uses=0
          // with out=2297, producing 4 generic "vacant retail" venues with
          // null URLs and 1 known-brand venue (Palihouse) with a training-
          // knowledge URL. Same structural collapse Phase A's per-row
          // restructure was supposed to cure: forced `tool_choice` on a
          // complex batch schema + server-side web_search = model emits
          // the tool from training knowledge without searching.
          //
          // Round 2 hot patch: drop forced tool_choice -> auto. SYSTEM
          // still says "You return ONLY a tool call to submit_research"
          // (strong directive). Auto-mode lets Claude use web_search
          // freely first, then emit the tool when it has actual results.
          // If Claude occasionally emits plain text instead of the tool,
          // the existing `no structured output` failure path kicks in and
          // the Researching page routes to ErrorState; producer retries.
          // Memory rule check: feedback_tool_choice_collapse is about not
          // editing SYSTEM, not about tool_choice. The collapse pattern
          // itself motivates dropping the forced choice.
          // Round 12 hot patch: pivoted web_search_20260209 -> 20250305
          // (same rationale as Phase A: dynamic filtering's
          // code_execution sandbox adds heavy per-turn context that
          // bills cumulatively across multi-turn rounds; the simpler
          // 20250305 tool is lighter-weight). Combined with round 10's
          // max_tokens 5000 + max_uses 4 + MAX_PAUSE_CONTINUATIONS=1,
          // Phase B should now fit comfortably within 360s.
          model: "claude-sonnet-4-6",
          // No-sheet flow truncation fix (2026-05-14): the research-only
          // path requests targetNet=10 venues (vs 4-7 when a sheet is
          // uploaded, where existing rows absorb most of the 10-15 target).
          // A submit_research payload for 10 fully-populated venues -- each
          // with key_features + recommendations + considerations arrays --
          // plus the interleaved web_search rounds overflowed the 5000
          // ceiling. The tool_use truncated mid-emission: derived_columns
          // landed (first in schema property order) but venues was cut
          // off, surfacing downstream as "tool input missing venues
          // array". 12000 fits the full 10-venue payload + searches +
          // reasoning in a single round with headroom; the model only
          // bills tokens it actually emits, so this costs nothing on the
          // smaller sheet-flow payloads.
          max_tokens: 12000,
          system: SYSTEM,
          tools: [
            TOOL,
            { type: "web_search_20250305", name: "web_search", max_uses: 4 },
          ],
          tool_choice: { type: "auto" },
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
          `server_tool_uses=${serverToolUses} ` +
          `stop_reason=${result.stop_reason ?? "?"}`,
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
        // stop_reason + out token count make a truncated tool_use
        // immediately diagnosable: stop_reason=max_tokens here means the
        // payload outgrew max_tokens and venues got cut off mid-emission.
        await writeFailure(
          sb,
          scout_id,
          `tool input missing venues array (stop_reason=${result.stop_reason ?? "?"}, out=${result.usage?.output_tokens ?? "?"})`,
        );
        return;
      }

      // Sanitize. Drop nameless venues defensively. Type tokens go
      // through sanitizeMultiAgainst (Phase 5.12.10; runtime canonical set)
      // which rejects non-canonical tokens (null on no match); URL captured
      // raw here for the deferred HEAD-validation pass below
      // (validateWebsiteUrls runs sanitizeWebsiteUrl internally + a HEAD-
      // request gate against URL fabrication, Phase 4.10.3-port).
      // Note column rename: VS Pro -> HQ
      //   type            -> venue_type
      //   ranking_score   -> rank
      let cleanVenues = venues
        .map((raw: unknown) => {
          const v = raw as Record<string, unknown>;
          const typeRaw = typeof v.type === "string" ? v.type : "";
          // sanitizeMultiAgainst splits on slash OR comma and runs each
          // token through canonicalizeAgainst (case-insensitive match
          // against canonicalSet.names). Returns null when nothing
          // resolves; venue_type lands as null in that case.
          const venue_type = sanitizeMultiAgainst(typeRaw, canonicalSet.names);
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
            // Round 7 hot patch: strip placeholder tokens ('<UNKNOWN>',
            // 'TBD', 'N/A', etc.) before they land in the DB. Phase B's
            // submit_research schema has the same minItems constraints as
            // Phase A's fill_venue, and Claude exhibits the same
            // "fill with placeholder when uncertain" fallback under both.
            // Phase 5.12.13.1: sanitizeTagShape chains on the outside to
            // drop items that violate the evergreen-tag shape (digits,
            // > 4 words, > 35 chars, case-insensitive dupes).
            key_features: sanitizeTagShape(stripPlaceholders(v.key_features)),
            derived_attrs:
              typeof v.derived_attrs === "object" && v.derived_attrs !== null
                ? v.derived_attrs
                : {},
            recommendations: stripPlaceholders(v.recommendations),
            considerations: stripPlaceholders(v.considerations),
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

      // Phase 5.12.1 (introduced) + Phase 5.12.3.1 (widened pool +
      // seed-then-drop for fit-vetoed matches): cross-rail dedupe runs
      // BEFORE validateWebsiteUrls + findVenueWebsite (both expensive:
      // HEAD requests and a per-venue targeted Claude call) so we don't
      // burn that cost on rows we're about to drop. Claude already gets
      // the EXISTING VENUES block at prompt time, but it occasionally
      // surfaces a near-duplicate anyway; this is the deterministic
      // backstop.
      //
      // 5.12.3.1 widening: the pool now queries `venues` directly for
      // every HQ row in scout.city, NOT just the seeded `source='hq_pool'`
      // subset. Pre-5.12.3.1 the 5.12.1 cross-rail dedupe only saw the
      // seeded subset, but the new fit filter can legitimately veto an
      // HQ venue (wrong_type, aggregate_gaps, etc.) that Claude's research
      // then surfaces with richer data. Without widening, the matrix
      // landed both the un-seeded HQ row (dropped by fit filter) AND
      // Claude's research row (unlinked) -- effectively a recall hole
      // on the dedupe path. Surfaced live by scout 7ad1d004 (Platform LA
      // wrong_type-vetoed + Claude's "Platform Culver City" landed
      // unlinked at address-identical match).
      //
      // Seed-then-drop: when a match resolves to an HQ venue that was NOT
      // seeded, INSERT it as hq_pool now (bypassing the fit filter for
      // this venue; the dedupe match is independent evidence of relevance)
      // with Claude's richer fields merged in where HQ has nulls/empties,
      // then drop the research row. When the match resolves to an HQ
      // venue that WAS seeded, just drop the research row (current
      // behavior). `vs_candidate_venues` has no `city` column so both
      // sides get the scout city stamped for cross-field disambiguation.
      const { data: hqVenuesRaw, error: poolReadErr } = await sb
        .from("venues")
        .select(
          "id, name, address, neighborhood, city, website_url, features, total_sq_ft, square_footage, capacity, about_venue, venue_venue_types(venue_types(name))",
        )
        .ilike("city", (scout.city ?? "").trim());
      const { data: seededLinksRaw, error: seededErr } = await sb
        .from("vs_candidate_venues")
        .select("linked_venue_id")
        .eq("scout_id", scout_id)
        .eq("source", "hq_pool");
      if (poolReadErr || seededErr) {
        // Best-effort: a SELECT failure here just means we lose the
        // cross-rail backstop; the EXISTING VENUES block already pushed
        // Claude away from duplicates, and `vs-generate-deck`'s 5.12.0 push
        // will still match on the HQ side.
        const msg = poolReadErr?.message ?? seededErr?.message ?? "unknown";
        console.warn(
          `[vs-research-venues] scout=${scout_id} hq-pool dedupe SELECT failed: ${msg} (continuing without cross-rail dedupe)`,
        );
      } else {
        const scoutCityForDedupe = (scout.city ?? null) as string | null;
        const hqVenues = (hqVenuesRaw ?? []) as HqVenueRowRaw[];
        const seededHqIds = new Set(
          (seededLinksRaw ?? [])
            .map((r) => r.linked_venue_id as string | null)
            .filter((id): id is string => typeof id === "string"),
        );
        // Lookup back to the full HQ row by id (needed for the seed-then-
        // drop merge path).
        const hqById = new Map(hqVenues.map((hq) => [hq.id, hq]));
        // Dedupe-pool shape: the ladder reads name/address/city/website_url
        // off each entry. Stamp scout.city onto each HQ entry so cityEquals
        // can compare apples to apples (HQ `city` column already carries
        // the canonical lookup value, but stamping scout.city is cheaper
        // than special-casing the comparator).
        const hqPool = hqVenues.map((hq) => ({
          id: hq.id,
          name: hq.name,
          address: hq.address,
          neighborhood: hq.neighborhood,
          website_url: hq.website_url,
          city: scoutCityForDedupe,
        }));
        if (hqPool.length > 0) {
          const before = cleanVenues.length;
          let seededOnDedupe = 0;
          let seededOnDedupeFailed = 0;
          const filtered: typeof cleanVenues = [];
          for (const cand of cleanVenues) {
            // Phase 5.12.3: points-based ladder. Address-differ VETO
            // catches same-city same-name different-address collisions.
            const result = findVenueDedupeMatch(
              {
                name: cand.name,
                address: cand.address,
                city: scoutCityForDedupe,
                website_url: cand.website_url,
              },
              hqPool,
            );
            if (!result) {
              filtered.push(cand);
              continue;
            }
            const matchedId = result.match.id;
            if (seededHqIds.has(matchedId)) {
              // HQ venue already in the scout's hq_pool. Drop the research
              // row; matrix already shows the HQ row.
              console.log(
                `[vs-research-venues] scout=${scout_id} hq-pool dedupe: drop research row "${cand.name}" (collides with seeded hq_pool ${matchedId}; ${result.reason})`,
              );
              continue;
            }
            // 5.12.3.1 seed-then-drop. HQ venue is in the city pool but
            // wasn't seeded (fit filter vetoed it; see [hqPoolFilter] log
            // lines from the same scout). Insert it as hq_pool now,
            // merging Claude's enrichment where HQ has nulls/empties.
            const hq = hqById.get(matchedId);
            if (!hq) {
              // Defensive: the matched id should always resolve back to
              // an hq_pool entry since we built hqPool from hqVenues. If
              // it doesn't, drop the research row to preserve the dedupe
              // invariant and warn.
              console.warn(
                `[vs-research-venues] scout=${scout_id} hq-pool dedupe: matched id ${matchedId} missing from hqById (defensive; dropping research row "${cand.name}")`,
              );
              continue;
            }
            const mergedVenueType = hqVenueTypesToSlashJoined(hq);
            const mergedWebsite = hq.website_url ?? cand.website_url;
            const mergedSizeSqFt =
              hq.total_sq_ft ?? hq.square_footage ?? cand.size_sq_ft ?? null;
            const mergedCapacity = hq.capacity ?? cand.capacity ?? null;
            const hqFeatures = Array.isArray(hq.features) ? hq.features : [];
            const mergedFeatures =
              hqFeatures.length > 0 ? hqFeatures : cand.key_features;
            const { error: seedErr } = await sb
              .from("vs_candidate_venues")
              .insert({
                scout_id,
                name: hq.name,
                address: hq.address,
                neighborhood: hq.neighborhood,
                venue_type: mergedVenueType,
                website_url: mergedWebsite,
                size_sq_ft: mergedSizeSqFt,
                capacity: mergedCapacity,
                key_features: mergedFeatures,
                venue_overview: hq.about_venue,
                // Per-brief judgments from Claude's research carry through
                // so the matrix row is rich on day one. 5.12.4 Pass 1
                // narrows the hq_pool skip to derived_attrs only, but
                // even today's behavior (skip-all-on-hq_pool) is fine
                // since these fields are already populated.
                derived_attrs: cand.derived_attrs,
                recommendations: cand.recommendations,
                considerations: cand.considerations,
                rank: cand.rank,
                linked_venue_id: hq.id,
                source: "hq_pool",
              });
            if (seedErr) {
              // INSERT failed (FK / CHECK / unique race against a
              // concurrent run). Keep the research row in the matrix so
              // the producer still sees the venue; vs-generate-deck's
              // pushVenuesToHq will catch the dedupe at deck time.
              console.warn(
                `[vs-research-venues] scout=${scout_id} hq-pool dedupe: seed-then-drop INSERT failed "${hq.name}" (${hq.id}): ${seedErr.message} (keeping research row)`,
              );
              seededOnDedupeFailed++;
              filtered.push(cand);
              continue;
            }
            seededOnDedupe++;
            console.log(
              `[vs-research-venues] scout=${scout_id} hq-pool dedupe: seed-then-drop "${cand.name}" -> hq_pool ${hq.id} "${hq.name}" (${result.reason}); research row dropped`,
            );
            // Track the newly-seeded id so a later candidate matching the
            // same HQ venue hits the seeded-path (drop only) instead of
            // double-inserting.
            seededHqIds.add(matchedId);
          }
          cleanVenues = filtered;
          if (cleanVenues.length < before || seededOnDedupe > 0) {
            console.log(
              `[vs-research-venues] scout=${scout_id} hq-pool dedupe summary: dropped=${before - cleanVenues.length} of ${before} research rows (${seededOnDedupe} seed-then-drop, ${seededOnDedupeFailed} seed-then-drop INSERT failed)`,
            );
          }
        }
        // If the dedupe drained the research set to zero, that's fine: the
        // hq_pool venues already cover the scout. The final scout UPDATE +
        // navigate still fires.
      }

      // Phase 5.12.1: dedupe can drain cleanVenues to zero when the HQ
      // pool already covered everything Claude found. That is a success
      // state (the scout's matrix is fully seeded by the pre-Phase-B
      // hq_pool insert), not a failure. Short-circuit the HEAD-validate
      // + INSERT block so we don't fire validateWebsiteUrls on an empty
      // array (cheap but wasteful) and don't call .insert([]) on
      // PostgREST (which can return an error depending on client
      // version). The Phase A await + final scout UPDATE still fires.
      if (cleanVenues.length === 0) {
        console.log(
          `[vs-research-venues] scout=${scout_id} no Phase B research rows after hq-pool dedupe; finalizing scout with hq_pool venues only`,
        );
      } else {
        // Phase 4.10.3-port: HEAD-validate each website_url in parallel so
        // fabricated listing URLs (LoopNet / Crexi / Storefront pages with
        // invented listing IDs that 4xx or soft-404 to a homepage) get
        // dropped before INSERT. ~15-20 URLs in parallel, 5s timeout each,
        // adds ~2-3s total. Network errors keep the URL (producer can edit).
        //
        // Round 14 hot patch: replaced round-13's findBestSearchResultUrl
        // (cheap title-matching against the broad batch's search results)
        // with findVenueWebsite (a NEW targeted Claude call per venue
        // using just `name + address`). Round 13's match-from-batch
        // approach was producing wrong URLs because the batch's search
        // results were broad / off-target. Targeted per-venue search is
        // more expensive (~10-15s per venue, parallel) but the URL
        // signal is cleaner. Combined with the round-14 schema tightening
        // on `name` (forbid descriptive suffixes), the search query
        // itself is now much more specific.
        const rawUrls = cleanVenues.map((v) => v.website_url);
        const validatedUrls = await validateWebsiteUrls(rawUrls);
        const fallbackUrls = await Promise.all(
          cleanVenues.map(async (v, i) => {
            if (validatedUrls[i] !== null) return validatedUrls[i];
            const candidate = await findVenueWebsite(
              "venue_scout",
              { name: v.name, address: v.address, city: scout.city ?? null },
              { fn_name: "vs-research-venues:url-fallback" },
            );
            if (!candidate) return null;
            const validated = await validateWebsiteUrl(candidate);
            if (validated) {
              console.log(
                `[vs-research-venues] scout=${scout_id} venue="${v.name}" website_url fallback from targeted search: ${validated}`,
              );
            }
            return validated;
          }),
        );
        const venuesForInsert = cleanVenues.map((v, i) => ({
          ...v,
          website_url: fallbackUrls[i],
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
      }

      // Await Phase A before final scout flip so the Researching page
      // navigates to a fully-enriched matrix. Phase A errors are tolerated
      // (per-row); the function call itself shouldn't reject unless the
      // table SELECT failed, which already logs above.
      const phaseAResult = await phaseAPromise;
      console.log(
        `[vs-research-venues] scout=${scout_id} phase-a sheet enrich done: ${phaseAResult.enriched} enriched, ${phaseAResult.failed} failed`,
      );

      // Phase 5.12.7 Feature B: research-time hq_pool enrichment runs
      // sequentially after Phase A, before the final UPDATE flipping
      // current_step='sourcing_report'. Best-effort: every failure path
      // warn-logs + skips, NEVER writeFailure (a failure stamp would
      // CAS-no-op the final UPDATE per Phase 5.12.4.2 Fix 2). Disjoint
      // with rescue (5.12.4 thread b): rescue insertions land with empty
      // recs/cons/rank too, so the same pass picks them up alongside
      // deterministic-keep bare-insert rows. Compile-time Pass 1 hq_pool
      // branch is the defense-in-depth backstop for any rows this leg
      // times out on (60s internal deadline; see helper docblock).
      await enrichHqPoolForResearch(
        sb,
        scout_id,
        scout as ScoutBrief,
        canonicalSet.names,
      );

      await writeProgress("finalizing");

      // Last write: flip the scout state so the Realtime subscriber on
      // the Researching page navigates. Venues are already queryable
      // when this UPDATE fires.
      //
      // Phase 5.12.4.2 (Codex round 2 finding 2; mirror of the
      // vs-compile-summaries fix): CAS-guard on `pipeline_error IS NULL`
      // + `current_step='researching'` so a late-resolving Phase B
      // callClaude (Promise.race timeout fired but the underlying fetch
      // resolved after) can't overwrite a writeFailure stamp with
      // `current_step='sourcing_report', status='in_progress'`. The
      // writeFailure path stamps a non-null pipeline_error + already
      // CAS-guards on `current_step='researching'`; this CAS mirrors
      // those predicates on the success side. The kickoff RPC clears
      // pipeline_error at acquisition time, so the happy-path runs always
      // see NULL when this CAS fires. CAS no-op on count=0 returns
      // cleanly without raising so the late-success path doesn't trip
      // the outer catch + double-write writeFailure on top of the prior
      // failure.
      const { error: updErr, count: updCount } = await sb
        .from("vs_scouts")
        .update(
          {
            derived_columns: Array.isArray(derived_columns)
              ? derived_columns
              : [],
            current_step: "sourcing_report",
            status: "in_progress",
            pipeline_error: null,
            last_touched_at: new Date().toISOString(),
          },
          { count: "exact" },
        )
        .eq("id", scout_id)
        .eq("current_step", "researching")
        .is("pipeline_error", null);

      if (updErr) {
        await writeFailure(
          sb,
          scout_id,
          `Final scout update failed: ${updErr.message}`,
        );
        return;
      }
      if (updCount === 0) {
        // 5.12.4.2 CAS no-op: writeFailure already stamped failure (timeout
        // race) or another invocation advanced current_step. Return cleanly
        // so the outer catch doesn't fire writeFailure on top of the prior
        // failure.
        console.warn(
          `[vs-research-venues] scout=${scout_id} final UPDATE no-op (CAS failed; likely timeout already wrote failure or another invocation advanced state)`,
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
