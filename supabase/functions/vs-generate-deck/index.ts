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
// Memory rules in force:
//   - feedback_port_fidelity: match VS Pro layout/data exactly except for
//     the locked deltas above. The slide-population code stays 1:1 with VS Pro.
//   - No callClaude usage; no model-pin concerns.
//   - feedback_tool_choice_collapse does not apply (no Claude tool calls).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getGoogleAccessToken } from "../_shared/googleServiceAccount.ts";

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
  | "UNKNOWN";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Skip-the-kickoff window. Matches 4.5 / 4.7.2.
const IN_FLIGHT_GRACE_MS = 90_000;

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
  // deck_order for venue sort.
  const { data: scout, error: scoutErr } = await sb
    .from("vs_scouts")
    .select(
      "id, client_name, event_name, city, live_dates, event_overview, brief_data, current_step, generated_decks, deck_order",
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
  // navigated away to /brief) or if a kickoff fired recently and is still
  // running. Note: a successful prior generation flips current_step to
  // 'completed'; a failed one leaves it at 'deck_prep'. So a Re-generate
  // from a failed run sees current_step='deck_prep' and proceeds normally.
  if (scout.current_step !== "deck_prep") {
    return jsonResponse({
      ok: true,
      scout_id,
      skipped: "not_in_deck_prep_state",
    });
  }
  const briefData = (scout.brief_data ?? {}) as Record<string, unknown>;
  const startedAtRaw = briefData.deck_generation_started_at;
  if (typeof startedAtRaw === "string") {
    const ageMs = Date.now() - new Date(startedAtRaw).getTime();
    if (Number.isFinite(ageMs) && ageMs < IN_FLIGHT_GRACE_MS) {
      return jsonResponse({ ok: true, scout_id, skipped: "in_flight" });
    }
  }

  // Record kickoff timestamp + clear prior error so a retry from a failed
  // run starts clean.
  await sb
    .from("vs_scouts")
    .update({
      brief_data: {
        ...briefData,
        deck_generation_started_at: new Date().toISOString(),
      },
      pipeline_error: null,
    })
    .eq("id", scout_id);

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

      // 4. Copy template into output folder.
      const templateId = Deno.env.get("GOOGLE_TEMPLATE_FILE_ID");
      const folderId = Deno.env.get("GOOGLE_OUTPUT_FOLDER_ID");
      if (!templateId || !folderId) {
        await failWithCode(
          "TEMPLATE_COPY_FAILED",
          "GOOGLE_TEMPLATE_FILE_ID or GOOGLE_OUTPUT_FOLDER_ID is not configured.",
        );
        return;
      }
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
                    imageReplaceMethod: "CENTER_INSIDE",
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
          .eq("current_step", "deck_prep");

        if (scoutUpdErr) {
          // Final write failed AFTER the deck landed in Drive. Surface as
          // UNKNOWN; producer can recover by re-generating (the in-Drive
          // deck is orphaned but doesn't block the workflow).
          throw new Error(
            `Final scout update failed: ${scoutUpdErr.message}`,
          );
        }
        if (scoutUpdCount === 0) {
          // CAS lost: another invocation completed first. The in-Drive
          // deck is orphaned; the producer-facing state reflects the
          // other invocation's deck. Log but don't fail (not a real
          // error from the producer's POV; they get a working deck).
          console.warn(
            `[vs-generate-deck] scout=${scout_id} success CAS lost; another invocation already completed. deck_id=${deckId} orphaned.`,
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
