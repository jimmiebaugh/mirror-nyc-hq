import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { StickySaveBar } from "@/components/data/StickySaveBar";
import { HQFormField } from "@/components/hq/HQFormField";
import { RecordCombobox, type Option } from "@/components/ui/RecordCombobox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  TASK_PRIORITY_VALUES,
  TASK_STATUS_VALUES,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/tasks/queries";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";

type FormState = {
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string;
  project_id: string | null;
  assignee_id: string | null;
  blocked_by: string[];
};

const EMPTY: FormState = {
  title: "",
  status: "To Do",
  priority: "Normal",
  due_date: "",
  project_id: null,
  assignee_id: null,
  blocked_by: [],
};

type ProjectOption = { id: string; name: string };
type UserOption = { id: string; full_name: string | null; email: string };
type TaskOption = { id: string; title: string; project_id: string | null };

export default function TaskEdit() {
  const { id } = useParams<{ id?: string }>();
  const isCreate = !id;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const projectFromQuery = searchParams.get("project");
  const { user } = useAuth();

  const [initial, setInitial] = useState<FormState>({
    ...EMPTY,
    project_id: projectFromQuery,
    assignee_id: user?.id ?? null,
  });
  const [form, setForm] = useState<FormState>({
    ...EMPTY,
    project_id: projectFromQuery,
    assignee_id: user?.id ?? null,
  });
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [siblingTasks, setSiblingTasks] = useState<TaskOption[]>([]);
  const [loading, setLoading] = useState(!isCreate);
  const [saving, setSaving] = useState(false);
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const [projectsRes, usersRes, taskRes] = await Promise.all([
        supabase.from("projects").select("id, name").is("archived_at", null).order("name"),
        supabase.from("users").select("id, full_name, email").eq("active", true).order("full_name"),
        isCreate
          ? Promise.resolve({ data: null })
          : supabase
              .from("tasks")
              .select(
                "id, title, status, priority, due_date, project_id, assignee_id, blocked_by",
              )
              .eq("id", id)
              .single(),
      ]);
      if (!active) return;
      setProjects((projectsRes.data ?? []) as ProjectOption[]);
      setUsers((usersRes.data ?? []) as UserOption[]);
      if (!isCreate && taskRes && "data" in taskRes && taskRes.data) {
        type Row = {
          title: string;
          status: TaskStatus;
          priority: TaskPriority;
          due_date: string | null;
          project_id: string | null;
          assignee_id: string | null;
          blocked_by: string[] | null;
        };
        const t = taskRes.data as unknown as Row;
        const next: FormState = {
          title: t.title,
          status: t.status,
          priority: t.priority,
          due_date: t.due_date ?? "",
          project_id: t.project_id,
          assignee_id: t.assignee_id,
          blocked_by: t.blocked_by ?? [],
        };
        setForm(next);
        setInitial(next);
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [id, isCreate]);

  useEffect(() => {
    if (!form.project_id) {
      setSiblingTasks([]);
      return;
    }
    let active = true;
    supabase
      .from("tasks")
      .select("id, title, project_id")
      .eq("project_id", form.project_id)
      .then(({ data }) => {
        if (!active) return;
        setSiblingTasks(((data ?? []) as TaskOption[]).filter((t) => t.id !== id));
      });
    return () => {
      active = false;
    };
  }, [form.project_id, id]);

  const projectOptions: Option[] = useMemo(
    () => projects.map((p) => ({ id: p.id, label: p.name })),
    [projects],
  );
  const userOptions: Option[] = useMemo(
    () => users.map((u) => ({ id: u.id, label: u.full_name ?? u.email })),
    [users],
  );
  const loadProjectOptions = useCallback(
    () => Promise.resolve(projectOptions),
    [projectOptions],
  );
  const loadUserOptions = useCallback(
    () => Promise.resolve(userOptions),
    [userOptions],
  );
  const siblingTaskOptions: Option[] = useMemo(
    () => siblingTasks.map((t) => ({ id: t.id, label: t.title || "Untitled task" })),
    [siblingTasks],
  );
  const loadSiblingTaskOptions = useCallback(
    () => Promise.resolve(siblingTaskOptions),
    [siblingTaskOptions],
  );

  const dirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(initial),
    [form, initial],
  );

  const onCancel = () => {
    if (!dirty) {
      navigate(isCreate ? "/tasks" : `/tasks/${id}`);
      return;
    }
    setConfirmLeaveOpen(true);
  };

  const onSave = async () => {
    if (!form.title.trim()) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }
    if (!user?.id) return;
    setSaving(true);
    const payload = {
      title: form.title,
      status: form.status,
      priority: form.priority,
      due_date: form.due_date || null,
      project_id: form.project_id,
      assignee_id: form.assignee_id,
      blocked_by: form.blocked_by,
    };
    if (isCreate) {
      const { data, error } = await supabase
        .from("tasks")
        .insert({ ...payload, created_by: user.id })
        .select("id")
        .single();
      setSaving(false);
      if (error) {
        toast({ title: "Save failed", description: error.message, variant: "destructive" });
        return;
      }
      toast({ title: "Task created" });
      navigate(`/tasks/${data.id}`);
    } else {
      const { error } = await supabase.from("tasks").update(payload).eq("id", id);
      setSaving(false);
      if (error) {
        toast({ title: "Save failed", description: error.message, variant: "destructive" });
        return;
      }
      setInitial(form);
      toast({ title: "Saved" });
    }
  };

  // Phase 5.7.4 § 4.F: hard delete. No FKs reference tasks; `blocked_by`
  // is a uuid[] on sibling tasks with no FK, so deleted ids orphan
  // cosmetically. Notes_log rows are polymorphic and survive the delete.
  const handleDelete = async () => {
    if (!id) return;
    setDeleting(true);
    const { error } = await supabase.from("tasks").delete().eq("id", id);
    if (error) {
      setDeleting(false);
      setConfirmDeleteOpen(false);
      toast({
        title: "Could not delete task",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    toast({ title: "Deleted task" });
    navigate("/tasks");
  };

  if (loading) {
    return (
      <div className="empty">
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="stack-4 hq-form" style={{ paddingBottom: 120, maxWidth: 880, marginLeft: "auto", marginRight: "auto" }}>
      <div className="pagehead">
        <h1 className="h-page">{isCreate ? "New Task" : "Edit Task"}</h1>
      </div>

      <section className="card">
        <div className="card-headbar">
          <span className="h-card">Details</span>
        </div>
        <div className="card-pad stack-4">
          <HQFormField label="Title" required>
            <input
              className={`input ${form.title ? "input--filled" : ""}`}
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
          </HQFormField>
          <div style={{ borderTop: "1px solid hsl(var(--border))" }} />
          <div className="g2">
            <HQFormField label="Project">
              <RecordCombobox
                source={{ kind: "record", loadOptions: loadProjectOptions }}
                value={form.project_id}
                onChange={(next) =>
                  setForm((f) => ({ ...f, project_id: next }))
                }
                entityLabel="Project"
                placeholder="Standalone"
              />
            </HQFormField>
            <HQFormField label="Assignee">
              <RecordCombobox
                source={{ kind: "record", loadOptions: loadUserOptions }}
                value={form.assignee_id}
                onChange={(next) =>
                  setForm((f) => ({ ...f, assignee_id: next }))
                }
                entityLabel="user"
                placeholder="Unassigned"
              />
            </HQFormField>
          </div>
          <div style={{ borderTop: "1px solid hsl(var(--border))" }} />
          <div className="g2">
            <HQFormField label="Status">
              <select
                className="input input--filled"
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as TaskStatus }))}
              >
                {TASK_STATUS_VALUES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </HQFormField>
            <HQFormField label="Priority">
              <select
                className="input input--filled"
                value={form.priority}
                onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as TaskPriority }))}
              >
                {TASK_PRIORITY_VALUES.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </HQFormField>
          </div>
          <div style={{ borderTop: "1px solid hsl(var(--border))" }} />
          <HQFormField label="Due date">
            <input
              type="date"
              className={`input ${form.due_date ? "input--filled" : ""}`}
              value={form.due_date}
              onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))}
            />
          </HQFormField>
          {siblingTasks.length > 0 ? (
            <>
              <div style={{ borderTop: "1px solid hsl(var(--border))" }} />
              <HQFormField label="Blocked by">
                <RecordCombobox
                  multi
                  source={{ kind: "record", loadOptions: loadSiblingTaskOptions }}
                  multiValue={form.blocked_by}
                  onMultiChange={(next) => setForm((f) => ({ ...f, blocked_by: next }))}
                  entityLabel="task"
                  placeholder="Add blocker..."
                />
              </HQFormField>
            </>
          ) : null}
        </div>
      </section>

      <StickySaveBar
        dirty={dirty}
        saving={saving}
        onCancel={onCancel}
        onSave={onSave}
        saveLabel={isCreate ? "Create task" : "Save changes"}
        onDelete={isCreate ? undefined : () => setConfirmDeleteOpen(true)}
        deleting={deleting}
      />

      <AlertDialog open={confirmLeaveOpen} onOpenChange={setConfirmLeaveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              You have edits that haven't been saved. Leaving will lose them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Stay</AlertDialogCancel>
            <AlertDialogAction onClick={() => navigate(isCreate ? "/tasks" : `/tasks/${id}`)}>
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this task?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. The task and its notes will be removed
              permanently.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleDelete();
              }}
              disabled={deleting}
              style={{ background: "hsl(var(--destructive))" }}
            >
              {deleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
