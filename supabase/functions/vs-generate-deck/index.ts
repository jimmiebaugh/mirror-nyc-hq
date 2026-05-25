// vs-generate-deck (Phase 4.8.2-port; slide indices corrected 4.8.3-port)
//
// Google Slides pitch-deck generation. Lifts the entire VS Pro
// `generate-deck` function (~565 lines) with these locked deltas per port
// plan § 6:
//   1. Service-account auth comes from _shared/googleServiceAccount.ts
//      (cherry-picked in 4.8.1-port). VS Pro's ~60 lines of inline
//      JWT-mint + token-exchange logic deletes entirely. No impersonation
//      (the service account owns the Drive + Slides calls; decks land in
//      a Mirror Shared Drive the account is a member of).
//   2. Payload simplified from { project_id } to { scout_id }.
//   3. Storage targets: projects -> vs_scouts; venues -> vs_candidate_venues;
//      venue_photos -> vs_venue_photos. Photo FK renamed venue_id ->
//      candidate_venue_id. Photo URL strategy: createSignedUrl(path, 3600)
//      instead of getPublicUrl (private bucket per 4.7.1-port).
//   4. EdgeRuntime.waitUntil divorces request lifetime from work lifetime
//      (port plan § 8.3). Function returns 200 immediately; Slides API
//      work runs in the background. The Generating page learns about
//      completion / failure via Realtime on vs_scouts.generated_decks +
//      current_step + status.
//   5. Idempotency via brief_data.deck_generation_started_at (90-second
//      grace). Refresh-tolerant. Same pattern as 4.5 + 4.7.2.
//   6. 180-second Promise.race timeout ceiling. Slides + Drive API is
//      slow; typical runs are 1-2 minutes per VS Pro description; 60-second
//      buffer.
//   7. Error signaling: VS Pro returns { error, code } synchronously. Port
//      writes status='failed' + pipeline_error=`${CODE}: ${message}`. The
//      Generating page parses the code and routes to /deck/error/<code>.
//      current_step stays 'deck_prep' so Resume / Re-generate from
//      DeckPrep is the recovery path (same pattern as 4.7.2 leaving at
//      'compiling' on failure).
//   8. Deck name template: `${event_name} - Venue Pitch Deck v${N}`
//      (hyphen). VS Pro used an em dash which violates the voice rule.
//
// VS Pro source: supabase/functions/generate-deck/index.ts (~565 lines).
// Slide-population logic (front-matter globals, per-venue duplicate +
// scoped replacements, image alt-text replacement, "Website" hyperlink,
// template per-venue slide deletion, final slide count) lifts verbatim
// modulo a one-slot index shift applied in 4.8.3-port: Mirror's actual
// template has 6 front-matter slides (cover, project info, event overview,
// section title, venue map with venue-name legend) whereas VS Pro's
// template had 5. Per-venue templates therefore live at slides 7 + 8 in
// Mirror's template instead of slides 6 + 7.
//
// Phase 5.12.0: gains an HQ Venues push at the top of `generateWork()`,
// before any Slides API call. The push runs the name-with-cross-field /
// address / website dedupe ladder against existing HQ `venues`, INSERTs
// new rows for non-matches (carrying the producer-edited venue_overview
// into `venues.about_venue`), UPDATEs `about_venue` on matched rows only
// when the existing value is blank (producer-edited paragraphs are
// preserved), and writes `linked_venue_id` on every candidate. Replaces
// the retired `vs_candidate_venues_shortlist_sync` trigger. Push failures
// fail the deck run via the new HQ_PUSH_FAILED code so the producer sees
// a meaningful error and can retry; `venue_venue_types` join failures are
// decorative and warn-and-continue.
//
// Memory rules in force:
//   - feedback_port_fidelity: match VS Pro layout/data exactly except for
//     the locked deltas above. The slide-population code stays 1:1 with VS Pro.
//   - No callClaude usage; no model-pin concerns.
//   - feedback_tool_choice_collapse does not apply (no Claude tool calls).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getGoogleAccessToken } from "../_shared/googleServiceAccount.ts";
import {
  getVenueTypesCanonicalSet,
  sanitizeMultiAgainst,
  type VenueTypesCanonical,
} from "../_shared/venueTypes.ts";
import { findVenueDedupeMatch } from "../_shared/venueDedupe.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type ErrCode =
  | "AUTH_FAILED"
  | "TEMPLATE_COPY_FAILED"
  | "SLIDES_API_FAILED"
  | "NO_VENUES_INCLUDED"
  | "HQ_PUSH_FAILED"
  | "UNKNOWN";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Skip-the-kickoff window. MUST exceed WORK_TIMEOUT_MS so a refresh-during-
// in-flight invocation can't reacquire the kickoff while the first run is
// still mutating state.
//
// Phase 5.12.4.2 bump 90_000 -> 240_000 (Codex adversarial review round 2,
// finding 1). Pre-fix: grace 90s + work 180s = a 90s window where the
// kickoff RPC's grace check expired BUT the first work() invocation was
// still mid-Slides-API, so a producer refresh at 100s would acquire a
// fresh kickoff and start a SECOND deck run, re-opening the duplicate-HQ-
// venue race the 5.12.4.1 kickoff RPC was meant to close. 240s = 180s
// work ceiling + 60s buffer for the failWithCode UPDATE to land before
// any refresh-triggered reacquisition can proceed. The producer's
// explicit Re-Generate path still works without delay because it goes
// through `reset_scout_for_deck_regenerate` which atomically clears the
// timestamp.
const IN_FLIGHT_GRACE_MS = 240_000;

// Hard ceiling on Drive + Slides work. Typical runs are 1-2 minutes
// (template copy + per-venue duplicates + per-venue token replacements +
// per-venue image replacements + slide deletes + reads). Cap at 3 minutes.
const WORK_TIMEOUT_MS = 180_000;

// Mirror's deck template has 6 front-matter slides (cover, project info
// across slides 2-3, event overview, section title, venue map with
// venue-name legend at slide 6). All per-venue detail + floor-plan
// duplicates land starting at this index. Mirrors the constant of the
// same name on the frontend DeckPrep page.
const FRONT_MATTER_SLIDES = 6;

// Service-account scopes. No impersonation; the service account owns the
// Drive + Slides calls directly.
const DRIVE_SLIDES_SCOPES = [
  "https://www.googleapis.com/auth/presentations",
  "https://www.googleapis.com/auth/drive",
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Google API fetch wrapper. Lifted verbatim from VS Pro.
async function gFetch(
  url: string,
  token: string,
  init: RequestInit = {},
): Promise<{ [k: string]: unknown }> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${init.method ?? "GET"} ${url} -> ${res.status}: ${body}`);
  }
  return res.json();
}

async function copyTemplate(
  templateId: string,
  name: string,
  folderId: string,
  token: string,
): Promise<string> {
  const j = await gFetch(
    `https://www.googleapis.com/drive/v3/files/${templateId}/copy?supportsAllDrives=true`,
    token,
    {
      method: "POST",
      body: JSON.stringify({ name, parents: [folderId] }),
    },
  );
  return j.id as string;
}

async function getPresentation(deckId: string, token: string) {
  return gFetch(
    `https://slides.googleapis.com/v1/presentations/${deckId}`,
    token,
  );
}

async function batchUpdate(
  deckId: string,
  // deno-lint-ignore no-explicit-any
  requests: any[],
  token: string,
) {
  if (!requests.length) return { replies: [] };
  return gFetch(
    `https://slides.googleapis.com/v1/presentations/${deckId}:batchUpdate`,
    token,
    { method: "POST", body: JSON.stringify({ requests }) },
  );
}

// Token -> request builders. Lifted verbatim from VS Pro.
function repText(find: string, replace: string, pageObjectIds?: string[]) {
  return {
    replaceAllText: {
      containsText: { text: find, matchCase: true },
      replaceText: replace ?? "",
      ...(pageObjectIds ? { pageObjectIds } : {}),
    },
  };
}

function fmtNum(n: number | null | undefined, fallback: string): string {
  if (n == null) return fallback;
  return Number(n).toLocaleString("en-US");
}

function fmtDate(live: string | null | undefined): string {
  if (!live) return "TBD";
  return live; // pass-through; producer-formatted strings already
}

// Slide element walking. Lifted verbatim from VS Pro.
function findImagesByAltText(
  // deno-lint-ignore no-explicit-any
  presentation: any,
  pageId: string,
): Record<string, string> {
  // deno-lint-ignore no-explicit-any
  const page = presentation.slides?.find((s: any) => s.objectId === pageId);
  const out: Record<string, string> = {};
  if (!page) return out;
  // deno-lint-ignore no-explicit-any
  const walk = (els: any[]) => {
    for (const el of els ?? []) {
      if (el.elementGroup?.children) walk(el.elementGroup.children);
      if (el.image) {
        const desc = el.description ?? el.title;
        if (desc) out[desc] = el.objectId;
      }
    }
  };
  walk(page.pageElements ?? []);
  return out;
}

function findTextElementsByContent(
  // deno-lint-ignore no-explicit-any
  presentation: any,
  pageId: string,
  needle: string,
): string[] {
  // deno-lint-ignore no-explicit-any
  const page = presentation.slides?.find((s: any) => s.objectId === pageId);
  const out: string[] = [];
  if (!page) return out;
  // deno-lint-ignore no-explicit-any
  const walk = (els: any[]) => {
    for (const el of els ?? []) {
      if (el.elementGroup?.children) walk(el.elementGroup.children);
      const runs = el.shape?.text?.textElements ?? [];
      for (const te of runs) {
        if (te.textRun?.content?.includes(needle)) {
          out.push(el.objectId);
          break;
        }
      }
    }
  };
  walk(page.pageElements ?? []);
  return out;
}

// ---------------------------------------------------------------------------
// Phase 5.12.0 HQ Venues push helpers.
//
// The retired `vs_candidate_venues_shortlist_sync` trigger matched HQ venues
// by `website_url` first, then by `LOWER(TRIM(name))+LOWER(TRIM(neighborhood))`.
// Phase 5.12.0 ladder is name-first (flexible normalization) with a
// cross-field conflict check on address/city, then address, then website.
// Name-first prioritizes the human-meaningful identifier; the cross-field
// check on the name step is what makes flexible matching safe across cities
// (a "The Plaza" name match between NYC and LA loses to the address or city
// conflict). The recipe trades typo-tolerance for explainability: it catches
// case / articles / suffixes / punctuation / "&" vs "and" / diacritics, but
// not single-character typos. A typo'd VS candidate falls through to address
// or website match, and absent both, lands as a new HQ venue. The cost of an
// occasional duplicate is low (admin merges manually); the cost of a
// false-positive merge is high (silently overwriting the wrong venue's link).
// Errs toward false-negatives.
//
// Phase 5.12.1: helpers extracted to `_shared/venueDedupe.ts` (second consumer
// is `vs-research-venues` Phase B cross-rail dedupe). `findVenueDedupeMatch`
// runs the full ladder in one call; this file imports it and the normalizers
// it needs locally (address + website for the post-INSERT pool push, below).

// HQ venue rows kept in memory for the dedupe scan. About-venue is read so
// the write-when-blank rule can compare against the existing string;
// newly-inserted rows are pushed back into the pool so a second VS candidate
// in the same batch can match against the just-created venue.
//
// Phase 5.12.13.1 amendment: features + total_sq_ft + capacity + website_url
// also read here so the matched-path UPDATE can extend the about_venue
// write-when-blank posture to these four canonical fields. The pool-side
// state is updated in-loop so a second candidate in the same batch
// matching against the same HQ row sees the most-recent value.
type HqVenueRow = {
  id: string;
  name: string;
  address: string | null;
  neighborhood: string | null;
  city: string | null;
  website_url: string | null;
  about_venue: string | null;
  features: string[] | null;
  total_sq_ft: number | null;
  capacity: number | null;
};

// Sequential HQ Venues push. Loops the pitched + include_in_deck candidate
// set, runs the name -> address -> website cascade against an in-memory pool
// of every HQ venue, INSERTs new rows for non-matches (carrying the
// producer-edited venue_overview into `venues.about_venue`), UPDATEs
// `about_venue` on matched rows only when the existing value is blank, and
// writes `linked_venue_id` on every candidate. Returns `{ failedVenueId,
// error }`; a non-null `failedVenueId` means the caller should fail the deck
// run via HQ_PUSH_FAILED. `venue_venue_types` join INSERT failures are
// decorative and warn-and-continue (do NOT populate `failedVenueId`).
async function pushVenuesToHq(
  sb: ReturnType<typeof createClient>,
  // deno-lint-ignore no-explicit-any
  candidates: any[],
  // deno-lint-ignore no-explicit-any
  scout: any,
  venueTypesCanonical: VenueTypesCanonical,
): Promise<{ failedVenueId: string | null; error: string | null }> {
  // 1. Load HQ venue pool. Small enough to scan in memory; cheaper than
  //    per-row normalized-LIKE queries against a few thousand rows.
  const { data: hqVenues, error: hqErr } = await sb
    .from("venues")
    .select(
      "id, name, address, neighborhood, city, website_url, about_venue, features, total_sq_ft, capacity",
    );
  if (hqErr) {
    return {
      failedVenueId: (candidates[0]?.id as string) ?? null,
      error: `venues SELECT failed: ${hqErr.message}`,
    };
  }
  const pool: HqVenueRow[] = ((hqVenues ?? []) as HqVenueRow[]).slice();

  // Phase 5.12.10: venueTypesCanonical comes from the consolidated
  // getVenueTypesCanonicalSet read at handler entry (per OQ #3). The
  // pre-5.12.10 ensureVenueTypesLoaded helper + lazy venueTypesLoaded
  // flag retired; .names feeds sanitizeMultiAgainst and .idByName feeds
  // the join inserts below.

  const scoutCity = (scout.city as string | null) ?? null;
  const scoutCreatedBy = (scout.created_by as string | null) ?? null;

  for (const cand of candidates) {
    const candId = cand.id as string;
    let linkedId: string | null = (cand.linked_venue_id as string | null) ?? null;
    let didLinkThisRun = false; // distinguishes match (or pre-link) from fresh insert

    if (!linkedId) {
      // Phase 5.12.3: points-based ladder via the shared helper (5.12.1
      // extraction). Cross-field VETO preserved on name FULL match +
      // (city differ OR address differ); locked website normalizer
      // contract; threshold 60. The candidate's city is the scout city
      // (`vs_candidate_venues` has no city column); the pool side already
      // carries its own `city` from the venues SELECT.
      const result = findVenueDedupeMatch(
        {
          name: cand.name as string | null,
          address: cand.address as string | null,
          city: scoutCity,
          website_url: cand.website_url as string | null,
        },
        pool,
      );
      const matchedId = result?.match.id ?? null;

      if (result && matchedId) {
        // Phase 5.12.3: write dedupe_meta alongside linked_venue_id on a
        // FRESH ladder-resolved match. Explicit NOT-written set: pre-linked
        // candidates (else branch below skips this block), hq_pool rows
        // (linked at insert time in vs-research-venues; never reach this
        // path), fresh-INSERT no-match rows (no match round happened).
        const dedupeMeta = {
          matched_venue_id: matchedId,
          matched_venue_name: (result.match.name as string | null) ?? "",
          score: result.score,
          reason: result.reason,
          matched_at: new Date().toISOString(),
        };
        const { error: linkErr } = await sb
          .from("vs_candidate_venues")
          .update({ linked_venue_id: matchedId, dedupe_meta: dedupeMeta })
          .eq("id", candId);
        if (linkErr) {
          return {
            failedVenueId: candId,
            error: `vs_candidate_venues link UPDATE failed: ${linkErr.message}`,
          };
        }
        linkedId = matchedId;
        didLinkThisRun = true;
      } else {
        // No match: INSERT new venues row carrying the producer's reviewed +
        // possibly edited paragraph into `about_venue`, the canonicalized
        // type tokens via venue_venue_types, and scout.created_by for
        // attribution. The INSERT-then-update-link split is one extra
        // statement per new venue but keeps the venues row complete on
        // first sight (activity_log trigger sees the full row).
        const features = Array.isArray(cand.key_features)
          ? (cand.key_features as string[])
          : [];
        const aboutValue = (cand.venue_overview as string | null) ?? null;
        const { data: ins, error: insErr } = await sb
          .from("venues")
          .insert({
            name: cand.name as string,
            address: (cand.address as string | null) ?? null,
            neighborhood: (cand.neighborhood as string | null) ?? null,
            city: scoutCity,
            website_url: (cand.website_url as string | null) ?? null,
            features,
            total_sq_ft: (cand.size_sq_ft as number | null) ?? null,
            capacity: (cand.capacity as number | null) ?? null,
            about_venue: aboutValue,
            created_by: scoutCreatedBy,
          })
          .select("id")
          .maybeSingle();
        if (insErr || !ins) {
          return {
            failedVenueId: candId,
            error: `venues INSERT failed: ${insErr?.message ?? "no row returned"}`,
          };
        }
        const newId = (ins as { id: string }).id;

        // venue_venue_types joins (Phase 5.12.10): sanitizeMultiAgainst
        // rejects tokens not in the runtime canonical set (returns null
        // when nothing resolves). On a non-null result, split back on
        // " / " and resolve each canonical name to its venue_types.id
        // via the consolidated idByName map from getVenueTypesCanonicalSet.
        // Tokens that don't resolve in idByName (only possible if the
        // canonical set changed between request entry and now; rare) are
        // silently skipped per the prior decorative posture.
        const rawType = (cand.venue_type as string | null) ?? "";
        const cleaned = sanitizeMultiAgainst(
          rawType,
          venueTypesCanonical.names,
        );
        if (cleaned) {
          for (const tn of cleaned.split(" / ")) {
            const vtId = venueTypesCanonical.idByName.get(tn.toLowerCase());
            if (!vtId) continue;
            const { error: joinErr } = await sb
              .from("venue_venue_types")
              .insert({ venue_id: newId, venue_type_id: vtId });
            if (joinErr) {
              // Decorative: warn-and-continue per § 8.2 / § 9.4.
              console.warn(
                `[vs-generate-deck] scout=${scout.id} venue=${candId} venue_venue_types insert skip for "${tn}": ${joinErr.message}`,
              );
            }
          }
        }

        // Push the new row into the in-memory pool so a second VS candidate
        // in this same batch can match against it (two VS rows pointing at
        // the same not-yet-existing HQ venue).
        pool.push({
          id: newId,
          name: cand.name as string,
          address: (cand.address as string | null) ?? null,
          neighborhood: (cand.neighborhood as string | null) ?? null,
          city: scoutCity,
          website_url: (cand.website_url as string | null) ?? null,
          about_venue: aboutValue,
          features,
          total_sq_ft: (cand.size_sq_ft as number | null) ?? null,
          capacity: (cand.capacity as number | null) ?? null,
        });

        // Link the candidate.
        const { error: linkErr } = await sb
          .from("vs_candidate_venues")
          .update({ linked_venue_id: newId })
          .eq("id", candId);
        if (linkErr) {
          return {
            failedVenueId: candId,
            error: `vs_candidate_venues link UPDATE after INSERT failed: ${linkErr.message}`,
          };
        }
        linkedId = newId;
        // Newly inserted: about_venue was populated in the INSERT, so no
        // additional UPDATE is needed below.
        didLinkThisRun = false;
      }
    } else {
      // linked_venue_id already set (a pre-5.12.0 shortlist-trigger run, or
      // a manual link). Still run the about_venue write-when-blank check
      // against the linked venue.
      didLinkThisRun = true;
    }

    // Write-when-blank rules (matched + pre-linked paths only; fresh INSERT
    // already populated every field). Producer-edited HQ values are
    // preserved; only HQ-side gaps get backfilled from VS enrichment.
    //
    // Pre-5.12.13.1 covered `about_venue` only. Phase 5.12.13.1 extends the
    // posture to `features`, `total_sq_ft`, `capacity`, `website_url` so
    // VS enrichment (Phase A, Phase B, Pass 1 backfill, vs-research-single-
    // venue) flows back to HQ when the canonical row was sparse. The pool-
    // side state is updated in-loop so a second candidate in the same batch
    // matching the same HQ row sees the most-recent value.
    if (linkedId && didLinkThisRun) {
      const linkedRow = pool.find((p) => p.id === linkedId);
      if (linkedRow) {
        const patch: {
          about_venue?: string;
          features?: string[];
          total_sq_ft?: number;
          capacity?: number;
          website_url?: string;
        } = {};

        const existingAbout = (linkedRow.about_venue ?? "").trim();
        if (existingAbout.length === 0) {
          const aboutNew =
            ((cand.venue_overview as string | null) ?? "").trim();
          if (aboutNew.length > 0) patch.about_venue = aboutNew;
        }

        const existingFeatures = Array.isArray(linkedRow.features)
          ? linkedRow.features
          : [];
        if (existingFeatures.length === 0) {
          const candFeatures = Array.isArray(cand.key_features)
            ? (cand.key_features as string[])
            : [];
          if (candFeatures.length > 0) patch.features = candFeatures;
        }

        if (linkedRow.total_sq_ft == null) {
          const candSqFt = (cand.size_sq_ft as number | null) ?? null;
          if (typeof candSqFt === "number") patch.total_sq_ft = candSqFt;
        }

        if (linkedRow.capacity == null) {
          const candCapacity = (cand.capacity as number | null) ?? null;
          if (typeof candCapacity === "number") patch.capacity = candCapacity;
        }

        const existingWebsite = (linkedRow.website_url ?? "").trim();
        if (existingWebsite.length === 0) {
          const candWebsite =
            ((cand.website_url as string | null) ?? "").trim();
          if (candWebsite.length > 0) patch.website_url = candWebsite;
        }

        if (Object.keys(patch).length > 0) {
          const { error: updErr } = await sb
            .from("venues")
            .update(patch)
            .eq("id", linkedId);
          if (updErr) {
            return {
              failedVenueId: candId,
              error: `venues write-when-blank UPDATE failed: ${updErr.message}`,
            };
          }
          if (patch.about_venue !== undefined) {
            linkedRow.about_venue = patch.about_venue;
          }
          if (patch.features !== undefined) {
            linkedRow.features = patch.features;
          }
          if (patch.total_sq_ft !== undefined) {
            linkedRow.total_sq_ft = patch.total_sq_ft;
          }
          if (patch.capacity !== undefined) {
            linkedRow.capacity = patch.capacity;
          }
          if (patch.website_url !== undefined) {
            linkedRow.website_url = patch.website_url;
          }
        }
      }
    }
  }

  return { failedVenueId: null, error: null };
}

// ---------------------------------------------------------------------------

// Main handler

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

  // failWithCode: write status='failed' + pipeline_error=`${code}: ${message}`.
  // The Generating page parses the code with a regex and routes to
  // /deck/error/<code>. current_step stays 'deck_prep' so Re-generate
  // from DeckPrep is the recovery path. Logs the underlying update error
  // if the write itself fails; the page would otherwise spin forever
  // because neither success nor failure state lands.
  //
  // Post-4.10.4 hot patch round 9: guard against overwriting a prior
  // success. .eq("current_step", "deck_prep") makes this update a CAS
  // that no-ops if another invocation has already advanced the scout to
  // 'completed' (success path flips current_step to 'completed' before
  // appending to generated_decks). Same guard pattern applied to
  // vs-research-venues + vs-compile-summaries writeFailure.
  async function failWithCode(code: ErrCode, message: string): Promise<void> {
    console.error(`[vs-generate-deck] scout=${scout_id} ${code}: ${message}`);
    const { error: updErr } = await sb
      .from("vs_scouts")
      .update({
        status: "failed",
        pipeline_error: `${code}: ${message}`,
        last_touched_at: new Date().toISOString(),
      })
      .eq("id", scout_id)
      .eq("current_step", "deck_prep");
    if (updErr) {
      console.error(
        `[vs-generate-deck] scout=${scout_id} failWithCode update FAILED: ${updErr.message}`,
      );
    }
  }

  // Load scout. Need brief fields for slide population, current_step +
  // brief_data for idempotency, generated_decks for version counter,
  // deck_order for venue sort, created_by for HQ push attribution
  // (Phase 5.12.0; populates `venues.created_by` on inserted rows).
  const { data: scout, error: scoutErr } = await sb
    .from("vs_scouts")
    .select(
      "id, client_name, event_name, city, live_dates, event_overview, brief_data, current_step, generated_decks, deck_order, created_by",
    )
    .eq("id", scout_id)
    .maybeSingle();

  if (scoutErr || !scout) {
    return jsonResponse(
      { error: `Could not load scout: ${scoutErr?.message ?? "not found"}` },
      404,
    );
  }

  // Idempotency: skip if already past the deck_prep step (page already
  // navigated away to /brief). Note: a successful prior generation flips
  // current_step to 'completed'; a failed one leaves it at 'deck_prep'.
  // So a Re-generate from a failed run sees current_step='deck_prep' and
  // proceeds normally.
  if (scout.current_step !== "deck_prep") {
    return jsonResponse({
      ok: true,
      scout_id,
      skipped: "not_in_deck_prep_state",
    });
  }

  // Phase 5.12.4.1: atomic kickoff acquisition via the new
  // `vs_deck_try_acquire_kickoff` RPC. The pre-5.12.4.1 inline path
  // (check `brief_data.deck_generation_started_at` against
  // IN_FLIGHT_GRACE_MS, then non-atomically UPDATE the timestamp) had the
  // same TOCTOU race Codex flagged on this surface: two near-simultaneous
  // invocations (producer double-clicking Generate) could both pass the
  // grace-window check before either committed its timestamp, then both
  // call pushVenuesToHq + INSERT duplicate `venues` rows (no UNIQUE
  // constraint on venue identity columns). Mirrors the Phase 5.12.1 fix
  // on vs-research-venues. The RPC uses pg_try_advisory_xact_lock + a
  // same-transaction read-and-write of brief_data.deck_generation_started_at
  // so the check + stamp are atomic. See the migration
  // `20260604120000_phase_5_12_4_1_deck_kickoff_lock.sql` for the RPC body.
  //
  // Grace seconds matches IN_FLIGHT_GRACE_MS / 1000 so the RPC's age check
  // matches the prior window's behavior (subsequent boots within the grace
  // window still no-op).
  const { data: acquired, error: kickoffErr } = await sb.rpc(
    "vs_deck_try_acquire_kickoff",
    {
      target_scout_id: scout_id,
      grace_seconds: Math.round(IN_FLIGHT_GRACE_MS / 1000),
    },
  );
  if (kickoffErr) {
    return jsonResponse(
      {
        error: `Could not acquire deck-generate kickoff: ${kickoffErr.message}`,
      },
      500,
    );
  }
  if (!acquired) {
    return jsonResponse({ ok: true, scout_id, skipped: "in_flight" });
  }
  // We hold the kickoff; the RPC stamped `brief_data.deck_generation_started_at`
  // and cleared `pipeline_error` in its own transaction.

  // Background work. Returns nothing; writes success / failure straight to
  // vs_scouts so the Generating page picks them up via Realtime.
  const work = async () => {
    // 180-second ceiling. Capture handle so we can clearTimeout on normal
    // completion; otherwise the orphaned timer keeps EdgeRuntime.waitUntil
    // alive for the full window.
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(
        () => reject(new Error(`timed out after ${WORK_TIMEOUT_MS / 1000}s`)),
        WORK_TIMEOUT_MS,
      );
    });

    const generateWork = async () => {
      // Audit pass 2 item 3: re-SELECT brief_data right at the top of
      // generateWork so the local copy reflects the kickoff RPC's
      // server-side stamp of deck_generation_started_at (the handler's
      // scout.brief_data was captured BEFORE the RPC ran and is missing
      // that field). Every progress_step write below merges against the
      // latest in-memory liveBriefData, then writes back, so the kickoff
      // timestamp + any other ad-hoc state survive intact.
      const { data: refreshedScout } = await sb
        .from("vs_scouts")
        .select("brief_data")
        .eq("id", scout_id)
        .maybeSingle();
      let liveBriefData =
        (refreshedScout?.brief_data ??
          (scout.brief_data ?? {})) as Record<string, unknown>;
      // Progress-step writer. UX-only signal driving the Generating page's
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
            `[vs-generate-deck] scout=${scout_id} progress_step=${key} write failed: ${progressErr.message}`,
          );
        }
      };

      // 1. Auth.
      let token: string;
      try {
        token = await getGoogleAccessToken(DRIVE_SLIDES_SCOPES);
      } catch (e) {
        await failWithCode(
          "AUTH_FAILED",
          `Service account auth failed: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
        return;
      }

      // 2. Load pitched + included venues.
      const { data: allVenues, error: vErr } = await sb
        .from("vs_candidate_venues")
        .select("*")
        .eq("scout_id", scout_id)
        .eq("pitched", true)
        .eq("include_in_deck", true);

      if (vErr) {
        await failWithCode(
          "UNKNOWN",
          `Could not load venues: ${vErr.message}`,
        );
        return;
      }

      if (!allVenues || allVenues.length === 0) {
        await failWithCode(
          "NO_VENUES_INCLUDED",
          "No venues are marked for the deck.",
        );
        return;
      }

      // Sort per scout.deck_order, anchoring unknown ids at the end by
      // created_at. Lifted verbatim from VS Pro.
      const order: string[] = Array.isArray(scout.deck_order)
        ? (scout.deck_order as string[])
        : [];
      const venues = [...allVenues].sort((a, b) => {
        const ai = order.indexOf(a.id as string);
        const bi = order.indexOf(b.id as string);
        if (ai === -1 && bi === -1) {
          return (a.created_at as string).localeCompare(b.created_at as string);
        }
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      });

      // 2.5. Validate non-mutating prerequisites BEFORE the HQ Venues
      // push (Phase 5.12.4.2, Codex round 2 finding 3). Pre-5.12.4.2
      // pushVenuesToHq ran immediately after the venues load + sort, which
      // meant a TEMPLATE_COPY_FAILED (env-var-missing) failure later in the
      // flow would leave HQ state mutated (new `venues` rows + linked_venue_
      // id writes) for a deck the producer was told was NOT generated.
      // Pulling the env-var existence check up here ensures the function
      // bails BEFORE any HQ writes if the Drive config is missing.
      // (The actual copyTemplate Drive call stays at step 4; only the env-
      // var presence check moves here.)
      const templateId = Deno.env.get("GOOGLE_TEMPLATE_FILE_ID");
      const folderId = Deno.env.get("GOOGLE_OUTPUT_FOLDER_ID");
      if (!templateId || !folderId) {
        await failWithCode(
          "TEMPLATE_COPY_FAILED",
          "GOOGLE_TEMPLATE_FILE_ID or GOOGLE_OUTPUT_FOLDER_ID is not configured.",
        );
        return;
      }

      // 2.6. HQ Venues push (Phase 5.12.0; reordered in 5.12.4.2).
      //
      // Runs after auth + venues load + config check but before any Drive /
      // Slides API mutation, so HQ state only mutates when all non-mutating
      // prerequisites have passed. Replaces the retired
      // `vs_candidate_venues_shortlist_sync` shortlist-time trigger; this is
      // the producer's confirmation moment (they have reviewed + edited the
      // venue_overview on DeckPrep and explicitly confirmed via the modal).
      //
      // Remaining HQ-mutated-but-deck-failed window (5.12.4.2 carry-forward
      // (a) in COWORK_SYNC): copyTemplate Drive API throw or Slides API
      // mutations throw AFTER this push. Both fail the deck via the
      // appropriate code; pushVenuesToHq is idempotent on linked_venue_id
      // so the producer's Re-Generate path re-runs without re-INSERTing.
      // A stronger guarantee (move HQ push after Slides success) is the
      // carry-forward.
      //
      // Error posture: per-venue link or insert failures fail the deck via
      // HQ_PUSH_FAILED. The Generating page parses the code and routes to
      // /deck/error/HQ_PUSH_FAILED. Only venue_venue_types join INSERT
      // failures are warn-and-continue (decorative).
      // Phase 5.12.10: consolidated runtime canonical venue-types set
      // (per OQ #3). Feeds both the sanitizeMultiAgainst guard AND the
      // idByName resolution for venue_venue_types join inserts in
      // pushVenuesToHq. Single SELECT per request.
      const venueTypesCanonical = await getVenueTypesCanonicalSet(
        sb,
        "vs-generate-deck",
      );
      const pushResult = await pushVenuesToHq(
        sb,
        venues,
        scout,
        venueTypesCanonical,
      );
      if (pushResult.failedVenueId) {
        await failWithCode(
          "HQ_PUSH_FAILED",
          `Could not link or insert HQ venue for candidate ${pushResult.failedVenueId}: ${pushResult.error}`,
        );
        return;
      }

      // 3. Load photos + build signed URLs (private bucket, 1-hour TTL).
      //    Signed-URL mint is parallel via Promise.all (~50-100ms per call;
      //    sequential against 8x4=32 photos would add real wall-clock).
      const venueIds = venues.map((v) => v.id as string);
      const { data: photos } = await sb
        .from("vs_venue_photos")
        .select("candidate_venue_id, slot, storage_path")
        .in("candidate_venue_id", venueIds)
        .order("slot", { ascending: true });

      const photoRows = (photos ?? []) as {
        candidate_venue_id: string;
        slot: number;
        storage_path: string;
      }[];
      const signedResults = await Promise.all(
        photoRows.map((p) =>
          sb.storage
            .from("vs_venue_photos")
            .createSignedUrl(p.storage_path, 3600),
        ),
      );
      const photosByVenue: Record<string, { slot: number; url: string }[]> = {};
      photoRows.forEach((p, i) => {
        const url = signedResults[i]?.data?.signedUrl;
        if (!url) return;
        (photosByVenue[p.candidate_venue_id] ||= []).push({
          slot: p.slot,
          url,
        });
      });

      await writeProgress("copying_template");

      // 4. Copy template into output folder. (Env-var existence check
      // moved up to step 2.5 in Phase 5.12.4.2 so HQ state doesn't mutate
      // on missing-config.)
      const existing = Array.isArray(scout.generated_decks)
        ? scout.generated_decks
        : [];
      const version = existing.length + 1;
      // Hyphen (not em dash) per voice rule.
      const deckName = `${scout.event_name ?? "Untitled"} - Venue Pitch Deck v${version}`;

      let deckId: string;
      try {
        deckId = await copyTemplate(templateId, deckName, folderId, token);
      } catch (e) {
        await failWithCode(
          "TEMPLATE_COPY_FAILED",
          `Could not copy template: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
        return;
      }

      await writeProgress("populating_slides");

      // 5. Slide population. The entire block lifts from VS Pro verbatim;
      //    any throw here gets caught and reported as SLIDES_API_FAILED.
      try {
        // Read presentation to learn page object IDs.
        // deno-lint-ignore no-explicit-any
        const pres: any = await getPresentation(deckId, token);
        // deno-lint-ignore no-explicit-any
        const slides: any[] = pres.slides ?? [];
        // Slides 1..N in order. Mirror template (verified via .pptx parse
        // 2026-05-12) has 6 front-matter slides: cover (1), project info
        // (2-3), event overview (4), section title (5), venue map with
        // 7-slot venue-name legend (6). Slide 7 = per-venue detail template,
        // slide 8 = per-venue floor plan template. Both per-venue templates
        // are duplicated once per venue and the originals deleted at the end.
        // 4.8.3-port shifted every index by one after first real producer
        // test revealed the VS Pro lift assumed 5 front-matter slides.
        const slide2Id = slides[1]?.objectId;
        const legendSlideId = slides[5]?.objectId;
        const templateSlide7 = slides[6]?.objectId;
        const templateSlide8 = slides[7]?.objectId;
        if (!slide2Id || !legendSlideId || !templateSlide7 || !templateSlide8) {
          throw new Error("Template missing slide 2, 6, 7, or 8");
        }

        // Slide 2 + 3 + 4 global text replacements (across the front matter).
        const guestCount =
          (scout.brief_data as Record<string, unknown> | null)
            ?.expected_guest_count ?? "TBD";
        const clientName = (scout.client_name as string) ?? "";
        const eventName = (scout.event_name as string) ?? "";
        const liveDate = fmtDate(scout.live_dates as string);
        const cityName = (scout.city as string) ?? "";
        // deno-lint-ignore no-explicit-any
        const globalReqs: any[] = [
          // Post-4.10.4 hot patch round 17: slide 2 ALL-CAPS pass MUST
          // run before the case-preserving global replaces below. The
          // Slides API processes requests within a batchUpdate in
          // order, so once these scoped replaces fire on slide 2 the
          // tokens are gone there and the subsequent global replaces
          // touch only the OTHER slides (which keep original casing).
          repText("{{client_name}}", clientName.toUpperCase(), [slide2Id]),
          repText("{{event_name}}", eventName.toUpperCase(), [slide2Id]),
          repText("{{event_live_date}}", liveDate.toUpperCase(), [slide2Id]),
          repText("{{event_location}}", cityName.toUpperCase(), [slide2Id]),
          // Case-preserving global replacements (cover all other slides
          // where these tokens appear -- title, project info pages,
          // etc.). On slide 2 the tokens are already gone after the
          // ALL-CAPS pass above, so these are no-ops there.
          repText("{{client_name}}", clientName),
          repText("{{event_name}}", eventName),
          repText("{{event_live_date}}", liveDate),
          repText("{{guest_count}}", String(guestCount)),
          repText("{{event_location}}", cityName),
          repText(
            "{{event_overview}}",
            (scout.event_overview as string) ?? "",
          ),
        ];

        // Slide 6 legend names (cap at 7). Empty slots intentionally left
        // blank per VS Pro line 354-374 comment ("leaving empty labels in
        // place is acceptable"). We replace with "" for slots beyond
        // venues.length so the template tokens disappear; we don't try to
        // delete the placeholder shapes. Scoped to legendSlideId so we don't
        // accidentally touch any other slide that re-uses the token.
        for (let i = 1; i <= 7; i++) {
          const v = venues[i - 1];
          globalReqs.push(
            repText(
              `{{venue_${i}_name}}`,
              v ? ((v.name as string) ?? "") : "",
              [legendSlideId],
            ),
          );
        }
        await batchUpdate(deckId, globalReqs, token);

        // Per-venue: duplicate slides 7 + 8 once per venue.
        // deno-lint-ignore no-explicit-any
        const dupReqs: any[] = [];
        venues.forEach((_, idx) => {
          const k7 = `dup7_${idx}`;
          const k8 = `dup8_${idx}`;
          dupReqs.push({
            duplicateObject: {
              objectId: templateSlide7,
              objectIds: { [templateSlide7]: k7 },
            },
          });
          dupReqs.push({
            duplicateObject: {
              objectId: templateSlide8,
              objectIds: { [templateSlide8]: k8 },
            },
          });
        });
        // deno-lint-ignore no-explicit-any
        const dupRes: any = await batchUpdate(deckId, dupReqs, token);
        // Map duplicate keys to returned object IDs (alternating 7/8).
        const slide7Ids: string[] = [];
        const slide8Ids: string[] = [];
        // deno-lint-ignore no-explicit-any
        dupRes.replies.forEach((r: any, i: number) => {
          const id = r.duplicateObject?.objectId;
          if (i % 2 === 0) slide7Ids.push(id);
          else slide8Ids.push(id);
        });

        // Audit pass 2 item 3: gate the inserting_photos progress write to
        // the first iteration's photo-insert block. Photos are inserted
        // per-venue within this loop (not a separate batch); emitting on
        // the first venue that has photos keeps the producer's step list
        // honest without spamming Realtime with one write per venue. If
        // no venue has photos the step stays on populating_slides through
        // to handoff, which is the truthful state.
        let emittedPhotos = false;

        // Per-venue scoped replacements + Website hyperlink + photo
        // replacement. {{venue_name}} gets ALL-CAPS treatment per producer
        // feedback 2026-05-12 (4.8.3-port); other tokens keep original
        // casing. Replacement is scoped to the duplicated detail slide s7
        // and floor-plan slide s8 for {{venue_name}} (both have it in the
        // header), and to s7 only for the rest of the body tokens.
        for (let i = 0; i < venues.length; i++) {
          const v = venues[i];
          const padded = String(i + 1).padStart(2, "0");
          const s7 = slide7Ids[i];
          const s8 = slide8Ids[i];
          const features = (
            (v.key_features as string[] | null | undefined) ?? []
          ).join("\n");

          // deno-lint-ignore no-explicit-any
          const reqs: any[] = [
            repText(
              "{{venue_name}}",
              ((v.name as string) ?? "").toUpperCase(),
              [s7, s8],
            ),
            repText("{{venue_id_padded}}", padded, [s7]),
            repText("{{venue_address}}", (v.address as string) ?? "", [s7]),
            repText(
              "{{venue_neighborhood}}",
              (v.neighborhood as string) ?? "",
              [s7],
            ),
            repText(
              "{{venue_overview}}",
              (v.venue_overview as string) ?? "",
              [s7],
            ),
            repText(
              "{{venue_size}}",
              fmtNum(v.size_sq_ft as number | null, "X,XXX"),
              [s7],
            ),
            repText(
              "{{venue_capacity}}",
              fmtNum(v.capacity as number | null, "XXXX"),
              [s7],
            ),
            repText("{{venue_features}}", features, [s7]),
            repText("{{venue_website}}", "Website", [s7]),
          ];
          await batchUpdate(deckId, reqs, token);

          // Hyperlink the "Website" text run on slide 7 (per-venue detail).
          if (v.website_url) {
            // deno-lint-ignore no-explicit-any
            const dupPres: any = await getPresentation(deckId, token);
            const els = findTextElementsByContent(dupPres, s7, "Website");
            for (const objId of els) {
              // deno-lint-ignore no-explicit-any
              const page = dupPres.slides.find(
                // deno-lint-ignore no-explicit-any
                (s: any) => s.objectId === s7,
              );
              // deno-lint-ignore no-explicit-any
              const findEl = (els: any[]): any => {
                for (const el of els ?? []) {
                  if (el.objectId === objId) return el;
                  if (el.elementGroup?.children) {
                    const r = findEl(el.elementGroup.children);
                    if (r) return r;
                  }
                }
                return null;
              };
              const el = findEl(page?.pageElements ?? []);
              const runs = el?.shape?.text?.textElements ?? [];
              let cursor = 0;
              let start = -1;
              let end = -1;
              for (const te of runs) {
                const c = te.textRun?.content;
                if (c) {
                  const idx = c.indexOf("Website");
                  if (idx >= 0) {
                    start = (te.startIndex ?? cursor) + idx;
                    end = start + "Website".length;
                    break;
                  }
                  cursor = (te.startIndex ?? cursor) + c.length;
                }
              }
              if (start >= 0) {
                try {
                  await batchUpdate(
                    deckId,
                    [
                      {
                        updateTextStyle: {
                          objectId: objId,
                          textRange: {
                            type: "FIXED_RANGE",
                            startIndex: start,
                            endIndex: end,
                          },
                          style: { link: { url: v.website_url as string } },
                          fields: "link",
                        },
                      },
                    ],
                    token,
                  );
                } catch (e) {
                  // VS Pro tolerance: link is best-effort. Skip on failure
                  // without flipping the run to SLIDES_API_FAILED.
                  console.warn(
                    `[vs-generate-deck] scout=${scout_id} venue=${v.id} link skip:`,
                    e,
                  );
                }
              }
            }
          }

          // Replace photos by alt text img_1..img_4 on slide 7
          // (per-venue detail).
          const venuePhotos = photosByVenue[v.id as string] ?? [];
          if (venuePhotos.length) {
            if (!emittedPhotos) {
              emittedPhotos = true;
              await writeProgress("inserting_photos");
            }
            // deno-lint-ignore no-explicit-any
            const dupPres: any = await getPresentation(deckId, token);
            const imgMap = findImagesByAltText(dupPres, s7);
            // deno-lint-ignore no-explicit-any
            const imgReqs: any[] = [];
            for (const ph of venuePhotos) {
              const target = imgMap[`img_${ph.slot}`];
              if (target) {
                imgReqs.push({
                  replaceImage: {
                    imageObjectId: target,
                    url: ph.url,
                    // Phase 5.12.11: CENTER_CROP fills the cell; CENTER_INSIDE letterboxed photos that did not match the cell aspect ratio.
                    imageReplaceMethod: "CENTER_CROP",
                  },
                });
              }
            }
            if (imgReqs.length) await batchUpdate(deckId, imgReqs, token);
          }
        }

        // Post-4.10.4 hot patch round 19: reorder duplicates + delete
        // originals in a single batchUpdate.
        //
        // duplicateObject inserts the duplicate IMMEDIATELY AFTER its
        // source. Duplicating slide 7 N times pushes each new duplicate
        // BETWEEN the source and the prior duplicate, landing them in
        // REVERSE order. Original slides 7 and 8 are duplicated
        // independently, so the post-duplicate state is:
        //   [front0..5, ts7, dup7_N-1..dup7_0, ts8, dup8_N-1..dup8_0]
        // After deleting templates ts7 + ts8 (still in this batch):
        //   [front0..5, dup7_N-1..dup7_0, dup8_N-1..dup8_0]
        // Producer needs interleaved-forward:
        //   [front0..5, dup7_0, dup8_0, dup7_1, dup8_1, ..., dup7_N-1, dup8_N-1]
        //
        // Round-17 attempted this with ONE updateSlidesPosition listing
        // every duplicate in the desired order. The Slides API rejected
        // that with INVALID_ARGUMENT: "The slides should be in
        // presentation order, with no duplicates." The slideObjectIds
        // list MUST match current presentation order; you can't use
        // updateSlidesPosition to reorder, only to relocate a contiguous
        // already-ordered block.
        //
        // Round-19 fix: emit ONE updateSlidesPosition per slide. A
        // single-slide list is trivially in order, satisfying the
        // constraint. Per-slide insertionIndex is interpreted in the
        // post-removal state (per API docs), so for slide K-th in the
        // desired final order, insertionIndex = FRONT_MATTER_SLIDES + K
        // works regardless of where the slide currently sits. Slides
        // API processes the requests in order within the batchUpdate
        // so each subsequent move sees the layout from the previous
        // move's result.
        //
        // Order matters: delete ts7 + ts8 FIRST, then the per-slide
        // moves operate on the cleaner post-delete state. The dup IDs
        // are stable across the template deletes (they're independent
        // slides, not children of the templates).
        // deno-lint-ignore no-explicit-any
        const finalizeReqs: any[] = [];
        finalizeReqs.push({ deleteObject: { objectId: templateSlide7 } });
        finalizeReqs.push({ deleteObject: { objectId: templateSlide8 } });
        if (venues.length > 0) {
          let targetIdx = FRONT_MATTER_SLIDES;
          for (let i = 0; i < venues.length; i++) {
            // Venue (i+1) detail slide -> position targetIdx.
            finalizeReqs.push({
              updateSlidesPosition: {
                slideObjectIds: [slide7Ids[i]],
                insertionIndex: targetIdx,
              },
            });
            targetIdx += 1;
            // Venue (i+1) floor plan slide -> position targetIdx.
            finalizeReqs.push({
              updateSlidesPosition: {
                slideObjectIds: [slide8Ids[i]],
                insertionIndex: targetIdx,
              },
            });
            targetIdx += 1;
          }
        }
        await batchUpdate(deckId, finalizeReqs, token);

        // Final slide count.
        // deno-lint-ignore no-explicit-any
        const finalPres: any = await getPresentation(deckId, token);
        const slideCount = (finalPres.slides ?? []).length;

        await writeProgress("finalizing");

        // 6. Append metadata + flip current_step='completed' + status='complete'.
        //    Final write triggers the Generating page's Realtime nav effect.
        const meta = {
          deck_id: deckId,
          deck_name: deckName,
          version,
          generated_at: new Date().toISOString(),
          venue_count: venues.length,
          slide_count: slideCount,
          edit_url: `https://docs.google.com/presentation/d/${deckId}/edit`,
          embed_url: `https://docs.google.com/presentation/d/${deckId}/embed`,
        };

        // Re-read generated_decks right before the append. Defends against
        // a stale-snapshot clobber if a prior run completed between the
        // initial scout load (line ~263, pre-waitUntil) and this final
        // write. Narrow window in practice (current_step + IN_FLIGHT_GRACE
        // guards both fire upstream) but the re-read is cheap and the
        // alternative would orphan a prior deck entry.
        const { data: fresh } = await sb
          .from("vs_scouts")
          .select("generated_decks")
          .eq("id", scout_id)
          .maybeSingle();
        const freshExisting = Array.isArray(fresh?.generated_decks)
          ? (fresh!.generated_decks as unknown[])
          : existing;

        // Phase 4.10.6-port: CAS guard on the success path mirrors the
        // failWithCode CAS guard (round 9). Two parallel invocations
        // that both succeed would otherwise both append to
        // generated_decks here, with a TOCTOU window between the
        // freshExisting re-read and the UPDATE. The
        // .eq("current_step", "deck_prep") filter makes the success
        // UPDATE a CAS that no-ops when another invocation has already
        // advanced current_step to 'completed' -- only the first-to-
        // complete wins the append.
        //
        // Phase 5.12.4.2 (Codex round 2 finding 2): added
        // `.is("pipeline_error", null)` so a late-resolving generateWork
        // can't overwrite a failWithCode stamp. failWithCode stamps a
        // non-null pipeline_error but leaves current_step='deck_prep'
        // (so Re-Generate from the failed run sees the expected step);
        // the pre-5.12.4.2 success CAS on current_step alone would
        // therefore PASS even after a failure landed, overwriting it
        // with current_step='completed'. The new pipeline_error CAS
        // closes that gap. Kickoff RPC clears pipeline_error at
        // acquisition so the happy path always sees NULL here.
        const { error: scoutUpdErr, count: scoutUpdCount } = await sb
          .from("vs_scouts")
          .update({
            generated_decks: [...freshExisting, meta],
            current_step: "completed",
            status: "complete",
            pipeline_error: null,
            last_touched_at: new Date().toISOString(),
          }, { count: "exact" })
          .eq("id", scout_id)
          .eq("current_step", "deck_prep")
          .is("pipeline_error", null);

        if (scoutUpdErr) {
          // Final write failed AFTER the deck landed in Drive. Surface as
          // UNKNOWN; producer can recover by re-generating (the in-Drive
          // deck is orphaned but doesn't block the workflow).
          throw new Error(
            `Final scout update failed: ${scoutUpdErr.message}`,
          );
        }
        if (scoutUpdCount === 0) {
          // CAS lost. Either (a) another invocation completed first +
          // advanced current_step to 'completed', or (b) Phase 5.12.4.2
          // failure-stamp race: failWithCode already stamped a non-null
          // pipeline_error from a timeout / Slides error path while this
          // path was still building meta. Either way the in-Drive deck
          // for THIS invocation is orphaned; the producer-facing state
          // reflects the winning state. Log but don't fail.
          console.warn(
            `[vs-generate-deck] scout=${scout_id} success CAS lost (either parallel-success race or failWithCode already stamped failure). deck_id=${deckId} orphaned.`,
          );
        }

        console.log(
          `[vs-generate-deck] scout=${scout_id} deck_id=${deckId} version=${version} venue_count=${venues.length} slide_count=${slideCount}`,
        );
      } catch (e) {
        await failWithCode(
          "SLIDES_API_FAILED",
          `Slides API error: ${e instanceof Error ? e.message : String(e)}`,
        );
        return;
      }
    };

    try {
      await Promise.race([generateWork(), timeoutPromise]);
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    } catch (e) {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      const msg = e instanceof Error ? e.message : String(e);
      // Outer catch covers timeoutPromise rejection + any throw above the
      // SLIDES_API_FAILED scope (e.g., venue query catastrophic failure).
      // failWithCode is idempotent on the row so even if generateWork
      // already wrote, the latest message wins; that's fine.
      await failWithCode("UNKNOWN", msg);
    }
  };

  // EdgeRuntime.waitUntil keeps the function alive past the response so
  // the Slides work can finish in the background. Available on Supabase
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
