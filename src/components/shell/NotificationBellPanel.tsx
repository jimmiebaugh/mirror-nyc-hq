import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { IconBell, IconSettings } from "@/components/icons/HQIcons";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useUnreadCount } from "@/lib/notifications/useUnreadCount";
import {
  fetchRecentNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationRow as NotifRow,
} from "@/lib/notifications/queries";
import { NotificationRow } from "./NotificationRow";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadError } from "@/components/ui/LoadError";

/**
 * Phase 5.5 bell popover (spec § 3 UI).
 *
 * Wireframe binding: OUTPUTS/phase-5-hq-wireframe-v1-LOCKED.html lines
 * 3262-3278 (open panel with rows) + lines 3539-3546 (empty-state variant).
 *
 * Anchored to the bell icon in the TopBar; 392px wide popover with a
 * card-headbar at the top (Mark all read), a scrollable notification list
 * in the middle, and a footer with two tlinks (View all in Activity Feed,
 * Preferences). Realtime: subscribes to postgres_changes INSERT on the
 * current user's row and prepends new notifications live.
 *
 * Hooks above any early return per design-system § 12.2.
 */
export function NotificationBellPanel() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const userId = user?.id;
  const { count, refresh } = useUnreadCount(userId);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<NotifRow[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );

  // Initial load whenever the popover opens.
  useEffect(() => {
    if (!open || !userId) return;
    let active = true;
    setStatus("loading");
    fetchRecentNotifications()
      .then((data) => {
        if (!active) return;
        setRows(data);
        setStatus("ready");
      })
      .catch((err) => {
        if (!active) return;
        console.error("[NotificationBellPanel] load error:", err);
        setStatus("error");
      });
    return () => {
      active = false;
    };
  }, [open, userId]);

  // Live new-row INSERTs from Realtime: prepend to the visible list while
  // the popover is mounted so the panel stays current without a refetch.
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`notifications-panel:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as NotifRow;
          if (!row.delivered_in_app) return;
          setRows((prev) => {
            // Dedupe in case the initial fetch races with the live INSERT.
            if (prev.some((r) => r.id === row.id)) return prev;
            return [row, ...prev].slice(0, 20);
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  const handleMarkAll = async () => {
    try {
      await markAllNotificationsRead();
      setRows((prev) =>
        prev.map((r) =>
          r.read ? r : { ...r, read: true, read_at: new Date().toISOString() },
        ),
      );
      await refresh();
      toast({ title: "All caught up" });
    } catch (err) {
      console.error("[NotificationBellPanel] mark-all-read failed:", err);
      toast({
        title: "Save failed",
        description: err instanceof Error ? err.message : "Could not mark read.",
        variant: "destructive",
      });
    }
  };

  const handleRowClick = async (row: NotifRow) => {
    setOpen(false);
    if (!row.read) {
      // Optimistic local update; server write is non-blocking for navigation.
      setRows((prev) =>
        prev.map((r) =>
          r.id === row.id
            ? { ...r, read: true, read_at: new Date().toISOString() }
            : r,
        ),
      );
      markNotificationRead(row.id)
        .catch((err) => {
          console.error("[NotificationBellPanel] mark-read failed:", err);
          // Revert on failure.
          setRows((prev) =>
            prev.map((r) =>
              r.id === row.id ? { ...r, read: row.read, read_at: row.read_at } : r,
            ),
          );
          toast({ title: "Save failed", variant: "destructive" });
        })
        .finally(() => {
          refresh();
        });
    }
    if (row.link_url) {
      navigate(row.link_url);
    }
  };

  const badgeText = count > 9 ? "9+" : String(count);
  const hasUnread = count > 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="hq-iconbtn"
          aria-label={
            hasUnread
              ? `Notifications, ${count} unread`
              : "Notifications, all caught up"
          }
          style={{ position: "relative" }}
        >
          <IconBell className="h-[18px] w-[18px]" />
          {hasUnread ? (
            <span
              className="hq-iconbtn-badge"
              style={{
                position: "absolute",
                top: -4,
                right: -4,
                minWidth: 16,
                height: 16,
                padding: "0 4px",
                borderRadius: 999,
                background: "hsl(var(--primary))",
                color: "#fff",
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                fontWeight: 700,
                lineHeight: "16px",
                textAlign: "center",
                pointerEvents: "none",
              }}
            >
              {badgeText}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="p-0"
        style={{ width: 392 }}
      >
        <div className="card-headbar" style={{ borderColor: "hsl(var(--border))" }}>
          <span className="h-card">Notifications</span>
          {status === "ready" && rows.some((r) => !r.read) ? (
            <button
              type="button"
              className="tlink"
              style={{ fontSize: 11 }}
              onClick={handleMarkAll}
            >
              Mark all read
            </button>
          ) : null}
        </div>
        <div style={{ maxHeight: 520, overflowY: "auto" }}>
          {status === "loading" ? (
            <div className="empty" style={{ border: "none", padding: "40px 24px" }}>
              <p>Loading...</p>
            </div>
          ) : status === "error" ? (
            <LoadError
              title="Could not load notifications"
              description="Try opening the panel again in a moment."
              onRetry={() => setStatus("idle")}
            />
          ) : rows.length === 0 ? (
            <EmptyState icon={IconBell} iconSize={26}>
              You are all caught up. New notifications land here.
            </EmptyState>
          ) : (
            rows.map((r) => (
              <NotificationRow key={r.id} row={r} onClick={() => handleRowClick(r)} />
            ))
          )}
        </div>
        <div
          style={{
            borderTop: "1px solid hsl(var(--border))",
            padding: "10px 16px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <button
            type="button"
            className="tlink"
            style={{ fontSize: 11, color: "hsl(var(--foreground))" }}
            onClick={() => {
              setOpen(false);
              navigate("/activity");
            }}
          >
            View all in Activity Feed
          </button>
          <button
            type="button"
            className="tlink"
            style={{ fontSize: 11, color: "hsl(var(--subtle-foreground))" }}
            onClick={() => {
              setOpen(false);
              navigate("/notifications/preferences");
            }}
          >
            <IconSettings className="ic ic-sm" style={{ width: 12, height: 12 }} />{" "}
            Preferences
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
