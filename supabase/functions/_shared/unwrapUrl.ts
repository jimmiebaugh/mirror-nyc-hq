// Strip common email-security wrappers (EdgePilot, ProofPoint, MS Safe Links,
// Mimecast, Barracuda) so we evaluate the real destination URL.
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

const SOCIAL_HOSTS = [
  "linkedin.com", "instagram.com", "facebook.com", "twitter.com", "x.com",
  "threads.net", "tiktok.com", "youtube.com", "youtu.be", "medium.com",
];
const KNOWN_PORTFOLIO_HOSTS = [
  "behance.net", "dribbble.com", "cargo.site", "are.na", "format.com",
  "myportfolio.com", "readymag.com", "squarespace.com", "foliolink.com",
  "archinect.com", "coroflot.com", "carbonmade.com", "crevado.com",
];
const PERSONAL_TLDS = [".me", ".design", ".studio", ".work", ".art", ".co", ".io"];
const RECOGNIZED_TLDS = ["com", "co", "io", "me", "design", "studio", "work", "art", "net", "org"];
const PATH_PORTFOLIO_RE = /(portfolio|work|projects|design)/i;
const ANCHOR_KEYWORDS = /(portfolio|my work|work|site|web|case studies)/i;
const LABEL_RE = /(portfolio|site|web|link|work|online)\s*:/i;

function alnum(s: string): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function rootDomain(host: string): string {
  const parts = host.toLowerCase().split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  return parts.slice(-2).join(".");
}

function isolateSignatureBlock(text: string, candidateName?: string): string {
  if (!text) return "";
  const lines = text.split(/\r?\n/);
  const markers = [/^--\s*$/i, /^best,?\s*$/i, /^thanks,?\s*$/i, /^sincerely,?\s*$/i, /^sent from /i];
  let cutFromIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    const ln = lines[i].trim();
    if (!ln) continue;
    if (markers.some((re) => re.test(ln))) { cutFromIdx = i; break; }
    if (candidateName && alnum(ln) === alnum(candidateName) && ln.length < 60) { cutFromIdx = i; break; }
  }
  if (cutFromIdx < 0) return "";
  return lines.slice(cutFromIdx).join("\n");
}

/** Decode common HTML entities used in href values. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ");
}

/** Extract {href, anchorText} pairs from an HTML email body via regex (no DOM). */
export function extractAnchorsFromHtml(html: string): { url: string; anchorText: string }[] {
  if (!html) return [];
  const out: { url: string; anchorText: string }[] = [];
  const re = /<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = decodeEntities(m[1]).trim();
    const text = decodeEntities(m[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (!href || href.startsWith("mailto:") || href.startsWith("#")) continue;
    if (!/^https?:\/\//i.test(href)) continue;
    out.push({ url: href, anchorText: text });
  }
  return out;
}

/** Detect bare-domain references (e.g. "Abbyblankdesign.com") not already formatted as URLs. */
export function extractBareDomains(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  const tldGroup = RECOGNIZED_TLDS.join("|");
  // Require a leading boundary that isn't a sentence-ending letter+period; reject if preceded by @
  const re = new RegExp(
    String.raw`(?<![A-Za-z0-9@._-])([a-zA-Z][a-zA-Z0-9-]{1,}(?:\.[a-zA-Z0-9-]+)*\.(?:${tldGroup}))(?![A-Za-z0-9-])`,
    "gi",
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = m[1];
    // Sentence-boundary heuristic: token preceded by a lowercase letter+period (".Com" inside "...end.Com next")
    const startIdx = m.index;
    const prev2 = text.slice(Math.max(0, startIdx - 2), startIdx);
    if (/[a-z]\.$/.test(prev2 + ".")) {
      // Check the character right before the match — if it's a letter, treat as sentence-glue
      const charBefore = text[startIdx - 1] ?? "";
      if (/[a-zA-Z]/.test(charBefore)) continue;
    }
    // Reject if part of a path or already a URL (http(s)://) — leading char wouldn't be word but check window
    const before = text.slice(Math.max(0, startIdx - 8), startIdx).toLowerCase();
    if (before.endsWith("://") || before.endsWith("//")) continue;
    // Reject if it looks like a filename (preceded by letters and "." => already handled by lookbehind for letters,
    // but extension-style tokens like "image.png" share no TLD on our list, so they won't match).
    out.push(`https://${raw}/`);
  }
  return Array.from(new Set(out.map((u) => u.toLowerCase())));
}

export type PortfolioScoringContext = {
  candidateName?: string;
  /** Free-form text used to detect employer mentions (resume/cover-letter text). */
  resumeText?: string;
  /** Email body text used to detect signature-only URLs. */
  emailBodyText?: string;
  /** URL → anchor text(s) extracted from HTML email body. */
  anchorTextByUrl?: Record<string, string[]>;
  /** URLs preceded by a Portfolio:/Site:/Web:/Link:/Work:/Online: label within 3 words. */
  labeledUrls?: Set<string>;
  /** URLs that appear in the resume header (top ~10 lines). */
  headerUrls?: Set<string>;
};

function detectEmployerDomains(resumeText: string): string[] {
  if (!resumeText) return [];
  const head = resumeText.slice(0, 3000);
  const m = head.match(/[a-z0-9-]+\.(?:com|co|io|design|studio|art|me|net|org)/gi) ?? [];
  return Array.from(new Set(m.map((d) => d.toLowerCase()))).slice(0, 6);
}

export function scorePortfolioUrl(url: string, ctx: PortfolioScoringContext = {}): number {
  let score = 0;
  let host = "";
  let pathname = "";
  try {
    const u = new URL(url);
    host = u.hostname.toLowerCase();
    pathname = (u.pathname + u.search).toLowerCase();
  } catch { return -100; }

  // Social/non-portfolio hard penalty
  if (SOCIAL_HOSTS.some((h) => host === h || host.endsWith("." + h))) score -= 8;

  // Name-in-domain
  const tokens: string[] = [];
  if (ctx.candidateName) {
    const parts = ctx.candidateName.trim().split(/\s+/);
    if (parts[0]) tokens.push(alnum(parts[0]));
    if (parts.length > 1) tokens.push(alnum(parts[parts.length - 1]));
  }
  const hostAlnum = alnum(host);
  if (tokens.some((t) => t.length >= 3 && hostAlnum.includes(t))) score += 10;

  // Path/filename keywords
  if (PATH_PORTFOLIO_RE.test(pathname)) score += 8;

  // Known portfolio host
  if (KNOWN_PORTFOLIO_HOSTS.some((h) => host === h || host.endsWith("." + h))) score += 6;

  // Personal TLD (only if name-like domain present)
  const nameLike = tokens.some((t) => t.length >= 3 && hostAlnum.includes(t));
  if (nameLike && PERSONAL_TLDS.some((tld) => host.endsWith(tld))) score += 4;

  // Employer penalty
  const employers = detectEmployerDomains(ctx.resumeText ?? "");
  const root = rootDomain(host);
  if (employers.some((e) => rootDomain(e) === root)) score -= 5;

  // --- v3 signals ---
  const anchors = ctx.anchorTextByUrl?.[url] ?? [];
  const anchorHit = anchors.some((t) => ANCHOR_KEYWORDS.test(t));
  if (anchorHit) score += 15;

  const labeled = ctx.labeledUrls?.has(url) ?? false;
  if (labeled) score += 12;

  if (ctx.headerUrls?.has(url)) score += 8;

  // Signature-only penalty (skipped when explicit anchor or label signals fire)
  if (ctx.emailBodyText && !anchorHit && !labeled) {
    const sig = isolateSignatureBlock(ctx.emailBodyText, ctx.candidateName);
    const body = ctx.emailBodyText;
    if (sig && sig.includes(url) && !body.replace(sig, "").includes(url)) score -= 3;
  }

  return score;
}

/**
 * Pick the best portfolio URL from a list of (already unwrapped) URLs using a
 * fitness score. Dedupes to root domain. Fallback: if exactly one URL exists
 * and its score is >= 0 (not actively penalized), promote it.
 */
export function pickBestPortfolioUrl(
  urls: string[],
  ctx: PortfolioScoringContext = {},
): string | null {
  if (!urls?.length) return null;
  const scored = urls
    .map((url, idx) => ({
      url,
      idx,
      score: scorePortfolioUrl(url, ctx),
      root: (() => { try { return rootDomain(new URL(url).hostname); } catch { return ""; } })(),
    }))
    .filter((s) => s.root);

  if (scored.length === 0) return null;

  // Dedupe by root domain (keep highest-scoring per root).
  const byRoot = new Map<string, typeof scored[number]>();
  for (const s of scored) {
    const cur = byRoot.get(s.root);
    if (!cur || s.score > cur.score || (s.score === cur.score && s.idx < cur.idx)) byRoot.set(s.root, s);
  }
  const winners = Array.from(byRoot.values()).sort((a, b) => b.score - a.score || a.idx - b.idx);
  const best = winners[0];
  if (!best) return null;

  if (best.score > 0) return best.url;

  // Fallback rule: single neutral URL → promote.
  if (winners.length === 1 && best.score >= 0) return best.url;

  return null;
}

/** Pick a portfolio PDF attachment from a Gmail attachment list. Largest wins. */
export function pickPortfolioAttachment<T extends { filename?: string | null; mimeType?: string | null; size?: number | null }>(
  attachments: T[] | null | undefined,
): T | null {
  if (!attachments?.length) return null;
  const matches = attachments.filter((a) => {
    const fn = (a.filename ?? "").toLowerCase();
    const isPdf = (a.mimeType ?? "").includes("pdf") || /\.pdf$/i.test(fn);
    return isPdf && /portfolio/i.test(fn);
  });
  if (matches.length === 0) return null;
  matches.sort((a, b) => (b.size ?? 0) - (a.size ?? 0));
  return matches[0];
}

// ============================================================
// URL extraction helpers used by ingest functions.
// ============================================================

/** Plain-text URL extraction with cleanup, dedupe, and security-wrapper unwrap. */
export function extractPlainUrls(text: string): string[] {
  if (!text) return [];
  const matches = text.match(/https?:\/\/[^\s<>"'\])]+/g) ?? [];
  const cleaned = matches
    .map((u) => u.replace(/[.,;:!?)\]>]+$/g, ""))
    .map((u) => unwrapSecurityWrapper(u))
    .filter(filterUrl);
  return Array.from(new Set(cleaned));
}

/**
 * Generic tool / SaaS / social hostnames that should never be treated as a
 * candidate's portfolio URL. Match logic is hostname suffix (so subdomains
 * also block). Strip leading "www." before checking.
 */
export const BLOCKED_PORTFOLIO_DOMAINS: string[] = [
  "monday.com", "notion.com", "notion.so", "asana.com", "trello.com",
  "atlassian.com", "jira.com", "slack.com",
  "google.com", "docs.google.com", "drive.google.com", "gmail.com",
  "microsoft.com", "office.com", "sharepoint.com",
  "adobe.com", "creativecloud.com", "figma.com", "canva.com",
  "miro.com", "mural.co", "zoom.us", "airtable.com",
  "hubspot.com", "salesforce.com", "mailchimp.com",
  "dropbox.com", "box.com", "quickbooks.com",
  "zendesk.com", "intercom.com", "loom.com", "calendly.com",
  "wikipedia.org", "youtube.com", "vimeo.com", "spotify.com", "apple.com",
  "linkedin.com", "twitter.com", "x.com", "facebook.com",
  "instagram.com", "threads.net", "tiktok.com",
  // Phase 3.7.8.15: block Mirror's own domain — referral forwards carry
  // the manager's email signature with mirrornyc.com / @mirror_nyc, and
  // the portfolio picker was promoting that as the candidate's
  // portfolio link. mirrornyc.com is never a valid portfolio URL.
  "mirrornyc.com",
];

export function isBlockedPortfolioHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  return BLOCKED_PORTFOLIO_DOMAINS.some((d) => host === d || host.endsWith("." + d));
}

export function filterUrl(u: string): boolean {
  const lower = u.toLowerCase();
  if (lower.startsWith("mailto:")) return false;
  if (/\.(png|jpg|jpeg|gif|svg|ico|css|js)(\?|$)/i.test(lower)) return false;
  if (/(googletagmanager|google-analytics|doubleclick|mailchimp\.com\/track|list-manage\.com\/track|sendgrid\.net\/wf|mandrillapp\.com\/track)/i.test(lower)) return false;
  try {
    const parsed = new URL(u);
    if (isBlockedPortfolioHost(parsed.hostname)) return false;
  } catch {
    return false;
  }
  return true;
}

/**
 * Build the full PortfolioScoringContext + canonical URL list from raw inputs.
 * Combines plain-text URLs, HTML anchors, and bare-domain mentions; detects
 * label-prefixed URLs and resume-header URLs.
 */
export function buildPortfolioInputs(opts: {
  candidateName?: string;
  bodyPlain: string;
  bodyHtml?: string;
  attachText: string;
}): { urls: string[]; ctx: PortfolioScoringContext } {
  const { candidateName, bodyPlain, bodyHtml, attachText } = opts;

  const plainUrls = extractPlainUrls(`${bodyPlain}\n${attachText}`);
  const anchors = bodyHtml ? extractAnchorsFromHtml(bodyHtml) : [];
  const anchorUrlsRaw = anchors
    .map((a) => unwrapSecurityWrapper(a.url.replace(/[.,;:!?)\]>]+$/g, "")))
    .filter(filterUrl);
  const bare = [
    ...extractBareDomains(bodyPlain),
    ...extractBareDomains(attachText),
  ].filter(filterUrl);

  // Build anchor text map (case-insensitive URL key normalization to original form preferred — keep both raw + unwrapped).
  const anchorTextByUrl: Record<string, string[]> = {};
  for (const a of anchors) {
    const u = unwrapSecurityWrapper(a.url.replace(/[.,;:!?)\]>]+$/g, ""));
    if (!filterUrl(u)) continue;
    (anchorTextByUrl[u] ||= []).push(a.anchorText);
  }

  const urls = Array.from(new Set([...plainUrls, ...anchorUrlsRaw, ...bare]));

  // Label detection: scan plain text for "Portfolio:|Site:|Web:|Link:|Work:|Online:" then look ahead a few words for any URL token.
  const labeledUrls = new Set<string>();
  const labelText = `${bodyPlain}\n${attachText}`;
  const labelRe = /\b(portfolio|site|web|link|work|online)\s*:\s*([^\s]+(?:\s+[^\s]+){0,3})/gi;
  let lm: RegExpExecArray | null;
  while ((lm = labelRe.exec(labelText)) !== null) {
    const window = lm[2];
    // Try: explicit URL in window
    const urlMatch = window.match(/https?:\/\/[^\s<>"'\])]+/);
    if (urlMatch) {
      const u = unwrapSecurityWrapper(urlMatch[0].replace(/[.,;:!?)\]>]+$/g, ""));
      if (filterUrl(u)) labeledUrls.add(u);
      continue;
    }
    // Try: bare domain in window
    const bareInWindow = extractBareDomains(window);
    for (const u of bareInWindow) if (filterUrl(u)) labeledUrls.add(u);
  }

  // Resume-header URLs: top 10 lines of attachment text (parsed resume).
  const headerUrls = new Set<string>();
  const headerLines = (attachText ?? "").split(/\r?\n/).slice(0, 30); // generous: includes empty-line padding from bundle delimiter
  // Trim down to first ~10 non-empty content lines after we get past the "--- file ---" delimiter.
  const headerSlice: string[] = [];
  let nonEmpty = 0;
  for (const ln of headerLines) {
    headerSlice.push(ln);
    if (ln.trim().length > 0) nonEmpty++;
    if (nonEmpty >= 10) break;
  }
  const headerText = headerSlice.join("\n");
  for (const u of extractPlainUrls(headerText)) headerUrls.add(u);
  for (const u of extractBareDomains(headerText).filter(filterUrl)) headerUrls.add(u);

  return {
    urls,
    ctx: { candidateName, resumeText: attachText, emailBodyText: bodyPlain, anchorTextByUrl, labeledUrls, headerUrls },
  };
}
