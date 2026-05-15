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
  action: string;
  payload: Record<string, unknown> | null;
  createdAtIso: string;
  actor: { full_name: string | null; email: string | null } | null;
};

type DbActivityRow = {
  id: string;
  entity_type: string;
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

function IconForEntity({ type }: { type: string }) {
  switch (type) {
    case "project": return <IconProjects className="h-[14px] w-[14px]" />;
    case "task": return <IconTasks className="h-[14px] w-[14px]" />;
    case "calendar": return <IconCalendar className="h-[14px] w-[14px]" />;
    case "deliverable": return <IconDeliverables className="h-[14px] w-[14px]" />;
    case "comment": return <IconComment className="h-[14px] w-[14px]" />;
    default: return <IconActivity className="h-[14px] w-[14px]" />;
  }
}

function describe(row: Row): { lead: string; record: string | null; recordHref: string | null } {
  // Activity log payload is freeform per project trigger. Surface what we have
  // without inventing structure; 5.5 will canonicalize the action vocabulary.
  const payload = row.payload ?? {};
  const recordName = (payload.name as string | undefined) ?? null;
  const recordId = (payload.id as string | undefined) ?? null;
  const lead = row.action.replace(/_/g, " ");
  let recordHref: string | null = null;
  if (recordId && row.entity_type === "project") recordHref = `/projects/${recordId}`;
  if (recordId && row.entity_type === "venue") recordHref = `/venues/${recordId}`;
  if (recordId && row.entity_type === "task") recordHref = `/tasks/${recordId}`;
  return { lead, record: recordName, recordHref };
}

export function RecentActivityCard({
  userId,
  scope,
}: {
  userId: string | undefined;
  scope: "mine" | "cross-team";
}) {
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    let active = true;
    async function load() {
      let query = supabase
        .from("activity_log")
        .select("id, entity_type, action, payload, created_at, actor:users(full_name, email)")
        .order("created_at", { ascending: false })
        .limit(5);

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
  }, [userId, scope]);

  const title = scope === "cross-team" ? "Cross-team Activity" : "Recent Activity";

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
          return (
            <div key={r.id} className="hq-activity-row">
              <span className="hq-actdot">
                <IconForEntity type={r.entity_type} />
              </span>
              <div>
                <div className="hq-activity-txt">
                  <span className="who">{actorDisplay(r.actor)}</span>{" "}
                  {lead}{" "}
                  {record && recordHref ? (
                    <Link to={recordHref}>
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