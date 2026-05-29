import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { pillClass } from "@/lib/home/projectStatusToken";

/**
 * Phase 5.1 Home `All Active Projects` card (spec § 7a step 4).
 *
 * Every project where `status NOT IN ('Complete', 'Cancelled')` and
 * `archived_at IS NULL`. Click-row routes to the project detail (stub
 * until 5.2).
 */

type Row = {
  id: string;
  jobNumber: string | null;
  name: string;
  status: string;
  clientName: string | null;
  leadName: string | null;
  designerName: string | null;
};

type DbProjectRow = {
  id: string;
  name: string;
  status: string | null;
  job_number: string | null;
  client: { name: string | null } | null;
  account_managers: { user: { full_name: string | null; email: string | null } | null }[] | null;
  designers: { user: { full_name: string | null; email: string | null } | null }[] | null;
};

function firstName(name: string | null | undefined, email: string | null | undefined): string | null {
  if (name) {
    const n = name.trim().split(/\s+/)[0];
    return n || null;
  }
  if (email) {
    return email.split("@")[0].split(".")[0].replace(/^./, (c) => c.toUpperCase());
  }
  return null;
}

async function loadActive(): Promise<Row[]> {
  const { data } = await supabase
    .from("projects")
    .select(
      `id, name, status, job_number,
       client:clients(name),
       account_managers:project_account_managers(user:users(full_name, email)),
       designers:project_designers(user:users(full_name, email))`,
    )
    .is("archived_at", null)
    .not("status", "in", '("Complete","Cancelled")');
  const rows: Row[] = ((data ?? []) as unknown as DbProjectRow[]).map((p) => {
    const am = (p.account_managers ?? []).map((j) => j.user).filter(Boolean);
    const ds = (p.designers ?? []).map((j) => j.user).filter(Boolean);
    return {
      id: p.id,
      jobNumber: p.job_number,
      name: p.name,
      status: p.status ?? "",
      clientName: p.client?.name ?? null,
      leadName: am[0] ? firstName(am[0]?.full_name, am[0]?.email) : null,
      designerName: ds[0] ? firstName(ds[0]?.full_name, ds[0]?.email) : null,
    };
  });
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}

export function AllActiveProjectsCard() {
  const [rows, setRows] = useState<Row[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;
    loadActive().then((r) => {
      if (active) setRows(r);
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="card">
      <div className="card-headbar">
        <span className="h-card">All Active Projects</span>
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th className="l">Job #</th>
            <th className="l">Project / Client</th>
            <th className="c">Status</th>
            <th className="l">Lead</th>
            <th className="l">Design</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="text-center text-[hsl(var(--subtle-foreground))] py-6">
                No active projects.
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr
                key={r.id}
                className="cursor-pointer"
                onClick={() => navigate(`/projects/${r.id}`)}
              >
                <td className="l font-mono text-[hsl(var(--muted-foreground))]">
                  {r.jobNumber ?? "-"}
                </td>
                <td className="l">
                  <div className="lead">{r.name}</div>
                  {r.clientName ? (
                    <Link
                      to={`/projects/${r.id}`}
                      className="tlink text-[11.5px]"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {r.clientName}
                    </Link>
                  ) : null}
                </td>
                <td className="c">
                  <span className={pillClass(r.status)}>
                    <span className="dt" />
                    {r.status || "Queued"}
                  </span>
                </td>
                <td className="l text-[hsl(var(--muted-foreground))]">{r.leadName ?? "-"}</td>
                <td className="l text-[hsl(var(--muted-foreground))]">{r.designerName ?? "-"}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}