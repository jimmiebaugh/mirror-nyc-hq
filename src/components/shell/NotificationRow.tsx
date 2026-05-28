import type { ReactNode } from "react";
import {
  IconActivity,
  IconAlert,
  IconCalendar,
  IconComment,
  IconDeliverables,
  IconProjects,
  IconTalentScout,
  IconTasks,
  IconTeam,
} from "@/components/icons/HQIcons";
import type { NotificationRow as NotifRow } from "@/lib/notifications/queries";

/**
 * Phase 5.5 notification-row component (spec § 3, wireframe lines 3266-3272).
 *
 * Renders the `.notif` block inside the bell-panel popover. The wireframe
 * uses a fixed-width "udot" slot on every row so unread + read rows align;
 * unread rows additionally carry the `notif--unread` background tint. Body
 * text is interpolated server-side into title + body (notifications-dispatch
 * templates from spec § 8 build them); we don't re-template client-side
 * because the title/body already capture the actor + entity strings.
 */

type IconKey = NotifRow["type"];

function iconFor(type: IconKey): ReactNode {
  switch (type) {
    case "deliverable_due_3d":
      return <IconDeliverables className="ic" style={{ width: 15, height: 15 }} />;
    case "task_assigned":
    case "task_due_today":
      return <IconTasks className="ic" style={{ width: 15, height: 15 }} />;
    case "task_blocked":
      return <IconAlert className="ic" style={{ width: 15, height: 15 }} />;
    case "project_status_changed":
      return <IconProjects className="ic" style={{ width: 15, height: 15 }} />;
    case "mention":
      return <IconComment className="ic" style={{ width: 15, height: 15 }} />;
    case "event_date_today":
      return <IconCalendar className="ic" style={{ width: 15, height: 15 }} />;
    case "user_pending":
      return <IconTeam className="ic" style={{ width: 15, height: 15 }} />;
    case "pull_complete":
    case "final_review_ready":
      return <IconTalentScout className="ic" style={{ width: 15, height: 15 }} />;
    default:
      return <IconActivity className="ic" style={{ width: 15, height: 15 }} />;
  }
}

/** Same relative-time grammar as RecentActivityCard. */
function relativeTime(iso: string): string {
  const ts = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.max(0, Math.floor((now - ts) / 1000));
  if (diffSec < 60) return "Just now";
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "Yesterday";
  if (day < 7) return `${day} days ago`;
  const date = new Date(iso);
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

export function NotificationRow({
  row,
  onClick,
}: {
  row: NotifRow;
  onClick: () => void;
}) {
  const unread = !row.read;
  const ts = relativeTime(row.created_at);
  // Per build notes § 21: no channel prefix. Slack DM delivery prefixes
  // "Slack DM · " so the user sees which channel surfaced the alert.
  const tsLabel = row.delivered_slack ? `Slack DM · ${ts}` : ts;

  return (
    <button
      type="button"
      className={`notif ${unread ? "notif--unread" : ""}`}
      onClick={onClick}
      style={{
        width: "100%",
        textAlign: "left",
        background: unread ? "rgba(190,78,68,.05)" : "transparent",
        border: "none",
        borderBottom: "1px solid hsl(var(--border))",
        cursor: "pointer",
      }}
    >
      {unread ? (
        <span className="udot" />
      ) : (
        <span style={{ width: 7, flex: "none" }} />
      )}
      <span className="nico">{iconFor(row.type)}</span>
      <div className="flex1">
        <div className="nbody">
          <span style={{ fontWeight: 500, color: "hsl(var(--foreground))" }}>
            {row.title}
          </span>
          {row.body ? (
            <>
              {" "}
              <span style={{ color: "hsl(var(--muted-foreground))" }}>
                {row.body}
              </span>
            </>
          ) : null}
        </div>
        <div className="nts">{tsLabel}</div>
      </div>
    </button>
  );
}
