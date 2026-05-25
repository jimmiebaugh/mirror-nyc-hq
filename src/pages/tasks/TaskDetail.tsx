import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  taskPriorityToken,
  taskStatusToken,
} from "@/lib/home/projectStatusToken";
import { formatMediumDate, formatShortDate } from "@/lib/hq/dates";
import {
  TASK_PRIORITY_VALUES,
  TASK_STATUS_VALUES,
  updateTaskPriority,
  updateTaskStatus,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/tasks/queries";
import { InlineEditText } from "@/components/hq/InlineEditText";
import { ClickPillCell } from "@/components/hq/ClickPillCell";
import { DField } from "@/components/hq/DField";
import { RecordCombobox, type Option } from "@/components/ui/RecordCombobox";
import { InternalNotesEditor } from "@/components/data/InternalNotesEditor";
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
type TaskRef = { id: string; title: string };

async function loadTaskRefsByIds(ids: string[]): Promise<TaskRef[]> {
  if (ids.length === 0) return [];
  const { data } = await supabase
    .from("tasks")
    .select("id, title")
    .in("id", ids);
  return (data ?? []) as TaskRef[];
}

async function loadSiblingTaskRefs(
  projectId: string | null,
  currentTaskId: string,
): Promise<TaskRef[]> {
  if (!projectId) return [];
  const { data } = await supabase
    .from("tasks")
    .select("id, title")
    .eq("project_id", projectId)
    .neq("id", currentTaskId)
    .order("title", { ascending: true });
  return (data ?? []) as TaskRef[];
}

export default function TaskDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [task, setTask] = useState<DbTask | null>(null);
  const [blockedTasks, setBlockedTasks] = useState<TaskRef[]>([]);
  const [siblingTasks, setSiblingTasks] = useState<TaskRef[]>([]);
  const [projectOptions, setProjectOptions] = useState<{ id: string; label: string }[]>([]);
  const [userOptions, setUserOptions] = useState<{ id: string; label: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    let active = true;
    (async () => {
      const [taskRes, projectsRes, usersRes] = await Promise.all([
        supabase
          .from("tasks")
          .select(
            `id, title, status, priority, due_date, blocked_by, completed_at,
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
      const taskRow = taskRes.data as unknown as DbTask;
      const loadedTask: DbTask = { ...taskRow, blocked_by: taskRow.blocked_by ?? [] };
      setTask(loadedTask);
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
      const [selectedBlockers, siblingBlockers] = await Promise.all([
        loadTaskRefsByIds(loadedTask.blocked_by),
        loadSiblingTaskRefs(loadedTask.project_id, loadedTask.id),
      ]);
      if (!active) return;
      setBlockedTasks(selectedBlockers);
      setSiblingTasks(siblingBlockers);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [id]);

  const loadProjectOptions = useCallback(async () => projectOptions, [projectOptions]);
  const loadUserOptions = useCallback(async () => userOptions, [userOptions]);
  const blockedTaskOptions: Option[] = useMemo(() => {
    const byId = new Map<string, string>();
    for (const t of siblingTasks) byId.set(t.id, t.title || "Untitled task");
    for (const t of blockedTasks) byId.set(t.id, t.title || "Untitled task");
    return Array.from(byId, ([optionId, label]) => ({ id: optionId, label }));
  }, [blockedTasks, siblingTasks]);
  const loadBlockedTaskOptions = useCallback(
    async () => blockedTaskOptions,
    [blockedTaskOptions],
  );

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
      return;
    }
    setSiblingTasks(await loadSiblingTaskRefs(nextId, task.id));
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

  const saveBlockedBy = async (nextIds: string[]) => {
    if (!task) return;
    const prevTask = task;
    const prevBlockedTasks = blockedTasks;
    const labelById = new Map(blockedTaskOptions.map((opt) => [opt.id, opt.label]));
    setTask({ ...task, blocked_by: nextIds });
    setBlockedTasks(
      nextIds.map((blockerId) => ({
        id: blockerId,
        title: labelById.get(blockerId) ?? blockerId,
      })),
    );
    const { error } = await supabase
      .from("tasks")
      .update({ blocked_by: nextIds })
      .eq("id", task.id);
    if (error) {
      setTask(prevTask);
      setBlockedTasks(prevBlockedTasks);
      toast({ title: "Blocked by save failed", description: error.message, variant: "destructive" });
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

  const assigneeDisplay = task.assignee?.full_name?.trim() || task.assignee?.email || null;
  const detailMeta = [
    task.project?.name,
    assigneeDisplay,
    task.due_date ? formatShortDate(task.due_date) : null,
  ].filter(Boolean);

  return (
    <div className="stack-4" style={{ maxWidth: 760 }}>
      {/* R7 amendment v3 § 3: per-page back-crumb retired; TopBar carries it. */}
      <header className="stack-3">
        <div className="eyebrow" style={{ paddingTop: 8 }}>Task</div>
        <div className="row between" style={{ alignItems: "center" }}>
          <div className="row-c" style={{ flex: 1, gap: 16, alignItems: "center", minWidth: 0, flexWrap: "wrap" }}>
            <h1 className="h-page" style={{ minWidth: 0 }}>{task.title || "(untitled)"}</h1>
            <ClickPillCell
              value={task.status}
              options={TASK_STATUS_VALUES}
              tokenMap={taskStatusToken}
              size="lg"
              onSave={async (next) => {
                await updateTaskStatus(task.id, next as TaskStatus);
                setTask({ ...task, status: next as TaskStatus });
              }}
            />
          </div>
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
        <div className="row-c detail-meta" style={{ gap: 12, marginTop: 8, flexWrap: "wrap" }}>
          {detailMeta.length > 0 ? <span>{detailMeta.join(" · ")}</span> : null}
        </div>
      </header>

      <section className="card">
        <div className="card-headbar">
          <span className="h-card">Details</span>
        </div>
        <div className="card-pad stack-4">
          <div className="g2">
            <DField label="Priority">
              <ClickPillCell
                value={task.priority}
                options={TASK_PRIORITY_VALUES}
                tokenMap={taskPriorityToken}
                onSave={async (next) => {
                  await updateTaskPriority(task.id, next as TaskPriority);
                  setTask({ ...task, priority: next as TaskPriority });
                }}
              />
            </DField>
            <DField label="Due">
              <InlineEditText
                value={task.due_date}
                placeholder="YYYY-MM-DD"
                inputType="date"
                renderRead={(v) =>
                  v ? formatShortDate(v) : <span className="muted subtle">-</span>
                }
                onSave={(next) => saveField("due_date", next || null)}
              />
            </DField>
          </div>
          <div style={{ borderTop: "1px solid hsl(var(--border))" }} />
          <div className="g2">
            <DField label="Assignee">
              <RecordCombobox
                source={{ kind: "record", loadOptions: loadUserOptions }}
                value={task.assignee_id}
                onChange={(next) => void saveAssigneeId(next)}
                entityLabel="user"
                placeholder="Unassigned"
              />
            </DField>
            <DField label="Project">
              <RecordCombobox
                source={{ kind: "record", loadOptions: loadProjectOptions }}
                value={task.project_id}
                onChange={(next) => void saveProjectId(next)}
                entityLabel="Project"
                placeholder="No project"
                getRecordHref={(id) => `/projects/${id}`}
              />
            </DField>
          </div>
          <div style={{ borderTop: "1px solid hsl(var(--border))" }} />
          <DField label="Task">
            <InlineEditText
              value={task.title}
              required
              placeholder="Task title"
              renderRead={(v) => v ?? "(untitled)"}
              onSave={(next) => saveField("title", next)}
            />
          </DField>
          <div style={{ borderTop: "1px solid hsl(var(--border))" }} />
          <DField label="Blocked by">
            <RecordCombobox
              multi
              source={{ kind: "record", loadOptions: loadBlockedTaskOptions }}
              multiValue={task.blocked_by}
              onMultiChange={(next) => void saveBlockedBy(next)}
              entityLabel="task"
              placeholder="Add blocker..."
              getRecordHref={(blockerId) => `/tasks/${blockerId}`}
            />
          </DField>
          {task.completed_at ? (
            <>
              <div style={{ borderTop: "1px solid hsl(var(--border))" }} />
              <DField label="Completed">
                <span>{formatMediumDate(task.completed_at.slice(0, 10))}</span>
              </DField>
            </>
          ) : null}
        </div>
      </section>

      <InternalNotesEditor parentType="task" parentId={task.id} title="Notes" />
    </div>
  );
}
