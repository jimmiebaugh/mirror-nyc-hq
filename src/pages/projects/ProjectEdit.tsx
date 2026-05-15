import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
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
import { PROJECT_STATUS_VALUES, type ProjectStatus } from "@/lib/projects/queries";
import { toast } from "@/hooks/use-toast";

type FormState = {
  name: string;
  status: ProjectStatus;
  clientId: string | null;
  liveDatesStart: string;
  liveDatesEnd: string;
  productionFolderUrl: string;
  designDecksFolderUrl: string;
  budgetSheetUrl: string;
  slackChannelUrl: string;
  notes: string;
};

const EMPTY: FormState = {
  name: "",
  status: "Queued",
  clientId: null,
  liveDatesStart: "",
  liveDatesEnd: "",
  productionFolderUrl: "",
  designDecksFolderUrl: "",
  budgetSheetUrl: "",
  slackChannelUrl: "",
  notes: "",
};

type ClientOption = { id: string; name: string | null };

export default function ProjectEdit() {
  const { id } = useParams<{ id?: string }>();
  const isCreate = !id;
  const navigate = useNavigate();
  const [initial, setInitial] = useState<FormState>(EMPTY);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [loading, setLoading] = useState(!isCreate);
  const [saving, setSaving] = useState(false);
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);
  const [confirmStatusOpen, setConfirmStatusOpen] = useState<{ next: ProjectStatus } | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const [clientsRes, projectRes] = await Promise.all([
        supabase.from("clients").select("id, name").order("name", { ascending: true }),
        isCreate
          ? Promise.resolve({ data: null, error: null })
          : supabase
              .from("projects")
              .select(
                "id, name, status, client_id, live_dates_start, live_dates_end, production_folder_url, design_decks_folder_url, budget_sheet_url, slack_channel_url, notes",
              )
              .eq("id", id)
              .single(),
      ]);
      if (!active) return;
      setClients((clientsRes.data ?? []) as ClientOption[]);
      if (!isCreate && projectRes && "data" in projectRes && projectRes.data) {
        type Row = {
          name: string;
          status: ProjectStatus;
          client_id: string | null;
          live_dates_start: string | null;
          live_dates_end: string | null;
          production_folder_url: string | null;
          design_decks_folder_url: string | null;
          budget_sheet_url: string | null;
          slack_channel_url: string | null;
          notes: string | null;
        };
        const p = projectRes.data as unknown as Row;
        const next: FormState = {
          name: p.name,
          status: p.status,
          clientId: p.client_id,
          liveDatesStart: p.live_dates_start ?? "",
          liveDatesEnd: p.live_dates_end ?? "",
          productionFolderUrl: p.production_folder_url ?? "",
          designDecksFolderUrl: p.design_decks_folder_url ?? "",
          budgetSheetUrl: p.budget_sheet_url ?? "",
          slackChannelUrl: p.slack_channel_url ?? "",
          notes: p.notes ?? "",
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

  const onStatusChange = (next: ProjectStatus) => {
    if (next === "Cancelled" || next === "Complete") {
      setConfirmStatusOpen({ next });
      return;
    }
    setForm((f) => ({ ...f, status: next }));
  };

  const confirmStatus = () => {
    if (confirmStatusOpen) {
      setForm((f) => ({ ...f, status: confirmStatusOpen.next }));
    }
    setConfirmStatusOpen(null);
  };

  const onCancel = () => {
    if (!dirty) {
      navigate(isCreate ? "/projects" : `/projects/${id}`);
      return;
    }
    setConfirmLeaveOpen(true);
  };

  const onSave = async () => {
    if (!form.name.trim()) {
      toast({ title: "Project name is required", variant: "destructive" });
      return;
    }
    setSaving(true);
    const payload = {
      name: form.name,
      status: form.status,
      client_id: form.clientId,
      live_dates_start: form.liveDatesStart || null,
      live_dates_end: form.liveDatesEnd || null,
      production_folder_url: form.productionFolderUrl || null,
      design_decks_folder_url: form.designDecksFolderUrl || null,
      budget_sheet_url: form.budgetSheetUrl || null,
      slack_channel_url: form.slackChannelUrl || null,
      notes: form.notes || null,
    };
    if (isCreate) {
      const { data: userRes } = await supabase.auth.getUser();
      const created_by = userRes.user?.id;
      const { data, error } = await supabase
        .from("projects")
        .insert({ ...payload, created_by })
        .select("id")
        .single();
      setSaving(false);
      if (error) {
        toast({ title: "Save failed", description: error.message, variant: "destructive" });
        return;
      }
      toast({ title: "Project created" });
      navigate(`/projects/${data.id}`);
    } else {
      const { error } = await supabase.from("projects").update(payload).eq("id", id);
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
    <div className="mx-auto max-w-7xl pb-24">
      <header className="space-y-2">
        <Link
          to={isCreate ? "/projects" : `/projects/${id}`}
          className="crumb"
          onClick={(e) => {
            if (dirty) {
              e.preventDefault();
              setConfirmLeaveOpen(true);
            }
          }}
        >
          ← Back to {isCreate ? "Projects" : "project"}
        </Link>
        <h1 className="h-page">{isCreate ? "New Project" : "Edit Project"}</h1>
      </header>

      <div className="mt-6 space-y-6">
        <Card title="Details">
          <div className="grid grid-cols-2 gap-6">
            <Field label="Project" required>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Untitled"
              />
            </Field>
            <Field label="Client">
              <Select
                value={form.clientId ?? "__none"}
                onValueChange={(v) => setForm((f) => ({ ...f, clientId: v === "__none" ? null : v }))}
              >
                <SelectTrigger><SelectValue placeholder="No client" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">No client</SelectItem>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name ?? "Untitled"}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Status">
              <Select
                value={form.status}
                onValueChange={(v) => onStatusChange(v as ProjectStatus)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PROJECT_STATUS_VALUES.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
        </Card>

        <Card title="Event Info">
          <div className="grid grid-cols-2 gap-6">
            <Field label="Live Date (start)">
              <Input
                type="date"
                value={form.liveDatesStart}
                onChange={(e) => setForm((f) => ({ ...f, liveDatesStart: e.target.value }))}
              />
            </Field>
            <Field label="Live Date (end)">
              <Input
                type="date"
                value={form.liveDatesEnd}
                onChange={(e) => setForm((f) => ({ ...f, liveDatesEnd: e.target.value }))}
              />
            </Field>
          </div>
        </Card>

        <Card title="Links & References">
          <div className="grid grid-cols-2 gap-6">
            <Field label="Production Folder URL">
              <Input
                value={form.productionFolderUrl}
                onChange={(e) => setForm((f) => ({ ...f, productionFolderUrl: e.target.value }))}
                placeholder="https://drive.google.com/..."
              />
            </Field>
            <Field label="Design Folder URL">
              <Input
                value={form.designDecksFolderUrl}
                onChange={(e) => setForm((f) => ({ ...f, designDecksFolderUrl: e.target.value }))}
                placeholder="https://drive.google.com/..."
              />
            </Field>
            <Field label="Budget Sheet URL">
              <Input
                value={form.budgetSheetUrl}
                onChange={(e) => setForm((f) => ({ ...f, budgetSheetUrl: e.target.value }))}
                placeholder="https://docs.google.com/spreadsheets/..."
              />
            </Field>
            <Field label="Slack Channel URL">
              <Input
                value={form.slackChannelUrl}
                onChange={(e) => setForm((f) => ({ ...f, slackChannelUrl: e.target.value }))}
                placeholder="https://mirrornyc.slack.com/..."
              />
            </Field>
          </div>
          <div className="mt-6">
            <Field label="Status Notes">
              <Textarea
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                rows={6}
                placeholder="Free-form context for the producer status check-ins."
              />
            </Field>
          </div>
        </Card>
      </div>

      <StickySaveBar
        dirty={dirty}
        saving={saving}
        onCancel={onCancel}
        onSave={onSave}
        saveLabel={isCreate ? "Create project" : "Save changes"}
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
            <AlertDialogAction onClick={() => navigate(isCreate ? "/projects" : `/projects/${id}`)}>
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(confirmStatusOpen)} onOpenChange={(v) => !v && setConfirmStatusOpen(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Move project to {confirmStatusOpen?.next}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmStatusOpen?.next === "Cancelled"
                ? "Cancelled is a terminal state. Active board filters hide it and pipeline counts ignore it. You can flip back later if you change your mind."
                : "Complete is a terminal state. The project drops off active dashboards once you save."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmStatus}>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="hq-card">
      <div className="hq-card-headbar">
        <span className="h-card">{title}</span>
      </div>
      <div className="p-6">{children}</div>
    </section>
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
