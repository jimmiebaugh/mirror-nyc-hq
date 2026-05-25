import { supabase } from "@/integrations/supabase/client";

/**
 * Phase 5.7.5 § 5.D: app-side auto-task lifecycle helper for the
 * deliverable assignees flow. The only writers to
 * deliverables.assigned_user_ids are DeliverableDetail (inline picker)
 * and DeliverableEdit (checkbox grid); both go through the app's
 * Supabase client, so the lifecycle stays in app-land rather than a
 * Postgres trigger. Easier to debug; no SECURITY DEFINER surface.
 */

export type DeliverableContext = {
  deliverableId: string;
  deliverableTitle: string;
  dueDate: string | null;
  projectName: string | null;
  /** Current user id; tasks.created_by is NOT NULL. */
  createdBy: string;
};

/**
 * Title format simplified in 5.7.5 follow-up round 2: drop the client
 * prefix per Jimmie. Now reads "{ProjectTitle} {DeliverableTitle} Due".
 * Falls back to "(no project)" when projectName is null.
 */
function autoTaskTitle(ctx: DeliverableContext): string {
  return `${ctx.projectName ?? "(no project)"} ${ctx.deliverableTitle} Due`;
}

/**
 * Diff prev vs next assignee arrays and fire the corresponding task
 * inserts (for added users) + deletes (for removed users). Idempotent:
 * the partial unique index prevents duplicate inserts; the DELETE is a
 * no-op when the task is already gone (user may have manually deleted).
 *
 * Caller is responsible for the deliverables.assigned_user_ids UPDATE
 * itself. This helper only handles the task side; best-effort like the
 * existing 5.7.2 note_mentions write.
 */
export async function syncDeliverableAssignees({
  ctx,
  prevIds,
  nextIds,
}: {
  ctx: DeliverableContext;
  prevIds: string[];
  nextIds: string[];
}): Promise<{ added: number; removed: number; deletedRows: number; errors: string[] }> {
  const prevSet = new Set(prevIds);
  const nextSet = new Set(nextIds);
  const added = nextIds.filter((id) => !prevSet.has(id));
  const removed = prevIds.filter((id) => !nextSet.has(id));
  const errors: string[] = [];

  if (added.length > 0) {
    const title = autoTaskTitle(ctx);
    const insertRows = added.map((userId) => ({
      title,
      status: "To Do" as const,
      priority: "Normal",
      due_date: ctx.dueDate,
      assignee_id: userId,
      created_by: ctx.createdBy,
      source_deliverable_id: ctx.deliverableId,
      source_user_id: userId,
    }));
    const { error } = await supabase.from("tasks").insert(insertRows);
    if (error) {
      // 23505 = unique_violation. Race-condition path; treat as benign.
      if (error.code !== "23505") {
        errors.push(`Auto-task insert: ${error.message}`);
      }
    }
  }

  let deletedRows = 0;
  if (removed.length > 0) {
    // Single round-trip via `IN (...)`; `.select("id")` makes Supabase
    // return the deleted rows so callers can confirm something actually
    // matched (5.7.5 follow-on round 1 caught a case where the user
    // expected a delete but the DELETE silently affected zero rows).
    const { data: deletedData, error } = await supabase
      .from("tasks")
      .delete()
      .eq("source_deliverable_id", ctx.deliverableId)
      .in("source_user_id", removed)
      .select("id");
    if (error) {
      errors.push(`Auto-task delete: ${error.message}`);
    } else {
      deletedRows = deletedData?.length ?? 0;
      if (deletedRows < removed.length) {
        // Common: user manually deleted their auto-task before unassigning.
        // Console-warn instead of toast; non-blocking.
        console.warn(
          `[syncDeliverableAssignees] expected to delete ${removed.length} auto-task(s); matched ${deletedRows}`,
          { deliverableId: ctx.deliverableId, removed },
        );
      }
    }
  }

  return { added: added.length, removed: removed.length, deletedRows, errors };
}
