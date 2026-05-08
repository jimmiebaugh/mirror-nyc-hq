// ts-cron-reeval-watchdog
//
// Phase 3.8. Detect stalled bulk re-evals and flip ts_roles.reeval_status to
// 'failed'. Detect-and-flag only — never auto-restart.
//
// A re-eval is stalled when:
//   - reeval_status = 'running'
//   - reeval_last_progress_at older than STALL_MINUTES
//
// ts-bulk-reevaluate writes reeval_last_progress_at on each chunked self-
// invocation, so this is the reliable heartbeat.
//
// Note: the LEGACY ts_pull_rounds.reeval_last_progress_at column is unused
// since Phase 3.5. This watchdog reads ts_roles.reeval_last_progress_at only.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireInternalOrUserAuth } from "../_shared/internalAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret",
};

const STALL_MINUTES = 30;

function sb() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const authFail = await requireInternalOrUserAuth(req);
  if (authFail) return authFail;

  const supabase = sb();
  const cutoff = new Date(Date.now() - STALL_MINUTES * 60_000).toISOString();

  const { data: stalled, error } = await supabase
    .from("ts_roles")
    .select("id, title, reeval_status, reeval_last_progress_at, reeval_started_at, reeval_total, reeval_processed")
    .eq("reeval_status", "running")
    .lt("reeval_last_progress_at", cutoff);

  if (error) {
    console.error("[ts-cron-reeval-watchdog] query failed:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const flagged: Array<{ id: string; title: string; reeval_last_progress_at: string }> = [];
  for (const row of stalled ?? []) {
    const { error: updErr } = await supabase
      .from("ts_roles")
      .update({ reeval_status: "failed", reeval_completed_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("reeval_status", "running");
    if (updErr) {
      console.error(`[ts-cron-reeval-watchdog] update failed for role ${row.id}:`, updErr);
      continue;
    }
    flagged.push({ id: row.id, title: row.title, reeval_last_progress_at: row.reeval_last_progress_at });
    console.warn(
      `[ts-cron-reeval-watchdog] flagged role ${row.id} (${row.title}) reeval as stalled. ` +
        `last_progress=${row.reeval_last_progress_at}, processed=${row.reeval_processed}/${row.reeval_total}`,
    );
  }

  const summary = { stall_minutes: STALL_MINUTES, scanned: stalled?.length ?? 0, flagged: flagged.length, rows: flagged };
  console.log(`[ts-cron-reeval-watchdog] done`, summary);
  return new Response(JSON.stringify(summary), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
