// ts-bulk-reevaluate
//
// Role-scoped batch re-evaluation with chunked self-invoke. Loops
// ts-evaluate-candidate over the role's master pool. Tracks per-run state on
// ts_roles (reeval_status / reeval_total / reeval_processed / reeval_failed /
// reeval_started_at / reeval_completed_at / reeval_last_progress_at).
//
// Body shapes:
//   { role_id, status_filter? }            → start a new run
//   { continue_role_id }                   → continuation invocation
//
// status_filter values:
//   undefined / null / 'master_pool'       → all non-rejected, non-auto-rejected
//   'auto_rejected'                        → only auto-rejected (retry path)
//   'all'                                  → every candidate in the role
//
// Adapted from mirror-talent-scout/supabase/functions/reevaluate-round/index.ts:
//   - Role-scoped instead of round-scoped (HQ Phase 3.5 spec).
//   - State on ts_roles instead of ts_pull_rounds.
//   - status_filter param consolidates retry-failed-candidates' role here.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireInternalOrUserAuth } from "../_shared/internalAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret",
};

const WALL_TIME_BUDGET_MS = 110 * 1000;
const MAX_PER_BATCH = 25;

const sb = () =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

// Phase 3.7.2.1: 'auto_rejected' filter still accepted from clients but the
// semantics are now "AI-rejected" — i.e. status='reject' AND
// manually_reviewed=false. The 'reject' enum value was the legacy AI bin;
// new writes use 'reject' + manually_reviewed=false. Unreviewed-rejected
// is the natural retry-failed bucket.
//
// Phase 3.7.6: 'not_manually_rejected' added. Used by Role Settings when
// the JD / eval prompt / scorecard changes — re-evaluates the entire pool
// AND any AI-rejected candidates, but leaves human-confirmed rejections
// alone (their manually_reviewed=true is the explicit "do not touch"
// signal).
type StatusFilter = "master_pool" | "auto_rejected" | "not_manually_rejected" | "all";

function normalizeFilter(v: unknown): StatusFilter {
  if (v === "auto_rejected") return "auto_rejected";
  if (v === "not_manually_rejected") return "not_manually_rejected";
  if (v === "all") return "all";
  return "master_pool";
}

type FilterClause = {
  include?: string[];
  exclude?: string[];
  manuallyReviewed?: boolean;
  /** SQL-or expression applied via PostgREST .or(). Used for compound
   *  conditions like "everything except status=reject AND manually_reviewed=true". */
  orExpr?: string;
};

function statusInClauseForFilter(filter: StatusFilter): FilterClause {
  // 'auto_rejected' filter = AI-rejected: status=reject AND not yet
  // manually reviewed. Includes legacy 'auto_rejected' enum values for
  // safety (any rows the backfill missed).
  if (filter === "auto_rejected") {
    return { include: ["reject", "auto_rejected"], manuallyReviewed: false };
  }
  // 'not_manually_rejected': everything EXCEPT rows the user explicitly
  // rejected (status='reject' AND manually_reviewed=true). AI rejections
  // (manually_reviewed=false) are included so prompt/JD/scorecard changes
  // can flip them back into the pool if the new score warrants it.
  if (filter === "not_manually_rejected") {
    return { orExpr: "status.neq.reject,manually_reviewed.eq.false" };
  }
  if (filter === "all") return {};
  return { exclude: ["reject", "auto_rejected"] };
}

async function dispatchNext(roleId: string, attempt = 1): Promise<void> {
  const MAX_ATTEMPTS = 3;
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/ts-bulk-reevaluate`;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
        apikey: key,
        "x-internal-secret": Deno.env.get("INTERNAL_API_SECRET") ?? "",
      },
      body: JSON.stringify({ continue_role_id: roleId }),
    });
    if (r.status >= 200 && r.status < 300) return;
    if (attempt < MAX_ATTEMPTS) {
      await new Promise((x) => setTimeout(x, 1500 * attempt));
      return dispatchNext(roleId, attempt + 1);
    }
    console.error(`[ts-bulk-reevaluate] dispatch failed status=${r.status}`);
  } catch (e: any) {
    if (attempt < MAX_ATTEMPTS) {
      await new Promise((x) => setTimeout(x, 1500 * attempt));
      return dispatchNext(roleId, attempt + 1);
    }
    console.error("[ts-bulk-reevaluate] dispatch error:", e?.message ?? e);
  }
}

function selfInvoke(roleId: string) {
  try {
    // @ts-expect-error EdgeRuntime.waitUntil is provided by Supabase Edge runtime, not in Deno types
    EdgeRuntime.waitUntil(dispatchNext(roleId));
  } catch {
    dispatchNext(roleId).catch((err) => console.error("[ts-bulk-reevaluate] selfInvoke:", err));
  }
}

async function evaluateOne(candidateId: string, triggeredByUserId?: string | null): Promise<boolean> {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/ts-evaluate-candidate`;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
        apikey: key,
        "x-internal-secret": Deno.env.get("INTERNAL_API_SECRET") ?? "",
      },
      body: JSON.stringify({
        candidate_id: candidateId,
        triggered_by_user_id: triggeredByUserId ?? null,
        // Bulk re-eval implies the prompt/scorecard has changed; the prior
        // evaluation is no longer meaningful.
        overwrite_history: true,
      }),
    });
    return r.status >= 200 && r.status < 300;
  } catch (e: any) {
    console.error(`[ts-bulk-reevaluate] candidate ${candidateId} error:`, e?.message ?? e);
    return false;
  }
}

async function listPendingCandidates(
  supabase: any,
  roleId: string,
  filter: StatusFilter,
  startedAt: string,
): Promise<string[]> {
  let q = supabase.from("ts_candidates").select("id").eq("role_id", roleId);
  const f = statusInClauseForFilter(filter);
  if (f.include) q = q.in("status", f.include);
  if (f.exclude) q = q.not("status", "in", `(${f.exclude.join(",")})`);
  if (f.manuallyReviewed !== undefined) q = q.eq("manually_reviewed", f.manuallyReviewed);
  if (f.orExpr) q = q.or(f.orExpr);
  const { data: cands } = await q;
  const allIds: string[] = (cands ?? []).map((c: any) => c.id);
  if (allIds.length === 0) return [];

  // Skip candidates already evaluated in this run (history-table-aware).
  const { data: doneEvals } = await supabase
    .from("ts_evaluations")
    .select("candidate_id")
    .in("candidate_id", allIds)
    .gte("evaluated_at", startedAt);
  const done = new Set<string>((doneEvals ?? []).map((e: any) => e.candidate_id));
  return allIds.filter((id) => !done.has(id));
}

async function processRole(supabase: any, roleId: string): Promise<Response> {
  const { data: role } = await supabase
    .from("ts_roles")
    .select("id, reeval_status, reeval_status_filter, reeval_total, reeval_processed, reeval_failed, reeval_started_at")
    .eq("id", roleId)
    .maybeSingle();
  if (!role) {
    return new Response(JSON.stringify({ error: "role not found" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (role.reeval_status !== "running") {
    return new Response(JSON.stringify({ ok: true, noop: true, status: role.reeval_status }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const filter = normalizeFilter(role.reeval_status_filter);
  const startedAt = role.reeval_started_at as string;
  const pending = await listPendingCandidates(supabase, roleId, filter, startedAt);

  if (pending.length === 0) {
    await supabase.from("ts_roles").update({
      reeval_status: "complete",
      reeval_completed_at: new Date().toISOString(),
      reeval_last_progress_at: new Date().toISOString(),
    }).eq("id", roleId);
    return new Response(JSON.stringify({ ok: true, complete: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const start = Date.now();
  let processedThisRun = 0;
  let failedThisRun = 0;
  for (const cid of pending.slice(0, MAX_PER_BATCH)) {
    if (Date.now() - start > WALL_TIME_BUDGET_MS) break;
    const ok = await evaluateOne(cid);
    processedThisRun++;
    if (!ok) failedThisRun++;
    await supabase.from("ts_roles").update({
      reeval_processed: (role.reeval_processed ?? 0) + processedThisRun,
      reeval_failed: (role.reeval_failed ?? 0) + failedThisRun,
      reeval_last_progress_at: new Date().toISOString(),
    }).eq("id", roleId);
  }

  // Re-check remaining: pending candidates whose eval row's evaluated_at is still older than startedAt.
  const remainingIds = await listPendingCandidates(supabase, roleId, filter, startedAt);

  if (remainingIds.length > 0) {
    selfInvoke(roleId);
    return new Response(JSON.stringify({ ok: true, remaining: remainingIds.length, processed_this_run: processedThisRun }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  await supabase.from("ts_roles").update({
    reeval_status: "complete",
    reeval_completed_at: new Date().toISOString(),
    reeval_last_progress_at: new Date().toISOString(),
  }).eq("id", roleId);
  return new Response(JSON.stringify({ ok: true, complete: true, processed_this_run: processedThisRun }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const authFail = await requireInternalOrUserAuth(req);
  if (authFail) return new Response(authFail.body, { status: authFail.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const supabase = sb();
    const body = await req.json().catch(() => ({}));

    if (body.continue_role_id) {
      return await processRole(supabase, body.continue_role_id as string);
    }

    const roleId = body.role_id as string | undefined;
    const filter = normalizeFilter(body.status_filter);
    if (!roleId) {
      return new Response(JSON.stringify({ error: "role_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Count target candidates for the run.
    let q = supabase.from("ts_candidates").select("id", { count: "exact", head: true }).eq("role_id", roleId);
    const f = statusInClauseForFilter(filter);
    if (f.include) q = q.in("status", f.include);
    if (f.exclude) q = q.not("status", "in", `(${f.exclude.join(",")})`);
    const { count: total } = await q;
    const totalNum = total ?? 0;

    const nowIso = new Date().toISOString();
    if (totalNum === 0) {
      await supabase.from("ts_roles").update({
        reeval_status: "complete",
        reeval_status_filter: filter,
        reeval_total: 0,
        reeval_processed: 0,
        reeval_failed: 0,
        reeval_started_at: nowIso,
        reeval_last_progress_at: nowIso,
        reeval_completed_at: nowIso,
      }).eq("id", roleId);
      return new Response(JSON.stringify({ ok: true, total: 0, complete: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase.from("ts_roles").update({
      reeval_status: "running",
      reeval_status_filter: filter,
      reeval_total: totalNum,
      reeval_processed: 0,
      reeval_failed: 0,
      reeval_started_at: nowIso,
      reeval_last_progress_at: nowIso,
      reeval_completed_at: null,
    }).eq("id", roleId);

    selfInvoke(roleId);

    return new Response(JSON.stringify({ ok: true, total: totalNum, status_filter: filter }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[ts-bulk-reevaluate] fatal:", e);
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
