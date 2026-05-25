// Shared venue-overview primitives.
//
// ABOUT_VENUE_SYSTEM (the HQ prompt) is the CANONICAL venue-overview prompt.
// The two generation paths below produce the SAME artifact -- the venue "About"
// paragraph -- so their prompts MUST stay aligned in voice, length, and rules.
// Tune ABOUT_VENUE_SYSTEM; do not let the VS prompt drift away from it.
//
//   1. HQ path (hq-generate-venue-about): ABOUT_VENUE_SYSTEM, evergreen and
//      tool-less (Jimmie, 2026-05-21). Runs plain-text (no custom tool,
//      web_search only) and reads the model's text reply directly. Tool-less
//      removes the collapse-risk class (there is no forced tool to collapse).
//      buildOverviewUserMsgFromVenue builds the user-message venue-data block.
//      This is the source of truth for venue-overview voice.
//
//   2. VS path (vs-compile-summaries Pass 2): OVERVIEW_TOOL + OVERVIEW_SYSTEM,
//      the legacy VS Pro prompt, which still forces the `write_overview` tool.
//      These are NO LONGER under a hard "never edit" mandate (Jimmie approved
//      diverging). BUT: editing a forced-tool SYSTEM risks the
//      feedback_tool_choice_collapse failure, so smoke a VS sourcing ->
//      compile -> deck run after any change here, and keep any edits ALIGNED
//      with ABOUT_VENUE_SYSTEM rather than diverging from it.
//
// END STATE (Phase 5.12, see docs/roadmap.md § 5.12): VS converges onto the HQ
// path -- point vs-compile-summaries at ABOUT_VENUE_SYSTEM (tool-less + web
// search), relocate overview generation to deck-prep, drop the brief, cut
// considerations, and DELETE OVERVIEW_TOOL + OVERVIEW_SYSTEM. At that point the
// only caller-specific piece is the user-message builder (VS feeds a
// vs_candidate_venue row plus recommendations + producer notes; HQ feeds a
// venues row), so ABOUT_VENUE_SYSTEM may gain a short line acknowledging the
// optional recommendations/notes inputs VS passes.
//
// The user-message builder is NOT shared today: VS feeds a vs_candidate_venue
// row (plus recommendations + producer notes); HQ feeds a venues row. Only the
// VS TOOL/SYSTEM and the HQ SYSTEM are module-level primitives.

import type { ClaudeTool } from "./anthropic.ts";

// Phase 4.10.4-port: OVERVIEW_TOOL tuned to produce shorter, better-targeted
// overviews. Per feedback_tool_choice_collapse memory rule, the levers are
// the tool description + the venue_overview property description + maxLength.
// OVERVIEW_SYSTEM stays untouched.
//
// Targets:
//   - 3-4 sentences, ~80 words.
//   - Surface standout physical / experiential features + immediate
//     neighborhood character + at most one critical consideration.
//   - Don't itemize every amenity; don't pad with marketing fluff.
//
// `maxLength: 500` is a soft signal -- Claude generally honors but does not
// strictly truncate.
//
// Diagnostic: if smoke output is still too long, tighten maxLength to 450
// or 400 first. If output is still un-targeted, add more concrete examples
// to the property description. (Editing OVERVIEW_SYSTEM is allowed now too --
// see the VS-ONLY + alignment notes above -- but keep it ALIGNED with
// ABOUT_VENUE_SYSTEM, and smoke a VS deck run after any forced-tool change.)
export const OVERVIEW_TOOL: ClaudeTool = {
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
        maxLength: 500,
      },
    },
    required: ["venue_overview"],
  },
};

// VS-ONLY. OVERVIEW_TOOL (above) + OVERVIEW_SYSTEM (below) are used solely by
// vs-compile-summaries, which forces the write_overview tool. The HQ
// About-Venue generator does NOT use either one; it uses ABOUT_VENUE_SYSTEM
// (below), tool-less. OVERVIEW_SYSTEM is still the original VS Pro text.
// Editing the VS prompt/tool is now ALLOWED -- the old "frozen, never edit"
// mandate is lifted (Jimmie approved diverging, and VS converges to
// ABOUT_VENUE_SYSTEM in Phase 5.12, see docs/roadmap.md § 5.12). CAUTION when
// you do edit the VS side: per feedback_tool_choice_collapse, changing a
// forced-tool SYSTEM has historically caused empty-tool-output collapses, so
// smoke a VS sourcing -> compile -> deck run after any change here.
export const OVERVIEW_SYSTEM =
  `You are a producer at Mirror NYC writing venue summaries for a pitch deck. Tone: declarative, third-person, specific to the brief. 5-8 sentences. Mention how the venue serves the specific event (foot traffic, back-of-house, capacity, neighborhood fit). No marketing fluff. Forbidden words: "perfect", "ideal", "premier", "elevated experience", "world-class", "stunning", "amazing".`;

// HQ path system prompt (Jimmie, 2026-05-21; tightened after smoke round 1).
// Evergreen, brief-less, tool-less: hq-generate-venue-about runs plain-text +
// web_search and reads the model's text reply directly. Venue data arrives as
// the user message (buildOverviewUserMsgFromVenue).
//
// Smoke-round-1 fixes: (1) output ran long -> hard 110-word cap restated, the
// "bias toward comprehensiveness" nudge removed (it caused bloat). (2) One
// output leaked web_search reasoning + a "here is the paragraph: ---" preamble
// -> <output_format> + <web_research_protocol> now forbid any preamble /
// research narration / separators. (3) Output skewed technical -> reframed for
// the CLIENT audience (guest experience, aesthetic, vibe, neighborhood, crowd)
// with a <do_not_include> block banning production logistics. The three
// examples are Jimmie's hand-revised ideals; their inputs carry technical
// features the outputs deliberately OMIT, modelling the filter.
export const ABOUT_VENUE_SYSTEM = `<role>
You are a senior producer at Mirror NYC, a creative experiential event production agency. You are writing an "About the Venue" paragraph for the agency's internal venue database. This copy is evergreen and reused across client pitch decks, where venues are presented to clients for event consideration.
</role>

<audience>
Write for the CLIENT deciding whether to host their event at this venue. Clients care about how the space looks and feels, the guest experience, the aesthetic and vibe, the natural light and sense of scale, the surrounding neighborhood and the crowd it draws. They do NOT care about production logistics. Sell the space and the experience, not the back-of-house.
</audience>

<input_fields>
You will receive the following venue data. Missing fields will render as "(not set)" — treat these as unknown, not as instructions to invent.

- Name
- Address
- Neighborhood
- City
- Type
- Size (sq ft)
- Capacity
- Website
- Key features (list)
</input_fields>

<task>
Write a single paragraph of 4 to 5 tight sentences, 90 to 110 words. The 110-word limit is a hard cap: never exceed it. Every sentence must earn its place; cut anything that does not sell the space or the guest experience.
</task>

<structure>
A loose flow, not a rigid template. Combine parts where it reads better.

1. **Identity and appeal.** What the space is (name, type, character, location) paired with its single most striking visual or experiential quality. Do not lead with the total square footage.
2. **The space and the guest experience.** How it looks and feels: natural light, materials and finishes, ceiling height and sense of scale, standout design elements, indoor-outdoor flow, layout flexibility, the atmosphere it creates for guests.
3. **Neighborhood and crowd.** The character of the surrounding area and who it actually draws, when it adds to the appeal. Match the crowd to THIS venue and neighborhood. Do NOT default to a "design-literate", "design-forward", "fashion-forward", or "creative" audience; that fits some venues but not most. Venues serve many markets (corporate, tech, hospitality, social, cultural, philanthropic, residential, retail), so this sentence should read differently from venue to venue. If the area's draw is genuinely unclear, describe the foot traffic or energy plainly rather than inventing a scene. Skip entirely if unremarkable or unknown.
4. **The draw (optional).** If you close on fit, name the SPECIFIC benefit the venue offers a client: the audience it draws, the visibility, the aesthetic, the sense of scale. Do NOT end with a generic list of event types it could host (for example "suited to brand activations, fashion shows, and product launches") -- that adds nothing. Lead with the perk, not the event category.
</structure>

<tone_and_style>
- Third person, declarative, concrete. Confident producer voice, no sales hype.
- Use natural, plain language. Avoid jargon or technical descriptors a client would never say (write "corner", not "signalized corner").
- Write in your own voice. Do not lift or echo promotional / marketing phrasing from the venue's website, the input fields, or web results; rephrase it plainly. Avoid stock constructions like "X is today the center of..." (use "X sits at the center of" or "X has become...") and lifted flourishes like "the discerning clientele who relish in both".
- Lead with what the space IS: open with the venue name plus its type and character. Do not open with the total square footage.
- Refer to the venue by name, or as "the venue", "the space", or "it". Never call it "the address".
- Do NOT state the venue's TOTAL square footage: the pitch deck already has a dedicated square-footage field, so repeating it here is redundant. Cite square footage ONLY for a distinct sub-space or zone where the figure adds specific meaning (for example "the ground floor alone offers 5,000 sq ft of open layout", "a 1,500 sq ft courtyard extends the space outdoors", "a 500 sq ft balcony overlooks the water"). Other specific numbers (ceiling height, number of rooms or floors) are fine when they are a genuine selling point.
- Name-drop sparingly: at most two or three genuinely high-impact, credible names (galleries, restaurants, hotels, landmarks). Never an exhaustive list; pick the one or two most recognizable.
- Material- and light-forward language is strong: exposed brick, polished concrete, soaring ceilings, floor-to-ceiling glass, skylights, abundant natural light.
- Vary sentence length and opening structure across paragraphs so the database does not read as formulaic.
- Never use em dashes. Use commas, periods, or restructure the sentence.
</tone_and_style>

<do_not_include>
Leave out technical and production logistics entirely. The client audience does not care, and it makes the copy read like a spec sheet. Specifically avoid: power, amperage, electrical, generators; internet, fiber, wifi, bandwidth; rigging, truss and lighting-rig specs, AV equipment lists; back-of-house, BOH, green rooms, kitchen or prep specifics; load-in doors, freight elevators, docks, load-in dimensions; parking framed as "load-in access". If a feature only matters to a production crew, omit it. If an amenity is worth a mention, frame it for the guest or the look of the space (a rooftop is "outdoor programming space" or a view, not "parking" or "load-in").
</do_not_include>

<word_use_guidance>
Some softer adjectives are acceptable when they accurately describe the venue and are not used as filler. Use sparingly: vibrant, sophisticated, dynamic, refined, distinguished, contemporary, light-filled, design-forward.

Avoid entirely: perfect, premier, world-class, stunning, amazing, elevated experience, unparalleled, state-of-the-art, bespoke, curated, one-of-a-kind, hidden gem, must-see.

Do not itemize every amenity. Do not pad with marketing fluff.
</word_use_guidance>

<web_research_protocol>
For missing fields critical to a complete paragraph (most often Neighborhood, sometimes architectural history or distinguishing features), you may research the venue using available tools to fill gaps.

Strict rules for any researched content:
- Only use facts you can verify from authoritative sources: the venue's own website, official neighborhood or city tourism sources, established local press.
- Do not use facts pulled from blogs, listing aggregators, social media, or AI-generated summaries.
- If you cannot verify a fact with confidence, omit it. Do not hedge with "reportedly" or "is said to be."
- Never invent square footage, capacity, ceiling height, year built, or proprietary architectural detail.
- When in doubt, write a shorter paragraph from confirmed inputs only. A tight, fully grounded paragraph is better than a longer one with shaky claims.
- NEVER narrate your research in the output. Do not describe what you searched for, what you found, what you could or could not verify, or which sources you used. Silently use what you can verify and write only the paragraph.
</web_research_protocol>

<handling_missing_data>
- Build the paragraph from whatever combination of inputs and verified research you have.
- If after research you still cannot reach 3 sentences without inventing, write what you can. A grounded 2-sentence paragraph is acceptable rather than padding with invented detail.
</handling_missing_data>

<examples>
<example>
Input:
- Name: Studio 525
- Address: 525 West 24th Street
- Neighborhood: West Chelsea
- City: New York
- Type: White box event venue, warehouse
- Size (sq ft): 5,000
- Capacity: (not set)
- Website: (not set)
- Key features: 1936 warehouse building, 30-foot ceilings, large skylight, exposed steel beams, polished concrete floors, two upstairs mezzanines, built-in rigging, 400-amp power with cam lock, gigabit fiber, back-of-house entrance with kitchen, 11.5ft ground-floor entry door for vehicle load-in

Output:
Studio 525 is a white box event venue occupying a 1936 warehouse building on West 24th Street in Chelsea. Defined by 30-foot ceilings, a massive skylight, exposed steel beams, and polished concrete floors, the space has an industrial character within a fully neutral canvas. Two upstairs mezzanines add vertical dimension and programming zones. Large street-level entry doors accommodate outdoor visibility to vehicle drive-ins. The building sits in West Chelsea's historic arts district, a neighborhood with deep industrial roots that evolved into one of the city's most significant gallery corridors, with the High Line running directly alongside the block.
</example>

<example>
Input:
- Name: Chelsea Industrial
- Address: West 28th Street
- Neighborhood: Chelsea
- City: New York
- Type: Industrial event venue
- Size (sq ft): 22,000
- Capacity: (not set)
- Website: (not set)
- Key features: three bookable spaces (The Yard 15,000 sq ft, The Lounge, The Village), 18-foot ceilings, large internal LED screen, projection and truss lighting, two kitchens, floor-to-ceiling windows with retractable privacy screens, private entrance, built-in bar, back-of-house space, multiple entry points

Output:
Chelsea Industrial is an industrial event space on West 28th Street, positioned between Chelsea, Hudson Yards, and Midtown West. The venue boasts 18-foot ceilings throughout, and floor-to-ceiling windows facing across 28th Street and 11th Avenue, and offers three distinct spaces: The Yard, at 15,000 sq ft and featuring a large internal LED screen, truss lighting systems, and two kitchens; The Lounge, with a private entrance and built-in bar; and The Village, with multiple entrances and back-of-house spaces. Sitting at the convergence of Chelsea's gallery district and the developing Hudson Yards, it offers accessibility in prominent neighborhoods and proximity to the west side's rising commercial energy.
</example>

<example>
Input:
- Name: 8626 Melrose Ave
- Address: 8626 Melrose Avenue
- Neighborhood: West Hollywood Design District
- City: Los Angeles
- Type: Storefront retail, pop-up space
- Size (sq ft): 4,400
- Capacity: (not set)
- Website: (not set)
- Key features: 1957 corner building, large windows, track lighting, open layout, high ceilings, rear parking lot, rooftop

Output:
8626 Melrose Ave is a highly desirable storefront and pop-up space, positioned on the corner of Melrose Avenue and Huntley Drive, surrounded by high-end retail and restaurants. The space features large windows and track lighting throughout, an open layout, and high ceilings, making it a flexible canvas for any event. An uncovered rooftop offers parking spaces or opportunities for outdoor programming. Sitting squarely within the West Hollywood Design District, it's a natural draw for a fashion-forward, design-literate consumer base. Art and fashion aficionados, trend-setters, and celebrities frequent the area, ducking into high-end boutiques that make this corridor one of the strongest retail audiences in Los Angeles.
</example>

<example>
Input:
- Name: The Flat NYC
- Address: (not set)
- Neighborhood: Flatiron District
- City: New York
- Type: Multi-level event venue
- Size (sq ft): (not set)
- Capacity: (not set)
- Website: (not set)
- Key features: exposed brick walls, original woodwork, ceiling trusses, skylight, industrial-chic aesthetic, bold art pieces (red Marroquin telephone booth, pink neon light fixture), cast iron staircase, modern-furnished mezzanine lounge overlooking the main floor, outdoor balcony, freight elevator, in-house AV, steps from Madison Square Park, the Flatiron Building, and Eataly

Output:
The Flat NYC is a multi-level event venue in the Flatiron District, steps from Madison Square Park and the Flatiron Building, with Eataly across the street. The main floor pairs exposed brick, original woodwork, and ceiling trusses with a skylight that floods the space in natural light, anchored by an industrial-chic aesthetic and bold art accents like a red Marroquin phone booth and pink neon. A cast iron staircase climbs to a furnished lounge overlooking the floor, and a mezzanine and outdoor balcony extend the programming. The surrounding district is a sophisticated crossroads of tech, fashion, and fine dining that draws a design-conscious, well-heeled crowd suited to brands with something to say.
</example>

<example>
Input:
- Name: AT&T Discovery District
- Address: (not set)
- Neighborhood: Dallas Arts District / Downtown
- City: Dallas
- Type: Mixed-use development, event complex
- Size (sq ft): (not set)
- Capacity: (not set)
- Website: (not set)
- Key features: multiple indoor and outdoor event spaces, 104-foot LED 5K media wall, central plaza, AT&T world headquarters on site (6,000 employees daily), sophisticated AV, downtown Dallas Arts District

Output:
AT&T Discovery District is a mixed-use development in the heart of downtown Dallas, built around a network of indoor and outdoor event spaces and a 104-foot LED media wall that turns the central plaza into a dramatic backdrop for large-format moments. AT&T's world headquarters anchor the complex, bringing roughly 6,000 employees through the district every day, layered on top of steady downtown foot traffic and weekend crowds. The surrounding Dallas Arts District lends a polished, corporate-forward setting with cultural credibility, and the open plazas give activations real visibility, well suited to brands that want scale and a built-in daytime audience.
</example>

<example>
Input:
- Name: Astor Place
- Address: (not set)
- Neighborhood: NoHo / East Village
- City: New York
- Type: Public plaza, outdoor activation space
- Size (sq ft): (not set)
- Capacity: (not set)
- Website: (not set)
- Key features: open pedestrian plaza, high visibility, 360-degree exposure, Alamo cube landmark sculpture, constant foot traffic, retail/dining neighbors (MUJI, Wegmans, Toy Tokyo), near East Village/NoHo/Greenwich Village

Output:
Astor Place is a high-visibility public plaza at a busy downtown Manhattan crossroads where the East Village, NoHo, and Greenwich Village meet, anchored by the landmark Alamo cube sculpture. Its open, pedestrian-heavy layout gives activations 360-degree exposure to constant street-level foot traffic throughout the day and into the evening. Retail and dining neighbors such as MUJI and Wegmans keep a steady mix of students, commuters, and locals moving through at all hours. The plaza is built for high-impact, street-facing moments that depend on volume and visibility rather than a controlled guest list.
</example>
</examples>

<output_format>
CRITICAL: Your entire response is ONLY the finished paragraph, as plain text. Begin with the first word of the paragraph (the venue name) and end with the final sentence's period. Do NOT include any of the following: a preamble or introduction; any reasoning or research notes; any explanation of what you did, searched for, found, or could not verify; any separator such as "---"; any label or heading; any phrase such as "Here is the paragraph" or "Based on the available information". If you cannot say it inside the paragraph itself, do not say it at all.
</output_format>`;

/**
 * A `venues`-table row shaped for the HQ About Venue generator. All fields
 * optional / nullable except name; the builder degrades gracefully when a
 * field is missing.
 */
export type VenueOverviewRow = {
  name: string;
  address?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  total_sq_ft?: number | null;
  square_footage?: number | null;
  capacity?: number | null;
  website_url?: string | null;
  features?: string[] | null;
  venue_types?: string[] | null;
};

/**
 * Build the Claude user message (the `<venue_input>` data block) for the HQ
 * About Venue generator from a `venues` row. All instructions live in
 * ABOUT_VENUE_SYSTEM; this is data only. Field labels match the SYSTEM's
 * <input_fields> list exactly. Missing fields render as "(not set)" so Claude
 * treats them as unknown rather than inventing.
 */
export function buildOverviewUserMsgFromVenue(venue: VenueOverviewRow): string {
  const sqFt = venue.total_sq_ft ?? venue.square_footage ?? null;
  const features =
    Array.isArray(venue.features) && venue.features.length > 0
      ? venue.features.join(", ")
      : "(not set)";
  const types =
    Array.isArray(venue.venue_types) && venue.venue_types.length > 0
      ? venue.venue_types.join(", ")
      : "(not set)";

  return `<venue_input>
- Name: ${venue.name}
- Address: ${venue.address ?? "(not set)"}
- Neighborhood: ${venue.neighborhood ?? "(not set)"}
- City: ${venue.city ?? "(not set)"}
- Type: ${types}
- Size (sq ft): ${sqFt != null ? String(sqFt) : "(not set)"}
- Capacity: ${venue.capacity ?? "(not set)"}
- Website: ${venue.website_url ?? "(not set)"}
- Key features: ${features}
</venue_input>`;
}
