import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { StickySaveBar } from "@/components/data/StickySaveBar";
import { RecordCombobox } from "@/components/ui/RecordCombobox";
import { MultiTagInput } from "@/components/data/MultiTagInput";
import { IconArrowLeft } from "@/components/icons/HQIcons";
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
 * Client Edit (create + edit).
 *
 * Wireframe binding (DEVIATION): Surface 08 Project Edit pattern
 * (OUTPUTS/phase-5-hq-wireframe-v1-LOCKED.html lines 1487-1583) applied
 * to the Client fieldset. Surface 10 was drawn as a unified
 * Organization Edit; per the 2026-05-16 locked decisions split (spec
 * § 0c Q3), this is the Clients half. Single column, two cards:
 * Details (name / industry / city / website / tags) and Primary
 * Contact (name / email / phone / address). Wireframe-v2 redraw
 * deferred to a future polish pass; see design-system § 11.
 */

type FormState = {
  name: string;
  industry: string;
  city: string;
  website_url: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  primary_address: string;
  tags: string[];
};

const EMPTY: FormState = {
  name: "",
  industry: "",
  city: "",
  website_url: "",
  contact_name: "",
  contact_email: "",
  contact_phone: "",
  primary_address: "",
  tags: [],
};

export default function ClientEdit() {
  const { id } = useParams<{ id?: string }>();
  const isCreate = !id;
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [initial, setInitial] = useState<FormState>(EMPTY);
  const [loading, setLoading] = useState(!isCreate);
  const [saving, setSaving] = useState(false);
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);

  useEffect(() => {
    if (isCreate) return;
    let active = true;
    (async () => {
      const { data, error } = await supabase
        .from("clients")
        .select(
          "name, industry, city, website_url, contact_name, contact_email, contact_phone, primary_address, tags",
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
        industry: string | null;
        city: string | null;
        website_url: string | null;
        contact_name: string | null;
        contact_email: string | null;
        contact_phone: string | null;
        primary_address: string | null;
        tags: string[] | null;
      };
      const next: FormState = {
        name: row.name,
        industry: row.industry ?? "",
        city: row.city ?? "",
        website_url: row.website_url ?? "",
        contact_name: row.contact_name ?? "",
        contact_email: row.contact_email ?? "",
        contact_phone: row.contact_phone ?? "",
        primary_address: row.primary_address ?? "",
        tags: row.tags ?? [],
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
      navigate(isCreate ? "/clients" : `/clients/${id}`);
      return;
    }
    setConfirmLeaveOpen(true);
  };

  const onSave = async () => {
    if (!form.name.trim()) {
      toast({ title: "Client name is required", variant: "destructive" });
      return;
    }
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      industry: form.industry || null,
      city: form.city || null,
      website_url: form.website_url || null,
      contact_name: form.contact_name || null,
      contact_email: form.contact_email || null,
      contact_phone: form.contact_phone || null,
      primary_address: form.primary_address || null,
      tags: form.tags,
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
        .from("clients")
        .insert({ ...payload, created_by })
        .select("id")
        .single();
      setSaving(false);
      if (error) {
        toast({ title: "Save failed", description: error.message, variant: "destructive" });
        return;
      }
      toast({ title: "Client created" });
      navigate(`/clients/${data.id}`);
    } else {
      const { error } = await supabase
        .from("clients")
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
        to={isCreate ? "/clients" : `/clients/${id}`}
        className="tlink"
        onClick={(e) => {
          if (dirty) {
            e.preventDefault();
            setConfirmLeaveOpen(true);
          }
        }}
      >
        <IconArrowLeft className="ic" />
        Back to {isCreate ? "Clients" : "client"}
      </Link>

      <div className="pagehead">
        <div className="eyebrow">Client</div>
        <h1 className="h-page">{isCreate ? "New Client" : "Edit Client"}</h1>
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
                placeholder="Olipop"
              />
            </FormField>
            <FormField label="Industry">
              <input
                className={`input ${form.industry ? "input--filled" : ""}`}
                value={form.industry}
                onChange={(e) => setForm((f) => ({ ...f, industry: e.target.value }))}
                placeholder="Beverage"
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
          <FormField label="Tags">
            <MultiTagInput
              options={[]}
              values={form.tags}
              onChange={(next) => setForm((f) => ({ ...f, tags: next }))}
              onAdd={async (name) => ({ id: name, name })}
              entityLabel="tag"
              exampleName="Net 30"
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
                placeholder="Sarah Klein"
              />
            </FormField>
            <FormField label="Contact Email">
              <input
                type="email"
                className={`input ${form.contact_email ? "input--filled" : ""}`}
                value={form.contact_email}
                onChange={(e) => setForm((f) => ({ ...f, contact_email: e.target.value }))}
                placeholder="sarah@example.com"
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
              placeholder="123 Main St, Brooklyn NY 11201"
              rows={2}
            />
          </FormField>
        </div>
      </section>

      <StickySaveBar
        dirty={dirty}
        saving={saving}
        onCancel={onCancel}
        onSave={onSave}
        saveLabel={isCreate ? "Create client" : "Save changes"}
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
              onClick={() => navigate(isCreate ? "/clients" : `/clients/${id}`)}
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
