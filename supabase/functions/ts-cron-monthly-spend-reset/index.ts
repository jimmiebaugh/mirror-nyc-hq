// ts-cron-monthly-spend-reset
//
// Phase 3.8. 1st of each calendar month, 00:01 UTC. Resets:
//   global_settings.anthropic_spend_current_month_usd -> 0
//   global_settings.cap_alert_sent_this_month         -> false
//
// Without this, the cap alert never re-arms after the first month it fires
// (cap_alert_sent_this_month stays true forever; spend tracker keeps adding).
//
// Logs the value being reset for audit so a future month-over-month review
// can reconstruct historical spend from the cron logs.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireInternalOrUserAuth } from "../_shared/internalAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret",
};

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

  const { data: before, error: readErr } = await supabase
    .from("global_settings")
    .select("id, anthropic_spend_current_month_usd, cap_alert_sent_this_month, anthropic_spend_cap_monthly_usd")
    .limit(1)
    .maybeSingle();

  if (readErr || !before) {
    console.error("[ts-cron-monthly-spend-reset] could not load global_settings:", readErr);
    return new Response(JSON.stringify({ error: readErr?.message ?? "global_settings not found" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { error: updErr } = await supabase
    .from("global_settings")
    .update({
      anthropic_spend_current_month_usd: 0,
      cap_alert_sent_this_month: false,
    })
    .eq("id", before.id);

  if (updErr) {
    console.error("[ts-cron-monthly-spend-reset] update failed:", updErr);
    return new Response(JSON.stringify({ error: updErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Phase 5.15: prune anthropic_call_log rows older than 12 months.
  // Runs AFTER the global_settings reset so a prune failure can't block the
  // cap-alert re-arm. Non-fatal; next month's run catches up.
  const pruneCutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
  const { error: pruneErr, count: prunedCount } = await supabase
    .from("anthropic_call_log")
    .delete({ count: "exact" })
    .lt("created_at", pruneCutoff);
  if (pruneErr) {
    console.warn("[ts-cron-monthly-spend-reset] call-log prune failed:", pruneErr);
  }

  const summary = {
    reset_at: new Date().toISOString(),
    previous_spend_usd: Number(before.anthropic_spend_current_month_usd ?? 0),
    cap_usd: Number(before.anthropic_spend_cap_monthly_usd ?? 0),
    cap_alert_was_armed: before.cap_alert_sent_this_month === false,
    call_log_pruned_count: pruneErr ? null : (prunedCount ?? 0),
    call_log_prune_cutoff: pruneCutoff,
  };
  console.log(`[ts-cron-monthly-spend-reset] done`, summary);
  return new Response(JSON.stringify(summary), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
