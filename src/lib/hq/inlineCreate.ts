import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

/**
 * Inline-create handlers for the RecordCombobox `onMiniCreate` slot.
 *
 * The original handlers in ProjectEdit (Phase 5.6.1) followed a stable
 * pattern: get the auth user id, insert the slim payload, return an
 * `{ id, label }` option that the RecordCombobox auto-selects. Phase
 * 5.6.4.2 generalizes those into shared helpers so the same path is
 * available from any detail page that surfaces a Client / Venue picker
 * without duplicating the per-page boilerplate.
 *
 * Both helpers:
 *   - Return `null` on failure after firing a destructive toast with the
 *     real Postgres error message (RecordCombobox + MiniCreateModal then
 *     stay open so the user can retry without losing input).
 *   - Trust the table's open-auth RLS posture (clients + venues both
 *     allow SELECT/INSERT/UPDATE for any authenticated user).
 *   - Stay slim: only the `name` field (and `industry` for clients) is
 *     written. The full edit surface is reachable via the detail page
 *     for any field the user wants to fill in later.
 */

export type CreatedOption = { id: string; label: string };

export async function createClientInline(
  data: Record<string, string>,
): Promise<CreatedOption | null> {
  const { data: userRes } = await supabase.auth.getUser();
  const created_by = userRes.user?.id;
  if (!created_by) {
    toast({ title: "Not signed in", variant: "destructive" });
    return null;
  }
  const payload = {
    name: data.name,
    industry: data.industry || null,
    created_by,
  };
  const { data: row, error } = await supabase
    .from("clients")
    .insert(payload)
    .select("id, name")
    .single();
  if (error || !row) {
    toast({
      title: "Create failed",
      description: error?.message,
      variant: "destructive",
    });
    return null;
  }
  return { id: row.id, label: row.name ?? "Untitled" };
}

export async function createVenueInline(
  data: Record<string, string>,
): Promise<CreatedOption | null> {
  const { data: userRes } = await supabase.auth.getUser();
  const created_by = userRes.user?.id;
  if (!created_by) {
    toast({ title: "Not signed in", variant: "destructive" });
    return null;
  }
  const payload = {
    name: data.name,
    created_by,
  };
  const { data: row, error } = await supabase
    .from("venues")
    .insert(payload)
    .select("id, name")
    .single();
  if (error || !row) {
    toast({
      title: "Create failed",
      description: error?.message,
      variant: "destructive",
    });
    return null;
  }
  return { id: row.id, label: row.name ?? "Untitled" };
}

export const CLIENT_MINI_CREATE_FIELDS = [
  { key: "name", label: "Name", required: true, placeholder: "Olipop" },
  { key: "industry", label: "Industry", placeholder: "Beverage" },
];

export const VENUE_MINI_CREATE_FIELDS = [
  {
    key: "name",
    label: "Name",
    required: true,
    placeholder: "Brooklyn Steel",
  },
];
