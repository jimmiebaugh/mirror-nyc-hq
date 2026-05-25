// Frontend venue-type palette + parser.
//
// Phase 5.12.10 narrowed the lockstep contract with the server mirror
// (supabase/functions/_shared/venueTypes.ts): CANONICAL_TYPES + TYPE_STYLES
// + TYPE_FALLBACK_STYLE are the legacy 9-key palette keying set. The
// runtime canonical set is whatever rows currently sit in
// `public.venue_types`, read at render time via useVenueTypes
// (src/lib/venue-scout/useVenueTypes.ts). Producer adds in HQ Settings
// flow through to every VS surface automatically.
//
// Legacy canonicalizeType + canonicalizeMultiType regex helpers were
// deleted in 5.12.10 (per OQ #1 + #2; existing VS data is testing
// records). VenueTypePill migrates to the new paletteForType helper;
// every other caller resolves against the runtime set via useVenueTypes.

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

// Venue-type pill palette. Lifted verbatim from VS Pro
// (src/components/sourcing/matrix/primitives.tsx). These rgba values are an
// intentional desaturated brand-context palette; do NOT substitute HQ design
// tokens here. See docs/decisions.md Phase 4.6-port for rationale.
export const TYPE_STYLES: Record<CanonicalType, string> = {
  Retail:        "bg-[rgba(181,133,136,0.18)] text-[#D89BA0] border-[rgba(181,133,136,0.42)]",
  "Event Venue": "bg-[rgba(104,142,142,0.18)] text-[#8FB3B3] border-[rgba(104,142,142,0.42)]",
  "White Box":   "bg-[rgba(140,140,144,0.18)] text-[#BCBCC0] border-[rgba(140,140,144,0.42)]",
  Industrial:    "bg-[rgba(120,146,171,0.18)] text-[#94B0C8] border-[rgba(120,146,171,0.42)]",
  Warehouse:     "bg-[rgba(168,147,112,0.18)] text-[#C8B190] border-[rgba(168,147,112,0.42)]",
  Gallery:       "bg-[rgba(144,128,176,0.18)] text-[#B5A3D4] border-[rgba(144,128,176,0.42)]",
  Studio:        "bg-[rgba(124,124,144,0.18)] text-[#A6A6BC] border-[rgba(124,124,144,0.40)]",
  Outdoor:       "bg-[rgba(144,163,128,0.18)] text-[#A8C098] border-[rgba(144,163,128,0.42)]",
  Mobile:        "bg-[rgba(168,132,104,0.18)] text-[#CCA088] border-[rgba(168,132,104,0.42)]",
};

export const TYPE_FALLBACK_STYLE =
  "bg-[rgba(124,124,144,0.18)] text-[#A6A6BC] border-[rgba(124,124,144,0.40)]";

/**
 * Phase 5.12.10: case-insensitive palette lookup. Returns the rgba
 * palette class for a legacy palette key (case-insensitive match
 * against CANONICAL_TYPES), falling back to TYPE_FALLBACK_STYLE for
 * any other token (producer-added types, legacy data with non-
 * canonical names). Lowercase + canonical-case input both resolve
 * the same palette so "retail" and "Retail" render identically.
 *
 * Use this helper for non-hook callers like VenueTypePill. Hook-
 * based callers should use useVenueTypes().paletteFor instead.
 */
export function paletteForType(name: string | null | undefined): string {
  if (!name) return TYPE_FALLBACK_STYLE;
  const target = name.trim().toLowerCase();
  for (const canonical of CANONICAL_TYPES) {
    if (canonical.toLowerCase() === target) {
      return TYPE_STYLES[canonical];
    }
  }
  return TYPE_FALLBACK_STYLE;
}

/**
 * Phase 5.12.10: parse a slash/comma-separated venue_type string into
 * an ordered, deduped list of type tokens. When `canonicalSet` is
 * provided AND non-empty, tokens are case-insensitively matched
 * against the runtime canonical set; matches resolve to the canonical
 * casing, non-matches keep their original trimmed casing (rendered
 * via TYPE_FALLBACK_STYLE by the pill renderer). When `canonicalSet`
 * is undefined OR empty (transient load / error state where
 * `useVenueTypes()` returns names: [] before the cache populates),
 * falls back to the legacy static `CANONICAL_TYPES` so callers
 * without a hook-loaded set still resolve legacy types.
 *
 * Returns `string[]` (no longer the narrow `CanonicalType[]`) so the
 * pill renderer can surface fallback-styled tokens for runtime-only
 * additions.
 */
export function parseTypes(
  raw: string | null,
  canonicalSet?: readonly string[],
): string[] {
  if (!raw) return [];
  const parts = raw.split(/[/,]/).map((s) => s.trim()).filter(Boolean);
  const set =
    canonicalSet && canonicalSet.length > 0
      ? canonicalSet
      : (CANONICAL_TYPES as readonly string[]);
  const out: string[] = [];
  for (const p of parts) {
    const lower = p.toLowerCase();
    let resolved: string | null = null;
    for (const c of set) {
      if (c.toLowerCase() === lower) {
        resolved = c;
        break;
      }
    }
    const emit = resolved ?? p;
    if (!out.includes(emit)) out.push(emit);
  }
  return out;
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

  const SEARCH_BROWSE_PATTERNS = [
    /\/search\b/i,
    /\/s\/[a-z]{2}(\/|$)/i,
    /\/hire\//i,
    /[?&](q|search|query)=/i,
  ];
  const pathAndQuery = url.pathname + url.search;
  if (SEARCH_BROWSE_PATTERNS.some((p) => p.test(pathAndQuery))) return null;

  if (
    LISTING_DATABASE_HOSTS.has(url.hostname.toLowerCase()) &&
    (url.pathname === "/" || url.pathname === "")
  ) {
    return null;
  }

  return url.toString();
}

/**
 * Root host for an inline website link: strips protocol + leading `www.`.
 * Falls back to the raw string for unparseable input. Shared by VenueEdit
 * + VenueDetail (was a per-file copy before the Phase 5.10.1 dedupe).
 */
