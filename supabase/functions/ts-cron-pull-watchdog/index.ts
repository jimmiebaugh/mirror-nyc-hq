// ts-cron-pull-watchdog
//
// Phase 3.8. Detect stalled ts_pull_rounds and flip status -> 'stalled'.
// Detect-and-flag only — never auto-restart. Stalled pulls surface in
// PullDetail for the admin to decide.
//
// A pull is considered stalled when:
//   - status = 'running'
//   - updated_at older than STALL_MINUTES
//
// The pull pipeline updates the row at every chunked self-invocation
// (writes to processed_count + pending_candidates), so updated_at is the
// reliable heartbeat. STALL_MINUTES is generous (60) to cover large pools
// where a single Anthropic batch with big resume PDFs can sit for a while.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireInternalOrUserAuth } from "../_shared/internalAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret",
};

const STALL_MINUTES = 60;

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
    .from("ts_pull_rounds")
    .select("id, role_id, started_at, updated_at, processed_count, candidates_found")
    .eq("status", "running")
    .lt("updated_at", cutoff);

  if (error) {
    console.error("[ts-cron-pull-watchdog] query failed:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const flagged: Array<{ id: string; role_id: string; updated_at: string }> = [];
  for (const row of stalled ?? []) {
    const { error: updErr } = await supabase
      .from("ts_pull_rounds")
      .update({ status: "stalled", completed_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("status", "running"); // CAS guard against a late completion
    if (updErr) {
      console.error(`[ts-cron-pull-watchdog] update failed for round ${row.id}:`, updErr);
      continue;
    }
    flagged.push({ id: row.id, role_id: row.role_id, updated_at: row.updated_at });
    console.warn(
      `[ts-cron-pull-watchdog] flagged round ${row.id} (role ${row.role_id}) ` +
        `as stalled. updated_at=${row.updated_at}, processed=${row.processed_count}/${row.candidates_found}`,
    );
  }

  const summary = { stall_minutes: STALL_MINUTES, scanned: stalled?.length ?? 0, flagged: flagged.length, rows: flagged };
  console.log(`[ts-cron-pull-watchdog] done`, summary);
  return new Response(JSON.stringify(summary), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
