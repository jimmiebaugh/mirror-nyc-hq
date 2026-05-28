// ts-pull-candidates
//
// Chunked, streaming pull pipeline. Ported from
// mirror-talent-scout/supabase/functions/pull-candidates/index.ts (1129 lines).
//
// Adaptations from the source:
//   - Service-account Gmail auth (gmailServiceAccount.ts) replaces per-install
//     OAuth refresh-token flow.
//   - callClaude('talent_scout', ...) wrapper replaces inline fetch + manual
//     spend math. Wrapper handles cost calc, spend tracking, cap-crossing
//     alert. No refusal on cap (per Q6).
//   - Schema renames: ts_roles / ts_candidates / ts_pull_rounds / ts_evaluations.
//     Scorecard lives on ts_roles.scorecard jsonb (not a separate table).
//   - ts_evaluations row is inserted alongside the ts_candidates row, capturing
//     scorecard_snapshot + eval_prompt_snapshot for reproducible history.
//   - ts_candidate_attachments rows for each attachment (replaces the source's
//     gmail_attachment_ids array on candidates).
//   - Storage bucket renamed candidate-attachments -> candidate_attachments.
//   - Step-progress jsonb dropped. UI uses processed_count / candidates_found.
//   - send-pull-notification calls dropped. Phase 3.8 wires real notifications.
//   - is_prompt_update / dispatch_failed flags / step-progress live tick
//     dropped — keep the chunked self-invoke architecture, drop ornamentation.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { extractText, getDocumentProxy } from "https://esm.sh/unpdf@0.12.1";
import { unzipSync, strFromU8 } from "https://esm.sh/fflate@0.8.2";
import { parseClaudeJson } from "../_shared/parseClaudeJson.ts";
import { buildClaudeEvalRequest, classifyDetectedUrls, getClaudeStaticPrefixLength } from "../_shared/buildClaudeEvalRequest.ts";
import { pickBestPortfolioUrl, pickPortfolioAttachment, buildPortfolioInputs, unwrapSecurityWrapper } from "../_shared/unwrapUrl.ts";
import { uploadAttachmentToStorage, LARGE_ATTACHMENT_THRESHOLD_BYTES } from "../_shared/attachmentStorage.ts";
import { requireInternalOrUserAuth } from "../_shared/internalAuth.ts";
import { getGmailAccessToken } from "../_shared/gmailServiceAccount.ts";
import { callClaude } from "../_shared/anthropic.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret",
};

const BATCH_SIZE = 8;
const WALL_TIME_BUDGET_MS = 120 * 1000;
const MAX_PARSE_ATTACHMENT_BYTES = 2_500_000;
const MAX_TOTAL_PARSED_ATTACHMENT_BYTES = 5_000_000;
const MAX_STORAGE_PERSIST_BYTES = 10 * 1024 * 1024;
const IMPERSONATED_GMAIL = "jobs@mirrornyc.com";

// Critical Claude API errors that affect every subsequent candidate.
class ClaudeApiCriticalError extends Error {
  kind: "AUTH_OR_BILLING" | "RATE_LIMIT" | "CREDITS_EXHAUSTED";
  constructor(kind: "AUTH_OR_BILLING" | "RATE_LIMIT" | "CREDITS_EXHAUSTED", message: string) {
    super(message);
    this.name = "ClaudeApiCriticalError";
    this.kind = kind;
  }
}

const sb = () =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

// ---------- Utilities ----------

function logMemory(label: string) {
  try {
    const mem = Deno.memoryUsage();
    console.log(
      `[ts-pull-candidates] [Mem] ${label}: heap=${(mem.heapUsed / 1024 / 1024).toFixed(1)}MB rss=${(mem.rss / 1024 / 1024).toFixed(1)}MB`,
    );
  } catch (_) { /* noop */ }
}

function bytesToMb(bytes?: number | null) {
  return `${((bytes ?? 0) / 1024 / 1024).toFixed(1)}MB`;
}

function yieldForCleanup() {
  return new Promise((r) => setTimeout(r, 0));
}

async function gmailFetch(token: string, path: string, retries = 3): Promise<any> {
  const url = `https://gmail.googleapis.com/gmail/v1/users/me${path}`;
  for (let i = 0; i < retries; i++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** i));
      continue;
    }
    const bodyText = await res.text();
    if (!res.ok) throw new Error(`Gmail ${path}: ${res.status} ${bodyText.slice(0, 400)}`);
    return JSON.parse(bodyText);
  }
  throw new Error(`Gmail ${path}: retries exhausted`);
}

function decodeBase64Url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function walkParts(payload: any, out: any[] = []): any[] {
  if (!payload) return out;
  out.push(payload);
  if (payload.parts) for (const p of payload.parts) walkParts(p, out);
  return out;
}

function toTitleCase(name: string): string {
  if (!name) return name;
  return name
    .toLowerCase()
    .replace(/(^|\s|-|')([a-z])/g, (_, sep, char) => sep + char.toUpperCase());
}

function cleanCandidateName(rawName: string): string {
  if (!rawName) return rawName;
  let cleaned = rawName.replace(/\s*\([^)]*\)\s*/g, " ").trim();
  cleaned = cleaned.replace(/\s*\[[^\]]*\]\s*/g, " ").trim();
  cleaned = cleaned.replace(/\s+/g, " ");
  return toTitleCase(cleaned);
}

function parseFromHeader(v: string): { name: string; email: string } {
  const m = v.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim(), email: m[2].trim().toLowerCase() };
  return { name: "", email: v.trim().toLowerCase() };
}

/**
 * Phase 3.7.7: detect a forwarded email and return the ORIGINAL sender's
 * identity + body. Used when a Mirror manager forwards a candidate's
 * application from their own inbox to jobs@mirrornyc.com.
 *
 * Phase 3.7.7.1: now handles nested forwards (manager A forwarded to
 * manager B forwarded to jobs@). Walks ALL "From: …" lines in the body
 * in reverse order and picks the DEEPEST one whose email isn't
 * @mirrornyc.com — that's the original applicant at the bottom of the
 * chain. Top-down iteration would lock onto the intermediate manager(s).
 *
 * Marker check (Gmail / Apple Mail / Outlook patterns) gates whether
 * we treat the message as a forward at all. Without any marker AND
 * without any "From: …" line in the body, returns null (probably an
 * internal Mirror email that happened to match the role's keyword).
 */
/**
 * Phase 3.7.7.3: convert HTML body to plain text while preserving line
 * structure. Used as a forward-parse fallback when text/plain comes back
 * empty or signature-only. Mirrors the conversion in walkParts but is
 * exported so parseForwardedEmail can reach for it.
 */
function htmlBodyToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

/**
 * Phase 3.7.7.5: best-effort name extraction from the "On <date>... <Name>"
 * prefix of a reply-quote attribution. Strips the date portion (AM/PM marker
 * with greedy match, or last comma after a digit run, or leading time-like
 * punctuation) and returns whatever's left. If extraction leaves digits in
 * the result, returns "" so downstream cleanCandidateName isn't fed a
 * mangled date string.
 */
function extractNameFromOnPrefix(prefix: string): string {
  let s = prefix.trim();
  // English AM/PM (Gmail / Apple Mail mobile most common). [\s\S] because
  // the prefix may contain a soft-wrapped newline.
  const ampmMatch = s.match(/^[\s\S]*\b(?:AM|PM)[\s,]*/i);
  if (ampmMatch) {
    s = s.slice(ampmMatch[0].length);
  } else {
    const lastComma = s.lastIndexOf(",");
    if (lastComma > 0 && /\d/.test(s.slice(0, lastComma))) {
      s = s.slice(lastComma + 1);
    }
    s = s.replace(/^[\s\d:.\/-]+/, "");
  }
  s = s.trim().replace(/[<>"']/g, "");
  if (/\d/.test(s)) return "";
  return s;
}

function parseForwardedFromString(rawBody: string): {
  name: string;
  email: string;
  bodyText: string;
} | null {
  if (!rawBody) return null;
  // Phase 3.7.7.2: regexes loosened to handle real-world forward chains.
  // Phase 3.7.7.3: also strip leading "> " quote markers via [^>\n]
  // tolerance and normalize the "<email>" capture so HTML entities like
  // &lt; / &gt; aren't required (the htmlBodyToText pass already did
  // entity decoding before we get here, but the bare path keeps working).
  // Phase 3.7.7.5: also collect "On <date> <Name> <<email>> wrote:"
  // reply-quote attributions. Apple Mail iPhone forwards (and any "Reply"
  // mistakenly used as a forward) carry the original applicant's identity
  // in this shape, NOT as a From: header. Without this rule, every From:
  // in such a chain is @mirrornyc.com and we incorrectly skip.
  const FROM_LINE = /From:\s*"?([^"<\n]{0,200}?)"?\s*<([^>\s]+@[^>\s]+)>/gi;
  const FROM_BARE = /From:\s*([^\s<\n]+@[^\s<\n]+)/gi;
  const ON_WROTE_LINE = /\bOn\b([^<]{1,300}?)<\s*([\w.+\-]+@[\w.\-]+)\s*>\s*wrote\s*:/gi;
  type FromHit = { name: string; email: string; startIdx: number; afterIdx: number };
  const hits: FromHit[] = [];
  for (const m of rawBody.matchAll(FROM_LINE)) {
    if (typeof m.index !== "number") continue;
    hits.push({
      name: m[1].trim().replace(/[<>"']/g, ""),
      email: m[2].trim().toLowerCase(),
      startIdx: m.index,
      afterIdx: m.index + m[0].length,
    });
  }
  for (const m of rawBody.matchAll(ON_WROTE_LINE)) {
    if (typeof m.index !== "number") continue;
    hits.push({
      name: extractNameFromOnPrefix(m[1]),
      email: m[2].trim().toLowerCase(),
      startIdx: m.index,
      afterIdx: m.index + m[0].length,
    });
  }
  if (hits.length === 0) {
    for (const m of rawBody.matchAll(FROM_BARE)) {
      if (typeof m.index !== "number") continue;
      hits.push({
        name: "",
        email: m[1].trim().toLowerCase(),
        startIdx: m.index,
        afterIdx: m.index + m[0].length,
      });
    }
  }
  if (hits.length === 0) return null;

  // Sort by document position so "deepest" is reliably last regardless of
  // which pattern matched it (From: vs On...wrote: hits get interleaved).
  hits.sort((a, b) => a.startIdx - b.startIdx);

  // Walk hits in reverse (deepest first) and pick the first non-Mirror
  // sender. That's the original applicant. If every hit in the chain
  // is @mirrornyc.com, return null instead of falling back — better to
  // skip than misattribute the manager as the candidate.
  let chosen: FromHit | undefined;
  for (let i = hits.length - 1; i >= 0; i--) {
    if (!hits[i].email.endsWith("@mirrornyc.com")) {
      chosen = hits[i];
      break;
    }
  }
  if (!chosen) return null;

  const tail = rawBody.slice(chosen.afterIdx);
  const blank = tail.match(/\r?\n\s*\r?\n/);
  let bodyText =
    blank && typeof blank.index === "number"
      ? tail.slice(blank.index + blank[0].length)
      : tail;
  // Phase 3.7.7.5: strip leading "> " quote markers. Apple Mail mobile
  // and reply-style forwards carry the original message as quoted text.
  bodyText = bodyText.replace(/^>\s?/gm, "").trim();
  return { name: chosen.name, email: chosen.email, bodyText };
}

/**
 * Phase 3.7.8.15: strip a Mirror NYC signature block from the end of a
 * note. Mirror sigs follow a strict template: a bolded name line
 * "*Firstname Lastname*" followed within ~12 lines by one of the brand
 * markers ("M I R R O R", "mirrornyc.com", "@mirror_*",
 * "STRATEGY / DESIGN / PRODUCTION"). When that pattern hits, truncate
 * everything from the bolded-name line on. Also strips trailing
 * "Sent from <device>" lines (Apple Mail mobile / Mirrornyc Mobile).
 */
function stripMirrorSignature(text: string): string {
  if (!text) return "";
  const lines = text.split(/\r?\n/);
  let cutIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i].trim();
    // Bolded name pattern: *Firstname Lastname* on its own line.
    if (/^\*[A-Z][A-Za-z'\-\.\s]{1,60}\*\s*$/.test(ln)) {
      const window = lines
        .slice(i, Math.min(lines.length, i + 14))
        .join("\n");
      if (
        /M\s+I\s+R\s+R\s+O\s+R/i.test(window) ||
        /mirrornyc\.com/i.test(window) ||
        /@mirror_/i.test(window) ||
        /STRATEGY\s*\/\s*DESIGN\s*\/\s*PRODUCTION/i.test(window)
      ) {
        cutIdx = i;
        break;
      }
    }
  }
  let out = cutIdx >= 0 ? lines.slice(0, cutIdx).join("\n") : text;
  // Strip trailing "Sent from <device>" lines and standalone signoffs.
  out = out.replace(/^.*Sent from .*$/gim, "");
  return out.trim();
}

/**
 * Phase 3.7.8.16: locate every explicit-forward marker in the body and
 * return their {start, end} positions sorted by document order.
 * "Explicit forward" = "---------- Forwarded message ----------" (Gmail)
 * or "Begin forwarded message:" (Apple Mail). These mark the boundary
 * between one chain segment and the next, and each segment that
 * follows them starts with a From:/Date:/Subject: header block of the
 * next-up sender.
 *
 * Reply-quote attributions ("On X wrote:") are NOT treated as segment
 * boundaries by this scanner — they're a sub-shape inside a single
 * segment, and the segment-body extractor truncates at them
 * separately.
 */
function findExplicitForwardMarkers(text: string): { idx: number; len: number }[] {
  if (!text) return [];
  const markers: { idx: number; len: number }[] = [];
  const patterns: RegExp[] = [
    /-{2,}\s*Forwarded message\s*-{2,}/gi,
    /Begin forwarded message:/gi,
  ];
  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      markers.push({ idx: m.index, len: m[0].length });
    }
  }
  markers.sort((a, b) => a.idx - b.idx);
  return markers;
}

/**
 * Phase 3.7.8.16: extract the body text from one forwarded-segment.
 * The segment text starts right after a "Forwarded message" marker,
 * so the first chunk is the inner forward's header block (From: /
 * Date: / Subject: / To:). Skip past the first blank line to land on
 * the actual body, then truncate at any "On X wrote:" attribution
 * since that's a quoted reply, not the manager's commentary.
 *
 * Strip leading blank lines first so the blank-line search picks the
 * gap BETWEEN headers and body, not the leading gap right after the
 * marker (Apple Mail wraps with an extra newline).
 */
function extractSegmentBody(segment: string): string {
  let body = segment.replace(/^[\s\n]+/, "");
  const blankMatch = body.match(/\r?\n\s*\r?\n/);
  if (blankMatch && typeof blankMatch.index === "number") {
    body = body.slice(blankMatch.index + blankMatch[0].length);
  }
  const wroteMatch = body.match(
    /\bOn\b[^<]{1,300}?<\s*[\w.+\-]+@[\w.\-]+\s*>\s*wrote\s*:/i,
  );
  if (wroteMatch && typeof wroteMatch.index === "number") {
    body = body.slice(0, wroteMatch.index);
  }
  return body;
}

/**
 * Phase 3.7.8.16: catch captures that are mostly a Mirror manager's
 * "from-mobile" signature (Apple Mail style) which the strict
 * bolded-name stripper misses. Pattern: 1-4 short lines containing
 * "Mirrornyc" / "mirrornyc.com" / "@mirror_*" / "Mobile. <digits>" /
 * "m: <digits>". When a capture looks like signature-only and has no
 * substantial commentary, drop it.
 */
function looksLikeSignatureOnly(text: string): boolean {
  if (!text) return true;
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return true;
  if (lines.length > 4) return false;
  const joined = lines.join(" ");
  return (
    /\bMirrornyc\b/i.test(joined) ||
    /mirrornyc\.com/i.test(joined) ||
    /@mirror_/i.test(joined) ||
    /Mobile\.\s*\d/i.test(joined) ||
    /\bm:\s*\d{3}/i.test(joined)
  );
}

/**
 * Phase 3.7.8.16: parse the segment's "From:" header to find the
 * sender's email. Apple Mail wraps headers with asterisks
 * (*From: *Andrew Hurewitz <andrew@x.com>) — the loose "From:" regex
 * tolerates that. Returns null when no parseable From line is found
 * (segment is malformed or doesn't start with a header block).
 */
function extractSegmentSenderEmail(segment: string): string | null {
  const m = segment.match(
    /From:\s*"?[^"<\n]{0,200}?"?\s*<([^>\s]+@[^>\s]+)>/i,
  );
  return m ? m[1].toLowerCase() : null;
}

/**
 * Phase 3.7.8.16: extract commentary from EVERY @mirrornyc.com manager
 * in the forward chain, not just the outermost forwarder.
 *
 * For "A (manager) → B (manager) → jobs@":
 * - Segment 0 (before first marker) = B's content. Sender is the
 *   outer email's From, passed in via outerSenderEmail.
 * - Segment 1 (between first and second marker) = A's content. Sender
 *   parsed from the segment's own From: header.
 * - Segment 2 (after second marker, when present) = the original
 *   applicant's content. Skipped unless From: is also @mirrornyc.com.
 *
 * For each segment whose sender is @mirrornyc.com, strip Mirror
 * signatures and capture the commentary. Combine into a single
 * attributed note block. Empty when no manager added any commentary
 * (e.g., a bare forward-with-default-signature only chain).
 *
 * Used to populate ts_candidates.internal_notes on referral ingestion
 * so manager context ("strong pick, schedule a call" / "borderline,
 * lmk what you think") factors into the FIRST evaluation via the
 * HIRING MANAGER NOTES block in the candidate bundle.
 */
export function extractManagerNote(
  rawBodyText: string,
  outerSenderEmail?: string | null,
): string {
  if (!rawBodyText) return "";
  const markers = findExplicitForwardMarkers(rawBodyText);
  const captured: { sender: string; note: string }[] = [];

  // Segment 0: text before the first marker (or the whole body if no
  // markers found). Sender = outer email's From.
  const seg0End = markers[0]?.idx ?? rawBodyText.length;
  let seg0 = rawBodyText.slice(0, seg0End);
  // Defensive: if seg 0 contains an "On X wrote:" attribution
  // (no explicit forward marker but a reply-quote pattern), truncate
  // at it so the quoted body isn't picked up as the manager's note.
  const seg0Wrote = seg0.match(
    /\bOn\b[^<]{1,300}?<\s*[\w.+\-]+@[\w.\-]+\s*>\s*wrote\s*:/i,
  );
  if (seg0Wrote && typeof seg0Wrote.index === "number") {
    seg0 = seg0.slice(0, seg0Wrote.index);
  }
  if (
    outerSenderEmail &&
    outerSenderEmail.toLowerCase().endsWith("@mirrornyc.com")
  ) {
    const note = stripMirrorSignature(seg0).replace(/\n{3,}/g, "\n\n").trim();
    if (note && !looksLikeSignatureOnly(note)) {
      captured.push({ sender: outerSenderEmail.toLowerCase(), note });
    }
  }

  // Segments 1..N: text between markers. Each starts with the inner
  // forward's header block (From / Date / Subject / To).
  for (let i = 0; i < markers.length; i++) {
    const start = markers[i].idx + markers[i].len;
    const end = markers[i + 1]?.idx ?? rawBodyText.length;
    const segText = rawBodyText.slice(start, end);

    const sender = extractSegmentSenderEmail(segText);
    if (!sender || !sender.endsWith("@mirrornyc.com")) continue;
    // Skip if this segment's sender already showed up earlier in the
    // walk (paranoia against duplicate captures from weird wrapper
    // chains).
    if (captured.some((c) => c.sender === sender)) continue;

    const body = extractSegmentBody(segText);
    const note = stripMirrorSignature(body).replace(/\n{3,}/g, "\n\n").trim();
    if (note && !looksLikeSignatureOnly(note)) {
      captured.push({ sender, note });
    }
  }

  if (captured.length === 0) return "";
  // Single note: drop the "Note from <email>:" attribution prefix —
  // the referrer email is already stored on the candidate row, so the
  // note reads cleaner without a redundant header.
  if (captured.length === 1) return captured[0].note;
  // Multiple notes: attribute each so the eval can read who said what.
  return captured
    .map((c) => `Note from ${c.sender}:\n${c.note}`)
    .join("\n\n---\n\n");
}

/**
 * Phase 3.7.7: detect a forwarded email and return the ORIGINAL sender's
 * identity + body. Used when a Mirror manager forwards a candidate's
 * application from their own inbox to jobs@mirrornyc.com.
 *
 * Phase 3.7.7.3: tries text/plain first (fast path, original behavior).
 * If that yields no original-applicant hit, retries against an
 * HTML→text conversion of the message's text/html part. Gmail's
 * auto-generated text/plain often contains only the manager's wrapper
 * note and signature, with the actual forward chain living only in
 * the HTML body. The fallback catches that.
 *
 * Phase 3.7.7.5: parseForwardedFromString now collects both From: headers
 * AND "On <date>... <<email>> wrote:" reply-quote attributions. Covers
 * Apple Mail iPhone forwards (which represent the original applicant as
 * a quoted reply rather than a re-headered forward) and any case where a
 * manager hit Reply instead of Forward.
 */
export function parseForwardedEmail(
  bodyText: string,
  bodyHtml?: string,
): { name: string; email: string; bodyText: string } | null {
  const fromText = parseForwardedFromString(bodyText);
  if (fromText) return fromText;
  if (bodyHtml && bodyHtml.length > 0) {
    return parseForwardedFromString(htmlBodyToText(bodyHtml));
  }
  return null;
}

async function extractPdfText(bytes: Uint8Array): Promise<string> {
  let pdf: any = null;
  try {
    pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: true });
    return Array.isArray(text) ? text.join("\n") : String(text ?? "");
  } catch (e) {
    console.error("PDF parse failed:", e);
    return "";
  } finally {
    try { await pdf?.destroy?.(); } catch (_) { /* best-effort */ }
    pdf = null;
  }
}

async function extractDocxText(bytes: Uint8Array, filename = "document.docx"): Promise<string> {
  let files: Record<string, Uint8Array> | null = null;
  let xmlFile: Uint8Array | null = null;
  let xml = "";
  try {
    files = unzipSync(bytes);
    xmlFile = files["word/document.xml"];
    if (!xmlFile) return "";
    xml = strFromU8(xmlFile);
    const withBreaks = xml
      .replace(/<w:p[ >][^]*?<\/w:p>/g, (m) => m.replace(/<[^>]+>/g, "") + "\n")
      .replace(/<w:br\/>/g, "\n");
    return withBreaks
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  } catch (e) {
    console.error(`DOCX parse failed (${filename}):`, e);
    return "";
  } finally {
    files = null;
    xmlFile = null;
    xml = "";
  }
}

function attachmentTypeFor(filename: string): "resume" | "cover_letter" | "portfolio" | "other" {
  const lower = (filename || "").toLowerCase();
  if (lower.includes("resume") || lower.includes("cv")) return "resume";
  if (lower.includes("cover") || lower.includes("letter")) return "cover_letter";
  if (lower.includes("portfolio") || lower.includes("work") || lower.includes("samples")) return "portfolio";
  return "other";
}

// ---------- Self-invoke continuation ----------

async function dispatchNextBatch(roundId: string, attempt = 1): Promise<boolean> {
  const MAX_ATTEMPTS = 3;
  const BACKOFF_MS = [0, 2000, 5000];
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/ts-pull-candidates`;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  if (attempt === 1) {
    console.log(`[ts-pull-candidates] SELF_INVOKE_DISPATCH: round=${roundId}`);
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        "x-internal-secret": Deno.env.get("INTERNAL_API_SECRET") ?? "",
      },
      body: JSON.stringify({ continue_round_id: roundId }),
    });

    if (response.status >= 200 && response.status < 300) {
      console.log(`[ts-pull-candidates] SELF_INVOKE_OK: round=${roundId} attempt=${attempt} status=${response.status}`);
      return true;
    }
    console.warn(`[ts-pull-candidates] SELF_INVOKE_RETRY: round=${roundId} attempt=${attempt} status=${response.status}`);
    if (attempt < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt]));
      return dispatchNextBatch(roundId, attempt + 1);
    }
    console.error(`[ts-pull-candidates] SELF_INVOKE_FAILED: round=${roundId} all ${MAX_ATTEMPTS} attempts exhausted`);
  } catch (err: any) {
    console.warn(`[ts-pull-candidates] SELF_INVOKE_ERROR: round=${roundId} attempt=${attempt} ${err?.message ?? err}`);
    if (attempt < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt]));
      return dispatchNextBatch(roundId, attempt + 1);
    }
  }

  // Final failure: mark round failed.
  try {
    const supabase = sb();
    await supabase.from("ts_pull_rounds").update({
      status: "failed",
      completed_at: new Date().toISOString(),
    }).eq("id", roundId);
  } catch (e) {
    console.error("[ts-pull-candidates] failed to mark round failed:", e);
  }
  return false;
}

function selfInvokeContinue(roundId: string) {
  try {
    // @ts-expect-error EdgeRuntime is provided by Supabase Edge runtime
    EdgeRuntime.waitUntil(dispatchNextBatch(roundId));
  } catch {
    dispatchNextBatch(roundId).catch((err) =>
      console.error("[ts-pull-candidates] dispatchNextBatch unhandled:", err)
    );
  }
}

// Phase 3.9: fire ts-send-pull-notification once a round flips to 'complete'.
// Fire-and-forget via EdgeRuntime.waitUntil where available — the round row is
// already finalized; a notification outage shouldn't block the response.
async function dispatchPullCompleteNotification(roleId: string, roundId: string): Promise<void> {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/ts-send-pull-notification`;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        "x-internal-secret": Deno.env.get("INTERNAL_API_SECRET") ?? "",
      },
      body: JSON.stringify({ role_id: roleId, pull_round_id: roundId }),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.warn(`[ts-pull-candidates] pull-complete notification non-2xx (${res.status}): ${errText.slice(0, 200)}`);
    }
  } catch (err) {
    console.warn(`[ts-pull-candidates] pull-complete notification dispatch failed:`, err);
  }
}

function fireNotificationAsync(roleId: string, roundId: string) {
  try {
    // @ts-expect-error EdgeRuntime is provided by Supabase Edge runtime
    if (typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime.waitUntil === "function") {
      // @ts-expect-error EdgeRuntime.waitUntil is provided by Supabase Edge runtime, not in Deno types
      EdgeRuntime.waitUntil(dispatchPullCompleteNotification(roleId, roundId));
      return;
    }
  } catch {
    // fall through
  }
  dispatchPullCompleteNotification(roleId, roundId).catch((err) =>
    console.error("[ts-pull-candidates] notification dispatch unhandled:", err)
  );
}

// ---------- Per-candidate processing ----------

async function processOne(
  supabase: any,
  ctx: {
    accessToken: string;
    roleId: string;
    roundId: string;
    role: any;
    scorecard: { criteria: any[] };
    competitors: string[];
    threshold: number;
    evalPromptSnapshot: string;
  },
  pending: { messageId: string },
  errors: any[],
): Promise<"saved" | "rejected" | "fast_track" | "promoted" | "failed" | "skipped"> {
  const { accessToken, roleId, roundId, role, scorecard, competitors, threshold, evalPromptSnapshot } = ctx;
  const id = pending.messageId;
  const candidateUuid = crypto.randomUUID();

  // --- extract ---
  let msg: any = null;
  let bodyText = "";
  let bodyHtml = "";
  let attachments: { id: string; filename: string; mimeType: string; size: number | null; storage_path?: string | null }[] = [];
  let name = "", email = "", date = new Date().toISOString();
  // Phase 3.7.7: when the sender is a Mirror manager forwarding to jobs@,
  // these get filled in; the candidate identity below shifts to the
  // original applicant parsed out of the forwarded body.
  let isReferral = false;
  let referrerEmail: string | null = null;
  // Phase 3.7.8.15: manager's commentary text captured from the forward
  // body (anything before the first chain marker, with Mirror sigs
  // stripped). Persisted to ts_candidates.internal_notes and folded
  // into the candidate bundle so the FIRST eval sees it as
  // "HIRING MANAGER NOTES:".
  let internalNotes: string | null = null;
  try {
    msg = await gmailFetch(accessToken, `/messages/${id}?format=full`);
    const headers: any[] = msg.payload?.headers ?? [];
    const fromH = headers.find((h: any) => h.name?.toLowerCase() === "from")?.value ?? "";
    const dateH = headers.find((h: any) => h.name?.toLowerCase() === "date")?.value ?? "";
    const parsed = parseFromHeader(fromH);
    name = parsed.name; email = parsed.email;
    if (dateH) date = new Date(dateH).toISOString();

    if (email && email.toLowerCase() === IMPERSONATED_GMAIL) {
      console.log(`[ts-pull-candidates] Skipping self-email: ${email}`);
      return "skipped";
    }

    // Walk MIME parts FIRST so we have bodyText available for forward
    // detection below. Dedupe check moved AFTER referral parse since
    // the candidate identity (email) can change for referrals.
    const parts = walkParts(msg.payload);
    // Phase 3.7.7.4: log the part tree for forward-detection debugging.
    // Each entry shows mimeType + size hint so log tailers can see when
    // a message/rfc822 attachment is in play (forward-as-attachment).
    console.log(
      `[ts-pull-candidates] ${id} parts: ${
        parts.map((p: any) => `${p.mimeType ?? "?"}(${p.body?.size ?? p.body?.data?.length ?? "0"})`).join(", ")
      }`,
    );
    for (const p of parts) {
      if (p.mimeType === "text/plain" && p.body?.data) {
        bodyText += new TextDecoder().decode(decodeBase64Url(p.body.data));
      } else if (p.mimeType === "text/html" && p.body?.data) {
        const html = new TextDecoder().decode(decodeBase64Url(p.body.data));
        bodyHtml += html;
        if (!bodyText) {
          // Phase 3.7.7.2: preserve line structure when falling back from
          // HTML to text. Map block-end tags + <br> to newlines BEFORE
          // stripping the rest, then only collapse runs of horizontal
          // whitespace.
          bodyText = html
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
            .replace(/<[^>]+>/g, " ")
            .replace(/[ \t]+/g, " ")
            .replace(/\n[ \t]+/g, "\n")
            .replace(/\n{3,}/g, "\n\n");
        }
      } else if (p.mimeType === "message/rfc822") {
        // Phase 3.7.7.4: forward-as-attachment. Gmail represents an
        // attached email as a message/rfc822 part. The raw RFC 822
        // content (headers + body) carries the forwarded chain — that's
        // where the original applicant's From: header lives when the
        // outer body is just the manager's wrapper + signature.
        //
        // body.data is base64url-encoded raw RFC 822 (small attachments).
        // body.attachmentId is a token to fetch separately (typical for
        // larger ones). Append the decoded raw text to bodyText so
        // parseForwardedEmail's regex finds the From: lines and original
        // body. Recursive forward chains (manager A → manager B → applicant
        // as attachments) all collapse into one big bodyText string —
        // parseForwardedEmail picks the deepest non-Mirror sender.
        let raw = "";
        if (p.body?.data) {
          raw = new TextDecoder().decode(decodeBase64Url(p.body.data));
        } else if (p.body?.attachmentId) {
          try {
            const att = await gmailFetch(
              accessToken,
              `/messages/${id}/attachments/${p.body.attachmentId}`,
            );
            if (att?.data) {
              raw = new TextDecoder().decode(decodeBase64Url(att.data));
            }
          } catch (e) {
            console.error(`[ts-pull-candidates] failed to fetch rfc822 attachment ${p.body.attachmentId}:`, e);
          }
        }
        if (raw) {
          bodyText += "\n\n[Forwarded attachment]\n" + raw;
        }
      }
      if (p.filename && p.body?.attachmentId) {
        attachments.push({
          id: p.body.attachmentId,
          filename: p.filename,
          mimeType: p.mimeType,
          size: typeof p.body.size === "number" ? p.body.size : null,
        });
      }
    }
    msg = null;

    // Phase 3.7.7: referral detection. If the sender is a Mirror manager
    // (any @mirrornyc.com that isn't the jobs@ inbox), unwrap the
    // forwarded body to find the ORIGINAL applicant's identity. Use that
    // identity for the candidate row; flag is_referral=true and capture
    // the manager's email as referrer_email. If the forward markers
    // aren't found, the message is just internal Mirror traffic that
    // happened to match the role's keyword filter — skip it.
    const senderEmail = email;
    const isMirrorForward =
      !!senderEmail &&
      senderEmail.endsWith("@mirrornyc.com") &&
      senderEmail !== IMPERSONATED_GMAIL;
    if (isMirrorForward) {
      // Phase 3.7.7.3: pass bodyHtml as a fallback. text/plain often only
      // carries the manager's wrapper + signature; the actual forward
      // chain (with its From: headers) lives in the HTML body.
      const fwd = parseForwardedEmail(bodyText, bodyHtml);
      if (!fwd || !fwd.email) {
        const textPreview = (bodyText || "").slice(0, 300).replace(/\s+/g, " ");
        const htmlPreview = (bodyHtml || "").slice(0, 300).replace(/\s+/g, " ");
        console.log(
          `[ts-pull-candidates] Mirror sender ${senderEmail} but no original applicant resolved — skipping. ` +
            `bodyText.length=${(bodyText || "").length} bodyHtml.length=${(bodyHtml || "").length} ` +
            `text[0..300]="${textPreview}" html[0..300]="${htmlPreview}"`,
        );
        return "skipped";
      }
      console.log(`[ts-pull-candidates] Referral: ${senderEmail} forwarded ${fwd.email}`);
      // Phase 3.7.8.15: capture the manager's commentary BEFORE we
      // overwrite bodyText with the original applicant's body. Try
      // text/plain first, then HTML→text if plain came up empty
      // (Gmail's auto-generated text/plain can be signature-only).
      // Phase 3.7.8.16: extractManagerNote now walks every segment in
      // the chain, not just the outermost. Captures commentary from
      // ANY @mirrornyc.com sender along A → B → jobs@.
      let note = extractManagerNote(bodyText, senderEmail);
      if (!note && bodyHtml) {
        note = extractManagerNote(htmlBodyToText(bodyHtml), senderEmail);
      }
      if (note) {
        internalNotes = note.slice(0, 4000);
        console.log(
          `[ts-pull-candidates] Captured manager note (${internalNotes.length} chars) from ${senderEmail}`,
        );
      }
      name = fwd.name || name;
      email = fwd.email;
      bodyText = fwd.bodyText || bodyText;
      isReferral = true;
      referrerEmail = senderEmail;
    }

    // Dedupe AFTER referral resolution. Two managers forwarding the same
    // applicant — or a direct application that arrived first — will all
    // collapse to the first-ingested row.
    if (email) {
      const { data: existing } = await supabase
        .from("ts_candidates")
        .select("id, applied_date")
        .eq("role_id", roleId)
        .eq("email", email.toLowerCase())
        .maybeSingle();
      if (existing) {
        console.log(`[ts-pull-candidates] Skipping duplicate sender: ${email} -> candidate ${existing.id}`);
        return "skipped";
      }
    }
  } catch (e) {
    errors.push({ step: "extract", messageId: id, error: String(e) });
    return "failed";
  }

  // --- bundle ---
  let attachText = "";
  let parsedAttachmentBytes = 0;
  logMemory(`Candidate ${id} AFTER_EXTRACT attachments=${attachments.length}`);
  const attachmentPriority = (filename: string) => {
    const lower = (filename || "").toLowerCase();
    if (lower.includes("resume") || lower.includes("cv")) return 1;
    if (lower.includes("cover") || lower.includes("letter")) return 2;
    if (lower.includes("portfolio") || lower.includes("work") || lower.includes("samples")) return 3;
    return 4;
  };
  attachments.sort((a, b) => attachmentPriority(a.filename ?? "") - attachmentPriority(b.filename ?? ""));
  const PER_ATTACHMENT_TEXT_CAP = 10000;

  for (const att of attachments) {
    let a: any = null;
    try {
      const isDocx = att.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        || /\.docx$/i.test(att.filename ?? "");
      const isPdf = att.mimeType === "application/pdf" || /\.pdf$/i.test(att.filename ?? "");
      const tooBigToParse = (isPdf || isDocx) && att.size && att.size > MAX_PARSE_ATTACHMENT_BYTES;
      const overParseBudget = (isPdf || isDocx) && parsedAttachmentBytes + (att.size ?? 0) > MAX_TOTAL_PARSED_ATTACHMENT_BYTES;
      const overStorageCap = (att.size ?? 0) > MAX_STORAGE_PERSIST_BYTES;

      // Always attempt to fetch; persist to Storage when within cap; only parse when within budget.
      if (overStorageCap) {
        attachText += `\n\n--- ${att.filename} (${att.mimeType}, ${bytesToMb(att.size)}) — over storage cap, skipped ---`;
        continue;
      }

      logMemory(`Candidate ${id} BEFORE_FETCH ${att.filename} size=${bytesToMb(att.size)}`);
      a = await gmailFetch(accessToken, `/messages/${id}/attachments/${att.id}`);
      let bytes: Uint8Array | null = a?.data ? decodeBase64Url(a.data) : null;
      a = null;

      if (bytes) {
        const uploaded = await uploadAttachmentToStorage({
          bytes,
          roleId,
          candidateId: candidateUuid,
          filename: att.filename,
          mimeType: att.mimeType,
        });
        if (uploaded) att.storage_path = uploaded.path;
      }

      if (tooBigToParse || overParseBudget) {
        attachText += `\n\n--- ${att.filename} (${att.mimeType}, ${bytesToMb(att.size)}) — too large to parse safely; review attached file manually ---`;
        bytes = null;
        continue;
      }

      if (isPdf && bytes) {
        parsedAttachmentBytes += bytes.byteLength;
        const t = await extractPdfText(bytes);
        attachText += `\n\n--- ${att.filename} (PDF, parsed) ---\n${t.slice(0, PER_ATTACHMENT_TEXT_CAP)}`;
      } else if (isDocx && bytes) {
        parsedAttachmentBytes += bytes.byteLength;
        const t = await extractDocxText(bytes, att.filename);
        attachText += `\n\n--- ${att.filename} (DOCX, parsed) ---\n${t.slice(0, PER_ATTACHMENT_TEXT_CAP)}`;
      } else {
        attachText += `\n\n--- ${att.filename} (${att.mimeType}) — attachment present but content not parsed ---`;
      }
      bytes = null;
    } catch (e) {
      errors.push({ step: "bundle", messageId: id, error: String(e) });
    } finally {
      a = null;
    }
  }

  // Phase 3.7.8.15: when the candidate came in as a referral and the
  // manager left commentary, prepend a "HIRING MANAGER NOTES:" block
  // to the bundle. The eval prompt explicitly looks for this label and
  // treats the contents as verified context that supersedes inferences
  // drawn from resume / cover letter.
  const notesBlock = internalNotes
    ? `HIRING MANAGER NOTES:\n${internalNotes}\n\n`
    : "";
  let bundle: string | null = `${notesBlock}From: ${name} <${email}>\nDate: ${date}\n\nEmail Body:\n${bodyText}\n\nAttachments:${attachText || " (none)"}`;
  bundle = bundle.slice(0, 60000);

  const cleanedName = cleanCandidateName(name) || email;
  const { urls, ctx: portfolioCtx } = buildPortfolioInputs({
    candidateName: cleanedName,
    bodyPlain: bodyText,
    bodyHtml,
    attachText,
  });
  const portfolioUrl = pickBestPortfolioUrl(urls, portfolioCtx);
  const portfolioAtt = pickPortfolioAttachment(attachments);

  // --- score ---
  let parsedResult: any = null;
  try {
    const claudeRequest = buildClaudeEvalRequest({
      role: { ...role, jd_full_text: role.job_description ?? role.jd_full_text },
      scorecard,
      competitors,
      candidateBundle: bundle ?? "",
      detectedUrls: urls,
      systemPromptOverride: evalPromptSnapshot && evalPromptSnapshot.trim().length ? evalPromptSnapshot : undefined,
    });
    const staticPrefixLen = getClaudeStaticPrefixLength({
      role: { ...role, jd_full_text: role.job_description ?? role.jd_full_text },
      scorecard,
      competitors,
      systemPromptOverride: evalPromptSnapshot && evalPromptSnapshot.trim().length ? evalPromptSnapshot : undefined,
    });
    console.log(`[ts-pull-candidates] BEFORE_FETCH candidate=${id} staticPrefixLen=${staticPrefixLen}`);

    const result = await callClaude(
      "talent_scout",
      claudeRequest.messages as any,
      {
        model: claudeRequest.model,
        max_tokens: claudeRequest.max_tokens,
        system: claudeRequest.system as any,
        anthropic_beta: ["extended-cache-ttl-2025-04-11"],
        fn_name: "ts-pull-candidates",
        role_id: roleId,
      },
    );

    if (!result.ok) {
      const status = result.status;
      const msg = result.error;
      if (status === 401 || status === 402 || status === 403) {
        throw new ClaudeApiCriticalError("AUTH_OR_BILLING", `Anthropic ${status}: ${msg.slice(0, 200)}`);
      }
      if (status === 429) {
        throw new ClaudeApiCriticalError("RATE_LIMIT", `Anthropic 429: ${msg.slice(0, 200)}`);
      }
      if (/credit balance (is )?too low/i.test(msg)) {
        throw new ClaudeApiCriticalError("CREDITS_EXHAUSTED", `Anthropic credits exhausted: ${msg.slice(0, 200)}`);
      }
      throw new Error(`Anthropic ${status}: ${msg.slice(0, 200)}`);
    }

    parsedResult = parseClaudeJson<any>(result.text);
  } catch (e) {
    if (e instanceof ClaudeApiCriticalError) throw e;
    errors.push({ step: "score", messageId: id, error: String(e) });
    return "failed";
  }

  // release big strings
  bundle = null;
  attachText = "";

  // --- save ---
  const r = parsedResult;
  const criteriaList: any[] = scorecard.criteria ?? [];
  let disqualified = false;
  for (const c of criteriaList) {
    if (c.tier === 1 && c.is_disqualifier && (r.scores?.[c.name] ?? 0) === 0) { disqualified = true; break; }
  }
  // Phase 3.7.2.1: AI rejection writes status='reject' with manually_reviewed
  // false (default on insert). The AUTO pill in the UI flags it as the AI's
  // call. Reviewer flips to MANUAL by clicking, changing, or re-selecting.
  let status: "consider" | "fast_track" | "reject";
  if (disqualified) status = "reject";
  else if ((r.total_score ?? 0) < threshold) status = "reject";
  else if (r.auto_classification_suggested === "fast_track") status = "fast_track";
  else status = "consider";

  let portfolio_type: "file" | "url" | "none" = "none";
  let portfolio_path_or_url: string | null = null;
  if (portfolioAtt?.storage_path) {
    portfolio_type = "file";
    portfolio_path_or_url = portfolioAtt.storage_path;
  } else if (portfolioUrl) {
    portfolio_type = "url";
    portfolio_path_or_url = portfolioUrl;
  }

  try {
    const { data: candRow, error: candErr } = await supabase.from("ts_candidates").insert({
      id: candidateUuid,
      role_id: roleId,
      pull_round_id: roundId,
      gmail_message_id: id,
      name: cleanedName,
      email,
      applied_date: date.slice(0, 10),
      location: (r.candidate_location as string | null) ?? null,
      score: r.total_score ?? null,
      status,
      recruiter_overview: r.recruiter_note ?? null,
      top_strengths: r.top_strengths ?? [],
      key_gaps: r.key_gaps ?? [],
      quick_overview: Array.isArray(r.quick_overview) ? r.quick_overview.slice(0, 4) : [],
      score_breakdown: r.scores ?? {},
      tier: r.recommendation_tier ?? null,
      portfolio_type,
      portfolio_path_or_url,
      detected_links: classifyDetectedUrls(urls),
      // Phase 3.6: persist plain-text email body so the packet's per-candidate
      // email page can render with the original application text. Trimmed at
      // 30k chars so it can never explode a row.
      email_body_text: (bodyText || "").slice(0, 30000) || null,
      // Phase 3.7.7: referral fields. is_referral=true means a Mirror
      // manager forwarded this candidate's email; referrer_email is that
      // manager. Defaults are false/null for direct-to-jobs@ applicants.
      is_referral: isReferral,
      referrer_email: referrerEmail,
      // Phase 3.7.8.15: persist the manager's commentary so it appears
      // in the candidate detail's Internal Notes field AND so future
      // re-evals (which read internal_notes from the row) keep folding
      // it in. Null when no note was captured.
      internal_notes: internalNotes,
      last_evaluated_at: new Date().toISOString(),
    }).select("id").single();
    if (candErr) { errors.push({ step: "save", messageId: id, error: String(candErr) }); return "failed"; }

    // INSERT into ts_evaluations — history table, one row per evaluation.
    // Pull is the candidate's first eval; later re-evals append more rows.
    const { error: evalErr } = await supabase.from("ts_evaluations").insert({
      role_id: roleId,
      candidate_id: candRow.id,
      scorecard_snapshot: scorecard,
      eval_prompt_snapshot: evalPromptSnapshot ?? "",
      score: r.total_score ?? null,
      score_breakdown: r.scores ?? {},
      recruiter_overview: r.recruiter_note ?? null,
      top_strengths: r.top_strengths ?? [],
      key_gaps: r.key_gaps ?? [],
      tier: r.recommendation_tier ?? null,
      // Phase 3.7.8.15: snapshot the manager note that fed into this
      // first eval. Mirrors what ts-evaluate-candidate writes on
      // re-eval, so the history table reads consistently across all
      // entries for a candidate.
      internal_notes_at_time: internalNotes,
      evaluated_at: new Date().toISOString(),
    });
    if (evalErr) errors.push({ step: "save_eval", messageId: id, error: String(evalErr) });

    // ts_candidate_attachments rows. Only the ones we successfully persisted to Storage.
    const attRows = attachments
      .filter((a) => a.storage_path)
      .map((a) => ({
        candidate_id: candRow.id,
        attachment_type: attachmentTypeFor(a.filename),
        file_name: a.filename,
        file_path: a.storage_path!,
        file_size_bytes: a.size,
      }));
    if (attRows.length > 0) {
      const { error: attErr } = await supabase.from("ts_candidate_attachments").insert(attRows);
      if (attErr) errors.push({ step: "save_attachments", messageId: id, error: String(attErr) });
    }
  } catch (e) {
    errors.push({ step: "save", messageId: id, error: String(e) });
    return "failed";
  } finally {
    bodyText = "";
    bodyHtml = "";
    attachments = [];
    parsedResult = null;
    // bind unused imports so lint stays quiet
    void unwrapSecurityWrapper;
    void LARGE_ATTACHMENT_THRESHOLD_BYTES;
  }

  // Phase 3.7.2.1: AI rejection now uses 'reject' (was 'auto_rejected').
  if (status === "reject") return "rejected";
  if (status === "fast_track") return "fast_track";
  return "promoted";
}

// ---------- Continuation ----------

async function continueRound(supabase: any, roundId: string): Promise<Response> {
  const invocationId = crypto.randomUUID();
  const INVOCATION_START_MS = Date.now();
  console.log(`[ts-pull-candidates] INVOCATION_START: invocation=${invocationId} round=${roundId} batchSize=${BATCH_SIZE}`);

  const { data: round } = await supabase.from("ts_pull_rounds").select("*").eq("id", roundId).maybeSingle();
  if (!round) throw new Error(`Round ${roundId} not found`);

  let pendingCandidates: { messageId: string }[] =
    Array.isArray(round.pending_candidates) ? [...round.pending_candidates] : [];

  const terminal = ["complete", "failed", "stalled"];
  if (terminal.includes(round.status ?? "") && pendingCandidates.length === 0) {
    return new Response(JSON.stringify({ ok: true, status: round.status }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (terminal.includes(round.status ?? "") && pendingCandidates.length > 0) {
    console.log(`[ts-pull-candidates] RESUME_ORPHANED: round=${roundId} prevStatus=${round.status} pending=${pendingCandidates.length}`);
    await supabase.from("ts_pull_rounds").update({ status: "running", completed_at: null }).eq("id", roundId);
  }

  const { data: role } = await supabase.from("ts_roles").select("*").eq("id", round.role_id).single();

  const scorecardCriteria = (role.scorecard as any[]) ?? [];
  const scorecard = { criteria: scorecardCriteria };
  const competitorBonus = (role.competitor_bonus as { competitors?: string[] } | null) ?? null;
  const competitors = competitorBonus?.competitors ?? [];
  const threshold = role.auto_rejection_threshold ?? 60;
  const evalPromptSnapshot = (role.evaluation_prompt as string | null) ?? "";

  const accessToken = await getGmailAccessToken();
  const errors: any[] = [];

  // Dedupe against already-saved candidates (resume safety).
  if (pendingCandidates.length > 0) {
    const { data: existing } = await supabase
      .from("ts_candidates")
      .select("gmail_message_id")
      .eq("role_id", round.role_id)
      .not("gmail_message_id", "is", null);
    const seen = new Set<string>((existing ?? []).map((c: any) => c.gmail_message_id));
    const before = pendingCandidates.length;
    pendingCandidates = pendingCandidates.filter((p) => !seen.has(p.messageId));
    if (pendingCandidates.length !== before) {
      console.log(`[ts-pull-candidates] RESUME_DEDUPE: removed=${before - pendingCandidates.length} remaining=${pendingCandidates.length}`);
      await supabase.from("ts_pull_rounds").update({ pending_candidates: pendingCandidates }).eq("id", roundId);
    }
    if (pendingCandidates.length === 0) {
      await supabase.from("ts_pull_rounds").update({
        pending_candidates: [],
        status: "complete",
        completed_at: new Date().toISOString(),
      }).eq("id", roundId);
      fireNotificationAsync(round.role_id, roundId);
      return new Response(JSON.stringify({ ok: true, complete: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  const total = round.candidates_found ?? (pendingCandidates.length + (round.processed_count ?? 0));
  let processed = Math.max(round.processed_count ?? 0, total - pendingCandidates.length);

  let processedInThisInvocation = 0;
  while (pendingCandidates.length > 0) {
    const elapsed = Date.now() - INVOCATION_START_MS;
    if (elapsed > WALL_TIME_BUDGET_MS && processedInThisInvocation > 0) {
      console.log(`[ts-pull-candidates] WALL_TIME_BREAKER: elapsed=${elapsed}ms processed=${processedInThisInvocation} remaining=${pendingCandidates.length}`);
      await supabase.from("ts_pull_rounds").update({
        pending_candidates: pendingCandidates,
        processed_count: processed,
        status: "running",
      }).eq("id", roundId);
      selfInvokeContinue(roundId);
      return new Response(JSON.stringify({ ok: true, wall_time_break: true, processed: processedInThisInvocation, remaining: pendingCandidates.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const p = pendingCandidates.shift()!;
    let result: "saved" | "rejected" | "fast_track" | "promoted" | "failed" | "skipped";
    try {
      result = await processOne(
        supabase,
        { accessToken, roleId: round.role_id, roundId, role, scorecard, competitors, threshold, evalPromptSnapshot },
        p,
        errors,
      );
    } catch (e) {
      if (e instanceof ClaudeApiCriticalError) {
        pendingCandidates.unshift(p);
        const reason = `Pull stopped: ${e.message}. ${pendingCandidates.length} candidate(s) remain unprocessed.`;
        console.error(`[ts-pull-candidates] CRITICAL_BAIL: kind=${e.kind} remaining=${pendingCandidates.length}`);
        await supabase.from("ts_pull_rounds").update({
          pending_candidates: pendingCandidates,
          processed_count: processed,
          status: "failed",
          completed_at: new Date().toISOString(),
        }).eq("id", roundId);
        return new Response(JSON.stringify({ ok: false, critical_error: e.message, kind: e.kind, reason }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      errors.push({ step: "processOne", messageId: p.messageId, error: String(e) });
      result = "failed";
    }

    if (result !== "skipped" && result !== "failed") processed++;
    if (result !== "skipped") processedInThisInvocation++;

    await supabase.from("ts_pull_rounds").update({
      pending_candidates: pendingCandidates,
      processed_count: processed,
    }).eq("id", roundId);
    await yieldForCleanup();

    if (processedInThisInvocation >= BATCH_SIZE && pendingCandidates.length > 0) {
      console.log(`[ts-pull-candidates] BATCH_BOUNDARY: processed=${processedInThisInvocation} remaining=${pendingCandidates.length}`);
      selfInvokeContinue(roundId);
      return new Response(JSON.stringify({ ok: true, batch_complete: true, processed: processedInThisInvocation, remaining: pendingCandidates.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  // Finalize.
  await supabase.from("ts_pull_rounds").update({
    pending_candidates: [],
    processed_count: processed,
    status: "complete",
    completed_at: new Date().toISOString(),
  }).eq("id", roundId);
  fireNotificationAsync(round.role_id, roundId);

  return new Response(JSON.stringify({ complete: true, processed: processedInThisInvocation, errors_count: errors.length }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ---------- Initial pull ----------

async function startPull(supabase: any, roleId: string, body: any): Promise<string> {
  const { data: role } = await supabase.from("ts_roles").select("*").eq("id", roleId).single();
  if (!role) throw new Error("Role not found");

  // round_number = max existing for this role + 1
  const { data: lastRound } = await supabase
    .from("ts_pull_rounds")
    .select("round_number")
    .eq("role_id", roleId)
    .order("round_number", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  const roundNumber = ((lastRound?.round_number as number | null) ?? 0) + 1;

  // Determine search window.
  const searchTo = new Date().toISOString();
  let searchFrom: string;
  if (role.email_search_start_date) {
    searchFrom = new Date(role.email_search_start_date).toISOString();
  } else {
    searchFrom = new Date(Date.now() - 30 * 86400000).toISOString();
  }

  const triggered_by = (body.triggered_by === "scheduled" ? "scheduled" : "manual") as "manual" | "scheduled";

  const { data: round, error: roundErr } = await supabase
    .from("ts_pull_rounds")
    .insert({
      role_id: roleId,
      round_number: roundNumber,
      triggered_by,
      pulled_from: searchFrom,
      pulled_to: searchTo,
      started_at: new Date().toISOString(),
      status: "running",
      pending_candidates: [],
      candidates_found: 0,
      processed_count: 0,
    })
    .select("id, started_at")
    .single();
  if (roundErr) throw roundErr;
  const roundId = round.id as string;

  // Background work: search Gmail, dedupe, enqueue, kick off continuation.
  const work = (async () => {
    try {
      const accessToken = await getGmailAccessToken();
      const messageIds: string[] = [];

      const kws: string[] = Array.isArray(role.email_keywords)
        ? role.email_keywords.map((k: unknown) => String(k)).filter((k: string) => k.length > 0)
        : [];
      const subjectQ = kws.length ? `subject:(${kws.map((k) => `"${k}"`).join(" OR ")})` : "";
      const afterSecs = Math.floor(new Date(searchFrom).getTime() / 1000);
      const beforeSecs = Math.floor(new Date(searchTo).getTime() / 1000);
      const fromExclusion = `-from:${IMPERSONATED_GMAIL}`;
      const q = ["in:inbox", fromExclusion, subjectQ, `after:${afterSecs}`, `before:${beforeSecs}`].filter(Boolean).join(" ");
      console.log("[ts-pull-candidates] Gmail query:", q);

      let pageToken: string | undefined;
      do {
        const list = await gmailFetch(
          accessToken,
          `/messages?q=${encodeURIComponent(q)}&maxResults=100${pageToken ? `&pageToken=${pageToken}` : ""}`,
        );
        for (const m of list.messages ?? []) messageIds.push(m.id);
        pageToken = list.nextPageToken;
      } while (pageToken && messageIds.length < 200);

      // Dedupe against existing candidates.
      const { data: existing } = await supabase
        .from("ts_candidates")
        .select("gmail_message_id")
        .eq("role_id", roleId);
      const existingIds = new Set((existing ?? []).map((c: any) => c.gmail_message_id));
      const newIds = messageIds.filter((id) => !existingIds.has(id));

      if (newIds.length === 0) {
        await supabase.from("ts_pull_rounds").update({
          status: "complete",
          completed_at: new Date().toISOString(),
          candidates_found: 0,
        }).eq("id", roundId);
        fireNotificationAsync(roleId, roundId);
        return;
      }

      const pending = newIds.map((mid) => ({ messageId: mid }));
      await supabase.from("ts_pull_rounds").update({
        pending_candidates: pending,
        candidates_found: pending.length,
        processed_count: 0,
      }).eq("id", roundId);

      selfInvokeContinue(roundId);
    } catch (e) {
      console.error("[ts-pull-candidates] startPull error:", e);
      const errMsg = e instanceof Error ? e.message : String(e);
      await supabase.from("ts_pull_rounds").update({
        status: "failed",
        completed_at: new Date().toISOString(),
      }).eq("id", roundId);
      console.error(`[ts-pull-candidates] Round ${roundId} failed during setup: ${errMsg}`);
    }
  })();

  // @ts-expect-error EdgeRuntime is provided by Supabase Edge runtime
  if (typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime.waitUntil === "function") {
    // @ts-expect-error EdgeRuntime.waitUntil is provided by Supabase Edge runtime, not in Deno types
    EdgeRuntime.waitUntil(work);
  }

  return roundId;
}

// ---------- HTTP entry ----------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const authFail = await requireInternalOrUserAuth(req);
  if (authFail) return new Response(authFail.body, { status: authFail.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  const supabase = sb();

  try {
    const body = await req.json();

    if (body.continue_round_id) {
      try {
        return await continueRound(supabase, body.continue_round_id as string);
      } catch (e) {
        console.error("[ts-pull-candidates] continueRound failed:", e);
        const errMsg = e instanceof Error ? e.message : String(e);
        await supabase.from("ts_pull_rounds").update({
          status: "failed",
          completed_at: new Date().toISOString(),
        }).eq("id", body.continue_round_id);
        return new Response(JSON.stringify({ error: errMsg }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const roleId = body.role_id as string;
    if (!roleId) throw new Error("role_id required");
    const roundId = await startPull(supabase, roleId, body);
    return new Response(JSON.stringify({ pull_round_id: roundId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[ts-pull-candidates] fatal:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
