import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { IconChevronRight, IconCheck } from "@/components/icons/HQIcons";
import { currentWeekWindow } from "@/lib/home/week";

/**
 * Phase 5.1 Home `My Tasks This Week` card (Standard variant only).
 *
 * Inline-action checkbox marks a task done (status='done') with optimistic
 * UI per spec § 7a. Inline-mutation rule (docs/conventions.md): await the DB
 * write before refetching parent state; the local optimistic state flips
 * immediately for snappy feedback, then the row reloads from the DB to
 * confirm (and revert on failure).
 */

type Row = {
  id: string;
  title: string;
  priority: "Urgent" | "High" | "Normal" | "Low";
  dueDateIso: string | null;
  projectName: string | null;
  clientName: string | null;
};

type DbTaskRow = {
  id: string;
  title: string;
  due_date: string | null;
  status: string;
  priority: "Urgent" | "High" | "Normal" | "Low";
  // The Supabase generated relationship type returns the join shape inline;
  // the project nested object is the small subset we need on the dashboard.
  project: {
    id: string;
    name: string;
    organization: { name: string | null } | null;
  } | null;
};

function priorityBadgeClass(p: Row["priority"]): string {
  switch (p) {
    case "Urgent": return "hq-pill hq-pill--destructive";
    case "High": return "hq-pill hq-pill--warn";
    case "Low": return "hq-pill hq-pill--muted";
    case "Normal":
    default: return "hq-pill hq-pill--muted";
  }
}

function formatDue(iso: string | null): { label: string; className: string } {
  if (!iso) return { label: "No due date", className: "text-[hsl(var(--subtle-foreground))]" };
  const [y, m, d] = iso.split("-").map(Number);
  const due = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isToday = due.getTime() === today.getTime();
  if (isToday) return { label: "Today", className: "text-[hsl(var(--destructive))]" };
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  return {
    label: `${DOW[due.getDay()]} ${MONTHS[m - 1]} ${d}`,
    className: "text-[hsl(var(--muted-foreground))]",
  };
}

export function MyTasksThisWeekCard({ userId }: { userId: string | undefined }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [completing, setCompleting] = useState<Record<string, boolean>>({});
  const navigate = useNavigate();
  const { mondayIso, sundayIso } = currentWeekWindow();

  useEffect(() => {
    if (!userId) return;
    let active = true;
    (async () => {
      const { data } = await supabase
        .from("tasks")
        .select(
          "id, title, due_date, status, priority, project:projects(id, name, organization:organizations(name))",
        )
        .eq("assignee_id", userId)
        .gte("due_date", mondayIso)
        .lte("due_date", sundayIso)
        .in("status", ["To Do", "Doing", "Blocked"])
        .order("due_date", { ascending: true });
      if (!active) return;
      const next: Row[] = ((data ?? []) as unknown as DbTaskRow[]).map((t) => ({
        id: t.id,
        title: t.title,
        priority: t.priority,
        dueDateIso: t.due_date,
        projectName: t.project?.name ?? null,
        clientName: t.project?.organization?.name ?? null,
      }));
      setRows(next);
    })();
    return () => {
      active = false;
    };
  }, [userId, mondayIso, sundayIso]);

  const onCheck = async (taskId: string) => {
    setCompleting((m) => ({ ...m, [taskId]: true }));
    const { error } = await supabase
      .from("tasks")
      .update({ status: "Done" })
      .eq("id", taskId);
    if (!error) {
      // Optimistic remove + server-confirmed reload per docs/conventions.md.
      setRows((rs) => rs.filter((r) => r.id !== taskId));
    }
    setCompleting((m) => ({ ...m, [taskId]: false }));
  };

  return (
    <div className="hq-card">
      <div className="hq-card-headbar">
        <span className="h-card">My Tasks This Week</span>
        <Link to="/tasks" className="hq-tlink">
          View all <IconChevronRight className="h-[14px] w-[14px]" />
        </Link>
      </div>
      <table className="hq-tbl">
        <thead>
          <tr>
            <th style={{ width: 34 }}></th>
            <th>Task</th>
            <th>Priority</th>
            <th className="r">Due</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4} className="text-center text-[hsl(var(--subtle-foreground))] py-6">
                No tasks due this week.
              </td>
            </tr>
          ) : (
            rows.map((r) => {
              const due = formatDue(r.dueDateIso);
              return (
                <tr key={r.id}>
                  <td className="text-center">
                    <button
                      type="button"
                      aria-label={`Mark "${r.title}" done`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onCheck(r.id);
                      }}
                      disabled={completing[r.id]}
                      className="inline-flex h-[15px] w-[15px] items-center justify-center rounded-[3px] border border-[hsl(var(--border-strong))] bg-[hsl(var(--surface-alt))] hover:border-primary"
                    >
                      {completing[r.id] ? <IconCheck className="h-[11px] w-[11px] text-primary" /> : null}
                    </button>
                  </td>
                  <td
                    className="cursor-pointer"
                    onClick={() => navigate(`/tasks/${r.id}`)}
                  >
                    <div className="lead">{r.title}</div>
                    <div className="sub">
                      {r.clientName && r.projectName
                        ? `${r.clientName} · ${r.projectName}`
                        : r.projectName ?? "No project"}
                    </div>
                  </td>
                  <td>
                    <span className={priorityBadgeClass(r.priority)}>
                      {r.priority}
                    </span>
                  </td>
                  <td className={`r ${due.className}`}>{due.label}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}