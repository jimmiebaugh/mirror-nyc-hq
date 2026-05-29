// Generic Gmail send helper used by edge functions that send transactional
// email outside the packet path (cap alerts, pull-complete notifications, etc.).
//
// All outbound mail flows from jobs@mirrornyc.com via the Workspace service
// account's gmail.send scope. See docs/auth-model.md.
//
// The packet-render module has its own sendPacketEmail wrapper that builds a
// link-only body with a 7-day signed URL; that stays bespoke. This helper is
// for plain transactional notifications.

import { getGmailAccessToken } from "./gmailServiceAccount.ts";
import { stripMimeControl } from "./mimeHeader.ts";

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function base64Url(s: string): string {
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function buildMime(opts: {
  to: string;
  from: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string;
}): string {
  // Sanitize header values so a CR/LF in to/subject/from can't inject extra
  // MIME headers (F019).
  const to = stripMimeControl(opts.to);
  const from = stripMimeControl(opts.from);
  const subject = stripMimeControl(opts.subject);
  if (!opts.bodyHtml) {
    return [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: 7bit",
      "",
      opts.bodyText,
    ].join("\r\n");
  }
  // Multipart/alternative for HTML + plaintext fallback.
  const boundary = `=_mirror_${Math.random().toString(36).slice(2)}`;
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    opts.bodyText,
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    opts.bodyHtml,
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

/** Send a plain transactional email from jobs@mirrornyc.com. Returns true on
 *  success, false on any failure (logged, never thrown — callers shouldn't
 *  block on a notification outage). */
export async function sendGmail(opts: {
  to: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  /** Optional friendly From label, e.g. "Mirror NYC". Defaults to that. */
  fromName?: string;
}): Promise<boolean> {
  if (!opts.to) {
    console.warn("[sendGmail] no recipient, skipping");
    return false;
  }
  try {
    const token = await getGmailAccessToken();
    const fromName = opts.fromName ?? "Mirror NYC";
    const mime = buildMime({
      to: opts.to,
      from: `${fromName} <jobs@mirrornyc.com>`,
      subject: opts.subject,
      bodyText: opts.bodyText,
      bodyHtml: opts.bodyHtml,
    });
    const raw = base64Url(bytesToBase64(new TextEncoder().encode(mime)));
    const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error(`[sendGmail] Gmail send failed (${res.status}): ${errText.slice(0, 400)}`);
      return false;
    }
    console.log(`[sendGmail] sent to ${opts.to} subject="${opts.subject}"`);
    return true;
  } catch (e) {
    console.error("[sendGmail] exception:", e);
    return false;
  }
}

// Narrow structural view of just the supabase-js query chain getAdminEmail
// uses: from("users").select(...).eq(...).eq(...).order(...).limit(...)
// .maybeSingle(). Each builder method returns the same chainable shape; the
// terminal maybeSingle() resolves to { data }. A full SupabaseClient
// structurally satisfies this, so callers pass their service-role client
// unchanged.
type AdminEmailQuery = {
  select: (columns: string) => AdminEmailQuery;
  eq: (column: string, value: unknown) => AdminEmailQuery;
  order: (column: string, opts: { ascending: boolean }) => AdminEmailQuery;
  limit: (count: number) => AdminEmailQuery;
  maybeSingle: () => PromiseLike<{ data: { email?: string | null } | null }>;
};

/** Look up the admin email for transactional alerts. Returns the first admin
 *  by created_at; falls back to jobs@mirrornyc.com if no admin row exists.
 *  Caller passes a service-role Supabase client. */
export async function getAdminEmail(sb: {
  from: (table: string) => AdminEmailQuery;
}): Promise<string> {
  try {
    const { data } = await sb
      .from("users")
      .select("email")
      .eq("permission_role", "admin")
      .eq("active", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (data?.email) return data.email as string;
  } catch (e) {
    console.warn("[getAdminEmail] lookup failed, falling back to jobs@:", e);
  }
  return "jobs@mirrornyc.com";
}
