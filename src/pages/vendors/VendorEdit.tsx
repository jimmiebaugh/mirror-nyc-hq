import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { StickySaveBar } from "@/components/data/StickySaveBar";
import { StarRating } from "@/components/data/StarRating";
import { RecordCombobox } from "@/components/ui/RecordCombobox";
import { MultiTagInput } from "@/components/data/MultiTagInput";
import { IconArrowLeft } from "@/components/icons/HQIcons";
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
 * / city / website / capabilities / tags) and Primary Contact (name /
 * email / phone / address) and Internal Rating (always shown). Tags
 * carry the literal 'Internal Partner' string when the vendor is
 * Mirror-internal (locked Q1). Wireframe-v2 redraw deferred to a
 * future polish pass; see design-system § 11.
 *
 * 5.2 cleanup: Primary Address textarea added below the contact
 * grid (matches ClientEdit shape; backed by the new
 * `vendors.primary_address` column added in the cleanup migration).
 */

type FormState = {
  name: string;
  category_id: string;
  city: string;
  capabilities: string[];
  website_url: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  primary_address: string;
  tags: string[];
  internal_rating: number | null;
};

const EMPTY: FormState = {
  name: "",
  category_id: "",
  city: "",
  capabilities: [],
  website_url: "",
  contact_name: "",
  contact_email: "",
  contact_phone: "",
  primary_address: "",
  tags: [],
  internal_rating: null,
};

export default function VendorEdit() {
  const { id } = useParams<{ id?: string }>();
  const isCreate = !id;
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [initial, setInitial] = useState<FormState>(EMPTY);
  const [loading, setLoading] = useState(!isCreate);
  const [saving, setSaving] = useState(false);
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);

  const categories = useLookup("vendor_categories");

  useEffect(() => {
    if (isCreate) return;
    let active = true;
    (async () => {
      const { data, error } = await supabase
        .from("vendors")
        .select(
          "name, category_id, city, capabilities, website_url, contact_name, contact_email, contact_phone, primary_address, tags, internal_rating",
        )
        .eq("id", id)
        .single();
      if (!active) return;
      if (error || !data) {
        setLoading(false);
        return;
      }
      const row = data as unknown as {
        name: string;
        category_id: string | null;
        city: string | null;
        capabilities: string[] | null;
        website_url: string | null;
        contact_name: string | null;
        contact_email: string | null;
        contact_phone: string | null;
        primary_address: string | null;
        tags: string[] | null;
        internal_rating: number | null;
      };
      const next: FormState = {
        name: row.name,
        category_id: row.category_id ?? "",
        city: row.city ?? "",
        capabilities: row.capabilities ?? [],
        website_url: row.website_url ?? "",
        contact_name: row.contact_name ?? "",
        contact_email: row.contact_email ?? "",
        contact_phone: row.contact_phone ?? "",
        primary_address: row.primary_address ?? "",
        tags: row.tags ?? [],
        internal_rating: row.internal_rating,
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
    () => JSON.stringify(form) !== JSON.stringify(initial),
    [form, initial],
  );

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

  const onSave = async () => {
    if (!form.name.trim()) {
      toast({ title: "Vendor name is required", variant: "destructive" });
      return;
    }
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      category_id: form.category_id || null,
      city: form.city || null,
      capabilities: form.capabilities,
      website_url: form.website_url || null,
      contact_name: form.contact_name || null,
      contact_email: form.contact_email || null,
      contact_phone: form.contact_phone || null,
      primary_address: form.primary_address || null,
      tags: form.tags,
      internal_rating: form.internal_rating,
    };
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
      setSaving(false);
      if (error) {
        toast({ title: "Save failed", description: error.message, variant: "destructive" });
        return;
      }
      toast({ title: "Vendor created" });
      navigate(`/vendors/${data.id}`);
    } else {
      const { error } = await supabase
        .from("vendors")
        .update(payload)
        .eq("id", id);
      setSaving(false);
      if (error) {
        toast({ title: "Save failed", description: error.message, variant: "destructive" });
        return;
      }
      setInitial(form);
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
    <div className="stack-4" style={{ paddingBottom: 24, maxWidth: 880, marginLeft: "auto", marginRight: "auto" }}>
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
        <div className="card-pad stack-4">
          <div className="block-lbl">
            <span className="label-section">Details</span>
          </div>
          <div className="g2">
            <FormField label="Name" required>
              <input
                className={`input ${form.name ? "input--filled" : ""}`}
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Testrite"
              />
            </FormField>
            <FormField label="Category">
              <RecordCombobox
                source={{ kind: "lookup", table: "vendor_categories" }}
                value={selectedCategoryName}
                onChange={(name) => {
                  const opt = categories.options.find((o) => o.name === name);
                  setForm((f) => ({ ...f, category_id: opt?.id ?? "" }));
                }}
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
            <FormField label="Website URL">
              <input
                className={`input ${form.website_url ? "input--filled" : ""}`}
                value={form.website_url}
                onChange={(e) => setForm((f) => ({ ...f, website_url: e.target.value }))}
                placeholder="https://example.com"
              />
            </FormField>
          </div>
          <FormField label="Capabilities">
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
          </FormField>
          <FormField label="Tags">
            <MultiTagInput
              options={[]}
              values={form.tags}
              onChange={(next) => setForm((f) => ({ ...f, tags: next }))}
              onAdd={async (name) => ({ id: name, name })}
              entityLabel="tag"
              exampleName="Internal Partner"
              placeholder="Add tag..."
            />
          </FormField>
        </div>
      </section>

      <section className="card">
        <div className="card-pad stack-4">
          <div className="block-lbl">
            <span className="label-section">Primary Contact</span>
          </div>
          <div className="g2">
            <FormField label="Contact Name">
              <input
                className={`input ${form.contact_name ? "input--filled" : ""}`}
                value={form.contact_name}
                onChange={(e) => setForm((f) => ({ ...f, contact_name: e.target.value }))}
                placeholder="Priya Nair"
              />
            </FormField>
            <FormField label="Contact Email">
              <input
                type="email"
                className={`input ${form.contact_email ? "input--filled" : ""}`}
                value={form.contact_email}
                onChange={(e) => setForm((f) => ({ ...f, contact_email: e.target.value }))}
                placeholder="priya@example.com"
              />
            </FormField>
            <FormField label="Contact Phone">
              <input
                className={`input ${form.contact_phone ? "input--filled" : ""}`}
                value={form.contact_phone}
                onChange={(e) => setForm((f) => ({ ...f, contact_phone: e.target.value }))}
                onBlur={() =>
                  setForm((f) => ({ ...f, contact_phone: formatPhone(f.contact_phone) }))
                }
                placeholder="(212) 555-0000"
              />
            </FormField>
          </div>
          <FormField label="Primary Address">
            <textarea
              className={`input textarea ${form.primary_address ? "input--filled" : ""}`}
              value={form.primary_address}
              onChange={(e) => setForm((f) => ({ ...f, primary_address: e.target.value }))}
              placeholder="50 W 34th St, New York NY 10001"
              rows={2}
            />
          </FormField>
        </div>
      </section>

      <section className="card">
        <div className="card-pad stack-4">
          <div className="block-lbl">
            <span className="label-section">Internal Rating</span>
          </div>
          <div className="row-c" style={{ gap: 12 }}>
            <StarRating
              value={form.internal_rating}
              editable
              size="lg"
              onChange={(next) => setForm((f) => ({ ...f, internal_rating: next }))}
            />
            <span className="cap">
              {form.internal_rating != null ? `${form.internal_rating} of 5` : "Not rated"}
            </span>
          </div>
          <p className="cap" style={{ lineHeight: 1.5 }}>
            Visible to all Standard users on the Detail view.
          </p>
        </div>
      </section>

      <StickySaveBar
        dirty={dirty}
        saving={saving}
        onCancel={onCancel}
        onSave={onSave}
        saveLabel={isCreate ? "Create vendor" : "Save changes"}
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
