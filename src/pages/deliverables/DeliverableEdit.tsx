import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
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
  notes: string;
};

const EMPTY: FormState = {
  title: "",
  type: "",
  status: "Upcoming",
  due_date: "",
  project_id: null,
  assigned_user_ids: [],
  notes: "",
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
              .select("id, title, type, status, due_date, project_id, assigned_user_ids, notes")
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
          notes: string | null;
        };
        const d = deliverableRes.data as unknown as Row;
        const next: FormState = {
          title: d.title,
          type: d.type ?? "",
          status: d.status,
          due_date: d.due_date ?? "",
          project_id: d.project_id,
          assigned_user_ids: d.assigned_user_ids ?? [],
          notes: d.notes ?? "",
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
      notes: form.notes || null,
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

  if (loading) return <p className="text-sm text-muted-foreground">Loading...</p>;

  return (
    <div className="mx-auto max-w-3xl pb-24">
      <header className="space-y-2">
        <Link
          to={isCreate ? "/deliverables" : `/deliverables/${id}`}
          className="crumb"
          onClick={(e) => {
            if (dirty) {
              e.preventDefault();
              setConfirmLeaveOpen(true);
            }
          }}
        >
          ← Back to {isCreate ? "Deliverables" : "deliverable"}
        </Link>
        <h1 className="h-page">{isCreate ? "New Deliverable" : "Edit Deliverable"}</h1>
      </header>

      <section className="hq-card mt-6">
        <div className="p-6 space-y-4">
          <Field label="Title" required>
            <Input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
          </Field>
          <Field label="Type">
            <Input
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
              placeholder="Kickoff, Venue Recon, Design Round, Client Approval, Install..."
            />
          </Field>
          <div className="grid grid-cols-2 gap-6">
            <Field label="Status">
              <Select
                value={form.status}
                onValueChange={(v) => setForm((f) => ({ ...f, status: v as DeliverableStatus }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DELIVERABLE_STATUS_VALUES.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
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
            <Field label="Project" required>
              <Select
                value={form.project_id ?? ""}
                onValueChange={(v) => setForm((f) => ({ ...f, project_id: v }))}
              >
                <SelectTrigger><SelectValue placeholder="Choose a project" /></SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="Assignees">
            <div className="space-y-1.5 max-h-44 overflow-y-auto rounded-md border border-[hsl(var(--border))] p-2">
              {users.map((u) => {
                const checked = form.assigned_user_ids.includes(u.id);
                return (
                  <label key={u.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(v) =>
                        setForm((f) => ({
                          ...f,
                          assigned_user_ids: v === true
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
          <Field label="Notes">
            <Textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              rows={5}
            />
          </Field>
        </div>
      </section>

      <StickySaveBar
        dirty={dirty}
        saving={saving}
        onCancel={onCancel}
        onSave={onSave}
        saveLabel={isCreate ? "Create deliverable" : "Save changes"}
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
