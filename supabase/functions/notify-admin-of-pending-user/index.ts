// notify-admin-of-pending-user
//
// Phase 5.1. Triggered by `handle_new_user` (via `public.invoke_edge_function`)
// after a new auth.users row is mirrored to public.users with
// permission_role='pending'. Sends a one-time email to every active admin so
// they know to assign a tier from the Team page (lands 5.4).
//
// Phase 5.5's `notifications-dispatch` function will absorb this; until then
// the function is a thin wrapper over `_shared/sendEmail.ts`.
//
// Body shape: { user_id: string, email: string }
// Auth: requireInternalSecret only (the trigger is the sole caller; no user
//   JWT path). Accepting user JWTs would let any signed-in user spam admins
//   with crafted email payloads. verify_jwt = false in config.toml.
//
// Defense in depth: after auth, the function looks the user_id up in
// public.users and verifies that the row exists with permission_role='pending'
// AND its email matches the payload (so a malicious internal caller can't
// pass a phishing email through the trigger's payload).
//
// Failures are logged, never thrown; the pending user is already in
// public.users and the notifications rows are already written.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireInternalSecret } from "../_shared/internalAuth.ts";
import { sendGmail } from "../_shared/sendEmail.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-internal-secret",
};

const APP_URL = Deno.env.get("APP_URL") ?? "https://hq.mirrornyc.com";

function sb() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Strip MIME control chars (CR/LF/NUL) so a poisoned email can't inject
 *  extra headers into the subject or plain-text body. */
function stripMimeControl(s: string): string {
  return s.replace(/[\r\n\0]/g, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const authFail = requireInternalSecret(req);
  if (authFail) return authFail;

  let userId: string;
  let pendingEmailRaw: string;
  try {
    const body = await req.json();
    userId = body.user_id;
    pendingEmailRaw = body.email;
    if (!userId || !pendingEmailRaw) throw new Error("user_id and email required");
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const pendingEmail = stripMimeControl(pendingEmailRaw);

  const supabase = sb();

  // Defense in depth: verify the payload describes an actual pending user
  // before mailing every admin. Drops fabricated invocations cheaply.
  const { data: pendingUser } = await supabase
    .from("users")
    .select("id, email, permission_role")
    .eq("id", userId)
    .maybeSingle();
  if (
    !pendingUser ||
    pendingUser.email !== pendingEmail ||
    pendingUser.permission_role !== "pending"
  ) {
    console.warn(
      `[notify-admin-of-pending-user] payload does not match pending user; skipping`,
    );
    return new Response(
      JSON.stringify({ ok: false, reason: "payload_mismatch" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const { data: admins } = await supabase
    .from("users")
    .select("email, full_name")
    .eq("permission_role", "admin")
    .eq("active", true);

  if (!admins || admins.length === 0) {
    console.warn("[notify-admin-of-pending-user] no active admins; skipping email");
    return new Response(
      JSON.stringify({ ok: true, sent: 0, reason: "no_admins" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // ASCII-only separators in the subject per the project's no-em-dashes rule
  // (docs/design-system.md § 12.5 / mirror-style-guide.md). The pipe + hyphen
  // pair renders consistently across Gmail clients.
  const subject = `[Mirror HQ] ${pendingEmail} is awaiting tier assignment`;
  const teamUrl = `${APP_URL}/team`;

  const bodyText = [
    `A new Mirror NYC user just signed in for the first time.`,
    ``,
    `  Email: ${pendingEmail}`,
    ``,
    `They will land on the Pending screen until an admin assigns a tier`,
    `(Admin, Standard, or Freelance) from the Team page.`,
    ``,
    `Open the Team page: ${teamUrl}`,
    ``,
    `- Mirror HQ`,
  ].join("\n");

  const bodyHtml = `<!DOCTYPE html>
<html><body style="font-family:-apple-system,system-ui,'Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.55;color:#1a1a1a;">
<p>A new Mirror NYC user just signed in for the first time.</p>
<p><b>Email:</b> ${escHtml(pendingEmail)}</p>
<p>They will land on the Pending screen until an admin assigns a tier
(Admin, Standard, or Freelance) from the Team page.</p>
<p style="margin:16px 0;"><a href="${escHtml(teamUrl)}" style="color:#BE4E44;text-decoration:underline;font-weight:600;">Open the Team page</a></p>
<p style="margin-top:24px;">- Mirror HQ</p>
</body></html>`;

  let sent = 0;
  for (const admin of admins) {
    if (!admin.email) continue;
    const ok = await sendGmail({ to: admin.email, subject, bodyText, bodyHtml });
    if (ok) sent++;
  }

  console.log(
    `[notify-admin-of-pending-user] user ${userId} (${pendingEmail}); admins notified=${sent}`,
  );
  return new Response(
    JSON.stringify({ ok: true, sent, total_admins: admins.length }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});