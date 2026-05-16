// hq-cron-deliverable-due-3d
//
// Phase 5.5. Daily 09:00 ET (13:00 UTC) cron. Queries deliverables where
// due_date = CURRENT_DATE + 3 AND status NOT IN ('Complete', 'Skipped'),
// resolves project owners from project_account_managers, fans out a
// notifications-dispatch call per deliverable. The dispatch fn handles
// per-user preference checks + in-app vs Slack delivery.
//
// Idempotency: notifications has no unique constraint on (user_id, type,
// entity_id), so re-runs of this cron on the same day would duplicate
// rows. Cron fires once daily; if a cap is ever needed, add a partial
// unique index on (user_id, type, link_url, date(created_at)).
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
    console.warn("[hq-cron-deliverable-due-3d] missing SUPABASE_URL or INTERNAL_API_SECRET");
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
        `[hq-cron-deliverable-due-3d] dispatch ${res.status}: ${text.slice(0, 200)}`,
      );
    }
  } catch (err) {
    console.error("[hq-cron-deliverable-due-3d] dispatch network error:", err);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const authFail = await requireInternalOrUserAuth(req);
  if (authFail) return authFail;

  const supabase = sb();

  // Postgres date arithmetic: due_date = today + 3 days.
  const target = new Date();
  target.setDate(target.getDate() + 3);
  const targetIso = target.toISOString().slice(0, 10);

  const { data: deliverables, error } = await supabase
    .from("deliverables")
    .select("id, title, project_id, projects(name)")
    .eq("due_date", targetIso)
    .not("status", "in", "(Complete,Skipped)");

  if (error) {
    console.error("[hq-cron-deliverable-due-3d] query error:", error);
    return new Response(
      JSON.stringify({ error: "query_failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  let fanout = 0;
  for (const d of deliverables ?? []) {
    const { data: ams } = await supabase
      .from("project_account_managers")
      .select("user_id")
      .eq("project_id", d.project_id);
    const recipientIds = (ams ?? []).map((r) => r.user_id);
    if (recipientIds.length === 0) continue;
    await postDispatch({
      event_type: "deliverable_due_3d",
      entity_type: "deliverable",
      entity_id: d.id,
      entity_name: d.title,
      recipient_user_ids: recipientIds,
      actor_id: null,
      extra: {
        project_name:
          (d.projects as { name?: string | null } | null)?.name ?? null,
      },
    });
    fanout++;
  }

  console.log(
    `[hq-cron-deliverable-due-3d] target=${targetIso} deliverables=${deliverables?.length ?? 0} dispatched=${fanout}`,
  );
  return new Response(
    JSON.stringify({ ok: true, target_date: targetIso, dispatched: fanout }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
