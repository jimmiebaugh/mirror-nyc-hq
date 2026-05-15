import { supabase } from "@/integrations/supabase/client";
import type { FilterState } from "@/components/data/FilterBar";

/**
 * Saved views persistence helpers (Phase 5.2.1 § 4c + 5.A.1). Per-user
 * named filter / sort / view-kind snapshots. The DB layer stores
 * `filter_state` as jsonb; this helper hides the shape from callers.
 *
 * The "default per (user, entity_type)" toggle is app-enforced via a
 * transactional pair: clear every other row's `is_default` then flip the
 * target row. The migration deliberately omits a unique partial index so
 * the multi-row write doesn't have to dodge a constraint mid-flight.
 */

export type EntityType =
  | "project"
  | "task"
  | "deliverable"
  | "organization"
  | "person"
  | "venue";

export type ViewKind = "list" | "board" | "timeline" | "calendar";

export type SavedView = {
  id: string;
  user_id: string;
  entity_type: EntityType;
  name: string;
  view_kind: ViewKind;
  filter_state: FilterState;
  is_default: boolean;
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

export async function getDefaultSavedView(entityType: EntityType): Promise<SavedView | null> {
  const { data, error } = await supabase
    .from("saved_views")
    .select("*")
    .eq("entity_type", entityType)
    .eq("is_default", true)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as SavedView) ?? null;
}

export async function createSavedView(input: {
  entityType: EntityType;
  name: string;
  viewKind: ViewKind;
  filterState: FilterState;
  isDefault: boolean;
}): Promise<SavedView> {
  const { data: userRes } = await supabase.auth.getUser();
  const userId = userRes.user?.id;
  if (!userId) throw new Error("Not signed in");

  if (input.isDefault) {
    await supabase
      .from("saved_views")
      .update({ is_default: false })
      .eq("user_id", userId)
      .eq("entity_type", input.entityType);
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
    })
    .select()
    .single();
  if (error) throw error;
  return data as unknown as SavedView;
}

export async function deleteSavedView(id: string): Promise<void> {
  const { error } = await supabase.from("saved_views").delete().eq("id", id);
  if (error) throw error;
}
