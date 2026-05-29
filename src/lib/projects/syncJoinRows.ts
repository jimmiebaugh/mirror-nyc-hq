import type { PostgrestError } from "@supabase/supabase-js";

/**
 * Diff `prevIds` vs `nextIds` and run the corresponding join-table writes,
 * collecting (not swallowing) the errors. Each edit page hands typed
 * `insert` / `remove` thunks so literal table-name typing is preserved at the
 * call site, while the diff + error collection lives here once. Replaces the
 * 5+ hand-rolled copies of this loop (TECH_DEBT_AUDIT F011) and fixes the
 * fire-and-forget pattern that reported "Saved" on a failed join write
 * (F002 / F005).
 *
 * Insert unique-violations (Postgres `23505`) are treated as benign: the join
 * row already exists, which is the desired end state, so a re-save after a
 * partial failure is idempotent. DELETEs of absent rows are no-ops and do not
 * error. Any other error is collected and returned so the caller can surface a
 * partial-failure toast and keep the dirty baseline for a retry.
 */
type JoinWriteResult = { error: PostgrestError | null };

export async function syncJoinRows(opts: {
  prevIds: string[];
  nextIds: string[];
  insert: (childId: string) => PromiseLike<JoinWriteResult>;
  remove: (childId: string) => PromiseLike<JoinWriteResult>;
}): Promise<PostgrestError[]> {
  const prev = new Set(opts.prevIds);
  const next = new Set(opts.nextIds);
  const toAdd = opts.nextIds.filter((id) => !prev.has(id));
  const toRemove = opts.prevIds.filter((id) => !next.has(id));
  const errors: PostgrestError[] = [];

  for (const childId of toAdd) {
    const { error } = await opts.insert(childId);
    // 23505 = unique_violation: the join row already exists (desired state).
    if (error && error.code !== "23505") errors.push(error);
  }
  for (const childId of toRemove) {
    const { error } = await opts.remove(childId);
    if (error) errors.push(error);
  }
  return errors;
}
