// hq-cron-task-due-today
//
// Phase 5.5. Daily 08:00 ET (12:00 UTC) cron. Queries tasks where
// due_date = CURRENT_DATE AND status NOT IN ('Done'), resolves assignee_id,
// fans out a notifications-dispatch call per task.
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
    console.warn("[hq-cron-task-due-today] missing SUPABASE_URL or INTERNAL_API_SECRET");
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
        `[hq-cron-task-due-today] dispatch ${res.status}: ${text.slice(0, 200)}`,
      );
    }
  } catch (err) {
    console.error("[hq-cron-task-due-today] dispatch network error:", err);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const authFail = await requireInternalOrUserAuth(req);
  if (authFail) return authFail;

  const supabase = sb();
  const today = new Date().toISOString().slice(0, 10);

  const { data: tasks, error } = await supabase
    .from("tasks")
    .select("id, title, assignee_id")
    .eq("due_date", today)
    .neq("status", "Done")
    .not("assignee_id", "is", null);

  if (error) {
    console.error("[hq-cron-task-due-today] query error:", error);
    return new Response(
      JSON.stringify({ error: "query_failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  let fanout = 0;
  for (const t of tasks ?? []) {
    if (!t.assignee_id) continue;
    await postDispatch({
      event_type: "task_due_today",
      entity_type: "task",
      entity_id: t.id,
      entity_name: t.title,
      recipient_user_ids: [t.assignee_id],
      actor_id: null,
    });
    fanout++;
  }

  console.log(
    `[hq-cron-task-due-today] today=${today} tasks=${tasks?.length ?? 0} dispatched=${fanout}`,
  );
  return new Response(
    JSON.stringify({ ok: true, today, dispatched: fanout }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
