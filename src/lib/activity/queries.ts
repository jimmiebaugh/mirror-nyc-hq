import { supabase } from "@/integrations/supabase/client";

/**
 * Phase 5.5 activity feed queries (spec § 5).
 *
 * Cursor-paginates `activity_log` newest-first, joining the actor's user
 * row (full_name / email / id) for the row sentence. Page size is 30 (with
 * +1 lookahead to derive `hasMore`); the "Load more" button passes the
 * last visible row's created_at as the cursor.
 *
 * Filter narrowing happens in the FilterBar's client-side `applyFilters`
 * after fetch. The page-level query only bounds by date_range (for the
 * "Last 7 days" / "This month" chips) when present, since those can be
 * cheaply translated to a server-side WHERE. Record-type and person chips
 * narrow client-side.
 */

export type ActivityRow = {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  payload: Record<string, unknown> | null;
  created_at: string;
  actor: { id: string; full_name: string | null; email: string | null } | null;
};

type DbActivityRow = {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  payload: Record<string, unknown> | null;
  created_at: string;
  actor: { id: string; full_name: string | null; email: string | null } | null;
};

export const ACTIVITY_PAGE_SIZE = 30;

export async function fetchActivityPage({
  cursor,
  pageSize = ACTIVITY_PAGE_SIZE,
}: {
  cursor?: string;
  pageSize?: number;
} = {}): Promise<{ rows: ActivityRow[]; hasMore: boolean }> {
  let query = supabase
    .from("activity_log")
    .select(
      "id, entity_type, entity_id, action, payload, created_at, actor:users(id, full_name, email)",
    )
    .order("created_at", { ascending: false })
    // +1 lookahead lets us tell the caller whether a Load-more makes sense
    // without a separate count(*) query.
    .limit(pageSize + 1);

  if (cursor) query = query.lt("created_at", cursor);

  const { data, error } = await query;
  if (error) throw error;

  const all = ((data ?? []) as unknown as DbActivityRow[]).map<ActivityRow>((r) => ({
    id: r.id,
    entity_type: r.entity_type,
    entity_id: r.entity_id,
    action: r.action,
    payload: r.payload,
    created_at: r.created_at,
    actor: r.actor,
  }));

  if (all.length > pageSize) {
    return { rows: all.slice(0, pageSize), hasMore: true };
  }
  return { rows: all, hasMore: false };
}
