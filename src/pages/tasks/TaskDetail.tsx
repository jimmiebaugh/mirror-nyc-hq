import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { hqPillClass, taskStatusToken, statusTextDecoration } from "@/lib/home/projectStatusToken";
import { formatMediumDate } from "@/lib/hq/dates";
import type { TaskPriority, TaskStatus } from "@/lib/tasks/queries";

type DbTask = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null;
  blocked_by: string[];
  completed_at: string | null;
  project: { id: string; name: string } | null;
  assignee: { id: string; full_name: string | null; email: string | null } | null;
};

export default function TaskDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [task, setTask] = useState<DbTask | null>(null);
  const [blockedTasks, setBlockedTasks] = useState<{ id: string; title: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    let active = true;
    (async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select(
          `id, title, description, status, priority, due_date, blocked_by, completed_at,
           project:projects(id, name),
           assignee:users(id, full_name, email)`,
        )
        .eq("id", id)
        .single();
      if (!active) return;
      if (error || !data) {
        setLoading(false);
        return;
      }
      setTask(data as unknown as DbTask);
      if ((data.blocked_by ?? []).length > 0) {
        const { data: rels } = await supabase
          .from("tasks")
          .select("id, title")
          .in("id", data.blocked_by);
        if (active) setBlockedTasks(rels ?? []);
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [id]);

  if (loading) return <p className="text-sm text-muted-foreground">Loading...</p>;
  if (!task) return <p className="text-sm text-muted-foreground">Task not found.</p>;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link to="/tasks" className="crumb">← Back to Tasks</Link>
      <header className="flex items-start justify-between gap-3">
        <h1 className={`h-page ${statusTextDecoration("task", task.status)}`}>{task.title}</h1>
        <Button onClick={() => navigate(`/tasks/${task.id}/edit`)}>Edit Task</Button>
      </header>

      <div className="grid grid-cols-2 gap-6">
        <div className="hq-card">
          <div className="hq-card-headbar">
            <span className="h-card">Details</span>
          </div>
          <div className="p-6 space-y-3 text-sm">
            <Row label="Status">
              <span className={`hq-pill hq-pill--${taskStatusToken(task.status)}`}>
                <span className="hq-pill-dt" />
                {task.status}
              </span>
            </Row>
            <Row label="Priority">{task.priority}</Row>
            <Row label="Due">{task.due_date ? formatMediumDate(task.due_date) : "-"}</Row>
            <Row label="Project">
              {task.project ? (
                <Link to={`/projects/${task.project.id}`} className="hq-tlink">{task.project.name}</Link>
              ) : (
                "-"
              )}
            </Row>
            <Row label="Assignee">
              {task.assignee?.full_name ?? task.assignee?.email ?? "Unassigned"}
            </Row>
            {task.completed_at ? (
              <Row label="Completed">{formatMediumDate(task.completed_at.slice(0, 10))}</Row>
            ) : null}
          </div>
        </div>

        <aside className="space-y-6">
          {blockedTasks.length > 0 ? (
            <div className="hq-card">
              <div className="hq-card-headbar">
                <span className="h-card">Blocked by</span>
              </div>
              <ul className="p-6 text-sm space-y-1">
                {blockedTasks.map((b) => (
                  <li key={b.id}>
                    <Link to={`/tasks/${b.id}`} className="hq-tlink">{b.title}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="hq-card">
            <div className="hq-card-headbar">
              <span className="h-card">Notes</span>
            </div>
            <div className="p-6 text-sm whitespace-pre-wrap text-[hsl(var(--muted-foreground))]">
              {task.description || "(empty)"}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="label-form text-[hsl(var(--subtle-foreground))] min-w-[80px]">
        {label}
      </span>
      <span>{children}</span>
    </div>
  );
}
