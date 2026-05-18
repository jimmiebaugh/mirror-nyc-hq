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

/** Phase 5.7.2: entity types whose underlying tables are gated to admins-only
 *  (or admins + standard) at the RLS layer. Surfacing their activity rows in
 *  the global feed for a viewer who can't navigate to the parent record is
 *  noise, so each viewer tier gets its own exclusion list. Plural and
 *  singular variants are both listed because activity_log_writer keys off
 *  TG_TABLE_NAME (plural) while the note_mentions writer uses singular. */
const ADMIN_ONLY_ENTITY_TYPES = [
  "outlook_entry",
  "outlook_entries",
] as const;
const FREELANCE_BLOCKED_ENTITY_TYPES = [
  ...ADMIN_ONLY_ENTITY_TYPES,
  "credential",
  "credentials",
] as const;

export type ActivityViewerRole = "admin" | "standard" | "freelance" | null;

function excludedTypesFor(role: ActivityViewerRole): readonly string[] {
  if (role === "admin") return [];
  if (role === "freelance") return FREELANCE_BLOCKED_ENTITY_TYPES;
  // standard (or unknown): hide admin-only surfaces.
  return ADMIN_ONLY_ENTITY_TYPES;
}

export async function fetchActivityPage({
  cursor,
  pageSize = ACTIVITY_PAGE_SIZE,
  viewerRole = null,
}: {
  cursor?: string;
  pageSize?: number;
  viewerRole?: ActivityViewerRole;
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

  const excluded = excludedTypesFor(viewerRole);
  if (excluded.length > 0) {
    // PostgREST IN-list filter; entity_type values come from a fixed
    // controlled list so we don't need to escape.
    query = query.not(
      "entity_type",
      "in",
      `(${excluded.map((t) => `"${t}"`).join(",")})`,
    );
  }

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

/**
 * Phase 5.7.3 § 3.F + 5.7.14 § 6.F.1: ProjectDetail "Project Activity" card.
 * Returns the most-recent `activity_log` rows whose entity is the project
 * itself (singular + plural variants) UNION rows whose entity is a task or
 * deliverable belonging to the project. Three SELECTs + client-side merge
 * keeps the query shape portable across PostgREST versions (the OR-with-
 * compound-AND syntax has surprised us before; see 5.7.13 loadVendors).
 *
 * The `viewerRole` exclusion mirrors `fetchActivityPage` for consistency.
 */
export async function loadActivityByProject({
  projectId,
  limit = 5,
  viewerRole = null,
}: {
  projectId: string;
  limit?: number;
  viewerRole?: ActivityViewerRole;
}): Promise<ActivityRow[]> {
  const excluded = excludedTypesFor(viewerRole);

  // 1. Resolve child entity ids belonging to this project.
  const [tasksRes, dlvRes] = await Promise.all([
    supabase.from("tasks").select("id").eq("project_id", projectId),
    supabase.from("deliverables").select("id").eq("project_id", projectId),
  ]);
  const taskIds = (tasksRes.data ?? []).map((t) => t.id as string);
  const dlvIds = (dlvRes.data ?? []).map((d) => d.id as string);

  // 2. Three parallel activity_log queries (project / tasks / deliverables),
  //    each capped at `limit` rows so we never pull more than 3 * limit before
  //    merge+truncate. PostgREST applies the .limit() per-query so total
  //    network cost is bounded.
  const select =
    "id, entity_type, entity_id, action, payload, created_at, actor:users(id, full_name, email)";

  const buildQuery = (types: string[], ids: string[]) => {
    let q = supabase
      .from("activity_log")
      .select(select)
      .in("entity_type", types)
      .in("entity_id", ids)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (excluded.length > 0) {
      q = q.not(
        "entity_type",
        "in",
        `(${excluded.map((t) => `"${t}"`).join(",")})`,
      );
    }
    return q;
  };

  const queries = [buildQuery(["project", "projects"], [projectId])];
  if (taskIds.length > 0) queries.push(buildQuery(["task", "tasks"], taskIds));
  if (dlvIds.length > 0)
    queries.push(buildQuery(["deliverable", "deliverables"], dlvIds));

  const results = await Promise.all(queries);
  for (const r of results) {
    if (r.error) throw r.error;
  }

  // 3. Merge, sort newest-first, truncate to `limit`.
  const merged: DbActivityRow[] = [];
  for (const r of results) {
    merged.push(...((r.data ?? []) as unknown as DbActivityRow[]));
  }
  merged.sort((a, b) => b.created_at.localeCompare(a.created_at));

  return merged.slice(0, limit).map<ActivityRow>((r) => ({
    id: r.id,
    entity_type: r.entity_type,
    entity_id: r.entity_id,
    action: r.action,
    payload: r.payload,
    created_at: r.created_at,
    actor: r.actor,
  }));
}
