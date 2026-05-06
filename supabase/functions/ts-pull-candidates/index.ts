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
    // @ts-ignore EdgeRuntime is provided by Supabase Edge runtime
    EdgeRuntime.waitUntil(dispatchNextBatch(roundId));
  } catch {
    dispatchNextBatch(roundId).catch((err) =>
      console.error("[ts-pull-candidates] dispatchNextBatch unhandled:", err)
    );
  }
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
    const parts = walkParts(msg.payload);
    for (const p of parts) {
      if (p.mimeType === "text/plain" && p.body?.data) {
        bodyText += new TextDecoder().decode(decodeBase64Url(p.body.data));
      } else if (p.mimeType === "text/html" && p.body?.data) {
        const html = new TextDecoder().decode(decodeBase64Url(p.body.data));
        bodyHtml += html;
        if (!bodyText) bodyText = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
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

  let bundle: string | null = `From: ${name} <${email}>\nDate: ${date}\n\nEmail Body:\n${bodyText}\n\nAttachments:${attachText || " (none)"}`;
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
  let status: "consider" | "fast_track" | "auto_rejected";
  if (disqualified) status = "auto_rejected";
  else if ((r.total_score ?? 0) < threshold) status = "auto_rejected";
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
      last_evaluated_at: new Date().toISOString(),
    }).select("id").single();
    if (candErr) { errors.push({ step: "save", messageId: id, error: String(candErr) }); return "failed"; }

    // ts_evaluations history row.
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

  if (status === "auto_rejected") return "rejected";
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

  // @ts-ignore EdgeRuntime is provided by Supabase Edge runtime
  if (typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime.waitUntil === "function") {
    // @ts-ignore
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
