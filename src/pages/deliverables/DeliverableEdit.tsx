import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  DELIVERABLE_STATUS_VALUES,
  type DeliverableStatus,
} from "@/lib/deliverables/queries";
import { syncDeliverableAssignees } from "@/lib/deliverables/assigneeSync";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";

type FormState = {
  title: string;
  status: DeliverableStatus;
  due_date: string;
  project_id: string | null;
  assigned_user_ids: string[];
};

const EMPTY: FormState = {
  title: "",
  status: "Upcoming",
  due_date: "",
  project_id: null,
  assigned_user_ids: [],
};

type ProjectOption = { id: string; name: string; client: { id: string; name: string | null } | null };
type UserOption = { id: string; full_name: string | null; email: string };

export default function DeliverableEdit() {
  const { id } = useParams<{ id?: string }>();
  const isCreate = !id;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const projectFromQuery = searchParams.get("project");
  const { user } = useAuth();

  const [initial, setInitial] = useState<FormState>({
    ...EMPTY,
    project_id: projectFromQuery,
  });
  const [form, setForm] = useState<FormState>({
    ...EMPTY,
    project_id: projectFromQuery,
  });
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(!isCreate);
  const [saving, setSaving] = useState(false);
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Phase 5.7.5 § 5.D: snapshot the original assignees on load so onSave
  // can diff against the current form.assigned_user_ids and fire the
  // right auto-task INSERTs / DELETEs.
  const originalAssignedUserIdsRef = useRef<string[]>([]);

  useEffect(() => {
    let active = true;
    (async () => {
      const [projectsRes, usersRes, deliverableRes] = await Promise.all([
        supabase
          .from("projects")
          .select("id, name, client:clients(id, name)")
          .is("archived_at", null)
          .order("name"),
        supabase.from("users").select("id, full_name, email").eq("active", true).order("full_name"),
        isCreate
          ? Promise.resolve({ data: null })
          : supabase
              .from("deliverables")
              .select("id, title, status, due_date, project_id, assigned_user_ids")
              .eq("id", id)
              .single(),
      ]);
      if (!active) return;
      setProjects(((projectsRes.data ?? []) as unknown) as ProjectOption[]);
      setUsers((usersRes.data ?? []) as UserOption[]);
      if (!isCreate && deliverableRes && "data" in deliverableRes && deliverableRes.data) {
        type Row = {
          title: string;
          status: DeliverableStatus;
          due_date: string | null;
          project_id: string | null;
          assigned_user_ids: string[] | null;
        };
        const d = deliverableRes.data as unknown as Row;
        const next: FormState = {
          title: d.title,
          status: d.status,
          due_date: d.due_date ?? "",
          project_id: d.project_id,
          assigned_user_ids: d.assigned_user_ids ?? [],
        };
        setForm(next);
        setInitial(next);
        originalAssignedUserIdsRef.current = d.assigned_user_ids ?? [];
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [id, isCreate]);

  const projectOptions: Option[] = useMemo(
    () => projects.map((p) => ({ id: p.id, label: p.name })),
    [projects],
  );
  const loadProjectOptions = useCallback(
    () => Promise.resolve(projectOptions),
    [projectOptions],
  );
  const userOptions: Option[] = useMemo(
    () => users.map((u) => ({ id: u.id, label: u.full_name ?? u.email })),
    [users],
  );
  const loadUserOptions = useCallback(
    () => Promise.resolve(userOptions),
    [userOptions],
  );

  const dirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(initial),
    [form, initial],
  );

  const onCancel = () => {
    if (!dirty) {
      navigate(isCreate ? "/deliverables" : `/deliverables/${id}`);
      return;
    }
    setConfirmLeaveOpen(true);
  };

  const onSave = async () => {
    if (!form.title.trim()) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }
    if (!form.project_id) {
      toast({ title: "Project is required", variant: "destructive" });
      return;
    }
    if (!user?.id) return;
    setSaving(true);
    const payload = {
      title: form.title,
      status: form.status,
      due_date: form.due_date || null,
      project_id: form.project_id,
      assigned_user_ids: form.assigned_user_ids,
    };
    const pickedProject = projects.find((p) => p.id === form.project_id) ?? null;
    const syncCtxBase = {
      deliverableTitle: form.title,
      dueDate: form.due_date || null,
      projectName: pickedProject?.name ?? null,
      createdBy: user.id,
    };
    if (isCreate) {
      const { data, error } = await supabase
        .from("deliverables")
        .insert({ ...payload, created_by: user.id })
        .select("id")
        .single();
      if (error) {
        setSaving(false);
        toast({ title: "Save failed", description: error.message, variant: "destructive" });
        return;
      }
      // Phase 5.7.5 § 5.D: fire auto-tasks for any initial assignees.
      if (form.assigned_user_ids.length > 0) {
        const { errors } = await syncDeliverableAssignees({
          ctx: { ...syncCtxBase, deliverableId: data.id },
          prevIds: [],
          nextIds: form.assigned_user_ids,
        });
        if (errors.length > 0) {
          console.warn("[DeliverableEdit:create] task lifecycle errors", errors);
        }
      }
      setSaving(false);
      toast({ title: "Deliverable created" });
      navigate(`/deliverables/${data.id}`);
    } else {
      const { error } = await supabase.from("deliverables").update(payload).eq("id", id);
      if (error) {
        setSaving(false);
        toast({ title: "Save failed", description: error.message, variant: "destructive" });
        return;
      }
      // Phase 5.7.5 § 5.D: diff against the original assignees snapshot.
      const { errors } = await syncDeliverableAssignees({
        ctx: { ...syncCtxBase, deliverableId: id! },
        prevIds: originalAssignedUserIdsRef.current,
        nextIds: form.assigned_user_ids,
      });
      if (errors.length > 0) {
        console.warn("[DeliverableEdit:update] task lifecycle errors", errors);
        toast({
          title: "Saved, but some auto-tasks did not sync",
          description: errors[0],
        });
      }
      originalAssignedUserIdsRef.current = form.assigned_user_ids;
      setSaving(false);
      setInitial(form);
      if (errors.length === 0) toast({ title: "Saved" });
    }
  };

  // Phase 5.7.3 § 3.B: hard delete. No FKs reference deliverables, so the
  // delete is clean at the schema layer. Notes_log entries scoped to this
  // deliverable use a polymorphic (parent_type, parent_id) pair with no FK;
  // those rows orphan and can be swept in a future cleanup pass.
  const handleDelete = async () => {
    if (!id) return;
    setDeleting(true);
    const { error } = await supabase.from("deliverables").delete().eq("id", id);
    if (error) {
      setDeleting(false);
      setConfirmDeleteOpen(false);
      toast({
        title: "Could not delete deliverable",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    toast({ title: "Deleted deliverable" });
    navigate("/deliverables");
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
        <h1 className="h-page">{isCreate ? "New Deliverable" : "Edit Deliverable"}</h1>
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
              placeholder="Venues Deck, Design R1 Deck..."
            />
          </HQFormField>
          <div style={{ borderTop: "1px solid hsl(var(--border))" }} />
          <div className="g2">
            <HQFormField label="Status">
              <select
                className="input input--filled"
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as DeliverableStatus }))}
              >
                {DELIVERABLE_STATUS_VALUES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </HQFormField>
            <HQFormField label="Due date">
              <input
                type="date"
                className={`input ${form.due_date ? "input--filled" : ""}`}
                value={form.due_date}
                onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))}
              />
            </HQFormField>
          </div>
          <div style={{ borderTop: "1px solid hsl(var(--border))" }} />
          <div className="g2">
            <HQFormField label="Project" required>
              <RecordCombobox
                source={{ kind: "record", loadOptions: loadProjectOptions }}
                value={form.project_id}
                onChange={(next) => setForm((f) => ({ ...f, project_id: next }))}
                entityLabel="Project"
                placeholder="Choose a project"
              />
            </HQFormField>
          </div>
          <div style={{ borderTop: "1px solid hsl(var(--border))" }} />
          <HQFormField label="Assignees">
            <RecordCombobox
              multi
              source={{ kind: "record", loadOptions: loadUserOptions }}
              multiValue={form.assigned_user_ids}
              onMultiChange={(next) =>
                setForm((f) => ({ ...f, assigned_user_ids: next }))
              }
              entityLabel="user"
              placeholder="Add assignee..."
            />
          </HQFormField>
        </div>
      </section>

      <StickySaveBar
        dirty={dirty}
        saving={saving}
        onCancel={onCancel}
        onSave={onSave}
        saveLabel={isCreate ? "Create deliverable" : "Save changes"}
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
            <AlertDialogAction onClick={() => navigate(isCreate ? "/deliverables" : `/deliverables/${id}`)}>
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this deliverable?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. The deliverable and its records will be
              removed permanently.
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
