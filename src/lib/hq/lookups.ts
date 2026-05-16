import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Shared lookup-table hook for the Phase 5.2.2 inline-add affordance
 * (spec § 6.C). Returns the option list plus an `addOption(name)` that
 * inserts a row, refreshes local state, and resolves to the new id so the
 * caller can immediately select it.
 *
 * The shipped lookups: `cities`, `project_categories`,
 * `vendor_capabilities` (renamed from `org_capabilities` in 5.2.3),
 * `vendor_categories` (new in 5.2.3), `venue_types`. All share the same
 * shape (id uuid, name text, created_by uuid, created_at) and the same
 * open-authenticated SELECT/INSERT RLS posture. `venue_types` predates
 * the 5.2.2 lookups but fits the same hook signature; consuming it
 * through `useLookup` keeps the Venue Edit's Venue-Type inline-add
 * consistent with the others.
 *
 * Names are unique case-insensitively at the DB level (`LOWER(name)`
 * unique index); the hook surfaces the unique-violation error so the
 * caller can show a "name already exists" toast.
 */

export type LookupTable =
  | "cities"
  | "project_categories"
  | "vendor_capabilities"
  | "vendor_categories"
  | "vendor_subcategories"
  | "venue_types"
  | "departments";

export type LookupOption = { id: string; name: string };

/**
 * `parentScopeId` (Phase 5.6.2): when set, the hook filters options by
 * `parent_category_id = parentScopeId` and includes `parent_category_id`
 * in the insert payload. Only `vendor_subcategories` carries a parent
 * column today; passing `parentScopeId` against other tables is a no-op
 * load but will fail at insert time (no such column).
 */
export function useLookup(
  table: LookupTable,
  opts?: { parentScopeId?: string | null },
) {
  const parentScopeId = opts?.parentScopeId ?? null;
  const [options, setOptions] = useState<LookupOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    (async () => {
      let q = supabase
        .from(table)
        .select("id, name")
        .order("name", { ascending: true });
      if (parentScopeId) {
        q = q.eq("parent_category_id", parentScopeId);
      }
      const { data, error } = await q;
      if (!active) return;
      setLoading(false);
      if (error) {
        console.warn(`${table} load failed`, error);
        setOptions([]);
        return;
      }
      setOptions((data ?? []) as LookupOption[]);
    })();
    return () => {
      active = false;
    };
  }, [table, parentScopeId]);

  const addOption = useCallback(
    async (name: string): Promise<LookupOption | null> => {
      const trimmed = name.trim();
      if (!trimmed) return null;
      const { data: userRes } = await supabase.auth.getUser();
      const created_by = userRes.user?.id;
      if (!created_by) return null;

      // venue_types doesn't carry created_by in its shipped schema.
      const basePayload: Record<string, unknown> =
        table === "venue_types"
          ? { name: trimmed }
          : { name: trimmed, created_by };
      const insertPayload: Record<string, unknown> = parentScopeId
        ? { ...basePayload, parent_category_id: parentScopeId }
        : basePayload;

      const { data, error } = await supabase
        .from(table)
        .insert(insertPayload as never)
        .select("id, name")
        .single();
      if (error || !data) {
        console.warn(`${table} insert failed`, error);
        return null;
      }
      const next = data as LookupOption;
      setOptions((prev) =>
        [...prev, next].sort((a, b) => a.name.localeCompare(b.name)),
      );
      return next;
    },
    [table, parentScopeId],
  );

  return { options, loading, addOption };
}
