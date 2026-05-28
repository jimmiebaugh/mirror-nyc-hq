// vs-generate-brief-overview (Phase 4 Revision - Intake; v3 = Phase 5.1 NIT pickup, canonical-value hash)
//
// Generates the Event Overview paragraph for a Venue Scout brief.
//
// Trigger model (pass 3): the primary trigger is the Submit Brief click in
// BriefVenue.tsx, which invokes this only when the overview is missing or the
// brief fields that drive it changed since the last generation. BriefReport's
// empty-state Generate button and Regenerate link invoke it unconditionally.
//
// Signature:
//   POST { scout_id: string }
//     -> { event_overview: string, overview_source_hash: string }
//
// Flow:
//   1. Validate scout_id (UUID).
//   2. Load the scout's brief fields via the service-role client.
//   3. Build a context block from the named columns + the Phase 4 Revision
//      brief_data keys and ask Claude (via callClaude('venue_scout')) for a
//      3-5 sentence overview in Mirror's voice.
//   4. Compute overview_source_hash from the same brief fields. MUST stay in
//      lockstep with briefForm.ts computeOverviewSourceHash (same field set,
//      same canonical form, same object key order).
//   5. Atomically write event_overview + brief_data.overview_source_hash back
//      to the scout in a single UPDATE, return both.
//
// Failure mode: if Claude errors or returns empty, fall back to a
// deterministic stub and persist that instead, so the producer always lands
// on a non-empty, editable overview. The hash is written regardless so the
// caller can record that this overview reflects the current brief fields.
//
// Auth posture: verify_jwt = true (default). User-invoked synchronous from
// the Brief surface; no self-invoke, no internal-secret path. Matches the
// vs-parse-brief sibling pattern. Spend tracking flows through
// callClaude('venue_scout').

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callClaude } from "../_shared/anthropic.ts";
import { formatBudgetForPrompt } from "../_shared/formatBudget.ts";

// User-invoked synchronous only; no internal-secret path. Don't advertise
// x-internal-secret to the browser preflight.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Phase 5.12.13.4: SYSTEM_PROMPT rewrites from a short voice-rule list to a
// <voice> + <must_not> + <rules> + <examples> structure. Hierarchy inverts
// from "stay faithful to facts" to "creative extrapolation is welcome";
// hard-fact lockdown moves to <must_not>. Three anchor overviews: A-List
// Salon + Vaseline Oasis (Mirror past-deck references, em dashes stripped
// to match the <rules> block; the few-shot cannot model what the rules
// forbid) + The Art of Cooper Flagg (post-smoke addition from Jimmie's
// manual edit of a generated overview; chosen because it models varied
// sentence openings + active verbs + a clean atmospheric close on a
// single-activation shape, addressing the template-rhythm drift the first
// smoke surfaced). <voice> beats reframe from a checklist to illustrative
// ("combine, skip, or fold as the brief calls for") + <rules> gain three
// post-smoke lines (active verbs with stop list, vary sentence openings,
// closing-one-clean-clause) targeting the same drift.
const SYSTEM_PROMPT = [
  "You write the Event Overview paragraph for a venue-sourcing brief at Mirror NYC, an experiential agency that produces brand activations, launches, and pop-ups for fashion, beauty, and lifestyle clients.",
  "",
  "<voice>",
  "Write in Mirror's producer voice: warm, evocative, present-tense, scene-setting, with a sense of place. The reader is the producer who will source venues for this brief. The overview frames what the activation is, who it's for, and the world it lives in.",
  "",
  "Beats that often show up in strong overviews. You do not need to hit all of them, and the order is yours. Combine, skip, or fold beats together as the brief calls for. The list is illustrative, not a checklist.",
  "- Concept-first framing somewhere in the opener. Lead with what the activation IS; the brand name appears in service of the concept, not as the headline.",
  "- Why this exists for the brand. Strategic intent, or what the activation is launching or celebrating.",
  "- A hero beat. The centerpiece moment at the center of the experience.",
  "- A guest-experience verb beat. What guests do, choose, or receive.",
  "- Scene-setting via metaphor or branded vocabulary. Pull the activation's invented language (themed neighborhoods, hashtags, conceptual pairings) through as if it's already part of the world.",
  "",
  "Creative extrapolation is welcome. Additive inferences that build imagery and aesthetic are part of the voice when they align with the vibe tags, scope, and brief in general. Use sensory and material language (light, texture, scale, material, energy) where the brief allows.",
  "",
  "Name the audience with the specificity the brief gives. If the brief says 'GenZennial women,' write 'GenZennial women,' not 'consumers' or 'guests.'",
  "</voice>",
  "",
  "<must_not>",
  "Do NOT invent hard facts. Client names, event names, dates, venues, neighborhoods, budgets, and headcount come from the brief or they don't appear. Imagery supports the scene; the bulk of the overview stays the activation, the audience, and the world it lives in. Don't let extrapolation become the point.",
  "</must_not>",
  "",
  "<rules>",
  "- One paragraph. 3 to 5 sentences. No bullet points, no headings, no preamble.",
  "- Present tense.",
  "- Use active verbs. Lean away from stative or arrival constructions ('is a', 'arrives as', 'holds', 'sits within', 'exists as'). Subjects act on the page; let the activation, the guests, and the brand DO things.",
  "- Vary sentence openings and structure. Not every sentence needs to start with the concept name or a subject-verb construction. Lead a sentence with a participial phrase, a temporal frame, or an audience cue when the rhythm calls for it.",
  "- Closing sentence is one clean clause. Avoid comma-chained pile-ups of appositional descriptors (e.g., 'X, Y, Z, premium without spectacle, nostalgic in texture but current in energy').",
  "- No em dashes anywhere. Use commas, periods, or parentheses.",
  "- No filler affirmations or hype ('exciting', 'amazing', 'world-class', 'unparalleled', 'we're thrilled').",
  "- Return ONLY the overview paragraph. No quotes, no labels, no headers.",
  "</rules>",
  "",
  "<examples>",
  "Three reference overviews. They demonstrate the voice; your output should sit in the same tonal range. The examples vary in opening structure (concept-first / participial-phrase / temporal-frame) on purpose; match the voice, not the surface shape.",
  "",
  "<example>",
  "To turbocharge the new A-List Collection and to create a new styling occasion, we are daring GenZennial women to leave their beds and take on a night out this summer into fall. We'll invite them to kick off the night at our mobile salon, designed to turn heads and turn getting ready into the main event. A curated hotspot, it's not just where you get ready. It's where the night begins.",
  "</example>",
  "",
  "<example>",
  "An immersive beauty experience brings the duality of Glowasis and Slowasis to life at the Vaseline Oasis in celebration of Vaseline's new Gel Oils and upgraded Core Lotions. Guests choose their vibe, #GlowLifeGirl or #SlowLifeGirl, then follow their path to a personalized skincare sanctuary. The journey invites content creation, connection, and glowing skin, all set within a sensorial, side-by-side world of Glow vs. Slow.",
  "</example>",
  "",
  "<example>",
  "Anchored in the weeks surrounding the 2025-2026 season tip-off, The Art of Cooper Flagg is both a product launch and an immersive portrait that places Cooper Flagg's story in a gallery-forward pop-up that frames New Balance's newest NBA chapter through the lens of the athlete who defines it. His discipline, craft, and quiet intensity as a student of the game center the curated, gallery-style environment where sneakers and apparel are displayed with the weight of collected works. NBA and Mavericks fans and sneaker enthusiasts alike move through the space on their own terms, discovering product, storytelling, and photo moments that feel authored rather than assembled. The space exemplifies quiet confidence through the visual language of a career in its first chapter, yet already worth framing.",
  "</example>",
  "</examples>",
].join("\n");

function asLine(label: string, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const t = value.trim();
    return t ? `${label}: ${t}` : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return `${label}: ${value}`;
  }
  if (Array.isArray(value)) {
    const items = value
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      .map((v) => v.trim());
    return items.length > 0 ? `${label}: ${items.join(", ")}` : null;
  }
  return null;
}

// Deterministic fallback overview (spec § 6).
function buildStub(scout: {
  event_name: string | null;
  client_name: string | null;
  city: string | null;
  live_dates: string | null;
}): string {
  const event = (scout.event_name ?? "").trim() || "Event";
  const client = (scout.client_name ?? "").trim() || "the client";
  const city = (scout.city ?? "").trim();
  const live = (scout.live_dates ?? "").trim();
  const where = city ? ` in ${city}` : "";
  const when = live ? ` Live ${live}.` : "";
  return `${event} for ${client}${where}.${when}`;
}

// --- overview_source_hash (pass 3, v3) ---------------------------------------
// Reproduce src/lib/venue-scout/briefForm.ts computeOverviewSourceHash exactly.
// The client builds its input from a BriefFormState; the server builds the
// same canonical object from the persisted scout row (which is exactly what
// toUpdate(form) wrote, so the array/scalar values match byte-for-byte).
// Phase 5.1 NIT pickup: budget + expected_guest_count are hashed in their
// canonical numeric form (matching toUpdate output) so a producer typing
// `750000` (no `$`/commas) hashes the same as a producer typing `$750,000`.
// Arrays are coerced to string[] but NOT trimmed/de-emptied: the client
// helper hashes form arrays as-is, so the server must too. If the overview
// prompt's input set changes, update both sides in lockstep.
// Phase 5.12.5: extended to coerce a single string into a single-element
// array. The § 5 backfill migration retires legacy-string-shape live values,
// so the runtime sees array shape end-to-end after deploy. The string-
// coercion branch stays as a defensive layer against future hand-edits to
// brief_data (SQL console, manual JSON injection); mirrors normalizeTagArray
// on the client side so both edges stay in lockstep on shape coercion
// semantics.
function hashAsStringArray(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v.filter((x): x is string => typeof x === "string");
  }
  if (typeof v === "string" && v.length > 0) {
    return [v];
  }
  return [];
}
function hashAsNumberOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function hashAsString(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

async function computeOverviewSourceHash(
  scout: {
    client_name: string | null;
    event_name: string | null;
    live_dates: string | null;
    city: string | null;
    budget: number | null;
  },
  briefData: Record<string, unknown>,
): Promise<string> {
  const normalize = (v: string) => v.trim() || null;
  // Object key order MUST match briefForm.ts -- JSON.stringify is order-sensitive.
  const source = {
    client_name: normalize(scout.client_name ?? ""),
    event_name: normalize(scout.event_name ?? ""),
    live_dates: normalize(scout.live_dates ?? ""),
    city: normalize(scout.city ?? ""),
    budget: hashAsNumberOrNull(scout.budget),
    expected_guest_count: hashAsNumberOrNull(briefData.expected_guest_count),
    activations_count: hashAsNumberOrNull(briefData.activations_count),
    objectives: hashAsStringArray(briefData.objectives).sort(),
    // Phase 5.12.5: target_audience + vibe_aesthetic flipped from string to
    // string[]; hash uses sorted array shape, mirroring objectives /
    // target_neighborhoods / venue_types / ideal_features. Object key order
    // stays identical to the client-side hash in src/lib/venue-scout/briefForm.ts.
    target_audience: hashAsStringArray(briefData.target_audience).sort(),
    vibe_aesthetic: hashAsStringArray(briefData.vibe_aesthetic).sort(),
    target_neighborhoods: hashAsStringArray(
      briefData.target_neighborhoods,
    ).sort(),
    venue_types: hashAsStringArray(briefData.venue_types).sort(),
    ideal_features: hashAsStringArray(briefData.ideal_features).sort(),
  };
  const json = JSON.stringify(source);
  const buf = new TextEncoder().encode(json);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
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

  const { data: scout, error: scoutErr } = await sb
    .from("vs_scouts")
    .select(
      "id, client_name, event_name, live_dates, city, budget, brief_data",
    )
    .eq("id", scout_id)
    .maybeSingle();

  if (scoutErr || !scout) {
    return jsonResponse(
      { error: `Could not load scout: ${scoutErr?.message ?? "not found"}` },
      404,
    );
  }

  const briefData = (scout.brief_data ?? {}) as Record<string, unknown>;

  // Phase 5.12.13.4: user message reshapes from a flat key/value dump to
  // three labeled blocks. BRIEF FACTS keeps key/value for hard-fact fields
  // where precision matters (the <must_not> block forbids inventing these).
  // BRIEF CONTEXT renders voice-driving arrays as paragraph segments the
  // model can weave into prose. PRODUCER NOTES surfaces free-text
  // `additional_notes` as its own discrete block.
  const factsLines = [
    asLine("Client", scout.client_name),
    asLine("Event", scout.event_name),
    asLine("City", scout.city),
    asLine("Live dates", scout.live_dates),
    // Phase 5.12.5 (Edge #2 resolve): pure-JS comma formatter removes the
    // V8/ICU coupling on the prompt display string.
    typeof scout.budget === "number"
      ? (() => {
          const formatted = formatBudgetForPrompt(scout.budget);
          return formatted ? `Budget: ${formatted}` : null;
        })()
      : null,
    asLine("Expected guest count", briefData.expected_guest_count),
    asLine("Activations / spaces", briefData.activations_count),
  ].filter((l): l is string => l !== null);

  const contextSegments: string[] = [];
  const objectives = briefData.objectives as string[] | undefined;
  const audience = briefData.target_audience as string[] | undefined;
  const vibe = briefData.vibe_aesthetic as string[] | undefined;
  const neighborhoods = briefData.target_neighborhoods as string[] | undefined;
  const venueTypes = briefData.venue_types as string[] | undefined;
  const features = briefData.ideal_features as string[] | undefined;

  if (objectives?.length) contextSegments.push(`The activation aims for ${objectives.join(", ")}`);
  if (audience?.length) contextSegments.push(`The audience is ${audience.join(", ")}`);
  if (vibe?.length) contextSegments.push(`The vibe is ${vibe.join(", ")}`);
  if (neighborhoods?.length) contextSegments.push(`Target neighborhoods: ${neighborhoods.join(", ")}`);
  if (venueTypes?.length) contextSegments.push(`Venue types under consideration: ${venueTypes.join(", ")}`);
  if (features?.length) contextSegments.push(`Ideal features: ${features.join(", ")}`);

  const additionalNotes =
    typeof briefData.additional_notes === "string" && briefData.additional_notes.trim()
      ? briefData.additional_notes.trim()
      : null;

  const stub = buildStub(scout);

  let overview = "";
  if (factsLines.length > 0 || contextSegments.length > 0 || additionalNotes) {
    const userMsg =
      `BRIEF FACTS\n${factsLines.join("\n")}\n\n` +
      (contextSegments.length > 0 ? `BRIEF CONTEXT\n${contextSegments.join(". ")}.\n\n` : "") +
      (additionalNotes ? `PRODUCER NOTES\n${additionalNotes}\n\n` : "") +
      `Write the Event Overview paragraph.`;
    const result = await callClaude(
      "venue_scout",
      [{ role: "user", content: userMsg }],
      {
        system: SYSTEM_PROMPT,
        max_tokens: 600,
        fn_name: "vs-generate-brief-overview",
        scout_id,
      },
    );
    if (result.ok) {
      overview = result.text.trim();
    } else {
      console.warn(
        `[vs-generate-brief-overview] scout=${scout_id} Claude call failed: ${result.error}`,
      );
    }
  }

  // Fall back to the deterministic stub on a Claude failure or empty result.
  if (!overview) {
    overview = stub;
  }

  // Compute the source hash and write it alongside the overview in a single
  // UPDATE. Merge into the existing brief_data jsonb so the other keys
  // (uploaded_files, idempotency flags, legacy notes) are preserved.
  const overviewSourceHash = await computeOverviewSourceHash(scout, briefData);
  const updatedBriefData = {
    ...briefData,
    overview_source_hash: overviewSourceHash,
  };

  const { error: updErr } = await sb
    .from("vs_scouts")
    .update({
      event_overview: overview,
      brief_data: updatedBriefData,
      last_touched_at: new Date().toISOString(),
    })
    .eq("id", scout_id);

  if (updErr) {
    return jsonResponse(
      { error: `Could not save overview: ${updErr.message}` },
      500,
    );
  }

  return jsonResponse({
    event_overview: overview,
    overview_source_hash: overviewSourceHash,
  });
});
