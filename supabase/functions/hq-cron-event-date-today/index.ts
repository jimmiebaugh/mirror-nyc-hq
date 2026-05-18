// hq-cron-event-date-today
//
// Phase 5.5. Daily 07:00 ET (11:00 UTC) cron. Queries projects where
// install_dates_start = CURRENT_DATE OR live_dates_start = CURRENT_DATE OR
// removal_dates_start = CURRENT_DATE. Resolves assigned users from
// project_account_managers + project_designers + project_members (deduped,
// 5.7.7 added the third bucket). Fans out a notifications-dispatch call per
// project with the event kind in `extra`.
//
// Auth: requireInternalOrUserAuth. verify_jwt = false in config.toml.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireInternalOrUserAuth } from "../_shared/internalAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-internal-secret",
};

function sb() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

async function postDispatch(payload: Record<string, unknown>): Promise<void> {
  const baseUrl = Deno.env.get("SUPABASE_URL");
  const secret = Deno.env.get("INTERNAL_API_SECRET");
  if (!baseUrl || !secret) {
    console.warn("[hq-cron-event-date-today] missing SUPABASE_URL or INTERNAL_API_SECRET");
    return;
  }
  try {
    const res = await fetch(`${baseUrl}/functions/v1/notifications-dispatch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": secret,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(
        `[hq-cron-event-date-today] dispatch ${res.status}: ${text.slice(0, 200)}`,
      );
    }
  } catch (err) {
    console.error("[hq-cron-event-date-today] dispatch network error:", err);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const authFail = await requireInternalOrUserAuth(req);
  if (authFail) return authFail;

  const supabase = sb();
  const today = new Date().toISOString().slice(0, 10);

  // One query per kind because Supabase JS doesn't combine OR across columns
  // cleanly without raw SQL. Three small queries are fine here.
  const [installs, lives, removals] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name")
      .eq("install_dates_start", today)
      .is("archived_at", null),
    supabase
      .from("projects")
      .select("id, name")
      .eq("live_dates_start", today)
      .is("archived_at", null),
    supabase
      .from("projects")
      .select("id, name")
      .eq("removal_dates_start", today)
      .is("archived_at", null),
  ]);

  const events: { id: string; name: string; kind: "Install" | "Live" | "Removal" }[] = [
    ...((installs.data ?? []).map((p) => ({ id: p.id, name: p.name, kind: "Install" as const }))),
    ...((lives.data ?? []).map((p) => ({ id: p.id, name: p.name, kind: "Live" as const }))),
    ...((removals.data ?? []).map((p) => ({ id: p.id, name: p.name, kind: "Removal" as const }))),
  ];

  let fanout = 0;
  for (const ev of events) {
    const [amRes, dgRes, pmRes] = await Promise.all([
      supabase.from("project_account_managers").select("user_id").eq("project_id", ev.id),
      supabase.from("project_designers").select("user_id").eq("project_id", ev.id),
      supabase.from("project_members").select("user_id").eq("project_id", ev.id),
    ]);
    const recipientIds = Array.from(
      new Set([
        ...((amRes.data ?? []).map((r) => r.user_id)),
        ...((dgRes.data ?? []).map((r) => r.user_id)),
        ...((pmRes.data ?? []).map((r) => r.user_id)),
      ]),
    );
    if (recipientIds.length === 0) continue;
    await postDispatch({
      event_type: "event_date_today",
      entity_type: "project",
      entity_id: ev.id,
      entity_name: ev.name,
      recipient_user_ids: recipientIds,
      actor_id: null,
      extra: { kind: ev.kind, project_name: ev.name },
    });
    fanout++;
  }

  console.log(
    `[hq-cron-event-date-today] today=${today} events=${events.length} dispatched=${fanout}`,
  );
  return new Response(
    JSON.stringify({ ok: true, today, dispatched: fanout }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
