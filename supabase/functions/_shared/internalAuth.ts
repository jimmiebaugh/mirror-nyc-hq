// Shared helpers for edge-function authentication.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

/** Require an INTERNAL_API_SECRET header (for cron/internal callers). */
export function requireInternalSecret(req: Request): Response | null {
  const expected = Deno.env.get("INTERNAL_API_SECRET");
  if (!expected) {
    return new Response(JSON.stringify({ error: "INTERNAL_API_SECRET not configured" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
  const got = req.headers.get("x-internal-secret") ?? "";
  if (got !== expected) {
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
  if (secretExpected && got === secretExpected) return null;

  const authHeader = req.headers.get("Authorization") ?? "";
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.replace("Bearer ", "");

    // Direct compare to the service-role key. Self-invocation uses this.
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (serviceKey && token === serviceKey) return null;

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

export const INTERNAL_HEADER = "x-internal-secret";
