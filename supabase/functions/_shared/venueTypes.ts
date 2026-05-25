// Server-side venue-type helpers.
//
// Phase 5.12.10 narrowed the lockstep contract: CANONICAL_TYPES is now
// the palette-key set (the keys TYPE_STYLES is indexed by on the
// frontend mirror); the runtime canonical set is whatever rows currently
// sit in `public.venue_types`, fetched per-request via
// getVenueTypesCanonicalSet. Producer-added types in HQ Settings flow
// through to every VS write path without a code change. Schema
// descriptions + system prompts stay static for prompt-cache stability
// (feedback_tool_choice_collapse); the live canonical list rides in the
// per-call user message.
//
// Legacy canonicalizeType + canonicalizeMultiType regex helpers were
// deleted in 5.12.10 (per OQ #1 + #2; existing VS data is testing
// records). Every write-path caller resolves against the runtime set via
// canonicalizeAgainst / canonicalizeMultiAgainst / sanitizeMultiAgainst.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export const CANONICAL_TYPES = [
  "Retail",
  "Event Venue",
  "White Box",
  "Industrial",
  "Warehouse",
  "Gallery",
  "Studio",
  "Outdoor",
  "Mobile",
] as const;

export type CanonicalType = (typeof CANONICAL_TYPES)[number];

export type VenueTypesCanonical = {
  names: readonly string[];
  /** Lowercased canonical name -> venue_types.id; used by deck push. */
  idByName: Map<string, string>;
};

/**
 * Phase 5.12.10: fetch the runtime canonical venue-types set from
 * public.venue_types ONCE per request. Returns BOTH the sorted names
 * array (for canonicalize callers) AND the id-by-lowercased-name map
 * (for vs-generate-deck's join inserts; consolidates the pre-5.12.10
 * ensureVenueTypesLoaded() helper per OQ #3).
 *
 * On error, returns the legacy CANONICAL_TYPES names + an empty
 * idByName map so a transient query failure doesn't collapse Claude's
 * prompt-building into an empty constraint. Deck push that hits the
 * fallback path silently skips join inserts (idByName empty); the
 * fresh-INSERT venues row still lands.
 */
export async function getVenueTypesCanonicalSet(
  sb: SupabaseClient,
  callerPrefix: string,
): Promise<VenueTypesCanonical> {
  const { data, error } = await sb
    .from("venue_types")
    .select("id, name")
    .order("name", { ascending: true });
  if (error || !data) {
    console.warn(
      `[${callerPrefix}] venue_types load failed, falling back to legacy CANONICAL_TYPES`,
      error,
    );
    return { names: CANONICAL_TYPES, idByName: new Map() };
  }
  const names: string[] = [];
  const idByName = new Map<string, string>();
  for (const row of data) {
    const nm = typeof row.name === "string" ? row.name.trim() : "";
    const id = typeof row.id === "string" ? row.id : "";
    if (!nm || !id) continue;
    names.push(nm);
    idByName.set(nm.toLowerCase(), id);
  }
  if (names.length === 0) {
    return { names: CANONICAL_TYPES, idByName };
  }
  return { names, idByName };
}

/**
 * Phase 5.12.10: case-insensitive canonicalize against a runtime set.
 * Returns the canonical-cased name on match, null otherwise.
 */
export function canonicalizeAgainst(
  raw: string,
  canonicalSet: readonly string[],
): string | null {
  const t = raw.trim().toLowerCase();
  if (!t) return null;
  for (const c of canonicalSet) {
    if (c.toLowerCase() === t) return c;
  }
  return null;
}

/**
 * Phase 5.12.10: DISPLAY-only multi-type runtime canonicalize. Splits
 * on `/` and `,`, canonicalizes each part against the runtime set,
 * joins with " / ". Returns the raw trimmed input when nothing
 * canonicalizes (the matrix's TYPE_FALLBACK_STYLE picks it up via
 * parseTypes). NEVER use on AI write paths -- the unknown-token
 * fallback would persist garbage. For write paths, see
 * sanitizeMultiAgainst below.
 */
export function canonicalizeMultiAgainst(
  raw: string,
  canonicalSet: readonly string[],
): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const parts = trimmed.split(/[/,]/).map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    const c = canonicalizeAgainst(p, canonicalSet);
    if (c && !out.includes(c)) out.push(c);
  }
  return out.length > 0 ? out.join(" / ") : trimmed;
}

/**
 * Phase 5.12.10: SERVER WRITE multi-type sanitizer. Same split + per-
 * token canonicalize + dedupe as canonicalizeMultiAgainst, but
 * returns NULL when nothing canonicalizes (matching the legacy Phase
 * A helper at vs-research-venues line 97-103 which was deleted; this
 * is its drop-in replacement).
 */
export function sanitizeMultiAgainst(
  raw: string,
  canonicalSet: readonly string[],
): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/[/,]/).map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    const c = canonicalizeAgainst(p, canonicalSet);
    if (c && !out.includes(c)) out.push(c);
  }
  return out.length > 0 ? out.join(" / ") : null;
}

const LISTING_DATABASE_HOSTS = new Set([
  "thestorefront.com",
  "peerspace.com",
  "propertyshark.com",
  "loopnet.com",
  "crexi.com",
  "splacer.co",
  "www.thestorefront.com",
  "www.peerspace.com",
  "www.propertyshark.com",
  "www.loopnet.com",
  "www.crexi.com",
  "www.splacer.co",
]);

/**
 * Reject search/browse pages on any host so the matrix doesn't link producers
 * to a listing-platform search-results URL. For listing-database hosts
 * (Storefront, Peerspace, etc.), null bare homepages but let deep links
 * through, since a peerspace.com/spaces/12345-style URL IS a specific venue's
 * detail page and is the only verifiable source when the venue has no
 * dedicated site. Returns null for blocked / invalid URLs so the caller can
 * simply skip that field.
 */
export function sanitizeWebsiteUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  // Reject search/browse pages on any host. Detail pages with non-search
  // query strings (?listing=, ?id=) pass through.
  const SEARCH_BROWSE_PATTERNS = [
    /\/search\b/i,
    /\/s\/[a-z]{2}(\/|$)/i,
    /\/hire\//i,
    /[?&](q|search|query)=/i,
  ];
  const pathAndQuery = url.pathname + url.search;
  if (SEARCH_BROWSE_PATTERNS.some((p) => p.test(pathAndQuery))) return null;

  // Listing-database hosts: null bare homepages, let deep links through.
  // Was previously a wholesale host block; deep links to specific listings
  // (peerspace.com/spaces/12345 etc.) are exactly the kind of URL we want
  // in the matrix when the venue lacks its own dedicated site.
  if (
    LISTING_DATABASE_HOSTS.has(url.hostname.toLowerCase()) &&
    (url.pathname === "/" || url.pathname === "")
  ) {
    return null;
  }

  return url.toString();
}

// Post-4.10.4 hot patch round 7: placeholder-string sanitizer.
//
// Symptom: with key_features added to FILL_TOOL.required + minItems on
// recommendations / considerations / key_features, Claude was filling
// schema-required arrays with placeholder tokens like '<UNKNOWN>',
// 'TBD', 'N/A' when it didn't have real data. The schema constraint
// removed the "return empty array" escape hatch but Claude found a new
// one: emit literal "I don't know" sentinels to satisfy the structure.
//
// This filter strips those out at the patch boundary. The schema
// descriptions also now explicitly forbid placeholders (the primary
// lever per feedback_tool_choice_collapse memory rule), and this
// post-emission cleanup is the safety net.
//
// Pattern: any string whose case-folded + punctuation-stripped form
// matches a known "I don't know" sentinel is dropped. Length cap of 32
// chars keeps real short observations like "Adjacent municipal lot"
// from being accidentally flagged.
const PLACEHOLDER_TOKENS = new Set([
  "unknown",
  "tbd",
  "tba",
  "na",
  "none",
  "null",
  "notavailable",
  "notprovided",
  "notspecified",
  "notapplicable",
  "notset",
  "notfound",
  "noinformation",
  "nodata",
  "noinfo",
  "pending",
  "placeholder",
  "todo",
  "fixme",
]);

export function isPlaceholderString(raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return true;
  if (trimmed.length > 32) return false;
  // Strip angle brackets, square brackets, parentheses, dashes,
  // periods, slashes, and whitespace. What remains is the bare token
  // we compare against PLACEHOLDER_TOKENS.
  const stripped = trimmed
    .toLowerCase()
    .replace(/[<>[\](){}\s\-./_]/g, "");
  return PLACEHOLDER_TOKENS.has(stripped);
}

export function stripPlaceholders(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .filter((s) => !isPlaceholderString(s))
    .map((s) => s.trim());
}

/**
 * Post-emission tag-shape sanitizer. Composes with `stripPlaceholders`:
 *   sanitizeTagShape(stripPlaceholders(claudeOutput))
 *
 * Drops items that violate the evergreen-tag shape locked Phase 5.12.13.1:
 *   - non-strings, empty strings (defense in depth; `stripPlaceholders`
 *     already filters)
 *   - any digit anywhere in the string (catches "24,806 sq ft",
 *     "Walk Score of 96", "1957 corner building", "100+ year-old", year
 *     ranges like "1917-1923")
 *   - more than 4 whitespace-separated words (catches narrative items
 *     like "Garden-industrial hybrid space with greenhouse, showroom,
 *     and outdoor deck")
 *   - more than 35 characters (defense in depth: schema enforces
 *     `items.maxLength: 35`, but Claude occasionally ignores it under
 *     forced-tool conditions)
 *   - case-insensitive duplicates (preserves the first occurrence's
 *     casing)
 *
 * Trims surrounding whitespace before length/word checks. Returns an
 * empty array when nothing usable remains; the caller's existing
 * `if (cleaned.length > 0) patch.key_features = cleaned` gate handles
 * the missing-field case.
 *
 * Deliberately does NOT strip items matching a CANONICAL_TYPES token
 * even though "don't double-encode venue types" is in the schema
 * description. Reason: "Outdoor" is both a canonical venue type AND a
 * legitimate evergreen feature tag in Jimmie's locked tag list, so
 * strict exact-match would strip a valid tag. Substring-match would
 * over-trigger on legitimate tags ("Industrial Brick"). The narrative
 * cases this rule would catch all fail the > 4 words check anyway, so
 * the word-count rule covers them.
 */
export function sanitizeTagShape(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of items) {
    if (typeof v !== "string") continue;
    const t = v.trim();
    if (t.length === 0 || t.length > 35) continue;
    if (/\d/.test(t)) continue;
    const wordCount = t.split(/\s+/).filter(Boolean).length;
    if (wordCount > 4) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

// Post-4.10.4 hot patch round 13: pick a URL from web_search results
// that best matches a given venue. Used as a fallback when Claude's
// tool output left website_url null but the search results clearly
// contained valid URLs for the venue.
//
// Algorithm: tokenize the venue name into meaningful words (drop common
// suffixes like "venue", "space", "studio", "the"). For each search
// result, score by how many venue tokens appear in the result's title
// (case-insensitive). Pick the highest-scoring result whose URL passes
// sanitizeWebsiteUrl. Ties broken by earliest position in the results
// list (search-engine-relevance order).
//
// Returns null when no result has at least one matching token, or all
// matching results have URLs that the sanitizer rejects.
const NAME_NOISE_WORDS = new Set([
  "the", "a", "an", "and", "of", "at", "in", "on", "for", "with",
  "venue", "space", "spaces", "studio", "studios", "loft", "lofts",
  "gallery", "galleries", "warehouse", "warehouses", "building",
  "center", "centre", "place", "house", "hall", "room", "rooms",
  "events", "event", "rental", "rentals", "vacancy", "storefront",
  "retail", "ground", "floor", "lower", "upper", "main",
]);

function tokenizeVenueName(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !NAME_NOISE_WORDS.has(t));
}

export function findBestSearchResultUrl(
  venueName: string,
  results: ReadonlyArray<{ url: string; title: string }>,
): string | null {
  const venueTokens = tokenizeVenueName(venueName);
  if (venueTokens.length === 0) return null;
  let best: { url: string; score: number; index: number } | null = null;
  for (let i = 0; i < results.length; i += 1) {
    const r = results[i];
    const titleLower = r.title.toLowerCase();
    const score = venueTokens.reduce(
      (acc, t) => acc + (titleLower.includes(t) ? 1 : 0),
      0,
    );
    if (score === 0) continue;
    const cleaned = sanitizeWebsiteUrl(r.url);
    if (!cleaned) continue;
    if (
      best === null ||
      score > best.score ||
      (score === best.score && i < best.index)
    ) {
      best = { url: cleaned, score, index: i };
    }
  }
  return best?.url ?? null;
}
