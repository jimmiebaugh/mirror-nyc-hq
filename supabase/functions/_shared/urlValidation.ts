// Phase 4.10.3-port: post-emission URL validation.
//
// Smoke testing 2026-05-13 surfaced URL fabrication: Claude returns LoopNet /
// Crexi listing URLs with missing or invented path segments. The existing
// sanitizeWebsiteUrl in _shared/venueTypes.ts catches search pages + listing-
// database bare-homepage URLs but not fabricated URLs that match the syntax
// pattern. This adds a HEAD-request check + redirect-host + redirect-path
// comparison as a deterministic gate.
//
// Memory rule: feedback_tool_choice_collapse. AI output quality lives on
// schema description nudges + post-emission validation. This is the post-
// emission layer.

import { sanitizeWebsiteUrl } from "./venueTypes.ts";

const HEAD_TIMEOUT_MS = 5000;

// Real-browser User-Agent so listing-database hosts (LoopNet, Crexi,
// Storefront, etc.) don't bot-block the HEAD request. Smoke testing
// 2026-05-13 surfaced LoopNet returning 403 to all unidentified HEAD
// requests despite the URLs being valid for browser visitors. Recent
// stable Chrome on macOS; doesn't need to be exact, just needs to look
// like a browser.
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Reject only on definitively-gone status codes. 401 (auth required), 403
// (bot block or geo restriction), 405 (method not allowed -- some hosts
// don't implement HEAD), and 429 (rate-limited) are network-level signals
// that the URL is probably still valid for a real browser visitor; keep
// them. 5xx is transient and also kept. The producer can verify any kept
// URL in-browser and edit inline if it's actually dead.
const DEFINITELY_GONE_CODES = new Set([404, 410]);

/**
 * Validate a candidate website URL.
 *
 * 1. Run existing sanitizeWebsiteUrl (search pages, listing-database
 *    homepages, etc.).
 * 2. If sanitize accepts the URL, HEAD-request it with redirect following
 *    using a real browser User-Agent so anti-bot gates don't 403 us.
 * 3. Compare the final URL host to the request host. If different, reject
 *    (catches soft 404s that redirect to home / search pages).
 * 4. Compare the final URL pathname length to the request pathname. If the
 *    redirect drops to a significantly shorter path (e.g. /), the listing
 *    is gone; reject.
 * 5. 404 / 410 => reject (definitively gone). Every other 4xx (401, 403,
 *    405, 429, etc.) => keep (network-level block or method-not-supported;
 *    URL is likely valid for a browser visitor). 5xx => keep (transient).
 * 6. Timeout or network error => keep (do not block compile on slow servers).
 *
 * Returns null on any rejection. Returns the sanitized URL on accept.
 */
export async function validateWebsiteUrl(
  raw: unknown,
): Promise<string | null> {
  const sanitized = sanitizeWebsiteUrl(raw);
  if (!sanitized) return null;

  try {
    const requestUrl = new URL(sanitized);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), HEAD_TIMEOUT_MS);

    const res = await fetch(sanitized, {
      method: "HEAD",
      redirect: "follow",
      headers: { "User-Agent": BROWSER_UA },
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer));

    // Only definitively-gone codes reject. 401 / 403 / 405 / 429 keep --
    // those are server-side blocks (auth, bot detection, method not
    // supported, rate limit) that don't indicate a dead listing. 5xx keep
    // as well. The producer-side cost of a dropped-but-real URL is much
    // higher than the cost of a kept-but-dead URL (one inline edit).
    if (DEFINITELY_GONE_CODES.has(res.status)) {
      console.log(
        `[validateWebsiteUrl] reject ${sanitized}: status ${res.status}`,
      );
      return null;
    }

    // Final URL after redirects. If host differs, likely a soft 404 to a
    // home / search page; reject.
    const finalUrl = new URL(res.url);
    if (
      finalUrl.hostname.toLowerCase() !== requestUrl.hostname.toLowerCase()
    ) {
      console.log(
        `[validateWebsiteUrl] reject ${sanitized}: redirected to ${res.url} (host mismatch)`,
      );
      return null;
    }

    // Path-level soft-404 check: if the final path is significantly shorter
    // than the request path (e.g. listing URL redirected to /), the listing
    // is gone.
    if (
      finalUrl.pathname.length < requestUrl.pathname.length / 2 &&
      finalUrl.pathname !== requestUrl.pathname
    ) {
      console.log(
        `[validateWebsiteUrl] reject ${sanitized}: redirected to shorter path ${res.url}`,
      );
      return null;
    }

    return sanitized;
  } catch (e) {
    // Network error or timeout: keep the URL. Producer can fix if broken.
    console.log(
      `[validateWebsiteUrl] keep ${sanitized}: network error ${
        e instanceof Error ? e.message : "unknown"
      }`,
    );
    return sanitized;
  }
}

/**
 * Parallel-validate an array of URLs. Returns sanitized values in the same
 * order, null where rejected. Use when you have a batch (e.g. all venues in
 * a Claude research pass) and want HEAD requests to overlap.
 */
export async function validateWebsiteUrls(
  raws: Array<string | null | undefined>,
): Promise<Array<string | null>> {
  return Promise.all(raws.map((r) => validateWebsiteUrl(r)));
}
