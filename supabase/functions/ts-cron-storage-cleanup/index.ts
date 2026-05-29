// ts-cron-storage-cleanup
//
// Phase 3.8. Daily 03:00 UTC. Three-pass cleanup per docs/cron-jobs.md:
//
// 1. Purge ts_candidate_attachments rows whose candidate has status='reject'
//    AND was created > 30 days ago.
// 2. Purge ts_candidate_attachments rows whose candidate's parent role has
//    status='closed' AND closed_at > 90 days ago.
// 3. Hard-delete ts_roles where status='closed' AND closed_at > 60 days ago.
//    Looks up attachment paths for those roles' candidates first so Storage
//    objects clear before the FK CASCADE wipes the rows.
//
// Cron-only — no UI affordance for manual triggering. The retention windows
// are conservative enough that a daily cadence catches everything before it
// becomes a problem.
//
// Each pass uses two-step queries (predicate -> ID list -> attachment lookup)
// instead of joined relational filters, since Supabase JS' filter-on-related-
// column syntax is finicky and the data volume here is small (closed-role
// candidate counts are typically in the hundreds, not millions).
//
// Errors deleting a Storage object are logged and do NOT abort the row delete —
// the worst case is an orphan file, which costs cents per month and surfaces
// in any future bucket audit.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireInternalOrUserAuth } from "../_shared/internalAuth.ts";
import { STORAGE_BUCKET } from "../_shared/attachmentStorage.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret",
};

const REJECTED_RETENTION_DAYS = 30;
const CLOSED_ROLE_RETENTION_DAYS = 90;
const ROLE_HARD_DELETE_AFTER_DAYS = 60;

function sb() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

async function deleteStorageObjects(supabase: SupabaseClient, paths: string[]): Promise<{ ok: number; failed: number }> {
  if (paths.length === 0) return { ok: 0, failed: 0 };
  let ok = 0;
  let failed = 0;
  const CHUNK = 200;
  for (let i = 0; i < paths.length; i += CHUNK) {
    const chunk = paths.slice(i, i + CHUNK);
    const { data, error } = await supabase.storage.from(STORAGE_BUCKET).remove(chunk);
    if (error) {
      console.error(`[ts-cron-storage-cleanup] storage.remove failed for chunk:`, error);
      failed += chunk.length;
    } else {
      ok += data?.length ?? chunk.length;
    }
  }
  return { ok, failed };
}

async function purgeAttachmentsForCandidates(supabase: SupabaseClient, candidateIds: string[], label: string) {
  if (candidateIds.length === 0) {
    return { scanned: 0, storage_ok: 0, storage_failed: 0, rows_deleted: 0 };
  }
  const CHUNK = 500;
  const allRows: { id: string; file_path: string }[] = [];
  for (let i = 0; i < candidateIds.length; i += CHUNK) {
    const chunk = candidateIds.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("ts_candidate_attachments")
      .select("id, file_path")
      .in("candidate_id", chunk);
    if (error) {
      console.error(`[ts-cron-storage-cleanup] (${label}) attachment lookup failed:`, error);
      continue;
    }
    allRows.push(...(data ?? []));
  }
  if (allRows.length === 0) {
    return { scanned: 0, storage_ok: 0, storage_failed: 0, rows_deleted: 0 };
  }
  const paths = allRows.map((r) => r.file_path).filter(Boolean) as string[];
  const ids = allRows.map((r) => r.id);
  const stor = await deleteStorageObjects(supabase, paths);
  let rowsDeleted = 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const { error } = await supabase.from("ts_candidate_attachments").delete().in("id", chunk);
    if (error) {
      console.error(`[ts-cron-storage-cleanup] (${label}) row delete failed:`, error);
      continue;
    }
    rowsDeleted += chunk.length;
  }
  return { scanned: allRows.length, storage_ok: stor.ok, storage_failed: stor.failed, rows_deleted: rowsDeleted };
}

async function pass1RejectedCandidates(supabase: SupabaseClient) {
  const cutoff = new Date(Date.now() - REJECTED_RETENTION_DAYS * 86400_000).toISOString();
  const { data, error } = await supabase
    .from("ts_candidates")
    .select("id")
    .eq("status", "reject")
    .lt("created_at", cutoff);
  if (error) {
    console.error("[ts-cron-storage-cleanup] pass1 candidate query failed:", error);
    return { scanned: 0, storage_ok: 0, storage_failed: 0, rows_deleted: 0 };
  }
  const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
  return purgeAttachmentsForCandidates(supabase, ids, "rejected-candidates");
}

async function pass2ClosedRoles(supabase: SupabaseClient) {
  const cutoff = new Date(Date.now() - CLOSED_ROLE_RETENTION_DAYS * 86400_000).toISOString();
  // Pull all closed-role candidates past the 90-day window. Pass3 will
  // catch the >60d-closed ones for full row delete; overlap is fine —
  // pass2's row delete is idempotent and pass3's CASCADE handles the rest.
  const { data: roles, error: roleErr } = await supabase
    .from("ts_roles")
    .select("id")
    .eq("status", "closed")
    .lt("closed_at", cutoff);
  if (roleErr) {
    console.error("[ts-cron-storage-cleanup] pass2 role query failed:", roleErr);
    return { scanned: 0, storage_ok: 0, storage_failed: 0, rows_deleted: 0 };
  }
  const roleIds = ((roles ?? []) as { id: string }[]).map((r) => r.id);
  if (roleIds.length === 0) {
    return { scanned: 0, storage_ok: 0, storage_failed: 0, rows_deleted: 0 };
  }
  const candIds: string[] = [];
  const CHUNK = 500;
  for (let i = 0; i < roleIds.length; i += CHUNK) {
    const chunk = roleIds.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("ts_candidates")
      .select("id")
      .in("role_id", chunk);
    if (error) {
      console.error("[ts-cron-storage-cleanup] pass2 candidate lookup failed:", error);
      continue;
    }
    for (const c of data ?? []) candIds.push(c.id as string);
  }
  return purgeAttachmentsForCandidates(supabase, candIds, "closed-role-candidates");
}

async function pass3HardDeleteOldClosedRoles(supabase: SupabaseClient) {
  const cutoff = new Date(Date.now() - ROLE_HARD_DELETE_AFTER_DAYS * 86400_000).toISOString();
  const { data: roles, error: roleErr } = await supabase
    .from("ts_roles")
    .select("id, title, closed_at")
    .eq("status", "closed")
    .lt("closed_at", cutoff);
  if (roleErr) {
    console.error("[ts-cron-storage-cleanup] pass3 role query failed:", roleErr);
    return { scanned: 0, storage_ok: 0, storage_failed: 0, roles_deleted: 0 };
  }
  if (!roles || roles.length === 0) {
    return { scanned: 0, storage_ok: 0, storage_failed: 0, roles_deleted: 0 };
  }
  const closedRoles = roles as { id: string; title: string | null; closed_at: string | null }[];
  const roleIds = closedRoles.map((r) => r.id);

  // Collect attachment paths so Storage clears before the FK CASCADE.
  const candIds: string[] = [];
  const CHUNK = 500;
  for (let i = 0; i < roleIds.length; i += CHUNK) {
    const chunk = roleIds.slice(i, i + CHUNK);
    const { data } = await supabase.from("ts_candidates").select("id").in("role_id", chunk);
    for (const c of data ?? []) candIds.push(c.id as string);
  }
  const paths: string[] = [];
  for (let i = 0; i < candIds.length; i += CHUNK) {
    const chunk = candIds.slice(i, i + CHUNK);
    const { data } = await supabase
      .from("ts_candidate_attachments")
      .select("file_path")
      .in("candidate_id", chunk);
    for (const a of data ?? []) {
      if (a.file_path) paths.push(a.file_path as string);
    }
  }
  const stor = await deleteStorageObjects(supabase, paths);

  // Delete the roles. CASCADE handles ts_pull_rounds / ts_candidates /
  // ts_evaluations / ts_final_reviews / remaining ts_candidate_attachments.
  let rolesDeleted = 0;
  for (let i = 0; i < roleIds.length; i += CHUNK) {
    const chunk = roleIds.slice(i, i + CHUNK);
    const { error } = await supabase.from("ts_roles").delete().in("id", chunk);
    if (error) {
      console.error("[ts-cron-storage-cleanup] pass3 role delete failed:", error);
      continue;
    }
    rolesDeleted += chunk.length;
  }
  for (const r of closedRoles) {
    console.warn(`[ts-cron-storage-cleanup] hard-deleted closed role ${r.id} (${r.title}), closed_at=${r.closed_at}`);
  }
  return { scanned: closedRoles.length, storage_ok: stor.ok, storage_failed: stor.failed, roles_deleted: rolesDeleted };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const authFail = await requireInternalOrUserAuth(req);
  if (authFail) return authFail;

  const supabase = sb();

  const rejected = await pass1RejectedCandidates(supabase);
  const closed = await pass2ClosedRoles(supabase);
  const hardDeleted = await pass3HardDeleteOldClosedRoles(supabase);

  const summary = {
    rejected_candidate_files: rejected,
    closed_role_files: closed,
    closed_role_hard_delete: hardDeleted,
  };
  console.log(`[ts-cron-storage-cleanup] done`, summary);
  return new Response(JSON.stringify(summary), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
