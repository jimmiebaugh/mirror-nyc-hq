// Phase 5.16.1.1 §3b (code-observations Frontend #19): presentational split
// of ProjectDetail. The "Project Activity" card/feed. Activity rows, loading
// + error state, and the viewer role all arrive via props; the loaders,
// effects, and realtime subscription that hydrate them stay in the parent.
// JSX only relocated here.
import { Link } from "react-router-dom";
import {
  IconActivity,
  IconClients,
  IconComment,
  IconDeliverables,
  IconExt,
  IconLock,
  IconOrgs,
  IconOutlook,
  IconPeople,
  IconProjects,
  IconTasks,
  IconVenues,
  IconWiki,
} from "@/components/icons/HQIcons";
import {
  type ActivityRow,
  type ActivityViewerRole,
} from "@/lib/activity/queries";
import {
  activityRowTimestamp,
  formatActivitySentence,
  iconKeyForEntity,
} from "@/lib/activity/formatSentence";

// Phase 5.7.3 § 3.F: row-dot icon for the Project Activity card. Same mapping
// the global ActivityFeed uses (kept inline so this card doesn't pull in the
// full feed component).
function ActivityRowIcon({ entityType }: { entityType: string }) {
  const key = iconKeyForEntity(entityType);
  const style = { width: 14, height: 14 } as const;
  switch (key) {
    case "project":       return <IconProjects style={style} />;
    case "task":          return <IconTasks style={style} />;
    case "deliverable":   return <IconDeliverables style={style} />;
    case "venue":         return <IconVenues style={style} />;
    case "vendor":        return <IconOrgs style={style} />;
    case "client":        return <IconClients style={style} />;
    case "person":        return <IconPeople style={style} />;
    case "wiki_page":     return <IconWiki style={style} />;
    case "credential":    return <IconLock style={style} />;
    case "outlook_entry": return <IconOutlook style={style} />;
    case "notes_log":     return <IconComment style={style} />;
    default:              return <IconActivity style={style} />;
  }
}

export function ProjectActivitySection({
  activityRows,
  activityLoading,
  activityError,
  viewerRole,
}: {
  activityRows: ActivityRow[];
  activityLoading: boolean;
  activityError: Error | null;
  viewerRole: ActivityViewerRole;
}) {
  return (
    <section className="card">
      <div className="card-headbar">
        <span className="h-card">Project Activity</span>
        <Link to="/activity" className="tlink">
          View all
          <IconExt className="ic" style={{ width: 11, height: 11 }} />
        </Link>
      </div>
      <div className="card-pad">
        {activityLoading ? (
          <p className="subtle" style={{ fontSize: 13 }}>Loading...</p>
        ) : activityError ? (
          <p className="subtle" style={{ fontSize: 13 }}>
            Could not load activity.
          </p>
        ) : activityRows.length === 0 ? (
          <p className="subtle" style={{ fontSize: 13 }}>
            No project activity yet.
          </p>
        ) : (
          activityRows.map((row) => {
            const f = formatActivitySentence(row);
            // Phase 5.7.2 carry-forward: /users (Team list) is admin-only.
            // Demote the mention-fallback link for non-admin viewers so we
            // don't render a dead-end. Revert in 5.7.11 once /users/:id ships.
            const recordHrefEffective =
              f.recordHref === "/users" && viewerRole !== "admin"
                ? null
                : f.recordHref;
            return (
              <div key={row.id} className="activity-row">
                <span className="actdot">
                  <ActivityRowIcon entityType={row.entity_type} />
                </span>
                <div>
                  <div className="txt">
                    <span className="who">{f.actor.name}</span>
                    {f.leadingText}
                    {f.recordName ? (
                      f.recordIsBoldOnly ? (
                        <span className="dlv">{f.recordName}</span>
                      ) : recordHrefEffective ? (
                        <Link to={recordHrefEffective}>
                          <b>{f.recordName}</b>
                        </Link>
                      ) : (
                        <b>{f.recordName}</b>
                      )
                    ) : null}
                    {f.trailingText}
                  </div>
                  <div className="ts">{activityRowTimestamp(row.created_at)}</div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
