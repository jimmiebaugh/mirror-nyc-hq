// Shared helpers for edge-function authentication.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { timingSafeEqual } from "./timingSafeEqual.ts";

/** Require an INTERNAL_API_SECRET header (for cron/internal callers). */
export async function requireInternalSecret(req: Request): Promise<Response | null> {
  const expected = Deno.env.get("INTERNAL_API_SECRET");
  if (!expected) {
    return new Response(JSON.stringify({ error: "INTERNAL_API_SECRET not configured" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
  const got = req.headers.get("x-internal-secret") ?? "";
  if (!(await timingSafeEqual(got, expected))) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { "Content-Type": "application/json" },
    });
  }
  return null;
}

/** Accept EITHER the internal secret OR the service-role key OR a valid user
 *  JWT (for self-invocation, cron callers, and the app). The service-role
 *  comparison is a direct string match against the env var so it works
 *  regardless of key format (legacy JWT vs newer sb_secret_*). */
export async function requireInternalOrUserAuth(req: Request): Promise<Response | null> {
  const secretExpected = Deno.env.get("INTERNAL_API_SECRET");
  const got = req.headers.get("x-internal-secret") ?? "";
  if (secretExpected && (await timingSafeEqual(got, secretExpected))) return null;

  const authHeader = req.headers.get("Authorization") ?? "";
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.replace("Bearer ", "");

    // Direct compare to the service-role key. Self-invocation uses this.
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (serviceKey && (await timingSafeEqual(token, serviceKey))) return null;

    // Fall through: validate as a user JWT.
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data, error } = await sb.auth.getUser(token);
    if (!error && data?.user) return null;
  }
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401, headers: { "Content-Type": "application/json" },
  });
}

/** Like requireInternalOrUserAuth, but for ADMIN-ONLY functions (Talent
 *  Scout). Internal-secret and service-role-key callers (cron + self-invoke)
 *  pass through unchanged; a plain user JWT must ALSO resolve to
 *  public.users.permission_role = 'admin'. The role read runs under the
 *  caller's own RLS context (the users_select policy allows the self-read),
 *  mirroring the bulk-import server-side re-check. Closes F001: these
 *  functions build a service-role client (RLS bypassed), so without this the
 *  only thing gating admin-only TS operations was the client-side AdminRoute,
 *  which a hand-crafted JWT-only request bypasses. */
export async function requireInternalOrAdminUser(req: Request): Promise<Response | null> {
  const secretExpected = Deno.env.get("INTERNAL_API_SECRET");
  const got = req.headers.get("x-internal-secret") ?? "";
  if (secretExpected && (await timingSafeEqual(got, secretExpected))) return null;

  const authHeader = req.headers.get("Authorization") ?? "";
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.replace("Bearer ", "");

    // Self-invocation passes the service-role key directly; skip the role check.
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (serviceKey && (await timingSafeEqual(token, serviceKey))) return null;

    // Plain user JWT: validate it, then require permission_role = 'admin'.
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data, error } = await sb.auth.getUser(token);
    if (!error && data?.user) {
      const { data: roleRow, error: roleErr } = await sb
        .from("users")
        .select("permission_role")
        .eq("id", data.user.id)
        .maybeSingle();
      // A transient read failure is retryable, not an authz denial: return 500
      // so the caller can retry rather than mislabeling it as "not admin".
      if (roleErr) {
        return new Response(JSON.stringify({ error: "Could not verify role" }), {
          status: 500, headers: { "Content-Type": "application/json" },
        });
      }
      if (roleRow?.permission_role === "admin") return null;
      return new Response(JSON.stringify({ error: "Forbidden: admin only" }), {
        status: 403, headers: { "Content-Type": "application/json" },
      });
    }
  }
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401, headers: { "Content-Type": "application/json" },
  });
}

export const INTERNAL_HEADER = "x-internal-secret";
