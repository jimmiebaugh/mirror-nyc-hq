import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchUnreadCount, type NotificationRow } from "./queries";

/**
 * Phase 5.5 unread-count hook with Realtime subscription (spec § 3).
 *
 * Initial fetch via fetchUnreadCount, then subscribes to postgres_changes
 * on `public.notifications` filtered by user_id=eq.{uid} so new INSERT
 * events bump the badge live. UPDATE events flip the count when read
 * toggles. This is the same Realtime pattern used by PullDetail.tsx for
 * ts_pull_rounds (3.4) and the deliverables board (5.2.1).
 *
 * Phase 5.7.2: optional `typeFilter` narrows the count to a single
 * notification.type so the @-mention bell can render its own badge in
 * parallel with the catch-all bell without double-counting.
 *
 * Returns the unread count + a `refresh` function the bell panel can call
 * after a local mark-read to converge optimistic state with the server.
 */
export function useUnreadCount(
  userId: string | undefined,
  typeFilter?: string,
): {
  count: number;
  refresh: () => Promise<void>;
} {
  const [count, setCount] = useState(0);

  const refresh = async () => {
    if (!userId) {
      setCount(0);
      return;
    }
    try {
      const n = await fetchUnreadCount(typeFilter);
      setCount(n);
    } catch {
      // Surface as zero; the bell still renders. The full bell panel will
      // log + surface query errors via LoadError when it opens.
    }
  };

  useEffect(() => {
    if (!userId) {
      setCount(0);
      return;
    }
    let active = true;
    fetchUnreadCount(typeFilter)
      .then((n) => {
        if (active) setCount(n);
      })
      .catch(() => {
        if (active) setCount(0);
      });

    const channelName = typeFilter
      ? `notifications:${userId}:${typeFilter}`
      : `notifications:${userId}`;

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as NotificationRow;
          if (typeFilter && row.type !== typeFilter) return;
          if (row.delivered_in_app && !row.read) {
            setCount((c) => c + 1);
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const oldRow = payload.old as Partial<NotificationRow>;
          const newRow = payload.new as NotificationRow;
          if (typeFilter && newRow.type !== typeFilter) return;
          // Only in-app-delivered rows are counted (matching the INSERT gate
          // and fetchUnreadCount). markAllNotificationsRead flips `read` on
          // non-in-app rows too, so gate the counter on delivered_in_app or it
          // decrements a row it never counted.
          if (!newRow.delivered_in_app) return;
          // Unread -> read: decrement. Read -> unread (rare): increment.
          if (oldRow.read === false && newRow.read === true) {
            setCount((c) => Math.max(0, c - 1));
          } else if (oldRow.read === true && newRow.read === false) {
            setCount((c) => c + 1);
          }
        },
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [userId, typeFilter]);

  return { count, refresh };
}
