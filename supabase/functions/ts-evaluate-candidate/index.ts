// ts-evaluate-candidate
//
// Re-evaluate a single candidate. Re-fetches the original Gmail message, re-bundles
// attachments + body + internal notes, re-scores via Claude using the role's CURRENT
// scorecard and eval prompt. Writes a fresh row to ts_evaluations (history) and
// mirrors the latest fields onto ts_candidates.
//
// Body: { candidate_id, triggered_by_user_id? }
//
// Adapted from mirror-talent-scout/supabase/functions/reevaluate-candidate/index.ts:
//   - Service-account Gmail auth replaces per-install OAuth refresh.
//   - callClaude('talent_scout', ...) replaces inline fetch.
//   - HQ schema: ts_roles / ts_candidates / ts_evaluations.
//   - Scorecard read from ts_roles.scorecard jsonb (no separate scorecards table).
//   - Internal notes folded into prompt as hiring-manager input that supersedes
//     resume assumptions (same pattern as source).
//   - INSERT into ts_evaluations (history), not UPDATE in place.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { extractText, getDocumentProxy } from "https://esm.sh/unpdf@0.12.1";
import { unzipSync, strFromU8 } from "https://esm.sh/fflate@0.8.2";
import { parseClaudeJson } from "../_shared/parseClaudeJson.ts";
import { buildClaudeEvalRequest, classifyDetectedUrls, getClaudeStaticPrefixLength } from "../_shared/buildClaudeEvalRequest.ts";
import { pickBestPortfolioUrl, pickPortfolioAttachment, buildPortfolioInputs } from "../_shared/unwrapUrl.ts";
import { uploadAttachmentToStorage } from "../_shared/attachmentStorage.ts";
import { requireInternalOrUserAuth } from "../_shared/internalAuth.ts";
import { getGmailAccessToken } from "../_shared/gmailServiceAccount.ts";
import { callClaude, type ClaudeMessage, type ClaudeContentPart } from "../_shared/anthropic.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret",
};

const sb = () =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

// Narrow shapes for the only Gmail REST fields this function reads. Not the
// full users.messages resource, just the MIME-part tree and attachment body.
type GmailMessagePart = {
  mimeType?: string;
  filename?: string;
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailMessagePart[];
};
type GmailMessage = { payload?: GmailMessagePart };
type GmailAttachment = { data?: string };

// The fields of a ts_roles.scorecard criterion this function reads. The full
// criterion carries more (weight, rubrics) but the disqualifier gate only
// needs these three.
type ScorecardCriterion = {
  name: string;
  tier?: number;
  is_disqualifier?: boolean;
};

// Parsed Claude eval JSON. Narrow to the fields read below; the model returns
// more but only these drive scoring + the candidate/evaluation writes.
type ClaudeEvalResult = {
  total_score?: number;
  scores?: Record<string, number>;
  candidate_location?: string | null;
  recruiter_note?: string | null;
  top_strengths?: string[];
  key_gaps?: string[];
  quick_overview?: unknown;
  recommendation_tier?: string | null;
  auto_classification_suggested?: string | null;
};

async function gmailFetch<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Gmail ${path}: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.json() as Promise<T>;
}

function decodeBase64Url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function walkParts(payload: GmailMessagePart | undefined, out: GmailMessagePart[] = []): GmailMessagePart[] {
  if (!payload) return out;
  out.push(payload);
  if (payload.parts) for (const p of payload.parts) walkParts(p, out);
  return out;
}

async function extractPdfText(bytes: Uint8Array): Promise<string> {
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>> | null = null;
  try {
    pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: true });
    return Array.isArray(text) ? text.join("\n") : String(text ?? "");
  } catch (e) { console.error("PDF parse failed:", e); return ""; }
  finally { try { await pdf?.destroy?.(); } catch (_) { /* noop */ } pdf = null; }
}

async function extractDocxText(bytes: Uint8Array, filename = "document.docx"): Promise<string> {
  try {
    const files = unzipSync(bytes);
    const xmlFile = files["word/document.xml"];
    if (!xmlFile) return "";
    const xml = strFromU8(xmlFile);
    const withBreaks = xml
      .replace(/<w:p[ >][^]*?<\/w:p>/g, (m) => m.replace(/<[^>]+>/g, "") + "\n")
      .replace(/<w:br\/>/g, "\n");
    return withBreaks
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  } catch (e) { console.error(`DOCX parse failed (${filename}):`, e); return ""; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const authFail = await requireInternalOrUserAuth(req);
  if (authFail) return new Response(authFail.body, { status: authFail.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const supabase = sb();
  let candidateIdForLog = "unknown";

  try {
    const body = await req.json();
    const { candidate_id, triggered_by_user_id, overwrite_history } = body as {
      candidate_id?: string;
      triggered_by_user_id?: string;
      /** When true, delete prior ts_evaluations rows for this candidate before
       *  inserting the new one — used by bulk re-eval where the prompt or
       *  scorecard has changed and old evaluations are no longer meaningful.
       *  Single re-eval (from CandidateDetail) leaves this false to preserve
       *  the audit trail. */
      overwrite_history?: boolean;
    };
    if (!candidate_id) throw new Error("candidate_id required");
    candidateIdForLog = candidate_id;

    const { data: cand } = await supabase.from("ts_candidates").select("*").eq("id", candidate_id).single();
    if (!cand) throw new Error("Candidate not found");
    if (!cand.gmail_message_id) throw new Error("Candidate has no Gmail message id");

    const { data: role } = await supabase.from("ts_roles").select("*").eq("id", cand.role_id).single();
    if (!role) throw new Error("Role not found");

    const scorecardCriteria = (role.scorecard as ScorecardCriterion[]) ?? [];
    const scorecard = { criteria: scorecardCriteria };
    const competitorBonus = (role.competitor_bonus as { competitors?: string[] } | null) ?? null;
    const competitors = competitorBonus?.competitors ?? [];
    const evalPromptSnapshot = (role.evaluation_prompt as string | null) ?? "";
    const internalNotes = (cand.internal_notes as string | null) ?? "";

    const accessToken = await getGmailAccessToken();

    // Fetch + parse the original message.
    const msg = await gmailFetch<GmailMessage>(accessToken, `/messages/${cand.gmail_message_id}?format=full`);
    const parts = walkParts(msg.payload);
    let bodyText = "";
    let bodyHtml = "";
    const attachments: { id: string; filename: string; mimeType: string; size: number | null; storage_path?: string | null }[] = [];
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

    // Re-fetch + persist + parse attachments. Storage upserts (Phase 3.4 set upsert: true)
    // so re-runs overwrite cleanly.
    let attachText = "";
    for (const att of attachments) {
      try {
        const a = await gmailFetch<GmailAttachment>(accessToken, `/messages/${cand.gmail_message_id}/attachments/${att.id}`);
        let bytes: Uint8Array | null = a?.data ? decodeBase64Url(a.data) : null;
        if (bytes) {
          const uploaded = await uploadAttachmentToStorage({
            bytes,
            roleId: cand.role_id,
            candidateId: cand.id,
            filename: att.filename,
            mimeType: att.mimeType,
          });
          if (uploaded) att.storage_path = uploaded.path;
        }
        const isDocx = att.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          || /\.docx$/i.test(att.filename ?? "");
        const isPdf = att.mimeType === "application/pdf" || /\.pdf$/i.test(att.filename ?? "");
        if (isPdf && bytes) {
          const t = await extractPdfText(bytes);
          attachText += `\n\n--- ${att.filename} (PDF, parsed) ---\n${t.slice(0, 20000)}`;
        } else if (isDocx && bytes) {
          const t = await extractDocxText(bytes, att.filename);
          attachText += `\n\n--- ${att.filename} (DOCX, parsed) ---\n${t.slice(0, 20000)}`;
        } else {
          attachText += `\n\n--- ${att.filename} (${att.mimeType}) — attachment present but content not parsed; lower confidence accordingly ---`;
        }
        bytes = null;
      } catch (e) {
        console.error(`[ts-evaluate-candidate] attachment fetch failed: ${att.filename}: ${e instanceof Error ? e.message : e}`);
      }
    }

    // Match the source repo's exact format. The system prompt (evalPrompt.ts)
    // already instructs Claude to treat this block as authoritative input that
    // supersedes resume/cover-letter inferences — don't reword the header here.
    const notesBlock = internalNotes.trim().length
      ? `\n\nHIRING MANAGER NOTES:\n${internalNotes.trim()}`
      : "";
    const bundle = `From: ${cand.name} <${cand.email}>\nDate: ${cand.applied_date}\n\nEmail Body:\n${bodyText}\n\nAttachments:${attachText || " (none)"}${notesBlock}`.slice(0, 60000);

    const { urls: detectedUrls, ctx: portfolioCtx } = buildPortfolioInputs({
      candidateName: cand.name ?? cand.email ?? undefined,
      bodyPlain: bodyText,
      bodyHtml,
      attachText,
    });
    const portfolioUrl = pickBestPortfolioUrl(detectedUrls, portfolioCtx);
    const portfolioAtt = pickPortfolioAttachment(attachments);

    // Score with current scorecard + eval prompt + internal notes.
    const claudeRequest = buildClaudeEvalRequest({
      role: { ...role, jd_full_text: role.job_description ?? null },
      scorecard,
      competitors,
      candidateBundle: bundle,
      detectedUrls,
      systemPromptOverride: evalPromptSnapshot && evalPromptSnapshot.trim().length ? evalPromptSnapshot : undefined,
    });
    const staticPrefixLen = getClaudeStaticPrefixLength({
      role: { ...role, jd_full_text: role.job_description ?? null },
      scorecard,
      competitors,
      systemPromptOverride: evalPromptSnapshot && evalPromptSnapshot.trim().length ? evalPromptSnapshot : undefined,
    });
    console.log(`[ts-evaluate-candidate] BEFORE_FETCH candidate=${candidate_id} staticPrefixLen=${staticPrefixLen}`);

    const result = await callClaude(
      "talent_scout",
      // buildClaudeEvalRequest's inferred return type widens the block
      // `type`/`role` string literals, so it isn't structurally assignable to
      // the wrapper's ClaudeMessage[] without routing through unknown.
      claudeRequest.messages as unknown as ClaudeMessage[],
      {
        model: claudeRequest.model,
        max_tokens: claudeRequest.max_tokens,
        system: claudeRequest.system as unknown as ClaudeContentPart[],
        anthropic_beta: ["extended-cache-ttl-2025-04-11"],
        fn_name: "ts-evaluate-candidate",
        role_id: cand.role_id,
      },
    );
    if (!result.ok) throw new Error(`Anthropic ${result.status}: ${result.error.slice(0, 300)}`);

    const r = parseClaudeJson<ClaudeEvalResult>(result.text);

    // Compute new portfolio_type / path. Same logic as ts-pull-candidates.
    let portfolio_type: "file" | "url" | "none" = "none";
    let portfolio_path_or_url: string | null = null;
    if (portfolioAtt?.storage_path) {
      portfolio_type = "file";
      portfolio_path_or_url = portfolioAtt.storage_path;
    } else if (portfolioUrl) {
      portfolio_type = "url";
      portfolio_path_or_url = portfolioUrl;
    }

    // Status policy: preserve status whenever a human has manually confirmed
    // it (manually_reviewed=true). Re-eval still refreshes score / breakdown /
    // strengths / gaps / overview but never overrides the human's pick.
    // For un-reviewed candidates (manually_reviewed=false), re-eval can
    // reclassify based on the new score — including flipping to or away
    // from a rejection.
    // Phase 3.7.2.1: AI rejection now writes status='reject' with
    // manually_reviewed=false (the AUTO pill in the UI signals it's still
    // the AI's pick). Legacy 'auto_rejected' values are still allowed in
    // the gate's existing-status check for safety.
    const currentStatus = cand.status as string | null;
    const manuallyReviewed = (cand as { manually_reviewed?: boolean }).manually_reviewed === true;
    let newStatus: string = currentStatus ?? "consider";
    if (!manuallyReviewed) {
      const threshold = role.auto_rejection_threshold ?? 60;
      let disqualified = false;
      for (const c of scorecardCriteria) {
        if (c.tier === 1 && c.is_disqualifier && (r.scores?.[c.name] ?? 0) === 0) { disqualified = true; break; }
      }
      if (disqualified) newStatus = "reject";
      else if ((r.total_score ?? 0) < threshold) newStatus = "reject";
      else if (r.auto_classification_suggested === "fast_track") newStatus = "fast_track";
      else newStatus = "consider";
    }

    // Mirror latest scoring fields onto ts_candidates.
    const { error: candErr } = await supabase.from("ts_candidates").update({
      score: r.total_score ?? null,
      score_breakdown: r.scores ?? {},
      status: newStatus,
      location: (r.candidate_location as string | null) ?? cand.location ?? null,
      recruiter_overview: r.recruiter_note ?? null,
      top_strengths: r.top_strengths ?? [],
      key_gaps: r.key_gaps ?? [],
      quick_overview: Array.isArray(r.quick_overview) ? r.quick_overview.slice(0, 4) : [],
      tier: r.recommendation_tier ?? null,
      portfolio_type,
      portfolio_path_or_url,
      detected_links: classifyDetectedUrls(detectedUrls),
      last_evaluated_at: new Date().toISOString(),
    }).eq("id", candidate_id);
    if (candErr) throw new Error(`ts_candidates update: ${candErr.message}`);

    // Overwrite mode (bulk re-eval): delete prior history rows. Old evals are
    // not meaningful because the prompt or scorecard has changed.
    if (overwrite_history) {
      const { error: delErr } = await supabase
        .from("ts_evaluations")
        .delete()
        .eq("candidate_id", candidate_id);
      if (delErr) throw new Error(`ts_evaluations delete: ${delErr.message}`);
    }

    // INSERT into ts_evaluations — history table, new row per evaluation.
    const { error: evalErr } = await supabase.from("ts_evaluations").insert({
      role_id: cand.role_id,
      candidate_id,
      scorecard_snapshot: scorecard,
      eval_prompt_snapshot: evalPromptSnapshot,
      score: r.total_score ?? null,
      score_breakdown: r.scores ?? {},
      recruiter_overview: r.recruiter_note ?? null,
      top_strengths: r.top_strengths ?? [],
      key_gaps: r.key_gaps ?? [],
      tier: r.recommendation_tier ?? null,
      internal_notes_at_time: internalNotes || null,
      triggered_by: triggered_by_user_id ?? null,
      evaluated_at: new Date().toISOString(),
    });
    if (evalErr) throw new Error(`ts_evaluations insert: ${evalErr.message}`);

    return new Response(JSON.stringify({
      ok: true,
      score: r.total_score ?? null,
      status: newStatus,
      cost_usd: result.cost_usd,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const err = e as { message?: string; stack?: string };
    console.error(`[ts-evaluate-candidate] CATCH candidate=${candidateIdForLog}: ${err?.message ?? String(e)}`);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
