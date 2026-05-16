import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

/**
 * Phase 5.5 notification queries (spec § 3 data layer).
 *
 * Reads the per-user notifications feed (newest first, capped at 20 for the
 * bell panel), counts unread for the badge, and writes read/read_at on
 * single or bulk mark-as-read. RLS on `notifications` already scopes both
 * SELECT and UPDATE to `user_id = auth.uid()` (initial schema); these
 * helpers do NOT need a defensive .eq("user_id", ...) clause.
 */

export type NotificationRow = Database["public"]["Tables"]["notifications"]["Row"];

export const BELL_PANEL_LIMIT = 20;

/** Fetch the most recent in-app notifications for the bell panel. */
export async function fetchRecentNotifications(): Promise<NotificationRow[]> {
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .eq("delivered_in_app", true)
    .order("created_at", { ascending: false })
    .limit(BELL_PANEL_LIMIT);
  if (error) throw error;
  return data ?? [];
}

/** Count unread in-app notifications for the bell badge. */
export async function fetchUnreadCount(): Promise<number> {
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { head: true, count: "exact" })
    .eq("delivered_in_app", true)
    .eq("read", false);
  if (error) throw error;
  return count ?? 0;
}

/** Mark a single notification as read. */
export async function markNotificationRead(id: string): Promise<void> {
  const { error } = await supabase
    .from("notifications")
    .update({ read: true, read_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

/** Mark every unread notification for the current user as read. */
export async function markAllNotificationsRead(): Promise<void> {
  const { error } = await supabase
    .from("notifications")
    .update({ read: true, read_at: new Date().toISOString() })
    .eq("read", false);
  if (error) throw error;
}
