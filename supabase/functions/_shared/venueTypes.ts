// Server-side mirror of src/lib/venue-scout/venueTypes.ts (canonical types +
// canonicalize logic only; UI styles stay client-side). Primed in Phase
// 4.1-port ahead of consumers: vs-parse-sheet (Phase 4.4-port) and
// vs-research-venues (Phase 4.5-port) will both import canonicalizeType +
// sanitizeWebsiteUrl so AI-research output and uploaded sheet rows
// canonicalize identically. The frontend mirror lands when the matrix
// surfaces port (Phase 4.6-port). Drift between this file and the eventual
// frontend mirror will produce mismatched venue type pills between the
// matrix and the source data; keep them in lock-step.

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
