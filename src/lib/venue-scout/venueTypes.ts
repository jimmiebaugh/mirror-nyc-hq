// Frontend mirror of supabase/functions/_shared/venueTypes.ts. The two files
// are kept in lock-step per port plan § 6 (Phase 4.1-port primed the server
// side ahead of consumers; Phase 4.6-port lands this mirror when the matrix
// surfaces). Any change to CANONICAL_TYPES, TYPE_STYLES, canonicalizeType,
// canonicalizeMultiType, parseTypes, or sanitizeWebsiteUrl touches BOTH files
// in the same commit. Drift produces mismatched venue type pills between the
// matrix UI and the AI-research / sheet-parsed source data.

export const CANONICAL_TYPES = [
  "Retail",
  "Event Venue",
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
  Retail:      "bg-[rgba(181,133,136,0.18)] text-[#D89BA0] border-[rgba(181,133,136,0.42)]",
  "Event Venue": "bg-[rgba(104,142,142,0.18)] text-[#8FB3B3] border-[rgba(104,142,142,0.42)]",
  Industrial:  "bg-[rgba(120,146,171,0.18)] text-[#94B0C8] border-[rgba(120,146,171,0.42)]",
  Warehouse:   "bg-[rgba(168,147,112,0.18)] text-[#C8B190] border-[rgba(168,147,112,0.42)]",
  Gallery:     "bg-[rgba(144,128,176,0.18)] text-[#B5A3D4] border-[rgba(144,128,176,0.42)]",
  Studio:      "bg-[rgba(124,124,144,0.18)] text-[#A6A6BC] border-[rgba(124,124,144,0.40)]",
  Outdoor:     "bg-[rgba(144,163,128,0.18)] text-[#A8C098] border-[rgba(144,163,128,0.42)]",
  Mobile:      "bg-[rgba(168,132,104,0.18)] text-[#CCA088] border-[rgba(168,132,104,0.42)]",
};

export const TYPE_FALLBACK_STYLE =
  "bg-[rgba(124,124,144,0.18)] text-[#A6A6BC] border-[rgba(124,124,144,0.40)]";

export function canonicalizeType(raw: string): CanonicalType | null {
  const t = raw.trim().toLowerCase();
  if (!t) return null;
  for (const c of CANONICAL_TYPES) if (t === c.toLowerCase()) return c;
  if (/(industrial)/.test(t) && /(warehouse)/.test(t)) return null;
  if (/storefront|retail|commercial|ground[- ]?floor|vacancy|pop[- ]?up/.test(t)) {
    return "Retail";
  }
  if (/warehouse/.test(t)) return "Warehouse";
  if (/industrial/.test(t)) return "Industrial";
  if (/gallery/.test(t)) return "Gallery";
  if (/studio|soundstage/.test(t)) return "Studio";
  if (/theater|ballroom|event|club|music venue/.test(t)) return "Event Venue";
  if (/outdoor|park|plaza|rooftop|courtyard/.test(t)) return "Outdoor";
  if (/mobile|truck|vehicle|cart/.test(t)) return "Mobile";
  return null;
}

/**
 * For multi-type strings ("Warehouse / Gallery"), canonicalize each segment
 * and return the joined result. If nothing canonicalizes, return the original
 * trimmed input so the matrix's TYPE_FALLBACK_STYLE picks it up.
 */
export function canonicalizeMultiType(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const parts = trimmed
    .split(/[/,]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    const c = canonicalizeType(p);
    if (c && !out.includes(c)) out.push(c);
  }
  return out.length > 0 ? out.join(" / ") : trimmed;
}

/** Matrix-friendly: returns the canonical types in order, deduped. */
export function parseTypes(raw: string | null): CanonicalType[] {
  if (!raw) return [];
  const parts = raw.split(/[/,]/).map((s) => s.trim()).filter(Boolean);
  const out: CanonicalType[] = [];
  for (const p of parts) {
    const c = canonicalizeType(p);
    if (c && !out.includes(c)) out.push(c);
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
export function prettyHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
