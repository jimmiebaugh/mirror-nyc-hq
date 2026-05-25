// vs-parse-brief (Phase 4.3-port rebuild; Phase 4 Revision field widen; Phase 5.1 v17 comma-split objective sanitizer; Phase 5.12.5 array-shape audience/vibe + canonical venue_types filter + re-parse guard)
//
// Replaces the failed-attempt vs-parse-brief in the deployed-function slot.
// Different signature, different shape, different storage target -- but
// occupies the same name so cutover doesn't need a separate delete step.
//
// Phase 4 Revision - Intake: the brief intake form grew venue-side fields, so
// the submit_brief tool schema + sanitizer widen to return them when the PDF
// mentions them (install/strike dates, activations count, objectives, target
// audience, vibe/aesthetic, target neighborhoods, venue types, ideal
// features). Producer judgment calls (priority toggles, strict-neighborhood
// flag, square-footage sliders) are intentionally NOT parsed.
//
// Phase 5.12.5: tighten output shapes on five fronts:
//   1. target_audience + vibe_aesthetic flip from string to string[] (tag-
//      array shape matching objectives / target_neighborhoods / venue_types /
//      ideal_features); sanitizeAudienceTags shares the parameterized
//      sanitizeTagArray body.
//   2. venue_types pins to the canonical list (CANONICAL_TYPES from
//      _shared/venueTypes.ts); non-canonical entries drop server-side via
//      sanitizeVenueTypesAgainstCanonical (5.12.10 swaps to DB-driven).
//   3. ideal_features tightens to 1-4 word tag shape via sanitizeFeatureTags
//      (40-char per-item cap, same split / dedupe shape as sanitizeObjectives).
//   4. Re-parse guard: after sanitize, SELECT vs_scouts.client_name +
//      event_name and drop those fields from parsed_fields when the scout
//      already has a non-empty value. Producer is source of truth.
//   5. objectives schema description already correct (Phase 5.1 NIT pickup);
//      verified, untouched.
//
// Signature:
//   POST { scout_id: string, storage_path: string } → { parsed_fields }
//
// Flow:
//   1. Validate inputs. scout_id must be UUID. storage_path must live under
//      `${scout_id}/` inside the `briefs` bucket.
//   2. Download the PDF via the service-role client (function context has
//      SUPABASE_SERVICE_ROLE_KEY).
//   3. Send to Claude as a `document` content block (no separate text
//      extraction step -- claude-sonnet-4-6 reads PDFs natively, which is the
//      modern HQ pattern and avoids the unpdf round-trip ts-pull-candidates
//      uses for email attachments).
//   4. tool_choice forces a `submit_brief` tool call. Parse the tool_use
//      block, sanitize, return as `parsed_fields`.
//
// Auth posture: verify_jwt = true (default). User-invoked synchronous; no
// self-invoke, no internal-secret path. Spend tracking flows through
// callClaude('venue_scout').

import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callClaude, type ClaudeTool } from "../_shared/anthropic.ts";
import {
  canonicalizeAgainst,
  getVenueTypesCanonicalSet,
} from "../_shared/venueTypes.ts";

// User-invoked synchronous only; no internal-secret path. Don't advertise
// `x-internal-secret` to the browser preflight (caught by code-reviewer
// during 4.4-port; same cleanup applied to vs-parse-sheet in this commit).
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type ParseRequest = {
  scout_id?: string;
  storage_path?: string;
};

type ParsedBriefFields = {
  client_name?: string;
  event_name?: string;
  live_dates?: string;
  city?: string;
  budget?: number | null;
  event_overview?: string;
  expected_guest_count?: number | null;
  additional_notes?: string;
  // Phase 4 Revision - Intake: venue-side + event-detail fields.
  // (install/strike dates retired in 5.12.14.3.)
  activations_count?: number | null;
  objectives?: string[];
  // Phase 5.12.5: target_audience + vibe_aesthetic flip to string[] (tag
  // shape, one demographic / aesthetic per item). Coordinated with
  // src/lib/venue-scout/briefForm.ts ParsedBriefFields + BriefFormState.
  target_audience?: string[];
  vibe_aesthetic?: string[];
  target_neighborhoods?: string[];
  venue_types?: string[];
  ideal_features?: string[];
  // Multi-set live-dates options. Populated INSTEAD OF the singular
  // live_dates field when the brief contains two or more distinct live
  // date sets (e.g. multi-city tours, multi-date offerings). The
  // ParsedPreview surfaces these as a radio group; the producer picks one
  // to write into form state. (Install / strike date *_options retired
  // in 5.12.14.3.)
  live_dates_options?: string[];
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

// Tool schema. All fields optional -- model returns what it finds, producer
// fills the rest. Numeric fields use `["number", "null"]` so the model can
// explicitly signal "not in the brief" without omitting the key entirely.
const tools: ClaudeTool[] = [
  {
    name: "submit_brief",
    description:
      "Submit the parsed brief fields extracted from the provided PDF text.",
    input_schema: {
      type: "object",
      properties: {
        client_name: {
          type: "string",
          description:
            "The client / brand name (e.g. 'Hennessy', 'Lululemon'). Omit if the brief doesn't clearly name a client.",
        },
        event_name: {
          type: "string",
          description: "The activation / event title.",
        },
        live_dates: {
          type: "string",
          description:
            "Clean date string for when the event is live. Strip parenthetical labels, activity tags, and any other non-date text; collapse multi-day listings into a single range. Examples: 'October 15-17, 2026', 'October 22-23, 2026' (NOT 'October 22 (Outdoor) October 23 (Restaurant)'), 'May 22-24, 2026' (NOT 'May 22-24, 2026 (LA Marathon Weekend)'). Use 'TBD' or 'TBD Q4 2026' for genuinely vague phrasing. Don't normalize to ISO. If the brief contains TWO OR MORE distinct live date sets (multi-city, multi-date offering), use live_dates_options INSTEAD. Install / strike dates are NOT extracted from briefs anymore (retired 5.12.14.3); ignore any install / load-in / strike / load-out language.",
        },
        city: {
          type: "string",
          description: "Primary city / location (e.g. 'New York, NY').",
        },
        budget: {
          type: ["number", "null"],
          description:
            "Total event budget in USD as a number. Look for labels like 'budget', 'production budget', 'estimated cost', 'event budget', 'production fee', or 'all-in'. Strip currency symbols and commas. For a range, use the upper bound. For 'approximately $50k' or '~$50,000', return 50000. Use null only when no budget figure appears anywhere in the brief.",
        },
        event_overview: {
          type: "string",
          description:
            "A 1-3 sentence summary of the activation, the audience, and the vibe.",
        },
        expected_guest_count: {
          type: ["number", "null"],
          description:
            "Expected guest / attendee count as a whole number. Use null if not specified.",
        },
        additional_notes: {
          type: "string",
          description:
            "Any other context worth carrying into venue research: brand tone, must-have features, hard nos, references. Free text. Omit if no extra context worth capturing.",
        },
        live_dates_options: {
          type: "array",
          items: { type: "string" },
          description:
            "Use this field INSTEAD OF live_dates when the brief contains TWO OR MORE distinct live date sets (e.g. multi-city tours: 'March 5-8, 2026 (LA), March 13-15, 2026 (NYC)'; multi-date offering: 'Option A: October 22-23, 2026; Option B: November 5-6, 2026'). Each array item is a clean date string with parentheticals, activity tags, and non-date text stripped (e.g. 'March 5-8, 2026', NOT 'March 5-8, 2026 (LA)'). When this field is populated, live_dates MUST be omitted.",
        },
        activations_count: {
          type: ["number", "null"],
          description:
            "Number of distinct activations / spaces / zones the event needs, as a whole number. Use null if not specified.",
        },
        objectives: {
          type: "array",
          items: { type: "string" },
          description:
            "Short tag-style phrases capturing the goals of the activation. Each item must be 1 to 5 words, no full sentences, no narrative. Aim for 3 to 6 distinct phrases (e.g. 'Brand awareness', 'Press moment', 'Premium positioning', 'Cultural relevance'). Each phrase goes into its own array item; do not return a single paragraph or a single string of comma-separated phrases. Omit the field if the brief states no objectives.",
        },
        target_audience: {
          type: "array",
          items: { type: "string" },
          description:
            "Demographic / audience tags the brief targets. ONE demographic per array item. Examples: Runners, Basketball Fans, LA Marathon Runners, Gen Z, Aged 30-35, Streetwear Enthusiasts, Brand Founders. Tags are additive (multiple non-conflicting tags allowed). Use 1-5 words per tag. Omit if the brief doesn't describe an audience.",
        },
        vibe_aesthetic: {
          type: "array",
          items: { type: "string" },
          description:
            "Aesthetic / vibe tags the venue should carry. ONE concept per array item. Tags can be general (Warm, Premium, Nostalgic, Clean, Museum, Gallery, Industrial-Raw, Polished) or brief-specific (Quiet Confidence, Medusa Green Color Palette, Future Forward, Childhood Bedroom). Use 1-5 words per tag. Omit if the brief doesn't describe a vibe.",
        },
        target_neighborhoods: {
          type: "array",
          items: { type: "string" },
          description:
            "Specific neighborhoods or districts the brief names as preferred locations. Omit if none named.",
        },
        venue_types: {
          type: "array",
          items: { type: "string" },
          description:
            "Kinds of venue the brief calls for. MUST be values from the canonical venue-types list provided in the user message ONLY. Multiple values returned as separate array items (e.g. for \"industrial warehouse\" return both \"Industrial\" and \"Warehouse\"). Omit the field entirely if the brief calls for nothing in this list.",
        },
        ideal_features: {
          type: "array",
          items: { type: "string" },
          description:
            "Concrete physical or capability tags the brief wants in a venue. MUST be short keyword-style phrases of 1-4 words each, one per array item. Examples: High Foot Traffic, Visible Street Presence, Outdoor Courtyard, Parking, Catering Kitchen, Ground Floor, Open Layout, Garage Doors, Drive-In, Rooftop, Floor-to-Ceiling Windows. Capitalize as title case. Quality + focus over quantity; emit as many tags as the brief warrants. Do NOT emit full sentences or paragraph-shaped items; do NOT include neighborhood names or address fragments (those live in target_neighborhoods); do NOT include venue-type tokens (those live in venue_types).",
        },
      },
      required: [],
    },
  },
];

const SYSTEM_PROMPT = [
  "You're a brief parser for Mirror NYC, an experiential agency that produces brand activations.",
  "Read the attached brief PDF and extract structured fields that will pre-fill the producer's sourcing brief in the HQ app.",
  "",
  "Rules:",
  "- Pull only what's explicitly stated in the brief. Don't guess.",
  "- For live_dates: return a CLEAN date string. Strip parenthetical labels, activity tags (e.g. '(Outdoor)', '(LA Marathon Weekend)'), and any other non-date text; collapse multi-day listings like 'October 22 (Outdoor) October 23 (Restaurant)' into a single range like 'October 22-23, 2026'. Don't normalize to ISO. Use 'TBD' / 'TBD Q4 2026' only when the brief is genuinely vague. Do NOT extract install / load-in / strike / load-out dates anymore (retired 5.12.14.3); ignore that language entirely.",
  "- When the brief contains TWO OR MORE distinct live date sets (e.g. multi-city tour: 'March 5-8, 2026 (LA), March 13-15, 2026 (NYC)'; multi-date offering: 'Option A vs Option B'), use live_dates_options and OMIT live_dates. Each array item must be a clean date string with parentheticals and city/activity labels stripped (e.g. 'March 5-8, 2026', not 'March 5-8, 2026 (LA)'). One date set per array item.",
  "- Pull budget as a number with currency symbols and commas stripped. Briefs often label it 'budget', 'production budget', 'estimated cost', 'event budget', 'production fee', or 'all-in'; check for any of these. For a range, use the upper bound. For 'approximately $50k' or '~$50,000', return 50000. Use null only when no budget figure appears anywhere.",
  "- Event overview should be a 1-3 sentence summary in your own words, capturing what the activation is, who it's for, and the vibe.",
  "- additional_notes is for tone / references / must-haves / hard-nos that don't fit the structured fields. Skip the field when nothing extra is worth capturing.",
  "- For the venue-side fields (activations_count, objectives, target_audience, vibe_aesthetic, target_neighborhoods, venue_types, ideal_features): fill them only when the brief states them explicitly. Omit any field the brief doesn't address rather than guessing.",
  "- objectives must be returned as short tag-style phrases (1-5 words each), one phrase per array item. Aim for 3-6 items. Do not return a single narrative item, a paragraph split into bullets, or a comma-separated string.",
  "- venue_types must come ONLY from the canonical list passed in the tool schema. Drop any term the schema doesn't list.",
  "- ideal_features must be returned as short 1-4 word tag-style phrases, one per array item. Do not return paragraph items or full sentences. Quality over quantity.",
  "- target_audience must be returned as short tag-style phrases (1-5 words each), one demographic per array item. Do not return a single narrative item; do not return contradictory tags.",
  "- vibe_aesthetic must be returned as short tag-style phrases (1-5 words each), one concept per array item. Do not return a single narrative item.",
  "",
  "Return ONLY a tool call to submit_brief. Do not return text.",
].join("\n");

function sanitizeString(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const t = raw.trim();
  return t.length > 0 ? t : undefined;
}

function sanitizeNumber(raw: unknown): number | null | undefined {
  if (raw === null) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const stripped = raw.replace(/[$,\s]/g, "");
    if (!stripped) return undefined;
    const n = parseFloat(stripped);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function sanitizeInteger(raw: unknown): number | null | undefined {
  if (raw === null) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.round(raw);
  if (typeof raw === "string") {
    const stripped = raw.replace(/[,\s]/g, "");
    if (!stripped) return undefined;
    const n = parseInt(stripped, 10);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

// Trim + drop empties + dedupe. Returns undefined when nothing usable remains
// so the key is omitted entirely (same omit-when-empty contract as the
// scalar sanitizers).
function sanitizeStringArray(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const t = v.trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out.length > 0 ? out : undefined;
}

// Tag-array sanitizer used by objectives / ideal_features / target_audience /
// vibe_aesthetic. The UI's TagInput expects short tag-style phrases, but the
// model sometimes leaks a narrative paragraph as one item or a joined string.
// Split joined items on "; " / ", " / " and ", drop items longer than maxLen
// chars, then trim / dedupe / drop empties. No hard count cap -- the producer
// prunes via the TagInput. (Phase 5.1 NIT pickup: added ", " split so a
// comma-joined item like "Brand awareness, Press moment, Premium positioning"
// breaks into three array items. Phase 5.12.5: parameterized maxLen with thin
// wrappers per field; ideal_features tightens to 40 chars since the canonical
// tag set tops out around 30.)
function sanitizeTagArray(raw: unknown, maxLen: number): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string") continue;
    for (const piece of v.split(/; |, | and /)) {
      const t = piece.trim();
      if (!t || t.length > maxLen) continue;
      if (!out.includes(t)) out.push(t);
    }
  }
  return out.length > 0 ? out : undefined;
}

function sanitizeObjectives(raw: unknown): string[] | undefined {
  return sanitizeTagArray(raw, 60);
}

function sanitizeFeatureTags(raw: unknown): string[] | undefined {
  return sanitizeTagArray(raw, 40);
}

function sanitizeAudienceTags(raw: unknown): string[] | undefined {
  return sanitizeTagArray(raw, 60);
}

// Phase 5.12.5: venue_types filter against the canonical set. Phase 5.12.10
// swapped the hard-coded canonical set to DB-driven: every call now receives
// the runtime `canonicalSet` (fetched once per request from
// public.venue_types via getVenueTypesCanonicalSet). Split each emitted
// entry on `/`, `,`, `;` so combined phrases like "industrial warehouse"
// or "gallery / studio" yield multiple canonical items; run each part
// through canonicalizeAgainst (case-insensitive runtime match). The
// "industrial warehouse" combined-phrase special-case (5.12.5) is gated
// on BOTH "Industrial" AND "Warehouse" being in the runtime set so a
// 5.12.13 prompt audit that retires either tag doesn't silently re-emit
// it. Dedupe across the full output. Logs the dropped (non-canonical)
// input strings for smoke calibration when non-empty. Returns undefined
// when nothing canonicalizes so the key omits.
function sanitizeVenueTypesAgainstCanonical(
  raw: unknown,
  canonicalSet: readonly string[],
): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: string[] = [];
  const dropped: string[] = [];
  // Cache the lowercased runtime set once so the industrial-warehouse
  // gate + the per-token resolver don't both re-scan canonicalSet.
  const lowerSet = new Set(canonicalSet.map((c) => c.toLowerCase()));
  const hasIndustrial = lowerSet.has("industrial");
  const hasWarehouse = lowerSet.has("warehouse");
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const original = v.trim();
    if (!original) continue;

    const canonicalsForThisEntry: string[] = [];

    // Combined phrase recovery: if the original entry mentions BOTH
    // "industrial" and "warehouse" (case-insensitive) AND both tokens are
    // in the runtime canonical set, emit both. The runtime-set gate (per
    // 5.12.10 OQ #1 follow-on) protects against silently re-emitting a
    // retired tag.
    const lower = original.toLowerCase();
    if (
      hasIndustrial &&
      hasWarehouse &&
      /industrial/.test(lower) &&
      /warehouse/.test(lower)
    ) {
      canonicalsForThisEntry.push("Industrial", "Warehouse");
    }

    // Per-part canonicalize via the runtime set (Phase 5.12.10).
    for (const piece of original.split(/[/,;]/)) {
      const t = piece.trim();
      if (!t) continue;
      const c = canonicalizeAgainst(t, canonicalSet);
      if (c) canonicalsForThisEntry.push(c);
    }

    if (canonicalsForThisEntry.length === 0) {
      dropped.push(original);
      continue;
    }

    for (const c of canonicalsForThisEntry) {
      if (!out.includes(c)) out.push(c);
    }
  }

  if (dropped.length > 0) {
    console.warn(
      `[vs-parse-brief] venue_types non-canonical drop: ${JSON.stringify(dropped)}`,
    );
  }

  return out.length > 0 ? out : undefined;
}

// Phase 5.12.2: resolve a parsed city against the cities lookup, with
// alias-first ordering + state-suffix stripping. Returns the canonical
// city name if any rung of the ladder hits; otherwise INSERTs a new row
// (using the state-stripped value to avoid polluting the lookup with
// alias-style strings like "Los Angeles, CA") and returns that back.
//
// Resolution ladder (per the 5.12.2-alias-cleanup migration's order):
//   1. Trim raw input.
//   2. Strip a trailing ", XX" 2-letter state suffix => stripped.
//   3. Alias match on trimmed (priority over direct cities match so a
//      polluting cities row -- in case one slipped past -- can't
//      short-circuit alias canonicalization).
//   4. Alias match on stripped.
//   5. Direct cities match on trimmed.
//   6. Direct cities match on stripped.
//   7. Insert a new cities row using the stripped value.
//
// Best-effort posture: every failure path logs + returns null. The caller
// falls through to the raw trimmed string; the frontend's RecordCombobox
// reconciliation in BriefVenue is the second line of defense.
//
// Race-loser path on insert: the cities uniqueness sits on the LOWER(name)
// expression index, which supabase-js can't target via onConflict (the
// conflict target must be a column or named constraint, not an
// expression). Plain INSERT + catch Postgres 23505 + re-read is the
// race-safe shape.
function stripStateSuffix(input: string): string {
  return input.replace(/,\s*[A-Za-z]{2}\s*$/g, "").trim();
}

async function resolveAlias(
  sb: SupabaseClient,
  candidate: string,
): Promise<string | null> {
  const { data, error } = await sb
    .from("city_aliases")
    .select("cities!inner(name)")
    .ilike("alias", candidate)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn(`[vs-parse-brief] city_aliases lookup error: ${error.message}`);
    return null;
  }
  const linked = (data as { cities?: { name?: string } } | null)?.cities;
  return linked?.name ?? null;
}

async function resolveCity(
  sb: SupabaseClient,
  candidate: string,
): Promise<string | null> {
  const { data, error } = await sb
    .from("cities")
    .select("name")
    .ilike("name", candidate)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn(`[vs-parse-brief] cities lookup error: ${error.message}`);
    return null;
  }
  return data?.name ?? null;
}

async function resolveOrCreateCity(
  sb: SupabaseClient,
  rawName: string,
  scoutId: string,
): Promise<string | null> {
  const trimmed = rawName.trim();
  if (!trimmed) return null;
  const stripped = stripStateSuffix(trimmed);
  const stripChanged = stripped.length > 0 && stripped !== trimmed;

  // (1) alias on trimmed.
  let canonical = await resolveAlias(sb, trimmed);
  if (canonical) return canonical;

  // (2) alias on stripped.
  if (stripChanged) {
    canonical = await resolveAlias(sb, stripped);
    if (canonical) return canonical;
  }

  // (3) direct cities on trimmed.
  canonical = await resolveCity(sb, trimmed);
  if (canonical) return canonical;

  // (4) direct cities on stripped.
  if (stripChanged) {
    canonical = await resolveCity(sb, stripped);
    if (canonical) return canonical;
  }

  // (5) novel city. Insert using the stripped value so we never seed the
  // cities lookup with alias-style "City, ST" strings.
  const toInsert = stripChanged ? stripped : trimmed;

  // Fetch scout.created_by for attribution (cities.created_by is NOT NULL).
  const { data: scoutRow, error: scoutErr } = await sb
    .from("vs_scouts")
    .select("created_by")
    .eq("id", scoutId)
    .maybeSingle();

  if (scoutErr || !scoutRow?.created_by) {
    console.warn(
      `[vs-parse-brief] could not resolve scout.created_by for cities insert: ${scoutErr?.message ?? "missing"}`,
    );
    return null;
  }

  const { error: insErr } = await sb
    .from("cities")
    .insert({ name: toInsert, created_by: scoutRow.created_by });

  if (insErr) {
    const insErrAny = insErr as { code?: string; message?: string };
    const isUnique =
      insErrAny.code === "23505" ||
      (typeof insErrAny.message === "string" &&
        insErrAny.message.includes("duplicate"));
    if (!isUnique) {
      console.warn(`[vs-parse-brief] cities insert error: ${insErr.message}`);
      return null;
    }
    // Race-loser path: re-read the row the race-winner inserted (case-
    // variant of the same name).
    const raced = await resolveCity(sb, toInsert);
    return raced ?? toInsert;
  }

  return toInsert;
}

function sanitizeParsed(
  raw: Record<string, unknown>,
  canonicalSet: readonly string[],
): ParsedBriefFields {
  const out: ParsedBriefFields = {};

  // Phase 5.12.5: target_audience + vibe_aesthetic moved out of stringKeys
  // into array-shape handlers below.
  const stringKeys: (keyof ParsedBriefFields)[] = [
    "client_name",
    "event_name",
    "live_dates",
    "city",
    "event_overview",
    "additional_notes",
  ];
  for (const k of stringKeys) {
    const v = sanitizeString(raw[k]);
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }

  // Phase 5.12.5: venue_types + ideal_features pulled out of the generic
  // arrayKeys loop and routed through dedicated sanitizers (canonical filter
  // for venue_types, tag-shape sanitizer for ideal_features).
  const arrayKeys: (keyof ParsedBriefFields)[] = ["target_neighborhoods"];
  for (const k of arrayKeys) {
    const v = sanitizeStringArray(raw[k]);
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }

  const objectives = sanitizeObjectives(raw.objectives);
  if (objectives !== undefined) out.objectives = objectives;

  const venueTypes = sanitizeVenueTypesAgainstCanonical(
    raw.venue_types,
    canonicalSet,
  );
  if (venueTypes !== undefined) out.venue_types = venueTypes;

  const idealFeatures = sanitizeFeatureTags(raw.ideal_features);
  if (idealFeatures !== undefined) out.ideal_features = idealFeatures;

  const audience = sanitizeAudienceTags(raw.target_audience);
  if (audience !== undefined) out.target_audience = audience;

  const vibe = sanitizeAudienceTags(raw.vibe_aesthetic);
  if (vibe !== undefined) out.vibe_aesthetic = vibe;

  const budget = sanitizeNumber(raw.budget);
  if (budget !== undefined) out.budget = budget;

  const egc = sanitizeInteger(raw.expected_guest_count);
  if (egc !== undefined) out.expected_guest_count = egc;

  const activations = sanitizeInteger(raw.activations_count);
  if (activations !== undefined) out.activations_count = activations;

  // Phase 5.12.13.7: multi-set date fields. The model is instructed to emit
  // *_options INSTEAD OF the singular field when the brief contains 2+ date
  // sets, but enforce that contract server-side: when both arrive populated,
  // options wins (intent signal is stronger). When options collapses to a
  // single distinct value after sanitize, treat it as a single-field write
  // and drop the options array so the UI surfaces a normal row, not a
  // one-item radio group.
  const collapseDateOptions = (
    singleKey: keyof ParsedBriefFields,
    optionsKey: keyof ParsedBriefFields,
  ) => {
    const opts = sanitizeStringArray(raw[optionsKey]);
    if (!opts || opts.length === 0) return;
    if (opts.length === 1) {
      // Lone option: write into the single field (unless already populated
      // by a non-empty singular field above).
      if (!out[singleKey]) {
        (out as Record<string, unknown>)[singleKey] = opts[0];
      }
      return;
    }
    // Multi-option case: prefer options. Drop the singular field so the UI
    // doesn't render two competing controls for the same key.
    (out as Record<string, unknown>)[optionsKey] = opts;
    delete (out as Record<string, unknown>)[singleKey];
  };
  collapseDateOptions("live_dates", "live_dates_options");

  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  let body: ParseRequest;
  try {
    body = (await req.json()) as ParseRequest;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const scout_id = (body.scout_id ?? "").trim();
  const storage_path = (body.storage_path ?? "").trim();

  if (!UUID_RE.test(scout_id)) {
    return jsonResponse({ error: "scout_id must be a UUID" }, 400);
  }
  if (!storage_path.startsWith(`${scout_id}/`) || !storage_path.toLowerCase().endsWith(".pdf")) {
    return jsonResponse(
      { error: "storage_path must live under '<scout_id>/' and end with .pdf" },
      400,
    );
  }
  // Defense-in-depth: Supabase Storage (S3-backed) treats `..` as literal
  // characters today, but reject anyway to stay safe under any future
  // storage backend that might interpret directory traversal.
  if (storage_path.includes("..")) {
    return jsonResponse({ error: "storage_path may not contain '..'" }, 400);
  }

  // Service-role client for storage read. Authenticated user JWT is verified
  // by the gateway (verify_jwt = true default); we don't need the user
  // identity downstream.
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: blob, error: dlErr } = await sb.storage.from("briefs").download(storage_path);
  if (dlErr || !blob) {
    return jsonResponse(
      { error: `Could not read PDF: ${dlErr?.message ?? "not found"}` },
      500,
    );
  }

  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  if (bytes.length < 200) {
    return jsonResponse({ error: "PDF appears empty or unreadable" }, 400);
  }
  const base64 = bytesToBase64(bytes);

  // Phase 5.12.10: runtime canonical venue-types set. Threaded into the
  // user message (CONSTRAINT line) AND sanitizeVenueTypesAgainstCanonical
  // below. Schema description + SYSTEM_PROMPT stay static for prompt-cache
  // stability per feedback_tool_choice_collapse.
  const canonicalSet = await getVenueTypesCanonicalSet(sb, "vs-parse-brief");
  const canonicalLine =
    canonicalSet.names.length > 0
      ? `Canonical venue types (CONSTRAINT for venue_types field): ${canonicalSet.names.join(", ")}. Use ONLY values from this list; drop anything else.`
      : "";

  const result = await callClaude(
    "venue_scout",
    [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: base64 },
          },
          {
            type: "text",
            text: canonicalLine
              ? `${canonicalLine}\n\nParse the attached brief and call submit_brief with the extracted fields.`
              : "Parse the attached brief and call submit_brief with the extracted fields.",
          },
        ],
      },
    ],
    {
      system: SYSTEM_PROMPT,
      tools,
      tool_choice: { type: "tool", name: "submit_brief" },
      max_tokens: 1500,
      fn_name: "vs-parse-brief",
    },
  );

  if (!result.ok) {
    return jsonResponse(
      { error: `Claude call failed: ${result.error}`, parsed_fields: {} },
      result.status >= 400 && result.status < 600 ? result.status : 500,
    );
  }

  const toolUse = result.content.find((b) => b?.type === "tool_use" && b?.name === "submit_brief");
  if (!toolUse || typeof toolUse.input !== "object" || toolUse.input === null) {
    // No tool call returned. Return 200 with empty parsed_fields so the
    // producer can fall back to filling the form manually rather than
    // surface this as an error.
    console.warn(
      `[vs-parse-brief] no submit_brief tool_use in response (stop_reason=${result.stop_reason}, scout_id=${scout_id})`,
    );
    return jsonResponse({ parsed_fields: {} });
  }

  const parsed_fields = sanitizeParsed(
    toolUse.input as Record<string, unknown>,
    canonicalSet.names,
  );

  // Phase 5.12.5: re-parse guard for client_name + event_name. Producer enters
  // these at scout creation; if the column is already populated, never
  // overwrite via a brief re-parse. SELECT the scout, drop the parsed value
  // when the scout's column is non-empty. Best-effort: scout-fetch failure
  // logs + falls through to today's behavior (parser fills both fields). The
  // BriefEvent intake gates the upload card behind these required fields, so
  // a no-guard parse on an empty-state scout is the legitimate first-parse
  // case anyway.
  const { data: guardRow, error: guardErr } = await sb
    .from("vs_scouts")
    .select("client_name, event_name")
    .eq("id", scout_id)
    .maybeSingle();
  if (guardErr) {
    console.warn(
      `[vs-parse-brief] scout fetch for re-parse guard failed: ${guardErr.message} (continuing without guard)`,
    );
  } else if (guardRow) {
    if (
      typeof guardRow.client_name === "string" &&
      guardRow.client_name.trim().length > 0 &&
      parsed_fields.client_name
    ) {
      console.warn(
        `[vs-parse-brief] re-parse guard: client_name skipped (scout already has "${guardRow.client_name.trim().slice(0, 40)}")`,
      );
      delete parsed_fields.client_name;
    }
    if (
      typeof guardRow.event_name === "string" &&
      guardRow.event_name.trim().length > 0 &&
      parsed_fields.event_name
    ) {
      console.warn(
        `[vs-parse-brief] re-parse guard: event_name skipped (scout already has "${guardRow.event_name.trim().slice(0, 40)}")`,
      );
      delete parsed_fields.event_name;
    }
  }

  // Phase 5.12.2: resolve the parsed city against the cities lookup. Rewrites
  // parsed_fields.city to the canonical name; auto-creates novel rows so the
  // frontend receives a lookup-ready value (defense-in-depth pairs with
  // BriefVenue's RecordCombobox reconciliation on mount). Errors are
  // swallowed + logged; we never fail the parse over a single city.
  if (parsed_fields.city) {
    const canonical = await resolveOrCreateCity(sb, parsed_fields.city, scout_id);
    if (canonical) parsed_fields.city = canonical;
  }

  return jsonResponse({ parsed_fields });
});
