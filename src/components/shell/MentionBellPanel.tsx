import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { IconAt, IconSettings } from "@/components/icons/HQIcons";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useUnreadCount } from "@/lib/notifications/useUnreadCount";
import {
  fetchRecentMentions,
  markAllMentionsRead,
  markNotificationRead,
  type NotificationRow as NotifRow,
} from "@/lib/notifications/queries";
import { NotificationRow } from "./NotificationRow";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadError } from "@/components/ui/LoadError";

/**
 * Phase 5.7.2 @-mentions popover (spec § 6.A).
 *
 * Sibling to `NotificationBellPanel`: same DOM, same Realtime channel
 * pattern, separate icon + separate filter on `notification.type='mention'`.
 * Sits immediately to the left of the bell in `TopBar.tsx`.
 *
 * Why sibling and not a parameterized bell: the two surfaces diverge on
 * copy + label + row-click behavior would likely keep splitting over time
 * (per-entity routing for mentions, channel prefixes for bell). Cloning
 * the file keeps each surface free to evolve.
 */
export function MentionBellPanel() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const userId = user?.id;
  const { count, refresh } = useUnreadCount(userId, "mention");
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<NotifRow[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );

  useEffect(() => {
    if (!open || !userId) return;
    let active = true;
    setStatus("loading");
    fetchRecentMentions()
      .then((data) => {
        if (!active) return;
        setRows(data);
        setStatus("ready");
      })
      .catch((err) => {
        if (!active) return;
        console.error("[MentionBellPanel] load error:", err);
        setStatus("error");
      });
    return () => {
      active = false;
    };
  }, [open, userId]);

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`mentions-panel:${userId}`)
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
          if (row.type !== "mention") return;
          setRows((prev) => {
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
      await markAllMentionsRead();
      setRows((prev) =>
        prev.map((r) =>
          r.read ? r : { ...r, read: true, read_at: new Date().toISOString() },
        ),
      );
      await refresh();
      toast({ title: "All caught up" });
    } catch (err) {
      console.error("[MentionBellPanel] mark-all-read failed:", err);
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
      setRows((prev) =>
        prev.map((r) =>
          r.id === row.id
            ? { ...r, read: true, read_at: new Date().toISOString() }
            : r,
        ),
      );
      markNotificationRead(row.id)
        .catch((err) => {
          console.error("[MentionBellPanel] mark-read failed:", err);
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
              ? `Mentions, ${count} unread`
              : "Mentions, all caught up"
          }
          style={{ position: "relative" }}
        >
          <IconAt className="h-[18px] w-[18px]" />
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
          <span className="h-card">Mentions</span>
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
              title="Could not load mentions"
              description="Try opening the panel again in a moment."
              onRetry={() => setStatus("idle")}
            />
          ) : rows.length === 0 ? (
            <EmptyState icon={IconAt} iconSize={26}>
              No @-mentions yet. They&apos;ll show up here when someone writes your
              name into a note.
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
