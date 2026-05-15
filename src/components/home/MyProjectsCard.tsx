import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { IconChevronRight } from "@/components/icons/HQIcons";
import { hqPillClass } from "@/lib/home/projectStatusToken";

/**
 * Phase 5.1 Home `My Projects` card.
 *
 * Standard variant: rendered alongside `MyTasksThisWeekCard` in a 2-col grid.
 * Admin variant: rendered full-width with an extra `Job #` column.
 *
 * Rows: every active (non-archived) project where the signed-in user is in
 * `project_account_managers` OR `project_designers`. Row click routes to the
 * project detail (stub until 5.2). The status pill resolves via spec § 5a.
 */

type Row = {
  id: string;
  jobNumber: string | null;
  name: string;
  status: string;
  clientName: string | null;
  liveStartIso: string | null;
  liveEndIso: string | null;
  role: "Account Lead" | "Designer" | "Co-Lead";
};

function formatLiveRange(start: string | null, end: string | null): string {
  if (!start && !end) return "TBD";
  if (start && end) {
    const [, sm, sd] = start.split("-").map(Number);
    const [, em, ed] = end.split("-").map(Number);
    const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    if (sm === em) return `${MONTHS[sm-1]} ${sd} to ${ed}`;
    return `${MONTHS[sm-1]} ${sd} to ${MONTHS[em-1]} ${ed}`;
  }
  return start ?? end ?? "TBD";
}

async function loadMyProjects(userId: string): Promise<Row[]> {
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
  const amIds = new Set((amRes.data ?? []).map((r) => r.project_id));
  const dIds = new Set((dRes.data ?? []).map((r) => r.project_id));
  const ids = new Set<string>([...amIds, ...dIds]);
  if (ids.size === 0) return [];

  const { data: projects } = await supabase
    .from("projects")
    .select("id, name, status, live_dates_start, live_dates_end, client:clients(name)")
    .in("id", Array.from(ids))
    .is("archived_at", null)
    .order("live_dates_start", { ascending: true });

  return (projects ?? []).map((p) => {
    const isAm = amIds.has(p.id);
    const isD = dIds.has(p.id);
    const role: Row["role"] = isAm && isD ? "Co-Lead" : isAm ? "Account Lead" : "Designer";
    return {
      id: p.id,
      jobNumber: null, // 5.2: a Job # column lands when the canonical Projects schema reshape ships.
      name: p.name,
      status: (p.status as string | null) ?? "",
      clientName: (p.client as { name?: string } | null)?.name ?? null,
      liveStartIso: p.live_dates_start,
      liveEndIso: p.live_dates_end,
      role,
    };
  });
}

export function MyProjectsCard({
  userId,
  fullWidth = false,
}: {
  userId: string | undefined;
  fullWidth?: boolean;
}) {
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    loadMyProjects(userId).then((r) => {
      if (active) setRows(r);
    });
    return () => {
      active = false;
    };
  }, [userId]);

  return (
    <div className="hq-card">
      <div className="hq-card-headbar">
        <span className="h-card">My Projects</span>
        <Link to="/projects" className="hq-tlink">
          View all <IconChevronRight className="h-[14px] w-[14px]" />
        </Link>
      </div>
      <table className="hq-tbl">
        <thead>
          <tr>
            {fullWidth ? <th>Job #</th> : null}
            <th>Project / Client</th>
            <th>Status</th>
            <th>Next Deliverable</th>
            <th>My role</th>
            <th className="r">Live</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={fullWidth ? 6 : 5} className="text-center text-[hsl(var(--subtle-foreground))] py-6">
                No projects assigned yet.
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.id} className="cursor-pointer">
                {fullWidth ? (
                  <td className="font-mono text-[hsl(var(--muted-foreground))]">
                    {r.jobNumber ?? "-"}
                  </td>
                ) : null}
                <td>
                  <Link to={`/projects/${r.id}`}>
                    <div className="lead">{r.name}</div>
                    {r.clientName ? (
                      <span className="hq-tlink text-[11.5px]">{r.clientName}</span>
                    ) : null}
                  </Link>
                </td>
                <td>
                  <span className={hqPillClass(r.status)}>
                    <span className="hq-pill-dt" />
                    {r.status || "Queued"}
                  </span>
                </td>
                <td className="text-[hsl(var(--muted-foreground))]">
                  <span className="text-[hsl(var(--subtle-foreground))]">None scheduled</span>
                </td>
                <td className="text-[hsl(var(--muted-foreground))]">{r.role}</td>
                <td className="r text-[hsl(var(--muted-foreground))]">
                  {formatLiveRange(r.liveStartIso, r.liveEndIso)}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}