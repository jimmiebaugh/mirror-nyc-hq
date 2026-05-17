// notifications-dispatch
//
// Phase 5.5. Central notification fan-out. Receives an event payload from
// either:
//   - public.notifications_dispatch_writer (PostgreSQL trigger: tasks +
//     projects)
//   - public.handle_new_user (event_type='user_pending')
//   - daily crons (cron-deliverable-due-3d / cron-task-due-today /
//     cron-event-date-today)
//
// For each recipient: check global kill-switches + per-user
// user_notification_preferences row (system defaults when no row exists),
// then write the in-app notifications row and/or send the Slack DM. Email
// stays out of scope here (deferred to a future digest pass); legacy
// notify-admin-of-pending-user continues to handle the user_pending email.
//
// Body shape (spec § 8):
//   {
//     event_type: TriggerKey,
//     entity_type: string,
//     entity_id: string,
//     entity_name: string,
//     recipient_user_ids: string[],
//     actor_id?: string | null,
//     extra?: Record<string, unknown>
//   }
//
// Auth: requireInternalSecret only (no user-JWT path); see the security
// audit comment on the import below + docs/decisions.md Phase 5.5 for the
// rationale. verify_jwt = false in config.toml.
//
// Returns { ok: true, sent_in_app: N, sent_slack: M, skipped: K }.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
// Phase 5.5 security audit MUST-FIX: dispatch is internal-only. Any
// signed-in user JWT path would let a Standard/Freelance user POST here
// with crafted `recipient_user_ids` to spoof notifications to admins.
// Legitimate callers (notifications_dispatch_writer trigger,
// handle_new_user, the three hq-cron-* functions) all send
// x-internal-secret. No UI path needs direct dispatch access.
import { requireInternalSecret } from "../_shared/internalAuth.ts";
import { sendSlackDm } from "../_shared/slackDm.ts";
import { sendGmail } from "../_shared/sendEmail.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-internal-secret",
};

const APP_URL = Deno.env.get("APP_URL") ?? "https://hq.mirrornyc.com";

type TriggerKey =
  | "deliverable_due_3d"
  | "task_assigned"
  | "task_due_today"
  | "task_blocked"
  | "project_status_changed"
  | "mention"
  | "event_date_today"
  | "user_pending";

type DispatchRequest = {
  event_type: TriggerKey;
  entity_type: string;
  entity_id: string;
  entity_name: string;
  recipient_user_ids: string[];
  actor_id?: string | null;
  extra?: Record<string, unknown>;
};

const VALID_TRIGGER_KEYS: TriggerKey[] = [
  "deliverable_due_3d",
  "task_assigned",
  "task_due_today",
  "task_blocked",
  "project_status_changed",
  "mention",
  "event_date_today",
  "user_pending",
];

// System defaults per spec § 2b table. Used when no
// user_notification_preferences row exists for (user_id, trigger_key).
const SYSTEM_DEFAULTS: Record<TriggerKey, { in_app: boolean; slack_dm: boolean }> = {
  deliverable_due_3d: { in_app: true, slack_dm: false },
  task_assigned: { in_app: true, slack_dm: true },
  task_due_today: { in_app: true, slack_dm: true },
  task_blocked: { in_app: true, slack_dm: false },
  project_status_changed: { in_app: true, slack_dm: false },
  mention: { in_app: true, slack_dm: true },
  event_date_today: { in_app: true, slack_dm: false },
  user_pending: { in_app: true, slack_dm: false },
};

function sb() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

function linkUrlFor(entityType: string, entityId: string, extra?: Record<string, unknown>): string {
  // Phase 5.7.2: mention dispatch trigger pre-computes a link_url in `extra`
  // (deliverable goes to /deliverables/:id, outlook_entry goes to /outlook, etc).
  // Prefer it when present so the dispatch path and the trigger agree on the
  // route without re-resolving the mapping here.
  const overrideLink = typeof extra?.link_url === "string" ? extra.link_url : null;
  if (overrideLink) return overrideLink;
  switch (entityType) {
    case "project":       return `/projects/${entityId}`;
    case "task":          return `/tasks/${entityId}`;
    case "deliverable":   return `/deliverables/${entityId}`;
    case "venue":         return `/venues/${entityId}`;
    case "vendor":        return `/vendors/${entityId}`;
    case "client":        return `/clients/${entityId}`;
    case "person":        return `/people/${entityId}`;
    case "outlook_entry": return `/outlook`;
    case "wiki_page": {
      const slug = (extra?.slug as string | undefined) ?? entityId;
      return `/wiki/${slug}`;
    }
    case "user":          return `/users`;
    default:              return `/activity`;
  }
}

const ENTITY_TYPE_LABEL: Record<string, string> = {
  project: "Project",
  task: "Task",
  deliverable: "Deliverable",
  venue: "Venue",
  vendor: "Vendor",
  client: "Client",
  person: "Person",
  wiki_page: "Wiki page",
  outlook_entry: "Outlook entry",
  user: "User",
};

type Template = { title: string; body: string };

function template(
  eventType: TriggerKey,
  entityType: string,
  entityName: string,
  extra: Record<string, unknown> | undefined,
  actorName?: string,
): Template {
  const projectName = (extra?.project_name as string | undefined) ?? "";
  const newStatus = (extra?.new_status as string | undefined) ?? "";
  switch (eventType) {
    case "deliverable_due_3d":
      return {
        title: "Deliverable due in 3 days",
        body: projectName
          ? `${entityName} is due in 3 days on ${projectName}`
          : `${entityName} is due in 3 days`,
      };
    case "task_assigned":
      return {
        title: "Task assigned",
        body: actorName
          ? `${actorName} assigned you a task: ${entityName}`
          : `You were assigned a task: ${entityName}`,
      };
    case "task_due_today":
      return {
        title: "Task due today",
        body: `${entityName} is due today`,
      };
    case "task_blocked":
      return {
        title: "Task blocked",
        body: `Task you created became Blocked: ${entityName}`,
      };
    case "project_status_changed":
      return {
        title: "Status changed",
        body: newStatus
          ? `Status changed to ${newStatus} on ${entityName}`
          : `Status changed on ${entityName}`,
      };
    case "mention": {
      // Phase 5.7.2: dispatch payload from notifications_dispatch_writer's
      // note_mentions branch carries `snippet` (first 140 chars of the note
      // body) and the parent entity_type so we can prefix "Task" / "Deliverable"
      // / etc. The body trims the snippet further to keep the bell row tight.
      const snippetRaw =
        typeof extra?.snippet === "string" ? extra.snippet.trim() : "";
      const snippet =
        snippetRaw.length > 80 ? snippetRaw.slice(0, 80) + "..." : snippetRaw;
      const label = ENTITY_TYPE_LABEL[entityType] ?? entityType;
      return {
        title: actorName ? `${actorName} mentioned you` : "Mentioned you",
        body: snippet
          ? `${label} ${entityName}: "${snippet}"`
          : `${label} ${entityName}`,
      };
    }
    case "event_date_today": {
      const kind = (extra?.kind as string | undefined) ?? "Event";
      return {
        title: "Event date today",
        body: `${kind} for ${entityName} is happening today`,
      };
    }
    case "user_pending":
      return {
        title: `${entityName} is awaiting tier assignment`,
        body: "Open the Team page to assign Admin, Standard, or Freelance.",
      };
  }
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stripMimeControl(s: string): string {
  return s.replace(/[\r\n\0]/g, "");
}

/** Slack mrkdwn requires &, <, > be escaped per the chat.postMessage docs.
 *  Crafted entity_name values otherwise could distort formatting or
 *  surface misleading <url|text> autolinks. */
function escSlackMrkdwn(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const authFail = requireInternalSecret(req);
  if (authFail) return authFail;

  let body: DispatchRequest;
  try {
    body = (await req.json()) as DispatchRequest;
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
      }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  if (!body.event_type || !VALID_TRIGGER_KEYS.includes(body.event_type)) {
    return new Response(
      JSON.stringify({ error: `Unknown event_type: ${body.event_type}` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  if (!body.entity_id || !body.entity_name || !body.entity_type) {
    return new Response(
      JSON.stringify({ error: "entity_id, entity_name, entity_type are required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  if (!Array.isArray(body.recipient_user_ids)) {
    return new Response(
      JSON.stringify({ error: "recipient_user_ids must be an array" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const supabase = sb();

  // Global kill-switches (single-row global_settings).
  const { data: globals } = await supabase
    .from("global_settings")
    .select("in_app_notifications_enabled, email_notifications_enabled")
    .maybeSingle();
  const globalInAppOn = globals?.in_app_notifications_enabled ?? true;
  const globalEmailOn = globals?.email_notifications_enabled ?? true;

  // Resolve recipients: drop the actor, dedupe.
  //
  // Phase 5.7.2: allow self-mentions through by design (locked decision).
  // The original 5.5 self-exclusion assumed actor=recipient would always be
  // noise (you don't need a "task assigned" notification for a task you just
  // assigned to yourself). Mentions are different: writing `@Self` in a note
  // is a deliberate "remind me later" pattern AND keeps the notification
  // surface symmetric for the writer. This is the permanent behavior, not
  // a testing hack.
  const allowSelf = body.event_type === "mention";
  const recipients = Array.from(
    new Set(
      body.recipient_user_ids.filter(
        (id): id is string =>
          typeof id === "string" && (allowSelf || id !== body.actor_id),
      ),
    ),
  );

  if (recipients.length === 0) {
    return new Response(
      JSON.stringify({ ok: true, sent_in_app: 0, sent_slack: 0, skipped: 0 }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Per-user data: preferences + slack_user_id + email + full_name.
  const { data: users } = await supabase
    .from("users")
    .select("id, email, full_name, slack_user_id, active")
    .in("id", recipients);
  const { data: prefRows } = await supabase
    .from("user_notification_preferences")
    .select("user_id, trigger_key, in_app, slack_dm")
    .in("user_id", recipients)
    .eq("trigger_key", body.event_type);

  const prefsByUser = new Map<string, { in_app: boolean; slack_dm: boolean }>();
  for (const r of prefRows ?? []) {
    prefsByUser.set(r.user_id, { in_app: r.in_app, slack_dm: r.slack_dm });
  }
  const userById = new Map<string, NonNullable<typeof users>[number]>();
  for (const u of users ?? []) userById.set(u.id, u);

  // Actor name for body templates.
  let actorName: string | undefined;
  if (body.actor_id) {
    const { data: actor } = await supabase
      .from("users")
      .select("full_name, email")
      .eq("id", body.actor_id)
      .maybeSingle();
    actorName = actor?.full_name?.trim() || actor?.email?.split("@")[0] || undefined;
  }

  const tpl = template(body.event_type, body.entity_type, body.entity_name, body.extra, actorName);
  const link = linkUrlFor(body.entity_type, body.entity_id, body.extra);

  let sentInApp = 0;
  let sentSlack = 0;
  let skipped = 0;

  for (const userId of recipients) {
    const user = userById.get(userId);
    if (!user) {
      skipped++;
      continue;
    }
    if (user.active === false) {
      skipped++;
      continue;
    }

    const prefs = prefsByUser.get(userId) ?? SYSTEM_DEFAULTS[body.event_type];

    // ── In-app row ────────────────────────────────────────────────────────
    // Skip the user_pending in-app row: handle_new_user already wrote one
    // for every active admin before invoking dispatch. Without this guard
    // admins would get two bell items per new signup.
    let didWriteInApp = false;
    if (globalInAppOn && prefs.in_app && body.event_type !== "user_pending") {
      const { error: insErr } = await supabase
        .from("notifications")
        .insert({
          user_id: userId,
          type: body.event_type,
          title: tpl.title,
          body: tpl.body,
          link_url: link,
          delivered_in_app: true,
        });
      if (insErr) {
        console.error(
          `[notifications-dispatch] insert failed for user ${userId}:`,
          insErr,
        );
      } else {
        sentInApp++;
        didWriteInApp = true;
      }
    }

    // ── Slack DM ──────────────────────────────────────────────────────────
    if (prefs.slack_dm && user.slack_user_id) {
      const ok = await sendSlackDm(
        user.slack_user_id,
        `*${escSlackMrkdwn(tpl.title)}*\n${escSlackMrkdwn(tpl.body)}\n${APP_URL}${link}`,
      );
      if (ok) {
        sentSlack++;
        // Flip delivered_slack on the most-recent matching notification so
        // the bell panel shows the "Slack DM" prefix on that row.
        if (didWriteInApp) {
          await supabase
            .from("notifications")
            .update({ delivered_slack: true })
            .eq("user_id", userId)
            .eq("type", body.event_type)
            .order("created_at", { ascending: false })
            .limit(1);
        }
      }
    }

    // ── Email (preserve legacy user_pending path only) ────────────────────
    if (body.event_type === "user_pending" && globalEmailOn && user.email) {
      const pendingEmail = stripMimeControl(
        ((body.extra?.email as string | undefined) ?? body.entity_name) || "",
      );
      const subject = `[Mirror HQ] ${pendingEmail} is awaiting tier assignment`;
      const teamUrl = `${APP_URL}/users`;
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
      await sendGmail({ to: user.email, subject, bodyText, bodyHtml });
    }
  }

  console.log(
    `[notifications-dispatch] event=${body.event_type} entity=${body.entity_type}:${body.entity_id} ` +
      `recipients=${recipients.length} in_app=${sentInApp} slack=${sentSlack} skipped=${skipped}`,
  );

  return new Response(
    JSON.stringify({
      ok: true,
      sent_in_app: sentInApp,
      sent_slack: sentSlack,
      skipped,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
