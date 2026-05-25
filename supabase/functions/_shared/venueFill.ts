// Shared FILL_TOOL + FILL_SYSTEM + buildFillUserMsg for the "fill missing
// venue fields" pass.
//
// Consumers:
//   1. vs-parse-sheet (Phase 4.10.1-port): enrichment of sheet rows immediately
//      after parse + insert. Producer-entered sheet values are authoritative;
//      AI fills only the blanks.
//   2. vs-compile-summaries Pass 1 (Phase 4.7.2-port): backfill of manual rows
//      and (post-4.10.1) sheet rows that still have empty derived_attrs.
//
// Memory rule (feedback_tool_choice_collapse): FILL_SYSTEM lifted verbatim
// from VS Pro; do NOT edit to shape AI-output quality. Output quality lives
// on schema descriptions + post-emission sanitization (sanitizeMultiAgainst,
// sanitizeWebsiteUrl). Same rule the prior compile-summaries comment cited.
//
// Phase 5.12.10: FILL_TOOL.venue_type.description + FILL_SYSTEM swapped
// from `${CANONICAL_TYPES.join(", ")}` interpolations to static strings
// (prompt-cache stability). The live canonical venue-types list rides in
// the per-call user message via buildFillUserMsg's optional canonicalSet
// param; callers pass `await getVenueTypesCanonicalSet(sb, fn).names`.

import type { ClaudeTool } from "./anthropic.ts";

export const FILL_TOOL: ClaudeTool = {
  name: "fill_venue",
  description:
    "Fill in missing venue research fields. Honor any pre-set fields the producer entered.",
  input_schema: {
    type: "object",
    properties: {
      // Post-4.10.4 hot patch round 15: added address + neighborhood
      // so Claude can fill them when the producer left them null on
      // the sheet row. Common case: producer enters just the venue
      // name (which is itself an address-style string like "238 N Canon
      // Drive"), and we want web_search to resolve the full canonical
      // address (city, state, zip) from the brief's city context.
      // Patch guards (vs-research-venues + vs-compile-summaries) only
      // write these when the existing row value is null/empty so the
      // producer's pre-filled values stay authoritative.
      address: {
        type: "string",
        description:
          "Full street address (number, street, city, state, ZIP if known). Only fill when the producer left address blank. If the venue NAME is itself an address-style string (e.g. '238 N Canon Drive'), web_search using that string + the brief's city to resolve the full canonical address. Examples: '238 N Canon Dr, Beverly Hills, CA 90210', '8500 Melrose Ave, West Hollywood, CA 90069'.",
      },
      neighborhood: {
        type: "string",
        description:
          "Specific neighborhood / district / submarket. Only fill when the producer left neighborhood blank. Examples: 'West Hollywood', 'Arts District', 'SoHo', 'Chelsea', 'Williamsburg'. Should be more specific than the city itself.",
      },
      venue_type: {
        type: "string",
        description:
          "Slash-separated values from the canonical venue-types list (passed in the user message). Multiple types allowed.",
      },
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
          "Array of 2-10 short, evergreen tags describing physical or experiential features of this venue. 1-4 words each (usually 1-2). Tags are reused across briefs and on the venue detail page; they describe WHAT THE SPACE IS, not what is happening around it. Use the canonical examples below as the reference shape; tags not on the list are fine if they match the shape. Examples: Courtyard, Skylight, High Ceilings, Garage Doors, Ground Floor, Multi-Level, Waterfront, Rooftop, Garden, Wood Floors, Exposed Brick, Balcony, Storefront, Vaulted Ceilings, Multiple Stages, Outdoor, Floor-to-Ceiling Windows. Capitalize as title case. Do NOT include: specific named neighborhoods, streets, addresses, landmarks, architects (Waterfront, not 'Hudson River Waterfront'); numbers, units, square footage, walk scores, capacity; narrative sentences (more than 4 words); marketing fluff ('amazing', 'world-class'); placeholder tokens like '<UNKNOWN>', 'TBD', 'N/A', 'None', 'TODO'. Items violating these rules will be stripped post-emission and the field treated as missing; emit fewer real tags rather than more invalid ones.",
        items: {
          type: "string",
          description:
            "A single 1-4 word evergreen feature tag. Title case. No digits, units, addresses, narrative sentences, or placeholder tokens.",
          maxLength: 35,
        },
        minItems: 2,
        maxItems: 10,
      },
      derived_attrs: {
        type: "object",
        additionalProperties: { type: "string" },
      },
      recommendations: {
        type: "array",
        description:
          "2-4 short venue-specific observations the producer can use to pitch this venue against the brief. Each is a concrete, targeted, single-clause statement (10-15 words). Focus on activation potential, brand-fit, physical features, neighborhood context. Do NOT return an empty array. CRITICAL: do NOT use placeholder tokens like '<UNKNOWN>', 'TBD', 'N/A', 'None', 'Not Available', 'TODO', or any similar 'I don't know' sentinel -- placeholder strings will be stripped and the field treated as missing. If you have not yet found enough information, web_search the venue first and base recommendations on real findings. Better to return 2 real recommendations than 4 placeholder strings.",
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
          "2-4 short limitations, gaps, or logistics flags the producer should weigh against the brief. Each is a concrete, targeted, single-clause statement (10-15 words). Focus on permits, capacity, distance, brand fit gaps, parking, programming constraints. Do NOT return an empty array. CRITICAL: do NOT use placeholder tokens like '<UNKNOWN>', 'TBD', 'N/A', 'None', 'Not Available', 'TODO', or any similar 'I don't know' sentinel -- placeholder strings will be stripped and the field treated as missing. If you have not yet found enough information, web_search the venue first and base considerations on real findings. Better to return 2 real considerations than 4 placeholder strings.",
        items: {
          type: "string",
          description:
            "A single specific limitation or distance/permit fact the producer should weigh. Concrete and brief. Examples: 'Venue requires TPA for capacity the brief states (over 350)', 'Permitting required for sidewalk/parking lot activation', 'Limited parking options available nearby', 'Melrose Ave is ~4 miles from the LA Marathon finish line in the brief', 'Smaller footprint limits simultaneous multi-zone programming', 'Hotel brand presence may compete visually with brand aesthetic', 'Culver City sits ~3 miles from the brief primary target zones'.",
          maxLength: 200,
        },
        minItems: 2,
        maxItems: 4,
      },
      ranking_score: { type: "number" },
    },
    // Post-4.10.4 hot patch: key_features added to required so Claude can't
    // silently skip it (smoke 2026-05-13 showed 0/7 sheet venues had features
    // even when web_search ran). recommendations + considerations already
    // required since 4.10.1-port. ranking_score also required.
    required: [
      "key_features",
      "recommendations",
      "considerations",
      "ranking_score",
    ],
  },
};

export const FILL_SYSTEM =
  `You are a venue researcher for Mirror NYC. Fill in missing structured fields for a single venue. Type must use ONLY values from the canonical venue-types list provided in the user message. Multiple types separated by " / " allowed. Never set website_url to a listing-database URL (thestorefront.com, peerspace.com, propertyshark.com, loopnet.com, crexi.com).`;

// Brief context the model sees in every Pass 1 user message. Identical
// across consumers so a refactor never drifts the prompt shape.
export type ScoutBrief = {
  client_name: string | null;
  event_name: string | null;
  city: string | null;
  live_dates: string | null;
  budget: number | string | null;
  event_overview: string | null;
  brief_data: Record<string, unknown> | null;
};

export type VenueForFill = {
  name: string;
  address: string | null;
  neighborhood: string | null;
  venue_type: string | null;
  // Phase 4.10.3-port: producer-provided website_url is surfaced to the
  // model so the URL becomes the primary research source. When present,
  // the user message switches to a "research starting from this URL"
  // framing; when absent, the line is rendered as "(not provided)" and
  // Claude can web_search freely. Pass null / undefined / "" when no URL.
  website_url?: string | null;
  // Producer notes are surfaced by vs-compile-summaries (manual venues collect
  // them via the producer notes flow). vs-parse-sheet rows do not have notes
  // yet at enrichment time, so callers may omit; the builder always renders
  // a `Producer notes:` line (defaulting to "(none)") so the user-message
  // shape matches the 4.7.2-port pre-extraction prompt byte-for-byte. Don't
  // drop the line conditionally -- that would be a system-prompt edit and
  // violates feedback_tool_choice_collapse.
  notes?: string | null;
  // Phase 5.12.4 thread (a): HQ canonical about_venue paragraph for hq_pool
  // rows. When present, signals to Claude that this venue is HQ-curated and
  // the about_venue is the authoritative reference for identity / character /
  // neighborhood. Claude focuses on per-brief judgment (recs / considerations
  // / rank) instead of re-researching structural facts. Pass null /
  // undefined / "" when not an hq_pool row; the builder degrades to today's
  // behavior byte-for-byte.
  aboutVenue?: string | null;
};

export function buildFillUserMsg(
  scout: ScoutBrief,
  venue: VenueForFill,
  canonicalSet?: readonly string[],
): string {
  // Post-4.10.4 hot patch round 11: trimmed Brief block. The old version
  // dumped the entire scout.brief_data JSONB, which includes internal
  // state flags (research_started_at, compile_started_at,
  // deck_generation_started_at, uploaded_files) that are pure noise to
  // Claude. New version extracts only the producer-relevant subset:
  // expected_guest_count + brief_data.notes (producer's additional
  // notes). The state flags + file metadata are dropped. Drops 30-70%
  // of per-call input tokens depending on brief_data size.
  const briefData = (scout.brief_data ?? {}) as Record<string, unknown>;
  const expectedGuests = briefData.expected_guest_count;
  const briefNotes = briefData.notes;
  const briefBlock =
    `Client: ${scout.client_name ?? "(not set)"}
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
Additional brief notes: ${
      typeof briefNotes === "string" && briefNotes.trim().length > 0
        ? briefNotes.trim()
        : "(none)"
    }`;

  // Preserve the 4.7.2-port shape byte-for-byte: `Producer notes:` always
  // present, falling back to "(none)" when the caller omits or passes null.
  // Empty string also falls through to "(none)" since an empty notes value
  // is semantically the same as no notes.
  const notesValue =
    venue.notes != null && venue.notes !== "" ? venue.notes : "(none)";

  // Phase 4.10.3-port: when the producer entered a website_url on the sheet
  // row (or set one on a manual venue), surface it to Claude as the primary
  // research source. When absent, render `(not provided)` and instruct
  // Claude to web_search freely. The instruction always pushes for live
  // research because FILL_SYSTEM is "fill structured fields" and the model
  // (especially under forced tool_choice on fill_venue) needs an explicit
  // research nudge in the user message or it falls back to training
  // knowledge and emits empty fields. User-message scoping is consistent
  // with feedback_tool_choice_collapse (the schema descriptions + per-call
  // user context are the levers; FILL_SYSTEM stays untouched).
  //
  // Post-4.10.4 hot patch: smoke 2026-05-13 showed 4/7 Phase A calls did
  // not invoke web_search, 2 of those returned near-empty payloads
  // (out=73, 75 tokens) -- specifically venues where the producer pasted
  // a listing-database URL (LoopNet / NMRK / Blace etc.). Hypothesis:
  // Claude read FILL_SYSTEM's "Never set website_url to a listing-database
  // URL" as "do not engage with this venue at all" and emitted the
  // bare-minimum tool_use to satisfy the schema. The user message now
  // explicitly disambiguates: the listing-DB restriction applies ONLY to
  // the output field, not to research; and mandates web_search use.
  const hasProducerUrl =
    venue.website_url != null && venue.website_url.trim() !== "";
  const websiteLine = hasProducerUrl
    ? `Website (USE AS PRIMARY RESEARCH SOURCE): ${venue.website_url}`
    : `Website: (not provided)`;

  // Phase 5.12.4 thread (a): when the caller passes a non-empty aboutVenue
  // (hq_pool rows only; vs-compile-summaries Pass 1 callsite gates on
  // source === 'hq_pool'), narrow the research instruction so Claude focuses
  // on per-brief judgment (recs / considerations / ranking_score) instead of
  // re-researching identity / character / neighborhood facts HQ already
  // curated. The wider web_search-mandatory instruction stays when aboutVenue
  // is absent so the byte-for-byte 4.10.3-port behavior is preserved for
  // every existing caller (vs-parse-sheet, manual + sheet rows in Pass 1).
  const hasAboutVenue =
    venue.aboutVenue != null && venue.aboutVenue.trim() !== "";
  const hqAboutBlock = hasAboutVenue
    ? `\n\nHQ CANONICAL ABOUT (this venue is in Mirror NYC's HQ database; treat as the authoritative reference, do not contradict, do not re-research identity / character / neighborhood facts):\n${venue.aboutVenue!.trim()}`
    : "";
  const researchInstruction = hasAboutVenue
    ? "This venue is HQ-curated. The HQ CANONICAL ABOUT paragraph above is authoritative for identity, character, neighborhood, and aesthetic. Use it as your primary reference and skip web_search unless you need to verify a specific structured fact (sq_ft / capacity) that is missing AND the about paragraph does not address it. Focus on per-brief judgment: write recommendations + considerations + ranking_score that tie THIS venue's strengths and gaps to THIS brief. "
    : hasProducerUrl
      ? "You MUST invoke web_search at least once for this venue before responding. Start with the website URL above. If that URL is a listing-database deep link (LoopNet, NMRK, TheVendry, Blace, CityFeet, Crexi, etc.), research the venue's specifics directly from that listing page; the 'never use listing-database URLs as the website_url output' rule applies ONLY to the output `website_url` field, NOT to your research. Always fall back to additional searches if the primary URL lacks specific details. "
      : "You MUST invoke web_search at least once for this venue before responding. Search for the venue by name + address + neighborhood and pull current photos, square footage, capacity, features, and recent press from your search results. ";

  // Phase 5.12.10: per-call canonical venue-types list rides in the user
  // message (schema descriptions + FILL_SYSTEM stay static for prompt-
  // cache stability per feedback_tool_choice_collapse). When the caller
  // doesn't pass canonicalSet (or passes an empty array), no constraint
  // line is rendered and Claude relies on FILL_SYSTEM's reference only.
  const canonicalLine =
    canonicalSet && canonicalSet.length > 0
      ? `\n\nCanonical venue types (CONSTRAINT): ${canonicalSet.join(", ")}. Use ONLY values from this list; multiple types separated by " / " allowed.`
      : "";

  return `BRIEF
${briefBlock}${hqAboutBlock}${canonicalLine}

VENUE (producer-entered, do not overwrite filled fields):
Name: ${venue.name}
Address: ${venue.address ?? "?"}
Neighborhood: ${venue.neighborhood ?? "?"}
Type (if set): ${venue.venue_type ?? "(missing, set from canonical list)"}
${websiteLine}
Producer notes: ${notesValue}

${researchInstruction}Fill ALL structured fields (key_features, recommendations, considerations, ranking_score are all required). Do NOT return empty arrays for key_features, recommendations, or considerations -- if you need more data to write meaningful entries, web_search the venue again before responding. CRITICAL: do NOT use placeholder strings like '<UNKNOWN>', 'TBD', 'N/A', 'None', 'Not Available', 'TODO' in any array field. Placeholder strings will be stripped from the response and the affected field treated as missing -- so two real entries are far more useful than four placeholder strings. Type must use canonical list values only.`;
}
