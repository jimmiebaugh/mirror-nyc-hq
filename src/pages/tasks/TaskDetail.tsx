import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { IconArrowLeft } from "@/components/icons/HQIcons";
import { taskStatusToken, statusTextDecoration } from "@/lib/home/projectStatusToken";
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

function priorityTokenClass(p: TaskPriority): string {
  switch (p) {
    case "Urgent":
      return "pill p-destructive";
    case "High":
      return "pill p-warn";
    default:
      return "pill p-muted";
  }
}

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
           assignee:users!tasks_assignee_id_fkey(id, full_name, email)`,
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

  if (loading) {
    return (
      <div className="empty">
        <p>Loading...</p>
      </div>
    );
  }
  if (!task) {
    return (
      <div className="empty">
        <p>Task not found.</p>
      </div>
    );
  }

  const token = taskStatusToken(task.status);

  return (
    <div className="stack-4" style={{ maxWidth: 760 }}>
      <Link to="/tasks" className="tlink">
        <IconArrowLeft className="ic" />
        Back to Tasks
      </Link>
      <div className="row between" style={{ alignItems: "flex-start" }}>
        <h1 className={`h-page ${statusTextDecoration("task", task.status)}`}>
          {task.title}
        </h1>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => navigate(`/tasks/${task.id}/edit`)}
        >
          Edit Task
        </button>
      </div>

      <div className="g2">
        <section className="card">
          <div className="card-headbar">
            <span className="h-card">Details</span>
          </div>
          <div className="card-pad">
            <dl className="kv">
              <dt>Status</dt>
              <dd>
                <span className={`pill p-${token}`}>
                  <span className="dt" />
                  {task.status}
                </span>
              </dd>
              <dt>Priority</dt>
              <dd>
                <span className={priorityTokenClass(task.priority)}>{task.priority}</span>
              </dd>
              <dt>Due</dt>
              <dd>{task.due_date ? formatMediumDate(task.due_date) : "-"}</dd>
              <dt>Project</dt>
              <dd>
                {task.project ? (
                  <Link to={`/projects/${task.project.id}`} className="tlink">
                    {task.project.name}
                  </Link>
                ) : (
                  "-"
                )}
              </dd>
              <dt>Assignee</dt>
              <dd>{task.assignee?.full_name ?? task.assignee?.email ?? "Unassigned"}</dd>
              {task.completed_at ? (
                <>
                  <dt>Completed</dt>
                  <dd>{formatMediumDate(task.completed_at.slice(0, 10))}</dd>
                </>
              ) : null}
            </dl>
          </div>
        </section>

        <aside className="stack-4">
          {blockedTasks.length > 0 ? (
            <section className="card">
              <div className="card-headbar">
                <span className="h-card">Blocked by</span>
              </div>
              <ul className="card-pad stack-2">
                {blockedTasks.map((b) => (
                  <li key={b.id}>
                    <Link to={`/tasks/${b.id}`} className="tlink">
                      {b.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <section className="card">
            <div className="card-headbar">
              <span className="h-card">Notes</span>
            </div>
            <div className="card-pad muted" style={{ whiteSpace: "pre-wrap" }}>
              {task.description || "(empty)"}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
