// ts-final-review — comparative AI ranking of a role's Master Pool.
//
// Ported from mirror-talent-scout/supabase/functions/generate-final-review
// with HQ-specific adaptations:
//   - Table names: ts_final_reviews / ts_candidates / ts_evaluations / ts_pull_rounds / ts_roles
//   - Field renames: final_rankings (not rankings); each entry shape is
//     { candidate_id, final_rank, final_tier, rationale, recruiter_note }
//     instead of source's { candidate_id, final_rank, recommendation_tier, narrative }.
//     recruiter_note is a string[] (bullet list, max 3); legacy single-string
//     responses get coerced to a singleton array on parse.
//   - Uses callClaude('talent_scout', ...) for spend tracking + per-app key.
//   - HQ status enum: interview / fast_track / consider / reject / auto_rejected.
//     Pool = non-rejected (everything except reject + auto_rejected).
//
// Returns immediately with `{ final_review_id }`; the AI work runs in the
// background via EdgeRuntime.waitUntil and streams progress via
// ts_final_reviews.step_progress (Realtime subscribed by FinalReviewLoading).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { parseClaudeJson } from "../_shared/parseClaudeJson.ts";
import { callClaude } from "../_shared/anthropic.ts";
import { requireInternalOrUserAuth } from "../_shared/internalAuth.ts";
import { FINAL_REVIEW_PROMPT_TEMPLATE } from "../_shared/prompts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret",
};

const sb = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

/**
 * Coerce any thrown value into a useful message string. Supabase's
 * PostgrestError isn't `instanceof Error`, so the naive `String(e)` path
 * yields "[object Object]". This handles the common shapes: real Errors,
 * objects with a `.message` field, and anything else.
 */
// deno-lint-ignore no-explicit-any
function fmtErr(e: any): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    if (typeof e.message === "string") {
      const parts = [e.message];
      if (e.code) parts.push(`(code ${e.code})`);
      if (e.details) parts.push(`details: ${e.details}`);
      if (e.hint) parts.push(`hint: ${e.hint}`);
      return parts.join(" ");
    }
    try { return JSON.stringify(e).slice(0, 500); } catch { return String(e); }
  }
  return String(e);
}

const STEPS = ["aggregate", "build", "rank"] as const;
type Progress = Record<string, { status: "pending" | "active" | "done"; count?: number; label?: string }>;

// HQ statuses considered "in pool" for the final review. interview /
// fast_track / consider land here. Reject + auto_rejected are excluded.
const POOL_STATUSES = ["interview", "fast_track", "consider"];


// deno-lint-ignore no-explicit-any
async function setProgress(supabase: any, id: string, progress: Progress, extra: Record<string, unknown> = {}) {
  await supabase.from("ts_final_reviews").update({ step_progress: progress, ...extra }).eq("id", id);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const authFail = await requireInternalOrUserAuth(req);
  if (authFail) {
    return new Response(authFail.body, {
      status: authFail.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let reviewId: string | undefined;
  const supabase = sb();

  try {
    const { role_id, top_n, triggered_by } = await req.json();
    if (!role_id) throw new Error("role_id required");
    const requestedTopN = typeof top_n === "number" && Number.isFinite(top_n) && top_n > 0 ? Math.floor(top_n) : null;

    const { data: role } = await supabase.from("ts_roles").select("*").eq("id", role_id).single();
    if (!role) throw new Error("Role not found");

    const initialProgress: Progress = {};
    for (const s of STEPS) initialProgress[s] = { status: "pending" };

    const { data: review, error: revErr } = await supabase
      .from("ts_final_reviews")
      .insert({
        role_id,
        status: "generating",
        step_progress: initialProgress,
        candidate_count_limit: requestedTopN,
        triggered_by: triggered_by ?? null,
      })
      .select()
      .single();
    if (revErr) throw revErr;
    reviewId = review.id;
    const startedAt = Date.now();

    const response = new Response(JSON.stringify({ final_review_id: reviewId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

    const work = (async () => {
      const progress: Progress = { ...initialProgress };
      const errors: unknown[] = [];
      try {
        // STEP A — Aggregate Master Pool
        progress.aggregate = { status: "active", label: "Aggregating Master Pool" };
        await setProgress(supabase, reviewId!, progress);

        const { data: cands } = await supabase
          .from("ts_candidates")
          .select("id,name,email,location,applied_date,status,pull_round_id,internal_notes,quick_overview,score,tier,recruiter_overview,top_strengths,key_gaps,score_breakdown")
          .eq("role_id", role_id)
          .in("status", POOL_STATUSES);

        const candList = cands ?? [];
        if (candList.length < 3) {
          throw new Error("Master Pool needs at least 3 candidates to run Final Review");
        }

        // Per-round number lookup so the prompt can show round provenance.
        const { data: rounds } = await supabase
          .from("ts_pull_rounds").select("id,round_number").eq("role_id", role_id);
        const roundMap: Record<string, number> = {};
        // deno-lint-ignore no-explicit-any
        (rounds ?? []).forEach((r: any) => { roundMap[r.id] = r.round_number; });

        // deno-lint-ignore no-explicit-any
        const fullPayload = candList.map((c: any) => ({
          id: c.id,
          name: c.name,
          email: c.email,
          location: c.location,
          applied_date: c.applied_date,
          total_score: c.score ?? null,
          score_breakdown: c.score_breakdown ?? {},
          top_strengths: c.top_strengths ?? [],
          key_gaps: c.key_gaps ?? [],
          recruiter_overview: c.recruiter_overview ?? null,
          internal_notes: c.internal_notes && String(c.internal_notes).trim().length
            ? String(c.internal_notes).trim()
            : null,
          quick_overview: c.quick_overview ?? [],
          original_tier: c.tier ?? null,
          source_round_number: roundMap[c.pull_round_id] ?? null,
        }));

        // Cap input at top 50 by total_score for context-window safety on
        // large pools. Ports source's HARD_CAP behavior verbatim.
        const HARD_CAP = 50;
        const poolSize = fullPayload.length;
        const sortedPayload = [...fullPayload].sort((a, b) => (b.total_score ?? -1) - (a.total_score ?? -1));
        const effectiveCap = requestedTopN ? Math.min(requestedTopN, HARD_CAP) : HARD_CAP;
        const candidatesPayload = sortedPayload.slice(0, effectiveCap);
        const inputNote = requestedTopN
          ? `Pool size: ${poolSize} total. User requested top ${requestedTopN}; ranking top ${candidatesPayload.length} by per-round score.`
          : (poolSize > HARD_CAP
            ? `Pool size: ${poolSize} total. Showing top ${HARD_CAP} by per-round score for ranking.`
            : `Pool size: ${poolSize} total. All candidates included.`);

        progress.aggregate = {
          status: "done",
          count: poolSize,
          label: `Aggregated ${poolSize} Master Pool candidates${candidatesPayload.length < poolSize ? ` (ranking top ${candidatesPayload.length})` : ""}`,
        };
        await setProgress(supabase, reviewId!, progress, { candidate_count: poolSize });

        // STEP B — Build the prompt payload
        progress.build = { status: "active", label: "Building comparative analysis" };
        await setProgress(supabase, reviewId!, progress);

        const prompt = FINAL_REVIEW_PROMPT_TEMPLATE
          .replaceAll("{{role_title}}", role.title ?? "")
          .replaceAll("{{job_description}}", role.job_description ?? "")
          .replaceAll("{{hiring_priorities}}", role.hiring_priorities ?? "")
          .replaceAll("{{auto_rejection_threshold}}", String(role.auto_rejection_threshold ?? 60))
          .replaceAll("{{candidate_count_note}}", `${candidatesPayload.length} included; ${inputNote}`)
          .replaceAll("{{candidates_json}}", JSON.stringify(candidatesPayload, null, 2));

        progress.build = { status: "done", label: "Comparative analysis prepared" };
        await setProgress(supabase, reviewId!, progress);

        // STEP C — Call Claude
        progress.rank = { status: "active", label: "Analyzing and Ranking (this can take 5+ minutes for large pools)" };
        await setProgress(supabase, reviewId!, progress);

        // Two-attempt retry on JSON parse failure (matches source).
        // deno-lint-ignore no-explicit-any
        let parsed: any | null = null;
        // deno-lint-ignore no-explicit-any
        let raw: any = null;
        let attempt = 0;
        let lastErr: unknown;
        while (attempt < 2) {
          attempt++;
          const result = await callClaude("talent_scout", [{ role: "user", content: prompt }], {
            max_tokens: 8000,
            fn_name: "ts-final-review",
            role_id,
          });
          if (!result.ok) {
            lastErr = result.error;
            errors.push({ step: "rank", attempt, error: result.error });
            if (attempt >= 2) throw new Error(`Anthropic call failed after retry: ${result.error}`);
            continue;
          }
          raw = result.raw;
          try {
            parsed = parseClaudeJson(result.text);
            break;
          } catch (e) {
            lastErr = e;
            errors.push({ step: "rank", attempt, error: String(e) });
            if (attempt >= 2) {
              throw new Error(`Claude returned malformed JSON after retry: ${e instanceof Error ? e.message : String(e)}`);
            }
          }
        }

        // Validate and canonicalize candidate_ids (hyphen-tolerant).
        // deno-lint-ignore no-explicit-any
        const rankings: any[] = Array.isArray(parsed.final_rankings) ? parsed.final_rankings : [];
        const normalizeId = (id: string) => String(id ?? "").replace(/-/g, "").toLowerCase();
        const poolByNormalized = new Map(candidatesPayload.map((c) => [normalizeId(c.id), c.id]));
        for (const r of rankings) {
          const claudeId = r.candidate_id;
          const canonicalId = poolByNormalized.get(normalizeId(claudeId));
          if (!canonicalId) {
            throw new Error(`Claude returned candidate_id not in pool: ${claudeId}`);
          }
          if (canonicalId !== claudeId) {
            console.log(`[ts-final-review] normalized malformed candidate_id: returned="${claudeId}" canonical="${canonicalId}"`);
            r.candidate_id = canonicalId;
          }
          // recruiter_note is now an array of bullet strings (Phase 3.6.6).
          // Coerce older Claude responses that returned a single string into
          // a singleton array so the UI renderers stay consistent.
          if (typeof r.recruiter_note === "string") {
            const s = r.recruiter_note.trim();
            r.recruiter_note = s ? [s] : [];
          } else if (!Array.isArray(r.recruiter_note)) {
            r.recruiter_note = [];
          }
        }

        progress.rank = {
          status: "done",
          count: rankings.length,
          label: `Complete. Ranked ${rankings.length} candidates.`,
        };
        await setProgress(supabase, reviewId!, progress, {
          status: "complete",
          final_rankings: rankings,
          pool_summary: parsed.pool_summary ?? "",
          claude_raw_response: raw,
          duration_seconds: Math.floor((Date.now() - startedAt) / 1000),
          error_log: errors,
        });
        console.log(`[ts-final-review] complete review=${reviewId} ranked=${rankings.length} duration=${Math.floor((Date.now() - startedAt) / 1000)}s`);
      } catch (e) {
        console.error("[ts-final-review] error:", e);
        await supabase.from("ts_final_reviews").update({
          status: "failed",
          error_message: fmtErr(e),
          error_log: errors,
          duration_seconds: Math.floor((Date.now() - startedAt) / 1000),
        }).eq("id", reviewId!);
      }
    })();

    // EdgeRuntime.waitUntil keeps the function alive past the response so
    // background work can finish. Available on Supabase Edge Runtime.
    // deno-lint-ignore no-explicit-any
    const erAny = (globalThis as any).EdgeRuntime;
    if (erAny && typeof erAny.waitUntil === "function") {
      erAny.waitUntil(work);
    } else {
      // Local dev fallback: just await it.
      await work;
    }

    return response;
  } catch (e) {
    const msg = fmtErr(e);
    console.error("[ts-final-review] fatal:", msg, e);
    if (reviewId) {
      await supabase.from("ts_final_reviews").update({
        status: "failed",
        error_message: msg,
      }).eq("id", reviewId);
    }
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
