import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { IconArrowLeft } from "@/components/icons/HQIcons";
import {
  taskPriorityToken,
  taskStatusToken,
  statusTextDecoration,
} from "@/lib/home/projectStatusToken";
import { formatMediumDate } from "@/lib/hq/dates";
import {
  TASK_PRIORITY_VALUES,
  TASK_STATUS_VALUES,
  updateTaskPriority,
  updateTaskStatus,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/tasks/queries";
import { useBackHref } from "@/lib/hq/useBackHref";
import { InlineEditText } from "@/components/hq/InlineEditText";
import { ClickPillCell } from "@/components/hq/ClickPillCell";
import { RecordCombobox } from "@/components/ui/RecordCombobox";
import { toast } from "@/hooks/use-toast";

/**
 * Task Detail (Surface 13).
 *
 * Phase 5.6.3.1: detail-page inline-edit pattern. Every field saves itself
 * optimistically; the Pencil button (icon-only) on the header still routes
 * to `/tasks/:id/edit` as a fallback per the locked plan decision (Edit
 * pages stay for power-edit / bulk).
 */

type DbTask = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null;
  blocked_by: string[];
  completed_at: string | null;
  project_id: string | null;
  assignee_id: string | null;
  project: { id: string; name: string } | null;
  assignee: { id: string; full_name: string | null; email: string | null } | null;
};

export default function TaskDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [task, setTask] = useState<DbTask | null>(null);
  const [blockedTasks, setBlockedTasks] = useState<{ id: string; title: string }[]>([]);
  const [projectOptions, setProjectOptions] = useState<{ id: string; label: string }[]>([]);
  const [userOptions, setUserOptions] = useState<{ id: string; label: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const back = useBackHref({ to: "/tasks", label: "Tasks" });

  useEffect(() => {
    if (!id) return;
    let active = true;
    (async () => {
      const [taskRes, projectsRes, usersRes] = await Promise.all([
        supabase
          .from("tasks")
          .select(
            `id, title, description, status, priority, due_date, blocked_by, completed_at,
             project_id, assignee_id,
             project:projects!tasks_project_id_fkey(id, name),
             assignee:users!tasks_assignee_id_fkey(id, full_name, email)`,
          )
          .eq("id", id)
          .single(),
        supabase
          .from("projects")
          .select("id, name")
          .is("archived_at", null)
          .order("name", { ascending: true }),
        supabase
          .from("users")
          .select("id, full_name, email")
          .eq("active", true)
          .order("full_name", { ascending: true }),
      ]);
      if (!active) return;
      if (taskRes.error || !taskRes.data) {
        setLoading(false);
        return;
      }
      setTask(taskRes.data as unknown as DbTask);
      setProjectOptions(
        ((projectsRes.data ?? []) as { id: string; name: string | null }[]).map((p) => ({
          id: p.id,
          label: p.name ?? "Untitled",
        })),
      );
      setUserOptions(
        ((usersRes.data ?? []) as { id: string; full_name: string | null; email: string }[]).map(
          (u) => ({ id: u.id, label: u.full_name?.trim() || u.email }),
        ),
      );
      if ((taskRes.data.blocked_by ?? []).length > 0) {
        const { data: rels } = await supabase
          .from("tasks")
          .select("id, title")
          .in("id", taskRes.data.blocked_by);
        if (active) setBlockedTasks(rels ?? []);
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [id]);

  const loadProjectOptions = useCallback(async () => projectOptions, [projectOptions]);
  const loadUserOptions = useCallback(async () => userOptions, [userOptions]);

  // Single-field optimistic save. Rolls back + toasts on error. Mirrors
  // the PersonDetail pattern (Phase 5.6.3 prototype).
  const saveField = async <K extends keyof DbTask>(
    field: K,
    nextValue: DbTask[K],
  ): Promise<void> => {
    if (!task) return;
    const prev = task[field];
    setTask({ ...task, [field]: nextValue });
    const { error } = await supabase
      .from("tasks")
      .update({ [field as string]: nextValue })
      .eq("id", task.id);
    if (error) {
      setTask({ ...task, [field]: prev });
      throw error;
    }
  };

  // FK saves re-fetch the joined record so the read-mode label updates
  // immediately (without waiting for a full page refresh).
  const saveProjectId = async (nextId: string | null) => {
    if (!task) return;
    const prev = { project_id: task.project_id, project: task.project };
    const nextProject = nextId
      ? projectOptions.find((p) => p.id === nextId) ?? null
      : null;
    setTask({
      ...task,
      project_id: nextId,
      project: nextProject ? { id: nextProject.id, name: nextProject.label } : null,
    });
    const { error } = await supabase
      .from("tasks")
      .update({ project_id: nextId })
      .eq("id", task.id);
    if (error) {
      setTask({ ...task, ...prev });
      toast({ title: "Project save failed", description: error.message, variant: "destructive" });
    }
  };

  const saveAssigneeId = async (nextId: string | null) => {
    if (!task) return;
    const prev = { assignee_id: task.assignee_id, assignee: task.assignee };
    const nextUser = nextId ? userOptions.find((u) => u.id === nextId) ?? null : null;
    setTask({
      ...task,
      assignee_id: nextId,
      assignee: nextUser
        ? { id: nextUser.id, full_name: nextUser.label, email: null }
        : null,
    });
    const { error } = await supabase
      .from("tasks")
      .update({ assignee_id: nextId })
      .eq("id", task.id);
    if (error) {
      setTask({ ...task, ...prev });
      toast({ title: "Assignee save failed", description: error.message, variant: "destructive" });
    }
  };

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

  return (
    <div className="stack-4" style={{ maxWidth: 760 }}>
      <Link to={back.to} className="tlink">
        <IconArrowLeft className="ic" />
        Back to {back.label}
      </Link>
      <div className="row between" style={{ alignItems: "flex-start" }}>
        <h1 className={`h-page ${statusTextDecoration("task", task.status)}`}>
          <InlineEditText
            value={task.title}
            required
            placeholder="Task title"
            renderRead={(v) => v ?? "(untitled)"}
            onSave={(next) => saveField("title", next)}
          />
        </h1>
        <button
          type="button"
          className="btn btn-secondary"
          aria-label="Edit Task"
          title="Edit Task"
          onClick={() => navigate(`/tasks/${task.id}/edit`)}
          style={{ padding: "0 10px" }}
        >
          <Pencil className="ic" style={{ width: 14, height: 14 }} />
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
                <ClickPillCell
                  value={task.status}
                  options={TASK_STATUS_VALUES}
                  tokenMap={taskStatusToken}
                  onSave={async (next) => {
                    await updateTaskStatus(task.id, next as TaskStatus);
                    setTask({ ...task, status: next as TaskStatus });
                  }}
                />
              </dd>
              <dt>Priority</dt>
              <dd>
                <ClickPillCell
                  value={task.priority}
                  options={TASK_PRIORITY_VALUES}
                  tokenMap={taskPriorityToken}
                  onSave={async (next) => {
                    await updateTaskPriority(task.id, next as TaskPriority);
                    setTask({ ...task, priority: next as TaskPriority });
                  }}
                />
              </dd>
              <dt>Due</dt>
              <dd>
                <InlineEditText
                  value={task.due_date}
                  placeholder="YYYY-MM-DD"
                  inputType="date"
                  renderRead={(v) =>
                    v ? formatMediumDate(v) : <span className="muted subtle">-</span>
                  }
                  onSave={(next) => saveField("due_date", next || null)}
                />
              </dd>
              <dt>Project</dt>
              <dd>
                <RecordCombobox
                  source={{ kind: "record", loadOptions: loadProjectOptions }}
                  value={task.project_id}
                  onChange={(next) => void saveProjectId(next)}
                  entityLabel="Project"
                  placeholder="No project"
                />
              </dd>
              <dt>Assignee</dt>
              <dd>
                <RecordCombobox
                  source={{ kind: "record", loadOptions: loadUserOptions }}
                  value={task.assignee_id}
                  onChange={(next) => void saveAssigneeId(next)}
                  entityLabel="user"
                  placeholder="Unassigned"
                />
              </dd>
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
            <div className="card-pad">
              <InlineEditText
                value={task.description}
                placeholder="Free-form notes for this task..."
                multiline
                renderRead={(v) =>
                  v ? (
                    <span className="muted" style={{ whiteSpace: "pre-wrap" }}>{v}</span>
                  ) : (
                    <span className="muted subtle">(empty)</span>
                  )
                }
                onSave={(next) => saveField("description", next || null)}
              />
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
