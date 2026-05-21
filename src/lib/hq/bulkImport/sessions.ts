import { supabase } from "@/integrations/supabase/client";

// Phase 5.9.5: read-side query for the bulk-import audit page. Reads the
// admin-only `bulk_import_sessions` table (RLS restricts SELECT to admins;
// AdminRoute gates the surface) with the actor's display name embedded
// through the single `actor → users.id` FK. Follows the loadVendors /
// loadProjects queries.ts pattern.

export type ImportSessionRow = {
  id: string;
  entity_type: "project" | "vendor" | "venue";
  actor_id: string;
  actor_name: string; // full_name ?? email
  row_count: number;
  created_refs: Record<string, number>;
  column_set: string[];
  status: "committed" | "failed_rollback";
  committed_at: string; // ISO
};

// Phase 5.9.6: undo is gated to imports committed within this many days. MUST
// stay in sync with bulk_import_undo's `v_window_days` constant (migration
// 20260602200000). The button gate and the RPC use the same N.
export const BULK_IMPORT_UNDO_WINDOW_DAYS = 7;

/** Client-side gate for the rail's Undo button: true when the import is still
 *  inside the undo window. The RPC re-checks authoritatively. */
export function committedWithinUndoWindow(iso: string): boolean {
  const committed = new Date(iso).getTime();
  if (Number.isNaN(committed)) return false;
  return committed >= Date.now() - BULK_IMPORT_UNDO_WINDOW_DAYS * 86_400_000;
}

type ActorEmbed = { full_name: string | null; email: string | null } | null;

export async function loadImportSessions(): Promise<ImportSessionRow[]> {
  const { data, error } = await supabase
    .from("bulk_import_sessions")
    .select(
      "id, entity_type, actor, row_count, created_refs, column_set, status, committed_at, actor_rec:users!bulk_import_sessions_actor_fkey(full_name, email)",
    )
    .order("committed_at", { ascending: false });

  if (error) throw error;

  return (data ?? []).map((row) => {
    const actor = row.actor_rec as ActorEmbed;
    const createdRefs = (row.created_refs ?? {}) as Record<string, number>;
    return {
      id: row.id as string,
      entity_type: row.entity_type as ImportSessionRow["entity_type"],
      actor_id: row.actor as string,
      actor_name: actor?.full_name ?? actor?.email ?? "Unknown",
      row_count: row.row_count as number,
      created_refs: createdRefs,
      column_set: (row.column_set ?? []) as string[],
      status: row.status as ImportSessionRow["status"],
      committed_at: row.committed_at as string,
    };
  });
}
