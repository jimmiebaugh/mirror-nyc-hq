// ts-send-pull-notification
//
// Phase 3.9. Standalone notification function. Called from ts-pull-candidates
// when a round completes (status='complete'). Emails the role's hiring manager
// with a summary of what landed: total candidates ingested, fast-track count,
// auto-rejected count, and a deep link into PullDetail.
//
// Standalone in 3.9 to ship Talent Scout cleanly. In Phase 5 this folds into
// notifications-dispatch alongside in-app bell notifications.
//
// Body shape: { role_id: string, pull_round_id: string }
// Auth: requireInternalOrUserAuth (cron + ts-pull-candidates self-invoke).
//
// Failures are logged, not surfaced. A notification outage shouldn't fail
// the upstream pull; the round row already records status='complete' and the
// PullDetail UI works without the email.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireInternalOrUserAuth } from "../_shared/internalAuth.ts";
import { sendGmail } from "../_shared/sendEmail.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret",
};

const APP_URL = Deno.env.get("APP_URL") ?? "https://hq.mirrornyc.com";

function sb() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

type Counts = {
  total: number;
  fast_track: number;
  interview: number;
  consider: number;
  reject: number;
};

async function tallyCandidates(supabase: any, roundId: string): Promise<Counts> {
  const { data } = await supabase
    .from("ts_candidates")
    .select("status")
    .eq("pull_round_id", roundId);
  const tally: Counts = { total: 0, fast_track: 0, interview: 0, consider: 0, reject: 0 };
  for (const row of data ?? []) {
    tally.total++;
    const s = row.status as keyof Counts;
    if (s in tally && s !== "total") (tally[s] as number)++;
  }
  return tally;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const authFail = await requireInternalOrUserAuth(req);
  if (authFail) return authFail;

  let roleId: string;
  let roundId: string;
  try {
    const body = await req.json();
    roleId = body.role_id;
    roundId = body.pull_round_id;
    if (!roleId || !roundId) throw new Error("role_id and pull_round_id required");
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = sb();

  const { data: role } = await supabase
    .from("ts_roles")
    .select("id, title, hiring_manager:users!hiring_manager_id(email, full_name)")
    .eq("id", roleId)
    .maybeSingle();

  if (!role) {
    console.warn(`[ts-send-pull-notification] role ${roleId} not found, skipping`);
    return new Response(JSON.stringify({ ok: false, reason: "role_not_found" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const managerEmail = (role as any).hiring_manager?.email as string | undefined;
  if (!managerEmail) {
    console.warn(`[ts-send-pull-notification] role ${roleId} has no hiring manager email, skipping`);
    return new Response(JSON.stringify({ ok: false, reason: "no_hiring_manager_email" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: round } = await supabase
    .from("ts_pull_rounds")
    .select("id, round_number, candidates_found, processed_count, started_at, completed_at, triggered_by")
    .eq("id", roundId)
    .maybeSingle();
  if (!round) {
    console.warn(`[ts-send-pull-notification] round ${roundId} not found, skipping`);
    return new Response(JSON.stringify({ ok: false, reason: "round_not_found" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const tally = await tallyCandidates(supabase, roundId);
  const triggerWord = round.triggered_by === "scheduled" ? "Scheduled" : "Manual";
  const link = `${APP_URL}/talent-scout/roles/${roleId}/pulls/${roundId}`;
  const managerName = (role as any).hiring_manager?.full_name ?? "there";

  // ASCII-only separators — em dashes garble in some Gmail clients when the
  // subject MIME header isn't strictly RFC 2047-encoded. Pipe + hyphen are
  // safe across every client and align with the project's no-em-dashes rule.
  const subject = `[Mirror HQ] R${round.round_number} pull complete | ${role.title}`;
  const bodyText = [
    `Hi ${managerName.split(" ")[0]},`,
    ``,
    `${triggerWord} pull R${round.round_number} just finished for "${role.title}".`,
    ``,
    `  ${tally.total} candidate${tally.total === 1 ? "" : "s"} ingested`,
    `  ${tally.fast_track} fast-track`,
    `  ${tally.interview} interview`,
    `  ${tally.consider} consider`,
    `  ${tally.reject} reject`,
    ``,
    `Open the round in HQ:`,
    `${link}`,
    ``,
    `- Mirror HQ`,
  ].join("\n");

  const sent = await sendGmail({ to: managerEmail, subject, bodyText });
  if (!sent) {
    return new Response(JSON.stringify({ ok: false, reason: "send_failed" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  console.log(`[ts-send-pull-notification] sent to ${managerEmail} for round ${roundId}`);
  return new Response(JSON.stringify({ ok: true, to: managerEmail, tally }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
