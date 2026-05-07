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

/** Display-only: show "jacquelinenuzzo.com" instead of full URL. */
export function cleanRootDomain(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
