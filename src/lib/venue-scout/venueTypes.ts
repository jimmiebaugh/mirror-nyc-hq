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

// Venue-type pill palette. Phase 6.5 follow-up (smoke feedback): replaced the
// desaturated "VS Pro" rgba palette (read too pastel/floral against the dark
// UI) with a bold, design-system-aligned scale. Each type maps to a saturated
// HSL hue in the app's pill idiom (fill ~22% / bright text / border ~55%,
// mirroring the status-pill convention in src/lib/venue-scout/format.ts). Four
// types use the exact HQ accent token VALUES (Event Venue = --info,
// Warehouse = --warn, Gallery = --purple, Outdoor = --success); the rest are
// bold hues in the same idiom. Coral (--primary) is intentionally NOT used
// (reserved for CTAs/links/active per design-system). Values are literal HSL
// (not var()) because this map is the static palette-key set kept in lockstep
// with the server mirror. Alphas/hues are a live tune during smoke.
// NOTE: fills/borders use comma-form hsla() (not the space/slash hsl(.. / ..)
// form) because Tailwind's opacity-modifier parser drops an arbitrary value
// that carries an in-bracket "/ alpha"; the comma form mirrors the old rgba()
// palette and emits reliably. Text uses comma-form hsl() (no alpha).
export const TYPE_STYLES: Record<CanonicalType, string> = {
  Retail:        "bg-[hsla(340,82%,62%,0.22)] text-[hsl(340,82%,72%)] border-[hsla(340,82%,62%,0.55)]",
  "Event Venue": "bg-[hsla(189,94%,43%,0.22)] text-[hsl(189,94%,52%)] border-[hsla(189,94%,43%,0.55)]",
  "White Box":   "bg-[hsla(214,16%,58%,0.22)] text-[hsl(214,16%,76%)] border-[hsla(214,16%,58%,0.55)]",
  Industrial:    "bg-[hsla(217,88%,60%,0.22)] text-[hsl(217,88%,72%)] border-[hsla(217,88%,60%,0.55)]",
  Warehouse:     "bg-[hsla(38,92%,50%,0.22)] text-[hsl(38,92%,56%)] border-[hsla(38,92%,50%,0.55)]",
  Gallery:       "bg-[hsla(268,86%,72%,0.22)] text-[hsl(268,86%,80%)] border-[hsla(268,86%,72%,0.55)]",
  Studio:        "bg-[hsla(300,70%,62%,0.22)] text-[hsl(300,70%,76%)] border-[hsla(300,70%,62%,0.55)]",
  Outdoor:       "bg-[hsla(142,76%,55%,0.22)] text-[hsl(142,76%,64%)] border-[hsla(142,76%,55%,0.55)]",
  Mobile:        "bg-[hsla(25,90%,56%,0.22)] text-[hsl(25,90%,66%)] border-[hsla(25,90%,56%,0.55)]",
};

export const TYPE_FALLBACK_STYLE =
  "bg-[hsla(0,0%,58%,0.20)] text-[hsl(0,0%,76%)] border-[hsla(0,0%,58%,0.5)]";

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
