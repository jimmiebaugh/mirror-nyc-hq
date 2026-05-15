import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StickySaveBar } from "@/components/data/StickySaveBar";
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
import { Checkbox } from "@/components/ui/checkbox";
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
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string;
  project_id: string | null;
  assignee_id: string | null;
  blocked_by: string[];
};

const EMPTY: FormState = {
  title: "",
  description: "",
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
              .select("id, title, description, status, priority, due_date, project_id, assignee_id, blocked_by")
              .eq("id", id)
              .single(),
      ]);
      if (!active) return;
      setProjects((projectsRes.data ?? []) as ProjectOption[]);
      setUsers((usersRes.data ?? []) as UserOption[]);
      if (!isCreate && taskRes && "data" in taskRes && taskRes.data) {
        type Row = {
          title: string;
          description: string | null;
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
          description: t.description ?? "",
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
      description: form.description || null,
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

  if (loading) return <p className="text-sm text-muted-foreground">Loading...</p>;

  return (
    <div className="mx-auto max-w-3xl pb-24">
      <header className="space-y-2">
        <Link
          to={isCreate ? "/tasks" : `/tasks/${id}`}
          className="crumb"
          onClick={(e) => {
            if (dirty) {
              e.preventDefault();
              setConfirmLeaveOpen(true);
            }
          }}
        >
          ← Back to {isCreate ? "Tasks" : "task"}
        </Link>
        <h1 className="h-page">{isCreate ? "New Task" : "Edit Task"}</h1>
      </header>

      <section className="hq-card mt-6">
        <div className="p-6 space-y-4">
          <Field label="Title" required>
            <Input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
          </Field>
          <Field label="Description">
            <Textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              rows={5}
              placeholder="What needs to happen?"
            />
          </Field>
          <div className="grid grid-cols-2 gap-6">
            <Field label="Project">
              <Select
                value={form.project_id ?? "__none"}
                onValueChange={(v) => setForm((f) => ({ ...f, project_id: v === "__none" ? null : v }))}
              >
                <SelectTrigger><SelectValue placeholder="Standalone" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Standalone</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Assignee">
              <Select
                value={form.assignee_id ?? "__none"}
                onValueChange={(v) => setForm((f) => ({ ...f, assignee_id: v === "__none" ? null : v }))}
              >
                <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Unassigned</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.full_name ?? u.email}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Status">
              <Select
                value={form.status}
                onValueChange={(v) => setForm((f) => ({ ...f, status: v as TaskStatus }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TASK_STATUS_VALUES.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Priority">
              <Select
                value={form.priority}
                onValueChange={(v) => setForm((f) => ({ ...f, priority: v as TaskPriority }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TASK_PRIORITY_VALUES.map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Due date">
              <Input
                type="date"
                value={form.due_date}
                onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))}
              />
            </Field>
          </div>
          {siblingTasks.length > 0 ? (
            <Field label="Blocked by">
              <div className="space-y-1.5 max-h-40 overflow-y-auto rounded-md border border-[hsl(var(--border))] p-2">
                {siblingTasks.map((s) => {
                  const checked = form.blocked_by.includes(s.id);
                  return (
                    <label key={s.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) =>
                          setForm((f) => ({
                            ...f,
                            blocked_by: v === true
                              ? [...f.blocked_by, s.id]
                              : f.blocked_by.filter((bid) => bid !== s.id),
                          }))
                        }
                      />
                      {s.title}
                    </label>
                  );
                })}
              </div>
            </Field>
          ) : null}
        </div>
      </section>

      <StickySaveBar
        dirty={dirty}
        saving={saving}
        onCancel={onCancel}
        onSave={onSave}
        saveLabel={isCreate ? "Create task" : "Save changes"}
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
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="text-[12px] font-mono font-bold uppercase tracking-wider text-primary">
        {label}
        {required ? <span className="ml-1 text-primary">*</span> : null}
      </Label>
      {children}
    </div>
  );
}
