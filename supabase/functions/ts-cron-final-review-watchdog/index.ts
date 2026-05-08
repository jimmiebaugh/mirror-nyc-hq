// ts-cron-final-review-watchdog
//
// Phase 3.8. Detect stalled ts_final_reviews stuck in 'generating' and flip
// status -> 'failed'. Detect-and-flag only — never auto-restart.
//
// A final review is stalled when:
//   - status = 'generating'
//   - generated_at older than STALL_MINUTES (no separate heartbeat column;
//     ts-final-review is one-shot Anthropic call wrapped in
//     EdgeRuntime.waitUntil, no chunked progress)
//
// 20 minutes is well past the typical wall-clock for a 50-candidate compare
// at the HARD_CAP, so anything older than that is dead.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireInternalOrUserAuth } from "../_shared/internalAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret",
};

const STALL_MINUTES = 20;

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
    .from("ts_final_reviews")
    .select("id, role_id, generated_at")
    .eq("status", "generating")
    .lt("generated_at", cutoff);

  if (error) {
    console.error("[ts-cron-final-review-watchdog] query failed:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const flagged: Array<{ id: string; role_id: string; generated_at: string }> = [];
  for (const row of stalled ?? []) {
    const { error: updErr } = await supabase
      .from("ts_final_reviews")
      .update({
        status: "failed",
        error_message: `Watchdog flagged as stalled (no completion within ${STALL_MINUTES} minutes).`,
      })
      .eq("id", row.id)
      .eq("status", "generating");
    if (updErr) {
      console.error(`[ts-cron-final-review-watchdog] update failed for review ${row.id}:`, updErr);
      continue;
    }
    flagged.push({ id: row.id, role_id: row.role_id, generated_at: row.generated_at });
    console.warn(
      `[ts-cron-final-review-watchdog] flagged review ${row.id} (role ${row.role_id}) as stalled. generated_at=${row.generated_at}`,
    );
  }

  const summary = { stall_minutes: STALL_MINUTES, scanned: stalled?.length ?? 0, flagged: flagged.length, rows: flagged };
  console.log(`[ts-cron-final-review-watchdog] done`, summary);
  return new Response(JSON.stringify(summary), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
