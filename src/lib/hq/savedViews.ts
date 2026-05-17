import { supabase } from "@/integrations/supabase/client";
import type { FilterState } from "@/components/data/FilterBar";

/**
 * Saved views persistence helpers (Phase 5.2.1 § 4c + 5.A.1, extended in
 * Phase 5.6.5 to add global-scope rows). Per-user OR global named filter
 * / sort / view-kind snapshots. The DB layer stores `filter_state` as
 * jsonb; this helper hides the shape from callers.
 *
 * The "default per (user, entity_type)" toggle for `scope='user'` is
 * app-enforced via a transactional pair: clear every other row's
 * `is_default` then flip the target row. Same shape for global defaults,
 * keyed on `(scope='global', entity_type)` instead. The migration
 * deliberately omits a unique partial index so the multi-row write
 * doesn't have to dodge a constraint mid-flight.
 *
 * Default-view resolution (5.6.5): per-user default wins; falls back to
 * the global default if no per-user default exists; otherwise null.
 */

export type EntityType =
  | "project"
  | "task"
  | "deliverable"
  /** @deprecated since 5.2.3 split. Kept for back-compat; no rows in production. */
  | "organization"
  | "vendor"
  | "client"
  | "person"
  | "venue"
  | "calendar";

export type ViewKind = "list" | "board" | "timeline" | "calendar";

export type SavedViewScope = "user" | "global";

export type SavedView = {
  id: string;
  user_id: string;
  entity_type: EntityType;
  name: string;
  view_kind: ViewKind;
  filter_state: FilterState;
  is_default: boolean;
  scope: SavedViewScope;
  created_at: string;
  updated_at: string;
};

export async function listSavedViews(entityType: EntityType): Promise<SavedView[]> {
  const { data, error } = await supabase
    .from("saved_views")
    .select("*")
    .eq("entity_type", entityType)
    .order("name", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as unknown as SavedView[]);
}

/**
 * Resolve the saved view that should apply to the current user on mount.
 * Per-user default wins, then global default, then null. Phase 5.6.5.
 */
export async function getDefaultSavedView(entityType: EntityType): Promise<SavedView | null> {
  const { data: userRes } = await supabase.auth.getUser();
  const userId = userRes.user?.id;
  if (!userId) return null;

  const userDefaultRes = await supabase
    .from("saved_views")
    .select("*")
    .eq("entity_type", entityType)
    .eq("scope", "user")
    .eq("user_id", userId)
    .eq("is_default", true)
    .limit(1)
    .maybeSingle();
  if (userDefaultRes.data) return userDefaultRes.data as unknown as SavedView;

  const globalDefaultRes = await supabase
    .from("saved_views")
    .select("*")
    .eq("entity_type", entityType)
    .eq("scope", "global")
    .eq("is_default", true)
    .limit(1)
    .maybeSingle();
  if (globalDefaultRes.data) return globalDefaultRes.data as unknown as SavedView;

  return null;
}

/** True iff a `scope='global'` default exists for the given entity_type. */
export async function hasGlobalDefault(entityType: EntityType): Promise<boolean> {
  const { data } = await supabase
    .from("saved_views")
    .select("id")
    .eq("entity_type", entityType)
    .eq("scope", "global")
    .eq("is_default", true)
    .limit(1)
    .maybeSingle();
  return Boolean(data);
}

export async function createSavedView(input: {
  entityType: EntityType;
  name: string;
  viewKind: ViewKind;
  filterState: FilterState;
  isDefault: boolean;
  /**
   * `'user'` writes a row owned by the current user; `'global'` writes a
   * row visible to every authenticated user (RLS restricts the INSERT to
   * `users.is_owner = true`). Required so callers think about scope.
   */
  scope: SavedViewScope;
}): Promise<SavedView> {
  const { data: userRes } = await supabase.auth.getUser();
  const userId = userRes.user?.id;
  if (!userId) throw new Error("Not signed in");

  if (input.isDefault) {
    if (input.scope === "user") {
      await supabase
        .from("saved_views")
        .update({ is_default: false })
        .eq("user_id", userId)
        .eq("entity_type", input.entityType)
        .eq("scope", "user");
    } else {
      await supabase
        .from("saved_views")
        .update({ is_default: false })
        .eq("scope", "global")
        .eq("entity_type", input.entityType);
    }
  }

  const { data, error } = await supabase
    .from("saved_views")
    .insert({
      user_id: userId,
      entity_type: input.entityType,
      name: input.name,
      view_kind: input.viewKind,
      filter_state: input.filterState as unknown as Record<string, unknown>,
      is_default: input.isDefault,
      scope: input.scope,
    } as never)
    .select()
    .single();
  if (error) throw error;
  return data as unknown as SavedView;
}

/**
 * Flip the user's per-user default flag to false for the given
 * entity_type. Doesn't delete the saved view itself; just unmarks it so
 * the next `getDefaultSavedView` call resolves to the global default
 * (if any) or null. Phase 5.6.5.
 */
export async function resetUserDefault(entityType: EntityType): Promise<void> {
  const { data: userRes } = await supabase.auth.getUser();
  const userId = userRes.user?.id;
  if (!userId) throw new Error("Not signed in");

  const { error } = await supabase
    .from("saved_views")
    .update({ is_default: false })
    .eq("user_id", userId)
    .eq("entity_type", entityType)
    .eq("scope", "user")
    .eq("is_default", true);
  if (error) throw error;
}

export async function deleteSavedView(id: string): Promise<void> {
  const { error } = await supabase.from("saved_views").delete().eq("id", id);
  if (error) throw error;
}
