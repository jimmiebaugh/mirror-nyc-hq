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

  const summary = {
    reset_at: new Date().toISOString(),
    previous_spend_usd: Number(before.anthropic_spend_current_month_usd ?? 0),
    cap_usd: Number(before.anthropic_spend_cap_monthly_usd ?? 0),
    cap_alert_was_armed: before.cap_alert_sent_this_month === false,
  };
  console.log(`[ts-cron-monthly-spend-reset] done`, summary);
  return new Response(JSON.stringify(summary), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
