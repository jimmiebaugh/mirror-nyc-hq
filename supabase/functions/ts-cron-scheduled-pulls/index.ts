// ts-cron-scheduled-pulls
//
// Phase 3.8. Fired by pg_cron daily at 12:00 UTC (8am ET, accepting EDT/EST
// drift). For every open role with auto_pull_schedule != 'off', if enough
// time has passed since the role's most recent pull (per the schedule),
// invoke ts-pull-candidates({role_id, triggered_by: 'scheduled'}).
//
// Schedule windows:
//   daily         => any pull older than ~22 hours qualifies
//   every_3_days  => any pull older than ~70 hours qualifies
//   weekly        => any pull older than ~166 hours qualifies
// (4-hour grace before each interval to avoid skip-day drift if the cron
// fires a few minutes late.)
//
// "Most recent pull" = max(started_at) over ts_pull_rounds for the role.
// If no pull exists yet, the role qualifies immediately.
//
// Failures invoking ts-pull-candidates are logged but never abort the loop —
// one bad role shouldn't block the rest.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireInternalOrUserAuth } from "../_shared/internalAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret",
};

const SCHEDULE_HOURS: Record<string, number> = {
  daily: 22,
  every_3_days: 70,
  weekly: 166,
};

function sb() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

async function invokePull(roleId: string): Promise<{ ok: boolean; error?: string }> {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/ts-pull-candidates`;
  const internalSecret = Deno.env.get("INTERNAL_API_SECRET")!;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": internalSecret,
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`,
      },
      body: JSON.stringify({ role_id: roleId, triggered_by: "scheduled" }),
    });
    if (!res.ok) {
      const errText = await res.text();
      return { ok: false, error: `${res.status}: ${errText.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const authFail = await requireInternalOrUserAuth(req);
  if (authFail) return authFail;

  const supabase = sb();
  const startedAt = new Date().toISOString();

  // Pull all open, scheduled roles.
  const { data: roles, error: rolesErr } = await supabase
    .from("ts_roles")
    .select("id, title, auto_pull_schedule")
    .eq("status", "open")
    .neq("auto_pull_schedule", "off");

  if (rolesErr) {
    console.error("[ts-cron-scheduled-pulls] could not load roles:", rolesErr);
    return new Response(JSON.stringify({ error: rolesErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const now = Date.now();
  const summary = {
    started_at: startedAt,
    candidates_for_pull: 0,
    invoked: 0,
    skipped: 0,
    failed: 0,
    details: [] as Array<{ role_id: string; title: string; action: string; reason?: string }>,
  };

  for (const role of roles ?? []) {
    const schedule = role.auto_pull_schedule as string;
    const intervalHours = SCHEDULE_HOURS[schedule];
    if (!intervalHours) {
      summary.skipped++;
      summary.details.push({ role_id: role.id, title: role.title, action: "skipped", reason: `unknown schedule '${schedule}'` });
      continue;
    }

    summary.candidates_for_pull++;

    // Most recent pull for this role.
    const { data: lastRound } = await supabase
      .from("ts_pull_rounds")
      .select("started_at, status")
      .eq("role_id", role.id)
      .order("started_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    if (lastRound) {
      // Skip if a pull is currently running — don't stack.
      if (lastRound.status === "running") {
        summary.skipped++;
        summary.details.push({ role_id: role.id, title: role.title, action: "skipped", reason: "pull already running" });
        continue;
      }
      const lastStartedMs = lastRound.started_at ? new Date(lastRound.started_at).getTime() : 0;
      const hoursSince = (now - lastStartedMs) / 3_600_000;
      if (hoursSince < intervalHours) {
        summary.skipped++;
        summary.details.push({
          role_id: role.id,
          title: role.title,
          action: "skipped",
          reason: `${hoursSince.toFixed(1)}h since last pull, interval ${intervalHours}h`,
        });
        continue;
      }
    }

    const result = await invokePull(role.id);
    if (result.ok) {
      summary.invoked++;
      summary.details.push({ role_id: role.id, title: role.title, action: "invoked" });
    } else {
      summary.failed++;
      summary.details.push({ role_id: role.id, title: role.title, action: "failed", reason: result.error });
      console.error(`[ts-cron-scheduled-pulls] invoke failed for role ${role.id}:`, result.error);
    }
  }

  console.log(`[ts-cron-scheduled-pulls] done`, summary);
  return new Response(JSON.stringify(summary), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
