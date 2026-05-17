import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  IconChevronRight,
  IconProjects,
  IconCalendar,
  IconDeliverables,
  IconTasks,
  IconComment,
  IconActivity,
} from "@/components/icons/HQIcons";
import { useUserRole } from "@/hooks/useUserRole";

/** Phase 5.7.2: kept in sync with the same list in lib/activity/queries.ts.
 *  Activity rows for admin-only surfaces don't appear for viewers who can't
 *  navigate to the parent record. */
const HOME_ADMIN_ONLY_ENTITY_TYPES = ["outlook_entry", "outlook_entries"];
const HOME_FREELANCE_BLOCKED_ENTITY_TYPES = [
  ...HOME_ADMIN_ONLY_ENTITY_TYPES,
  "credential",
  "credentials",
];

/**
 * Phase 5.1 Recent Activity card (spec § 7a step 5).
 *
 * Standard scope (`mine`): activity rows where the entity belongs to a
 * project the signed-in user is assigned to. In 5.1 the activity_log row
 * does not directly carry a user assignment; the simplest faithful filter
 * is to join activity rows whose `entity_type='project'` and the project
 * is one the user is on. Other entity_types (venue, task) still surface
 * for admin scope but are not filtered in 5.1 for the standard scope
 * (deferred to 5.5 when the activity surface gets its full polish).
 *
 * Admin scope (`cross-team`): every activity row.
 */

type Row = {
  id: string;
  entity_type: string;
  entity_id: string | null;
  action: string;
  payload: Record<string, unknown> | null;
  createdAtIso: string;
  actor: { full_name: string | null; email: string | null } | null;
};

type DbActivityRow = {
  id: string;
  entity_type: string;
  entity_id: string | null;
  action: string;
  payload: Record<string, unknown> | null;
  created_at: string;
  actor: { full_name: string | null; email: string | null } | null;
};

function actorDisplay(a: Row["actor"]): string {
  if (!a) return "Someone";
  if (a.full_name?.trim()) return a.full_name;
  if (a.email) return a.email.split("@")[0];
  return "Someone";
}

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
  if (day < 7) return `${day} day${day === 1 ? "" : "s"} ago`;
  const date = new Date(iso);
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

function singularizeEntityType(t: string): string {
  switch (t) {
    case "projects":        return "project";
    case "tasks":           return "task";
    case "deliverables":    return "deliverable";
    case "venues":          return "venue";
    case "vendors":         return "vendor";
    case "clients":         return "client";
    case "people":          return "person";
    case "wiki_pages":      return "wiki_page";
    case "outlook_entries": return "outlook_entry";
    case "credentials":     return "credential";
    case "mirror_holidays": return "mirror_holiday";
    case "organizations":   return "vendor";
    default:                return t;
  }
}

function entityWord(t: string): string {
  switch (t) {
    case "project": return "project";
    case "task": return "task";
    case "deliverable": return "deliverable";
    case "venue": return "venue";
    case "vendor": return "vendor";
    case "client": return "client";
    case "person": return "person";
    case "wiki_page": return "wiki page";
    case "outlook_entry": return "outlook entry";
    case "credential": return "credential";
    default: return t.replace(/_/g, " ");
  }
}

function hrefForEntity(t: string, id: string | null): string | null {
  if (!id) return null;
  switch (t) {
    case "project":       return `/projects/${id}`;
    case "task":          return `/tasks/${id}`;
    case "deliverable":   return `/deliverables/${id}`;
    case "venue":         return `/venues/${id}`;
    case "vendor":        return `/vendors/${id}`;
    case "client":        return `/clients/${id}`;
    case "person":        return `/people/${id}`;
    case "outlook_entry": return `/outlook`;
    case "wiki_page":     return `/wiki`;
    default:              return null;
  }
}

function IconForEntity({ type }: { type: string }) {
  const t = singularizeEntityType(type);
  switch (t) {
    case "project": return <IconProjects className="h-[14px] w-[14px]" />;
    case "task": return <IconTasks className="h-[14px] w-[14px]" />;
    case "calendar": return <IconCalendar className="h-[14px] w-[14px]" />;
    case "deliverable": return <IconDeliverables className="h-[14px] w-[14px]" />;
    case "comment": return <IconComment className="h-[14px] w-[14px]" />;
    default: return <IconActivity className="h-[14px] w-[14px]" />;
  }
}

function describe(row: Row): { lead: string; record: string | null; recordHref: string | null } {
  // Activity log payload is freeform per trigger. Surface what we have
  // without inventing structure; 5.7.2 sweep adds full-name fallback for
  // people and singularizes the plural entity_type from activity_log_writer.
  const payload = row.payload ?? {};
  const entityType = singularizeEntityType(row.entity_type);

  // Phase 5.7.2 mention rows: prefer parent_title (post-follow-up migration)
  // so the record-link lands on the parent task/deliverable/etc; fall back to
  // mentioned-user name + /users when parent_title isn't on the payload yet.
  if (row.action === "mentioned") {
    const mentioned =
      typeof payload.mentioned_user_full_name === "string"
        ? payload.mentioned_user_full_name
        : "someone";
    const parentTitle =
      typeof payload.parent_title === "string" && payload.parent_title
        ? payload.parent_title
        : null;
    if (parentTitle) {
      return {
        lead: ` mentioned ${mentioned} in `,
        record: parentTitle,
        recordHref: hrefForEntity(entityType, row.entity_id),
      };
    }
    return {
      lead: ` mentioned ${mentioned} in this ${entityWord(entityType)}`,
      record: null,
      recordHref: null,
    };
  }

  // Resolve the record's display name. People rows store it under full_name.
  const recordName =
    (typeof payload.name === "string" && payload.name) ||
    (typeof payload.title === "string" && payload.title) ||
    (typeof payload.full_name === "string" && payload.full_name) ||
    (typeof payload.entity_name === "string" && payload.entity_name) ||
    null;
  const recordHref = hrefForEntity(entityType, row.entity_id);

  if (row.action === "created") {
    return {
      lead: ` created ${entityWord(entityType)} `,
      record: recordName,
      recordHref,
    };
  }
  if (row.action === "deleted") {
    return {
      lead: ` deleted ${entityWord(entityType)} `,
      record: recordName,
      recordHref: null,
    };
  }
  return {
    lead: ` ${row.action.replace(/_/g, " ")} `,
    record: recordName,
    recordHref,
  };
}

export function RecentActivityCard({
  userId,
  scope,
}: {
  userId: string | undefined;
  scope: "mine" | "cross-team";
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const { role, loading: roleLoading } = useUserRole();

  useEffect(() => {
    if (roleLoading) return;
    let active = true;
    async function load() {
      let query = supabase
        .from("activity_log")
        .select(
          "id, entity_type, entity_id, action, payload, created_at, actor:users(full_name, email)",
        )
        .order("created_at", { ascending: false })
        .limit(5);

      // Phase 5.7.2: hide admin-only surfaces from non-admin viewers so the
      // card stays useful (rather than full of unclickable rows).
      const excluded =
        role === "admin"
          ? []
          : role === "freelance"
            ? HOME_FREELANCE_BLOCKED_ENTITY_TYPES
            : HOME_ADMIN_ONLY_ENTITY_TYPES;
      if (excluded.length > 0) {
        query = query.not(
          "entity_type",
          "in",
          `(${excluded.map((t) => `"${t}"`).join(",")})`,
        );
      }

      if (scope === "mine" && userId) {
        // Filter to projects the user is assigned to (account manager or designer).
        const [amRes, dRes] = await Promise.all([
          supabase
            .from("project_account_managers")
            .select("project_id")
            .eq("user_id", userId),
          supabase
            .from("project_designers")
            .select("project_id")
            .eq("user_id", userId),
        ]);
        const projectIds = Array.from(new Set([
          ...((amRes.data ?? []).map((r) => r.project_id)),
          ...((dRes.data ?? []).map((r) => r.project_id)),
        ]));
        if (projectIds.length === 0) {
          setRows([]);
          return;
        }
        query = query
          .eq("entity_type", "project")
          .in("entity_id", projectIds);
      }

      const { data } = await query;
      if (!active) return;
      const mapped: Row[] = ((data ?? []) as unknown as DbActivityRow[]).map((r) => ({
        id: r.id,
        entity_type: r.entity_type,
        entity_id: r.entity_id,
        action: r.action,
        payload: r.payload,
        createdAtIso: r.created_at,
        actor: r.actor,
      }));
      setRows(mapped);
    }
    load();
    return () => {
      active = false;
    };
  }, [userId, scope, role, roleLoading]);

  const title = scope === "cross-team" ? "Global Activity Feed" : "Recent Activity";

  return (
    <div className="hq-card hq-card-pad">
      <div className="flex justify-between items-center mb-2">
        <span className="h-card">{title}</span>
        <Link to="/activity" className="hq-tlink">
          Open feed <IconChevronRight className="h-[14px] w-[14px]" />
        </Link>
      </div>
      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-[hsl(var(--border-strong))] py-8 text-center text-sm text-[hsl(var(--muted-foreground))]">
          No activity yet.
        </div>
      ) : (
        rows.map((r) => {
          const { lead, record, recordHref } = describe(r);
          // Phase 5.7.2: /users (Team list) is admin-gated; don't render a
          // dead-end link for non-admin viewers.
          const recordHrefEffective =
            recordHref === "/users" && role !== "admin" ? null : recordHref;
          return (
            <div key={r.id} className="hq-activity-row">
              <span className="hq-actdot">
                <IconForEntity type={r.entity_type} />
              </span>
              <div>
                <div className="hq-activity-txt">
                  <span className="who">{actorDisplay(r.actor)}</span>{" "}
                  {lead}{" "}
                  {record && recordHrefEffective ? (
                    <Link to={recordHrefEffective}>
                      <b>{record}</b>
                    </Link>
                  ) : record ? (
                    <b>{record}</b>
                  ) : null}
                </div>
                <div className="hq-activity-ts">{relativeTime(r.createdAtIso)}</div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}