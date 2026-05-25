import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { StickySaveBar } from "@/components/data/StickySaveBar";
import { HQFormField } from "@/components/hq/HQFormField";
import { RecordCombobox } from "@/components/ui/RecordCombobox";
import { IconArrowLeft } from "@/components/icons/HQIcons";
import { VendorFilesEditor } from "@/components/data/VendorFilesEditor";
import { useLookup } from "@/lib/hq/lookups";
import { formatPhone } from "@/lib/hq/phone";
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
import { toast } from "@/hooks/use-toast";

/**
 * Vendor Edit (create + edit).
 *
 * Wireframe binding (DEVIATION): Surface 08 Project Edit pattern
 * (OUTPUTS/phase-5-hq-wireframe-v1-LOCKED.html lines 1487-1583) applied
 * to the Vendor fieldset. Surface 10 was drawn as a unified
 * Organization Edit; per the 2026-05-16 locked decisions split (spec
 * § 0c Q3), this is the Vendors half. Cards: Details (name / category
 * / city / website / capabilities), Primary Contact (name / email /
 * phone / address), and Projects. Capabilities are the visible vendor
 * tag-like set; the raw tags column stays in the database but is no
 * longer exposed here. Wireframe-v2 redraw deferred to a
 * future polish pass; see design-system § 11.
 *
 * 5.2 cleanup: Primary Address textarea added below the contact
 * grid (matches ClientEdit shape; backed by the new
 * `vendors.primary_address` column added in the cleanup migration).
 *
 * Phase 5.7.13: Internal Rating card + form-state plumbing removed.
 * Ratings are now per-user via vendor_ratings; the read-only Team Rating
 * card + the editable "Your rating" row live on VendorDetail.
 */

type FormState = {
  name: string;
  category_id: string;
  subcategory_id: string;
  city: string;
  capabilities: string[];
  website_url: string;
  general_email: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  primary_address: string;
  preferred: boolean;
  nationwide: boolean;
};

const EMPTY: FormState = {
  name: "",
  category_id: "",
  subcategory_id: "",
  city: "",
  capabilities: [],
  website_url: "",
  general_email: "",
  contact_name: "",
  contact_email: "",
  contact_phone: "",
  primary_address: "",
  preferred: false,
  nationwide: false,
};

type ProjectOption = {
  id: string;
  label: string;
};

export default function VendorEdit() {
  const { id } = useParams<{ id?: string }>();
  const isCreate = !id;
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [initial, setInitial] = useState<FormState>(EMPTY);
  const [projectOptions, setProjectOptions] = useState<ProjectOption[]>([]);
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [initialProjectIds, setInitialProjectIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(!isCreate);
  const [saving, setSaving] = useState(false);
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const categories = useLookup("vendor_categories");
  const subcategories = useLookup("vendor_subcategories", {
    parentScopeId: form.category_id || null,
  });

  useEffect(() => {
    let active = true;
    (async () => {
      // Project picker options load on both create + edit so a freshly
      // created vendor can be linked to projects immediately after save.
      // (Edit mode also pulls the existing project_vendors join rows.)
      const [vendorRes, projectsAllRes, joinRes] = await Promise.all([
        isCreate
          ? Promise.resolve({ data: null, error: null })
          : supabase
              .from("vendors")
              .select(
                "name, category_id, subcategory_id, city, capabilities, website_url, general_email, contact_name, contact_email, contact_phone, primary_address, preferred, nationwide",
              )
              .eq("id", id)
              .single(),
        supabase
          .from("projects")
          .select("id, name, job_number")
          .is("archived_at", null)
          .order("name", { ascending: true }),
        isCreate
          ? Promise.resolve({ data: [] as { project_id: string }[] })
          : supabase
              .from("project_vendors")
              .select("project_id")
              .eq("vendor_id", id),
      ]);
      if (!active) return;
      type ProjectRow = { id: string; name: string | null; job_number: string | null };
      setProjectOptions(
        ((projectsAllRes.data ?? []) as ProjectRow[]).map((p) => ({
          id: p.id,
          label: p.job_number ? `#${p.job_number} ${p.name ?? "Untitled"}` : p.name ?? "Untitled",
        })),
      );
      const linkedIds = ((joinRes.data ?? []) as { project_id: string }[]).map(
        (r) => r.project_id,
      );
      setProjectIds(linkedIds);
      setInitialProjectIds(linkedIds);

      if (isCreate || !vendorRes || vendorRes.error || !vendorRes.data) {
        setLoading(false);
        return;
      }
      const row = vendorRes.data as unknown as {
        name: string;
        category_id: string | null;
        subcategory_id: string | null;
        city: string | null;
        capabilities: string[] | null;
        website_url: string | null;
        general_email: string | null;
        contact_name: string | null;
        contact_email: string | null;
        contact_phone: string | null;
        primary_address: string | null;
        preferred: boolean | null;
        nationwide: boolean | null;
      };
      const next: FormState = {
        name: row.name,
        category_id: row.category_id ?? "",
        subcategory_id: row.subcategory_id ?? "",
        city: row.city ?? "",
        capabilities: row.capabilities ?? [],
        website_url: row.website_url ?? "",
        general_email: row.general_email ?? "",
        contact_name: row.contact_name ?? "",
        contact_email: row.contact_email ?? "",
        contact_phone: row.contact_phone ?? "",
        primary_address: row.primary_address ?? "",
        preferred: row.preferred ?? false,
        nationwide: row.nationwide ?? false,
      };
      setForm(next);
      setInitial(next);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [id, isCreate]);

  const dirty = useMemo(
    () =>
      JSON.stringify(form) !== JSON.stringify(initial) ||
      JSON.stringify([...projectIds].sort()) !==
        JSON.stringify([...initialProjectIds].sort()),
    [form, initial, projectIds, initialProjectIds],
  );

  const loadProjectOptions = useCallback(async () => projectOptions, [projectOptions]);

  const onCancel = () => {
    if (!dirty) {
      navigate(isCreate ? "/vendors" : `/vendors/${id}`);
      return;
    }
    setConfirmLeaveOpen(true);
  };

  // Category is an FK; RecordCombobox lookup mode binds to the option name,
  // so translate id <-> name at the prop boundary.
  const selectedCategoryName = useMemo(() => {
    if (!form.category_id) return null;
    return categories.options.find((o) => o.id === form.category_id)?.name ?? null;
  }, [form.category_id, categories.options]);

  const selectedSubcategoryName = useMemo(() => {
    if (!form.subcategory_id) return null;
    return (
      subcategories.options.find((o) => o.id === form.subcategory_id)?.name ?? null
    );
  }, [form.subcategory_id, subcategories.options]);

  const onSave = async () => {
    if (!form.name.trim()) {
      toast({ title: "Vendor name is required", variant: "destructive" });
      return;
    }
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      category_id: form.category_id || null,
      subcategory_id: form.subcategory_id || null,
      city: form.city || null,
      capabilities: form.capabilities,
      website_url: form.website_url || null,
      general_email: form.general_email || null,
      contact_name: form.contact_name || null,
      contact_email: form.contact_email || null,
      contact_phone: form.contact_phone || null,
      primary_address: form.primary_address || null,
      preferred: form.preferred,
      nationwide: form.nationwide,
    };
    let vendorId = id ?? null;
    if (isCreate) {
      const { data: userRes } = await supabase.auth.getUser();
      const created_by = userRes.user?.id;
      if (!created_by) {
        setSaving(false);
        toast({ title: "Not signed in", variant: "destructive" });
        return;
      }
      const { data, error } = await supabase
        .from("vendors")
        .insert({ ...payload, created_by })
        .select("id")
        .single();
      if (error || !data) {
        setSaving(false);
        toast({ title: "Save failed", description: error?.message, variant: "destructive" });
        return;
      }
      vendorId = data.id;
    } else {
      const { error } = await supabase
        .from("vendors")
        .update(payload)
        .eq("id", id);
      if (error) {
        setSaving(false);
        toast({ title: "Save failed", description: error.message, variant: "destructive" });
        return;
      }
    }

    // Diff project_vendors join. Insert added pairs, delete removed pairs.
    if (vendorId) {
      const pvAdd = projectIds.filter((p) => !initialProjectIds.includes(p));
      const pvRemove = initialProjectIds.filter((p) => !projectIds.includes(p));
      for (const projectId of pvAdd) {
        await supabase
          .from("project_vendors")
          .insert({ project_id: projectId, vendor_id: vendorId });
      }
      for (const projectId of pvRemove) {
        await supabase
          .from("project_vendors")
          .delete()
          .eq("project_id", projectId)
          .eq("vendor_id", vendorId);
      }
    }

    setSaving(false);
    if (isCreate && vendorId) {
      toast({ title: "Vendor created" });
      navigate(`/vendors/${vendorId}`);
    } else {
      setInitial(form);
      setInitialProjectIds(projectIds);
      toast({ title: "Saved" });
    }
  };

  // Phase 5.7.3 § 3.B: hard delete. Cascade posture (verified against the
  // FK graph): vendors delete cascades `project_vendors` join rows and
  // sets `people.vendor_id` to NULL. No standalone records cascade.
  const handleDelete = async () => {
    if (!id) return;
    setDeleting(true);
    const { error } = await supabase.from("vendors").delete().eq("id", id);
    if (error) {
      setDeleting(false);
      setConfirmDeleteOpen(false);
      toast({
        title: "Could not delete vendor",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    toast({ title: "Deleted vendor" });
    navigate("/vendors");
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
      <Link
        to={isCreate ? "/vendors" : `/vendors/${id}`}
        className="tlink"
        onClick={(e) => {
          if (dirty) {
            e.preventDefault();
            setConfirmLeaveOpen(true);
          }
        }}
      >
        <IconArrowLeft className="ic" />
        Back to {isCreate ? "Vendors" : "vendor"}
      </Link>

      <div className="pagehead">
        <div className="eyebrow">Vendor</div>
        <h1 className="h-page">{isCreate ? "New Vendor" : "Edit Vendor"}</h1>
      </div>

      <section className="card">
        <div className="card-headbar">
          <span className="h-card">Details</span>
        </div>
        <div className="card-pad stack-4">
          <div className="g2">
            <HQFormField label="Name" required>
              <input
                className={`input ${form.name ? "input--filled" : ""}`}
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Testrite"
              />
            </HQFormField>
            <HQFormField label="Category">
              <RecordCombobox
                source={{ kind: "lookup", table: "vendor_categories" }}
                value={selectedCategoryName}
                onChange={(name) => {
                  const opt = categories.options.find((o) => o.name === name);
                  // Changing category clears subcategory (prior pick may not
                  // belong to the new parent).
                  setForm((f) => ({
                    ...f,
                    category_id: opt?.id ?? "",
                    subcategory_id: "",
                  }));
                }}
                entityLabel="Category"
              />
            </HQFormField>
            <HQFormField label="Subcategory">
              <RecordCombobox
                source={{
                  kind: "lookup",
                  table: "vendor_subcategories",
                  parentScopeId: form.category_id || null,
                  parentScopeLabel:
                    categories.options.find((o) => o.id === form.category_id)
                      ?.name ?? null,
                  parentScopeLabelKey: "Category",
                }}
                value={selectedSubcategoryName}
                onChange={(name) => {
                  const opt = subcategories.options.find((o) => o.name === name);
                  setForm((f) => ({ ...f, subcategory_id: opt?.id ?? "" }));
                }}
                entityLabel="Subcategory"
                disabled={!form.category_id}
              />
            </HQFormField>
            <HQFormField label="City">
              <RecordCombobox
                source={{ kind: "lookup", table: "cities" }}
                value={form.city || null}
                onChange={(v) => setForm((f) => ({ ...f, city: v ?? "" }))}
                entityLabel="city"
              />
            </HQFormField>
            <HQFormField label="Website URL">
              <input
                className={`input ${form.website_url ? "input--filled" : ""}`}
                value={form.website_url}
                onChange={(e) => setForm((f) => ({ ...f, website_url: e.target.value }))}
                placeholder="https://example.com"
              />
            </HQFormField>
            <HQFormField label="General Email">
              <input
                type="email"
                className={`input ${form.general_email ? "input--filled" : ""}`}
                value={form.general_email}
                onChange={(e) => setForm((f) => ({ ...f, general_email: e.target.value }))}
                placeholder="info@example.com"
              />
            </HQFormField>
          </div>
          <HQFormField label="Capabilities">
            <RecordCombobox
              multi
              source={{ kind: "lookup", table: "vendor_capabilities" }}
              multiValue={form.capabilities}
              onMultiChange={(next) =>
                setForm((f) => ({ ...f, capabilities: next }))
              }
              entityLabel="Capability"
              placeholder="Add capability..."
            />
          </HQFormField>
          <HQFormField label="Preferred">
            <label className="row-c" style={{ fontSize: 13, cursor: "pointer", gap: 8 }}>
              <input
                type="checkbox"
                checked={form.preferred}
                onChange={(e) => setForm((f) => ({ ...f, preferred: e.target.checked }))}
              />
              Preferred vendor (shown in the Wiki Preferred Vendors list)
            </label>
          </HQFormField>
          <HQFormField label="Nationwide">
            <label className="row-c" style={{ fontSize: 13, cursor: "pointer", gap: 8 }}>
              <input
                type="checkbox"
                checked={form.nationwide}
                onChange={(e) => setForm((f) => ({ ...f, nationwide: e.target.checked }))}
              />
              Works nationwide (appears under every city filter)
            </label>
          </HQFormField>
        </div>
      </section>

      <section className="card">
        <div className="card-headbar">
          <span className="h-card">Primary Contact</span>
        </div>
        <div className="card-pad stack-4">
          <div className="g2">
            <HQFormField label="Contact Name">
              <input
                className={`input ${form.contact_name ? "input--filled" : ""}`}
                value={form.contact_name}
                onChange={(e) => setForm((f) => ({ ...f, contact_name: e.target.value }))}
                placeholder="Priya Nair"
              />
            </HQFormField>
            <HQFormField label="Contact Email">
              <input
                type="email"
                className={`input ${form.contact_email ? "input--filled" : ""}`}
                value={form.contact_email}
                onChange={(e) => setForm((f) => ({ ...f, contact_email: e.target.value }))}
                placeholder="priya@example.com"
              />
            </HQFormField>
            <HQFormField label="Contact Phone">
              <input
                className={`input ${form.contact_phone ? "input--filled" : ""}`}
                value={form.contact_phone}
                onChange={(e) => setForm((f) => ({ ...f, contact_phone: e.target.value }))}
                onBlur={() =>
                  setForm((f) => ({ ...f, contact_phone: formatPhone(f.contact_phone) }))
                }
                placeholder="(212) 555-0000"
              />
            </HQFormField>
          </div>
          <HQFormField label="Primary Address">
            <textarea
              className={`input textarea ${form.primary_address ? "input--filled" : ""}`}
              value={form.primary_address}
              onChange={(e) => setForm((f) => ({ ...f, primary_address: e.target.value }))}
              placeholder="50 W 34th St, New York NY 10001"
              rows={2}
            />
          </HQFormField>
        </div>
      </section>

      <section className="card">
        <div className="card-headbar">
          <span className="h-card">Projects</span>
        </div>
        <div className="card-pad stack-4">
          <p className="cap" style={{ lineHeight: 1.5 }}>
            Projects this vendor has worked on. Add or remove links here, or
            from the project's edit page.
          </p>
          <HQFormField label="Linked Projects">
            <RecordCombobox
              multi
              source={{ kind: "record", loadOptions: loadProjectOptions }}
              multiValue={projectIds}
              onMultiChange={setProjectIds}
              entityLabel="Project"
              placeholder="Add project..."
            />
          </HQFormField>
        </div>
      </section>

      {!isCreate && id ? <VendorFilesEditor vendorId={id} /> : null}

      <StickySaveBar
        dirty={dirty}
        saving={saving}
        onCancel={onCancel}
        onSave={onSave}
        saveLabel={isCreate ? "Create vendor" : "Save changes"}
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
            <AlertDialogAction
              onClick={() => navigate(isCreate ? "/vendors" : `/vendors/${id}`)}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this vendor?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. The vendor and its records will be removed
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
