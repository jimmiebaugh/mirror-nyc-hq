import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { StickySaveBar } from "@/components/data/StickySaveBar";
import { IconArrowLeft } from "@/components/icons/HQIcons";
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
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";

type FormState = {
  title: string;
  type: string;
  status: DeliverableStatus;
  due_date: string;
  project_id: string | null;
  assigned_user_ids: string[];
};

const EMPTY: FormState = {
  title: "",
  type: "",
  status: "Upcoming",
  due_date: "",
  project_id: null,
  assigned_user_ids: [],
};

type ProjectOption = { id: string; name: string };
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

  useEffect(() => {
    let active = true;
    (async () => {
      const [projectsRes, usersRes, deliverableRes] = await Promise.all([
        supabase.from("projects").select("id, name").is("archived_at", null).order("name"),
        supabase.from("users").select("id, full_name, email").eq("active", true).order("full_name"),
        isCreate
          ? Promise.resolve({ data: null })
          : supabase
              .from("deliverables")
              .select("id, title, type, status, due_date, project_id, assigned_user_ids")
              .eq("id", id)
              .single(),
      ]);
      if (!active) return;
      setProjects((projectsRes.data ?? []) as ProjectOption[]);
      setUsers((usersRes.data ?? []) as UserOption[]);
      if (!isCreate && deliverableRes && "data" in deliverableRes && deliverableRes.data) {
        type Row = {
          title: string;
          type: string | null;
          status: DeliverableStatus;
          due_date: string | null;
          project_id: string | null;
          assigned_user_ids: string[] | null;
        };
        const d = deliverableRes.data as unknown as Row;
        const next: FormState = {
          title: d.title,
          type: d.type ?? "",
          status: d.status,
          due_date: d.due_date ?? "",
          project_id: d.project_id,
          assigned_user_ids: d.assigned_user_ids ?? [],
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

  const projectOptions: Option[] = useMemo(
    () => projects.map((p) => ({ id: p.id, label: p.name })),
    [projects],
  );
  const loadProjectOptions = useCallback(
    () => Promise.resolve(projectOptions),
    [projectOptions],
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
      type: form.type || null,
      status: form.status,
      due_date: form.due_date || null,
      project_id: form.project_id,
      assigned_user_ids: form.assigned_user_ids,
    };
    if (isCreate) {
      const { data, error } = await supabase
        .from("deliverables")
        .insert({ ...payload, created_by: user.id })
        .select("id")
        .single();
      setSaving(false);
      if (error) {
        toast({ title: "Save failed", description: error.message, variant: "destructive" });
        return;
      }
      toast({ title: "Deliverable created" });
      navigate(`/deliverables/${data.id}`);
    } else {
      const { error } = await supabase.from("deliverables").update(payload).eq("id", id);
      setSaving(false);
      if (error) {
        toast({ title: "Save failed", description: error.message, variant: "destructive" });
        return;
      }
      setInitial(form);
      toast({ title: "Saved" });
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
    <div className="stack-4" style={{ paddingBottom: 120, maxWidth: 760 }}>
      <Link
        to={isCreate ? "/deliverables" : `/deliverables/${id}`}
        className="tlink"
        onClick={(e) => {
          if (dirty) {
            e.preventDefault();
            setConfirmLeaveOpen(true);
          }
        }}
      >
        <IconArrowLeft className="ic" />
        Back to {isCreate ? "Deliverables" : "deliverable"}
      </Link>

      <div className="pagehead">
        <h1 className="h-page">{isCreate ? "New Deliverable" : "Edit Deliverable"}</h1>
      </div>

      <section className="card">
        <div className="card-pad stack-4">
          <div className="block-lbl">
            <span className="label-section">Deliverable</span>
          </div>
          <Field label="Title" required>
            <input
              className={`input ${form.title ? "input--filled" : ""}`}
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
          </Field>
          <Field label="Type">
            <input
              className={`input ${form.type ? "input--filled" : ""}`}
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
              placeholder="Kickoff, Venue Recon, Design Round, Client Approval, Install..."
            />
          </Field>
          <div className="g2">
            <Field label="Status">
              <select
                className="input input--filled"
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as DeliverableStatus }))}
              >
                {DELIVERABLE_STATUS_VALUES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </Field>
            <Field label="Due date">
              <input
                type="date"
                className={`input ${form.due_date ? "input--filled" : ""}`}
                value={form.due_date}
                onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))}
              />
            </Field>
            <Field label="Project" required>
              <RecordCombobox
                source={{ kind: "record", loadOptions: loadProjectOptions }}
                value={form.project_id}
                onChange={(next) => setForm((f) => ({ ...f, project_id: next }))}
                entityLabel="Project"
                placeholder="Choose a project"
              />
            </Field>
          </div>
          <Field label="Assignees">
            <div
              className="stack-2"
              style={{
                maxHeight: 180,
                overflowY: "auto",
                border: "1px solid hsl(var(--border))",
                borderRadius: "var(--radius)",
                padding: 8,
              }}
            >
              {users.map((u) => {
                const checked = form.assigned_user_ids.includes(u.id);
                return (
                  <label
                    key={u.id}
                    className="row-c"
                    style={{ fontSize: 13, cursor: "pointer" }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          assigned_user_ids: e.target.checked
                            ? [...f.assigned_user_ids, u.id]
                            : f.assigned_user_ids.filter((uid) => uid !== u.id),
                        }))
                      }
                    />
                    {u.full_name ?? u.email}
                  </label>
                );
              })}
            </div>
          </Field>
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

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="field">
      <label className="label-form">
        {label}
        {required ? <span className="req">*</span> : null}
      </label>
      {children}
    </div>
  );
}
