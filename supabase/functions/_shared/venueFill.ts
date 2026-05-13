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
// on schema descriptions + post-emission sanitization (canonicalizeType,
// sanitizeWebsiteUrl). Same rule the prior compile-summaries comment cited.

import { CANONICAL_TYPES } from "./venueTypes.ts";
import type { ClaudeTool } from "./anthropic.ts";

export const FILL_TOOL: ClaudeTool = {
  name: "fill_venue",
  description:
    "Fill in missing venue research fields. Honor any pre-set fields the producer entered.",
  input_schema: {
    type: "object",
    properties: {
      venue_type: {
        type: "string",
        description:
          `Slash-separated values from canonical list: ${CANONICAL_TYPES.join(", ")}`,
      },
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
      ranking_score: { type: "number" },
    },
    required: ["recommendations", "considerations", "ranking_score"],
  },
};

export const FILL_SYSTEM =
  `You are a venue researcher for Mirror NYC. Fill in missing structured fields for a single venue. Type must use ONLY values from this canonical list: ${CANONICAL_TYPES.join(", ")}. Multiple types separated by " / " allowed. Prefer Retail for ground-floor commercial / storefront / vacancy spaces. Never set website_url to a listing-database URL (thestorefront.com, peerspace.com, propertyshark.com, loopnet.com, crexi.com).`;

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
};

export function buildFillUserMsg(
  scout: ScoutBrief,
  venue: VenueForFill,
): string {
  const briefBlock =
    `Client: ${scout.client_name ?? "(not set)"}
Event: ${scout.event_name ?? "(not set)"}
City: ${scout.city ?? "(not set)"}
Live dates: ${scout.live_dates ?? "(not set)"}
Budget: ${scout.budget ?? "(not set)"}
Overview: ${scout.event_overview ?? "(not set)"}
Brief: ${JSON.stringify(scout.brief_data ?? {})}`;

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
  const hasProducerUrl =
    venue.website_url != null && venue.website_url.trim() !== "";
  const websiteLine = hasProducerUrl
    ? `Website (USE AS PRIMARY RESEARCH SOURCE): ${venue.website_url}`
    : `Website: (not provided)`;
  const researchInstruction = hasProducerUrl
    ? "Use web_search to research this venue starting with the website URL above; search there first, and only fall back to other sources if the website lacks the information you need. "
    : "Use web_search to research this venue (its homepage, listing page, or social profile) and pull current photos, square footage, capacity, features, and recent press from your search results. ";

  return `BRIEF
${briefBlock}

VENUE (producer-entered, do not overwrite filled fields):
Name: ${venue.name}
Address: ${venue.address ?? "?"}
Neighborhood: ${venue.neighborhood ?? "?"}
Type (if set): ${venue.venue_type ?? "(missing, set from canonical list)"}
${websiteLine}
Producer notes: ${notesValue}

${researchInstruction}Fill in missing structured fields. Type must use canonical list values only.`;
}
