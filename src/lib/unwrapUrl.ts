// Frontend mirror of supabase/functions/_shared/unwrapUrl.ts (unwrap part only).
// Strips common email-security wrappers so the user sees and clicks the real
// URL instead of routing through Google/Outlook/Mimecast/etc. redirects.
//
// Phase 3.6: applied to portfolio link rendering across HQ
// (CandidateTable, CandidateDetail, FinalReviewDetail) so candidates whose
// emails came through a wrapped-link service still resolve to the actual
// portfolio site. Defensive, low-cost.
export function unwrapSecurityWrapper(url: string): string {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    if (hostname.includes("edgepilot.com")) {
      const inner = parsed.searchParams.get("u");
      if (inner) return decodeURIComponent(inner);
    }
    if (hostname.includes("urldefense.com") || hostname.includes("urldefense.proofpoint.com")) {
      const inner = parsed.searchParams.get("url") || parsed.searchParams.get("u");
      if (inner) return decodeURIComponent(inner);
    }
    if (hostname.includes("safelinks.protection.outlook.com")) {
      const inner = parsed.searchParams.get("url");
      if (inner) return decodeURIComponent(inner);
    }
    if (hostname.includes("protect-eu.mimecast.com") || hostname.includes("protect.mimecast.com")) {
      const inner = parsed.searchParams.get("url");
      if (inner) return decodeURIComponent(inner);
    }
    if (hostname.includes("linkprotect.cudasvc.com")) {
      const inner = parsed.searchParams.get("a") || parsed.searchParams.get("url");
      if (inner) return decodeURIComponent(inner);
    }
    return url;
  } catch {
    return url;
  }
}

/**
 * Phase 3.7.3.7: normalize a URL into a comparable canonical form for
 * dedup. Same address presented as `http://www.x.com`, `www.x.com`,
 * `x.com`, `https://x.com/` should all map to the same key.
 *
 * Rules:
 *   - lowercase host
 *   - drop leading www.
 *   - drop trailing slashes from path
 *   - drop the protocol (treat http and https as equivalent)
 *   - keep the path + query (different paths on same host = different links)
 */
function normalizeUrl(url: string): string {
  if (!url) return "";
  const cleaned = unwrapSecurityWrapper(url).trim();
  try {
    const u = new URL(cleaned);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "");
    return host + path + u.search;
  } catch {
    // Bare hostnames without a protocol — make a best-effort canonical form.
    return cleaned
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/+$/, "");
  }
}

/**
 * Dedupe a list of URLs by normalized form, preserving original first-seen
 * order. Optionally filter out URLs that match an "exclude" URL (used to
 * hide the portfolio link from the generic resume-and-files list).
 */
export function dedupeUrls<T extends { url: string }>(
  items: T[],
  excludeUrl?: string | null,
): T[] {
  const seen = new Set<string>();
  if (excludeUrl) seen.add(normalizeUrl(excludeUrl));
  const out: T[] = [];
  for (const item of items) {
    const key = normalizeUrl(item.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
