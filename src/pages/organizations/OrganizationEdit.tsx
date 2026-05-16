import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { StickySaveBar } from "@/components/data/StickySaveBar";
import { StarRating } from "@/components/data/StarRating";
import { InlineAddSelect } from "@/components/data/InlineAddSelect";
import { MultiTagInput } from "@/components/data/MultiTagInput";
import { IconArrowLeft } from "@/components/icons/HQIcons";
import { useLookup } from "@/lib/hq/lookups";
import { ORG_TYPES, type OrgType } from "@/lib/organizations/queries";
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
 * Organization Edit (Surface 10 create + edit).
 * Wireframe binding: Surface 08 Project Edit pattern (OUTPUTS/phase-5-hq-
 * wireframe-v1-LOCKED.html lines 1487-1583) applied to the Organization
 * fieldset per spec § 5.A.3.
 *
 *   crumb -> eyebrow + h-page -> .card .card-pad with .block-lbl + .g2 of
 *   .field rows -> .savebar sticky bottom.
 *
 * Capabilities + Internal Rating gate on `type === Vendor | Internal` for
 * Capabilities and `type === Vendor` for Internal Rating, matching the
 * Detail view's conditional render.
 */

type FormState = {
  name: string;
  type: OrgType;
  city: string;
  capabilities: string[];
  website_url: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  tags: string;
  internal_rating: number | null;
};

const EMPTY: FormState = {
  name: "",
  type: "Client",
  city: "",
  capabilities: [],
  website_url: "",
  contact_name: "",
  contact_email: "",
  contact_phone: "",
  tags: "",
  internal_rating: null,
};

export default function OrganizationEdit() {
  const { id } = useParams<{ id?: string }>();
  const isCreate = !id;
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [initial, setInitial] = useState<FormState>(EMPTY);
  const [loading, setLoading] = useState(!isCreate);
  const [saving, setSaving] = useState(false);
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);

  const cities = useLookup("cities");
  const capabilities = useLookup("org_capabilities");

  useEffect(() => {
    if (isCreate) return;
    let active = true;
    (async () => {
      const { data, error } = await supabase
        .from("organizations")
        .select(
          "name, type, city, capabilities, website_url, contact_name, contact_email, contact_phone, tags, internal_rating",
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
        type: OrgType;
        city: string | null;
        capabilities: string[] | null;
        website_url: string | null;
        contact_name: string | null;
        contact_email: string | null;
        contact_phone: string | null;
        tags: string[] | null;
        internal_rating: number | null;
      };
      const next: FormState = {
        name: row.name,
        type: row.type,
        city: row.city ?? "",
        capabilities: row.capabilities ?? [],
        website_url: row.website_url ?? "",
        contact_name: row.contact_name ?? "",
        contact_email: row.contact_email ?? "",
        contact_phone: row.contact_phone ?? "",
        tags: (row.tags ?? []).join(", "),
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
      navigate(isCreate ? "/organizations" : `/organizations/${id}`);
      return;
    }
    setConfirmLeaveOpen(true);
  };

  const onSave = async () => {
    if (!form.name.trim()) {
      toast({ title: "Organization name is required", variant: "destructive" });
      return;
    }
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      type: form.type,
      city: form.city || null,
      capabilities: form.capabilities,
      website_url: form.website_url || null,
      contact_name: form.contact_name || null,
      contact_email: form.contact_email || null,
      contact_phone: form.contact_phone || null,
      tags: form.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      internal_rating: form.type === "Vendor" ? form.internal_rating : null,
    };
    if (isCreate) {
      const { data: userRes } = await supabase.auth.getUser();
      const created_by = userRes.user?.id;
      const { data, error } = await supabase
        .from("organizations")
        .insert({ ...payload, created_by })
        .select("id")
        .single();
      setSaving(false);
      if (error) {
        toast({ title: "Save failed", description: error.message, variant: "destructive" });
        return;
      }
      toast({ title: "Organization created" });
      navigate(`/organizations/${data.id}`);
    } else {
      const { error } = await supabase
        .from("organizations")
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

  const showCapabilities = form.type === "Vendor" || form.type === "Internal";
  const showRating = form.type === "Vendor";

  return (
    <div className="stack-4" style={{ paddingBottom: 24, maxWidth: 880, marginLeft: "auto", marginRight: "auto" }}>
      <Link
        to={isCreate ? "/organizations" : `/organizations/${id}`}
        className="tlink"
        onClick={(e) => {
          if (dirty) {
            e.preventDefault();
            setConfirmLeaveOpen(true);
          }
        }}
      >
        <IconArrowLeft className="ic" />
        Back to {isCreate ? "Organizations" : "organization"}
      </Link>

      <div className="pagehead">
        <div className="eyebrow">Organization</div>
        <h1 className="h-page">{isCreate ? "New Organization" : "Edit Organization"}</h1>
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
                placeholder="Organization name"
              />
            </FormField>
            <FormField label="Type">
              <select
                className={`input ${form.type ? "input--filled" : ""}`}
                value={form.type}
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as OrgType }))}
              >
                {ORG_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </FormField>
            <FormField label="City">
              <InlineAddSelect
                options={cities.options}
                value={form.city || null}
                onSelect={(v) => setForm((f) => ({ ...f, city: v }))}
                onAdd={cities.addOption}
                entityLabel="city"
                exampleName="NYC"
                filled={Boolean(form.city)}
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
            <FormField label="Primary Contact">
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
            <FormField label="Phone">
              <input
                className={`input ${form.contact_phone ? "input--filled" : ""}`}
                value={form.contact_phone}
                onChange={(e) => setForm((f) => ({ ...f, contact_phone: e.target.value }))}
                placeholder="(212) 555-0000"
              />
            </FormField>
            <FormField label="Tags">
              <input
                className={`input ${form.tags ? "input--filled" : ""}`}
                value={form.tags}
                onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
                placeholder="Fast turnaround, Net 30"
              />
            </FormField>
          </div>
          {showCapabilities ? (
            <FormField label="Capabilities">
              <MultiTagInput
                options={capabilities.options}
                values={form.capabilities}
                onChange={(next) => setForm((f) => ({ ...f, capabilities: next }))}
                onAdd={capabilities.addOption}
                entityLabel="capability"
                exampleName="Custom Fabrication"
                placeholder="Add capability..."
              />
            </FormField>
          ) : null}
        </div>
      </section>

      {showRating ? (
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
      ) : null}

      <StickySaveBar
        dirty={dirty}
        saving={saving}
        onCancel={onCancel}
        onSave={onSave}
        saveLabel={isCreate ? "Create organization" : "Save changes"}
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
              onClick={() => navigate(isCreate ? "/organizations" : `/organizations/${id}`)}
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
