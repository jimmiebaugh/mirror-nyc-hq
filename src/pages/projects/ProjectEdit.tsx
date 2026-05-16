import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { StickySaveBar } from "@/components/data/StickySaveBar";
import { RecordCombobox } from "@/components/ui/RecordCombobox";
import { IconArrowLeft } from "@/components/icons/HQIcons";
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

/**
 * Surface 08 Project Edit. Wireframe-fidelity rebuild (Phase 5.2.1
 * Revision); renders the structure at OUTPUTS/phase-5-hq-wireframe-v1-
 * LOCKED.html lines 1487-1583.
 *
 *   crumb -> eyebrow "Job #..." -> h-page "Edit Project"
 *   4 .card .card-pad blocks: Details / Team / Event Info / Links &
 *   References. Each card opens with .block-lbl. Each .field has a
 *   .label-form + .input (with .input--filled on populated fields).
 *   .savebar at the bottom.
 *
 * Team card (Phase 5.6.1 catch-up): Account Managers + Designers are
 * multi RecordCombobox pickers sourced from `users` (active=true). Save
 * diffs against the initial set and INSERTs/DELETEs join rows on
 * `project_account_managers` / `project_designers`, same pattern
 * VenueEdit uses for `venue_venue_types`. There is no role distinction
 * inside each picker; the schema only carries the two arrays.
 */

type FormState = {
  name: string;
  status: ProjectStatus;
  clientId: string | null;
  jobNumber: string;
  category: string;
  city: string;
  budget: string;
  tags: string;
  installDatesStart: string;
  installDatesEnd: string;
  liveDatesStart: string;
  liveDatesEnd: string;
  removalDatesStart: string;
  removalDatesEnd: string;
  productionFolderUrl: string;
  designDecksFolderUrl: string;
  budgetSheetUrl: string;
  slackChannelUrl: string;
  statusNotes: string;
  clientNotes: string;
};

const EMPTY: FormState = {
  name: "",
  status: "Queued",
  clientId: null,
  jobNumber: "",
  category: "",
  city: "",
  budget: "",
  tags: "",
  installDatesStart: "",
  installDatesEnd: "",
  liveDatesStart: "",
  liveDatesEnd: "",
  removalDatesStart: "",
  removalDatesEnd: "",
  productionFolderUrl: "",
  designDecksFolderUrl: "",
  budgetSheetUrl: "",
  slackChannelUrl: "",
  statusNotes: "",
  clientNotes: "",
};

type ClientOption = { id: string; name: string | null };

export default function ProjectEdit() {
  const { id } = useParams<{ id?: string }>();
  const isCreate = !id;
  const navigate = useNavigate();
  const [initial, setInitial] = useState<FormState>(EMPTY);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [clientLabels, setClientLabels] = useState<Map<string, string>>(new Map());
  const [accountManagerIds, setAccountManagerIds] = useState<string[]>([]);
  const [initialAccountManagerIds, setInitialAccountManagerIds] = useState<string[]>([]);
  const [designerIds, setDesignerIds] = useState<string[]>([]);
  const [initialDesignerIds, setInitialDesignerIds] = useState<string[]>([]);
  const [vendorIds, setVendorIds] = useState<string[]>([]);
  const [initialVendorIds, setInitialVendorIds] = useState<string[]>([]);
  const [userOptions, setUserOptions] = useState<{ id: string; label: string }[]>([]);
  const [vendorOptions, setVendorOptions] = useState<{ id: string; label: string }[]>([]);
  const [vendorCategoryOptions, setVendorCategoryOptions] = useState<
    { id: string; label: string }[]
  >([]);
  const [loading, setLoading] = useState(!isCreate);
  const [saving, setSaving] = useState(false);
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);
  const [confirmStatusOpen, setConfirmStatusOpen] = useState<{ next: ProjectStatus } | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const [
        clientsRes,
        usersRes,
        vendorsRes,
        vendorCategoriesRes,
        projectRes,
        amRes,
        dsRes,
        pvRes,
      ] = await Promise.all([
        supabase
          .from("clients")
          .select("id, name")
          .order("name", { ascending: true }),
        supabase
          .from("users")
          .select("id, full_name, email")
          .eq("active", true)
          .order("full_name", { ascending: true }),
        supabase
          .from("vendors")
          .select("id, name")
          .order("name", { ascending: true }),
        supabase
          .from("vendor_categories")
          .select("id, name")
          .order("name", { ascending: true }),
        isCreate
          ? Promise.resolve({ data: null, error: null })
          : supabase
              .from("projects")
              .select(
                "id, name, status, client_id, job_number, category, city, budget, tags, install_dates_start, install_dates_end, live_dates_start, live_dates_end, removal_dates_start, removal_dates_end, production_folder_url, design_decks_folder_url, budget_sheet_url, slack_channel_url, status_notes, client_notes",
              )
              .eq("id", id)
              .single(),
        isCreate
          ? Promise.resolve({ data: [] as { user_id: string }[] })
          : supabase
              .from("project_account_managers")
              .select("user_id")
              .eq("project_id", id),
        isCreate
          ? Promise.resolve({ data: [] as { user_id: string }[] })
          : supabase
              .from("project_designers")
              .select("user_id")
              .eq("project_id", id),
        isCreate
          ? Promise.resolve({ data: [] as { vendor_id: string }[] })
          : supabase
              .from("project_vendors")
              .select("vendor_id")
              .eq("project_id", id),
      ]);
      if (!active) return;
      const labels = new Map<string, string>();
      for (const c of (clientsRes.data ?? []) as ClientOption[]) {
        labels.set(c.id, c.name ?? "Untitled");
      }
      setClientLabels(labels);
      type UserRow = { id: string; full_name: string | null; email: string };
      setUserOptions(
        ((usersRes.data ?? []) as UserRow[]).map((u) => ({
          id: u.id,
          label: u.full_name?.trim() || u.email,
        })),
      );
      type VendorRow = { id: string; name: string | null };
      setVendorOptions(
        ((vendorsRes.data ?? []) as VendorRow[]).map((v) => ({
          id: v.id,
          label: v.name ?? "Untitled",
        })),
      );
      type CategoryRow = { id: string; name: string | null };
      setVendorCategoryOptions(
        ((vendorCategoriesRes.data ?? []) as CategoryRow[]).map((c) => ({
          id: c.id,
          label: c.name ?? "Untitled",
        })),
      );
      const amIds = ((amRes.data ?? []) as { user_id: string }[]).map((r) => r.user_id);
      const dsIds = ((dsRes.data ?? []) as { user_id: string }[]).map((r) => r.user_id);
      const pvIds = ((pvRes.data ?? []) as { vendor_id: string }[]).map((r) => r.vendor_id);
      setAccountManagerIds(amIds);
      setInitialAccountManagerIds(amIds);
      setDesignerIds(dsIds);
      setInitialDesignerIds(dsIds);
      setVendorIds(pvIds);
      setInitialVendorIds(pvIds);
      if (!isCreate && projectRes && "data" in projectRes && projectRes.data) {
        type Row = {
          name: string;
          status: ProjectStatus;
          client_id: string | null;
          job_number: string | null;
          category: string | null;
          city: string | null;
          budget: number | null;
          tags: string[] | null;
          install_dates_start: string | null;
          install_dates_end: string | null;
          live_dates_start: string | null;
          live_dates_end: string | null;
          removal_dates_start: string | null;
          removal_dates_end: string | null;
          production_folder_url: string | null;
          design_decks_folder_url: string | null;
          budget_sheet_url: string | null;
          slack_channel_url: string | null;
          status_notes: string | null;
          client_notes: string | null;
        };
        const p = projectRes.data as unknown as Row;
        const next: FormState = {
          name: p.name,
          status: p.status,
          clientId: p.client_id,
          jobNumber: p.job_number ?? "",
          category: p.category ?? "",
          city: p.city ?? "",
          budget: p.budget != null ? String(p.budget) : "",
          tags: (p.tags ?? []).join(", "),
          installDatesStart: p.install_dates_start ?? "",
          installDatesEnd: p.install_dates_end ?? "",
          liveDatesStart: p.live_dates_start ?? "",
          liveDatesEnd: p.live_dates_end ?? "",
          removalDatesStart: p.removal_dates_start ?? "",
          removalDatesEnd: p.removal_dates_end ?? "",
          productionFolderUrl: p.production_folder_url ?? "",
          designDecksFolderUrl: p.design_decks_folder_url ?? "",
          budgetSheetUrl: p.budget_sheet_url ?? "",
          slackChannelUrl: p.slack_channel_url ?? "",
          statusNotes: p.status_notes ?? "",
          clientNotes: p.client_notes ?? "",
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
    () =>
      JSON.stringify(form) !== JSON.stringify(initial) ||
      JSON.stringify([...accountManagerIds].sort()) !==
        JSON.stringify([...initialAccountManagerIds].sort()) ||
      JSON.stringify([...designerIds].sort()) !==
        JSON.stringify([...initialDesignerIds].sort()) ||
      JSON.stringify([...vendorIds].sort()) !==
        JSON.stringify([...initialVendorIds].sort()),
    [
      form,
      initial,
      accountManagerIds,
      initialAccountManagerIds,
      designerIds,
      initialDesignerIds,
      vendorIds,
      initialVendorIds,
    ],
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

  // Client list cached on the page; RecordCombobox loadOptions returns the
  // pre-fetched array so the trigger renders the selected name immediately
  // (avoids a UUID flash on edit-mode mount).
  const clientOptions = useMemo(
    () =>
      Array.from(clientLabels.entries()).map(([id, label]) => ({ id, label })),
    [clientLabels],
  );
  const loadClientOptions = useCallback(
    async () => clientOptions,
    [clientOptions],
  );

  const loadUserOptions = useCallback(async () => userOptions, [userOptions]);

  const loadVendorOptions = useCallback(async () => vendorOptions, [vendorOptions]);

  const handleCreateVendor = useCallback(
    async (data: Record<string, string>) => {
      const { data: userRes } = await supabase.auth.getUser();
      const created_by = userRes.user?.id;
      if (!created_by) {
        toast({ title: "Not signed in", variant: "destructive" });
        return null;
      }
      const payload = {
        name: data.name,
        category_id: data.category_id || null,
        created_by,
      };
      const { data: row, error } = await supabase
        .from("vendors")
        .insert(payload)
        .select("id, name")
        .single();
      if (error || !row) {
        toast({ title: "Create failed", description: error?.message, variant: "destructive" });
        return null;
      }
      const created = { id: row.id, label: row.name ?? "Untitled" };
      setVendorOptions((prev) =>
        [...prev, created].sort((a, b) => a.label.localeCompare(b.label)),
      );
      return created;
    },
    [],
  );

  const handleCreateClient = useCallback(
    async (data: Record<string, string>) => {
      const { data: userRes } = await supabase.auth.getUser();
      const created_by = userRes.user?.id;
      if (!created_by) {
        toast({ title: "Not signed in", variant: "destructive" });
        return null;
      }
      const payload = {
        name: data.name,
        industry: data.industry || null,
        created_by,
      };
      const { data: row, error } = await supabase
        .from("clients")
        .insert(payload)
        .select("id, name")
        .single();
      if (error || !row) {
        toast({ title: "Create failed", description: error?.message, variant: "destructive" });
        return null;
      }
      const created = { id: row.id, label: row.name ?? "Untitled" };
      setClientLabels((prev) => {
        const next = new Map(prev);
        next.set(created.id, created.label);
        return next;
      });
      return created;
    },
    [],
  );

  const onSave = async () => {
    if (!form.name.trim()) {
      toast({ title: "Project name is required", variant: "destructive" });
      return;
    }
    const parsedBudget = form.budget.trim() ? Number(form.budget.replace(/[$,\s]/g, "")) : null;
    if (form.budget.trim() && (parsedBudget == null || Number.isNaN(parsedBudget))) {
      toast({ title: "Budget must be a number", variant: "destructive" });
      return;
    }
    setSaving(true);
    const payload = {
      name: form.name,
      status: form.status,
      client_id: form.clientId,
      job_number: form.jobNumber || null,
      category: form.category || null,
      city: form.city || null,
      budget: parsedBudget,
      tags: form.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      install_dates_start: form.installDatesStart || null,
      install_dates_end: form.installDatesEnd || null,
      live_dates_start: form.liveDatesStart || null,
      live_dates_end: form.liveDatesEnd || null,
      removal_dates_start: form.removalDatesStart || null,
      removal_dates_end: form.removalDatesEnd || null,
      production_folder_url: form.productionFolderUrl || null,
      design_decks_folder_url: form.designDecksFolderUrl || null,
      budget_sheet_url: form.budgetSheetUrl || null,
      slack_channel_url: form.slackChannelUrl || null,
      status_notes: form.statusNotes || null,
      client_notes: form.clientNotes || null,
    };
    let projectId = id;
    if (isCreate) {
      const { data: userRes } = await supabase.auth.getUser();
      const created_by = userRes.user?.id;
      const { data, error } = await supabase
        .from("projects")
        .insert({ ...payload, created_by })
        .select("id")
        .single();
      if (error || !data) {
        setSaving(false);
        toast({ title: "Save failed", description: error?.message, variant: "destructive" });
        return;
      }
      projectId = data.id;
    } else {
      const { error } = await supabase.from("projects").update(payload).eq("id", id);
      if (error) {
        setSaving(false);
        toast({ title: "Save failed", description: error.message, variant: "destructive" });
        return;
      }
    }

    if (projectId) {
      const amAdd = accountManagerIds.filter((u) => !initialAccountManagerIds.includes(u));
      const amRemove = initialAccountManagerIds.filter((u) => !accountManagerIds.includes(u));
      for (const userId of amAdd) {
        await supabase
          .from("project_account_managers")
          .insert({ project_id: projectId, user_id: userId });
      }
      for (const userId of amRemove) {
        await supabase
          .from("project_account_managers")
          .delete()
          .eq("project_id", projectId)
          .eq("user_id", userId);
      }
      const dsAdd = designerIds.filter((u) => !initialDesignerIds.includes(u));
      const dsRemove = initialDesignerIds.filter((u) => !designerIds.includes(u));
      for (const userId of dsAdd) {
        await supabase
          .from("project_designers")
          .insert({ project_id: projectId, user_id: userId });
      }
      for (const userId of dsRemove) {
        await supabase
          .from("project_designers")
          .delete()
          .eq("project_id", projectId)
          .eq("user_id", userId);
      }
      const pvAdd = vendorIds.filter((v) => !initialVendorIds.includes(v));
      const pvRemove = initialVendorIds.filter((v) => !vendorIds.includes(v));
      for (const vendorId of pvAdd) {
        await supabase
          .from("project_vendors")
          .insert({ project_id: projectId, vendor_id: vendorId });
      }
      for (const vendorId of pvRemove) {
        await supabase
          .from("project_vendors")
          .delete()
          .eq("project_id", projectId)
          .eq("vendor_id", vendorId);
      }
    }

    setSaving(false);
    setInitial(form);
    setInitialAccountManagerIds(accountManagerIds);
    setInitialDesignerIds(designerIds);
    setInitialVendorIds(vendorIds);
    if (isCreate && projectId) {
      toast({ title: "Project created" });
      navigate(`/projects/${projectId}`);
    } else {
      toast({ title: "Saved" });
    }
  };

  if (loading) {
    return (
      <div className="empty">
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="stack-4" style={{ paddingBottom: 24 }}>
      <Link
        to={isCreate ? "/projects" : `/projects/${id}`}
        className="tlink"
        onClick={(e) => {
          if (dirty) {
            e.preventDefault();
            setConfirmLeaveOpen(true);
          }
        }}
      >
        <IconArrowLeft className="ic" />
        Back to {isCreate ? "Projects" : "project"}
      </Link>

      <div className="pagehead">
        {form.jobNumber ? (
          <div className="label-form">Job #{form.jobNumber}</div>
        ) : null}
        <h1 className="h-page">{isCreate ? "New Project" : "Edit Project"}</h1>
      </div>

      <section className="card">
        <div className="card-pad stack-4">
          <div className="block-lbl">
            <span className="label-section">Details</span>
          </div>
          <div className="g2">
            <FormField label="Project" required>
              <input
                className={`input ${form.name ? "input--filled" : ""}`}
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Untitled"
              />
            </FormField>
            <FormField label="Job #">
              <input
                className={`input ${form.jobNumber ? "input--filled" : ""}`}
                value={form.jobNumber}
                onChange={(e) => setForm((f) => ({ ...f, jobNumber: e.target.value }))}
                placeholder="2604"
              />
            </FormField>
            <FormField label="Client">
              <RecordCombobox
                source={{ kind: "record", loadOptions: loadClientOptions }}
                value={form.clientId}
                onChange={(next) => setForm((f) => ({ ...f, clientId: next }))}
                entityLabel="Client"
                placeholder="No client"
                miniCreateFields={[
                  { key: "name", label: "Name", required: true, placeholder: "Olipop" },
                  { key: "industry", label: "Industry", placeholder: "Beverage" },
                ]}
                onMiniCreate={handleCreateClient}
              />
            </FormField>
            <FormField label="Status">
              <select
                className={`input ${form.status ? "input--filled" : ""}`}
                value={form.status}
                onChange={(e) => onStatusChange(e.target.value as ProjectStatus)}
              >
                {PROJECT_STATUS_VALUES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Category">
              <RecordCombobox
                source={{ kind: "lookup", table: "project_categories" }}
                value={form.category || null}
                onChange={(v) => setForm((f) => ({ ...f, category: v ?? "" }))}
                entityLabel="Category"
              />
            </FormField>
            <FormField label="City">
              <RecordCombobox
                source={{ kind: "lookup", table: "cities" }}
                value={form.city || null}
                onChange={(v) => setForm((f) => ({ ...f, city: v ?? "" }))}
                entityLabel="city"
              />
            </FormField>
            <FormField label="Budget">
              <input
                className={`input ${form.budget ? "input--filled" : ""}`}
                value={form.budget}
                onChange={(e) => setForm((f) => ({ ...f, budget: e.target.value }))}
                placeholder="$185,000"
              />
            </FormField>
            <FormField label="Tags">
              <input
                className={`input ${form.tags ? "input--filled" : ""}`}
                value={form.tags}
                onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
                placeholder="Summer 2026, CPG, Outdoor"
              />
            </FormField>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-pad stack-4">
          <div className="block-lbl">
            <span className="label-section">Team</span>
          </div>
          <div className="g2">
            <FormField label="Account Managers">
              <RecordCombobox
                multi
                source={{ kind: "record", loadOptions: loadUserOptions }}
                multiValue={accountManagerIds}
                onMultiChange={setAccountManagerIds}
                entityLabel="user"
                placeholder="Add account manager..."
              />
            </FormField>
            <FormField label="Designers">
              <RecordCombobox
                multi
                source={{ kind: "record", loadOptions: loadUserOptions }}
                multiValue={designerIds}
                onMultiChange={setDesignerIds}
                entityLabel="user"
                placeholder="Add designer..."
              />
            </FormField>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-pad stack-4">
          <div className="block-lbl">
            <span className="label-section">Project Vendors</span>
          </div>
          <FormField label="Vendors">
            <RecordCombobox
              multi
              source={{ kind: "record", loadOptions: loadVendorOptions }}
              multiValue={vendorIds}
              onMultiChange={setVendorIds}
              entityLabel="Vendor"
              placeholder="Add vendor..."
              miniCreateFields={[
                { key: "name", label: "Name", required: true, placeholder: "Testrite" },
                {
                  key: "category_id",
                  label: "Category",
                  select: {
                    options: vendorCategoryOptions,
                    placeholder: "Select category...",
                  },
                },
              ]}
              onMiniCreate={handleCreateVendor}
            />
          </FormField>
        </div>
      </section>

      <section className="card">
        <div className="card-pad stack-4">
          <div className="block-lbl">
            <span className="label-section">Event Info</span>
          </div>
          <div className="g2">
            <FormField label="Install Date (start)">
              <input
                type="date"
                className={`input ${form.installDatesStart ? "input--filled" : ""}`}
                value={form.installDatesStart}
                onChange={(e) => setForm((f) => ({ ...f, installDatesStart: e.target.value }))}
              />
            </FormField>
            <FormField label="Install Date (end)">
              <input
                type="date"
                className={`input ${form.installDatesEnd ? "input--filled" : ""}`}
                value={form.installDatesEnd}
                onChange={(e) => setForm((f) => ({ ...f, installDatesEnd: e.target.value }))}
              />
            </FormField>
            <FormField label="Live Date (start)">
              <input
                type="date"
                className={`input ${form.liveDatesStart ? "input--filled" : ""}`}
                value={form.liveDatesStart}
                onChange={(e) => setForm((f) => ({ ...f, liveDatesStart: e.target.value }))}
              />
            </FormField>
            <FormField label="Live Date (end)">
              <input
                type="date"
                className={`input ${form.liveDatesEnd ? "input--filled" : ""}`}
                value={form.liveDatesEnd}
                onChange={(e) => setForm((f) => ({ ...f, liveDatesEnd: e.target.value }))}
              />
            </FormField>
            <FormField label="Removal Date (start)">
              <input
                type="date"
                className={`input ${form.removalDatesStart ? "input--filled" : ""}`}
                value={form.removalDatesStart}
                onChange={(e) => setForm((f) => ({ ...f, removalDatesStart: e.target.value }))}
              />
            </FormField>
            <FormField label="Removal Date (end)">
              <input
                type="date"
                className={`input ${form.removalDatesEnd ? "input--filled" : ""}`}
                value={form.removalDatesEnd}
                onChange={(e) => setForm((f) => ({ ...f, removalDatesEnd: e.target.value }))}
              />
            </FormField>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-pad stack-4">
          <div className="block-lbl">
            <span className="label-section">Links &amp; References</span>
          </div>
          <div className="g2">
            <FormField label="Production Folder URL">
              <input
                className={`input ${form.productionFolderUrl ? "input--filled" : ""}`}
                value={form.productionFolderUrl}
                onChange={(e) => setForm((f) => ({ ...f, productionFolderUrl: e.target.value }))}
                placeholder="https://drive.google.com/..."
              />
            </FormField>
            <FormField label="Design Folder URL">
              <input
                className={`input ${form.designDecksFolderUrl ? "input--filled" : ""}`}
                value={form.designDecksFolderUrl}
                onChange={(e) => setForm((f) => ({ ...f, designDecksFolderUrl: e.target.value }))}
                placeholder="https://drive.google.com/..."
              />
            </FormField>
            <FormField label="Budget Sheet URL">
              <input
                className={`input ${form.budgetSheetUrl ? "input--filled" : ""}`}
                value={form.budgetSheetUrl}
                onChange={(e) => setForm((f) => ({ ...f, budgetSheetUrl: e.target.value }))}
                placeholder="https://docs.google.com/spreadsheets/..."
              />
            </FormField>
            <FormField label="Slack Channel URL">
              <input
                className={`input ${form.slackChannelUrl ? "input--filled" : ""}`}
                value={form.slackChannelUrl}
                onChange={(e) => setForm((f) => ({ ...f, slackChannelUrl: e.target.value }))}
                placeholder="https://mirrornyc.slack.com/..."
              />
            </FormField>
          </div>
          <FormField label="Status Notes">
            <textarea
              className={`input textarea ${form.statusNotes ? "input--filled" : ""}`}
              value={form.statusNotes}
              onChange={(e) => setForm((f) => ({ ...f, statusNotes: e.target.value }))}
              rows={5}
              placeholder="Free-form context for the producer status check-ins."
            />
          </FormField>
          <FormField label="Client Notes">
            <textarea
              className={`input textarea ${form.clientNotes ? "input--filled" : ""}`}
              value={form.clientNotes}
              onChange={(e) => setForm((f) => ({ ...f, clientNotes: e.target.value }))}
              rows={5}
              placeholder="Client-facing context shared at touchpoints."
            />
          </FormField>
        </div>
      </section>

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
            <AlertDialogTitle>Move project to {confirmStatusOpen?.next}?</AlertDialogTitle>
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

function FormField({
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
