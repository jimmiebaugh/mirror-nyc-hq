import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { StickySaveBar } from "@/components/data/StickySaveBar";
import { IconArrowLeft, IconX } from "@/components/icons/HQIcons";
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
import {
  PERSON_AFFILIATIONS,
  affiliationToken,
  type PersonAffiliation,
} from "@/lib/people/queries";

/**
 * Person Edit (Surface 11 create + edit).
 * Wireframe binding: Surface 08 Project Edit pattern (lines 1487-1583)
 * adapted per spec § 5.B.3.
 *
 * Affiliations renders as a multi-select chip row. When the selection
 * includes 'Venue', a "Venues this person contacts" multi-select appears
 * pulling from `venues` and writing to `venue_contact_people` join rows
 * (insert net new, delete dropped) on save.
 */

type FormState = {
  full_name: string;
  affiliations: PersonAffiliation[];
  organization_id: string | null;
  role_title: string;
  email: string;
  phone: string;
  linkedin_url: string;
  tags: string;
};

const EMPTY: FormState = {
  full_name: "",
  affiliations: [],
  organization_id: null,
  role_title: "",
  email: "",
  phone: "",
  linkedin_url: "",
  tags: "",
};

type OrgOption = { id: string; name: string };
type VenueOption = { id: string; name: string };

export default function PersonEdit() {
  const { id } = useParams<{ id?: string }>();
  const isCreate = !id;
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [initial, setInitial] = useState<FormState>(EMPTY);
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [venues, setVenues] = useState<VenueOption[]>([]);
  const [venueIds, setVenueIds] = useState<string[]>([]);
  const [initialVenueIds, setInitialVenueIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(!isCreate);
  const [saving, setSaving] = useState(false);
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const [orgRes, venueRes, personRes, joinRes] = await Promise.all([
        supabase.from("organizations").select("id, name").order("name", { ascending: true }),
        supabase.from("venues").select("id, name").order("name", { ascending: true }),
        isCreate
          ? Promise.resolve({ data: null, error: null })
          : supabase
              .from("people")
              .select(
                "full_name, affiliations, organization_id, role_title, email, phone, linkedin_url, tags",
              )
              .eq("id", id)
              .single(),
        isCreate
          ? Promise.resolve({ data: [], error: null })
          : supabase
              .from("venue_contact_people")
              .select("venue_id")
              .eq("person_id", id),
      ]);
      if (!active) return;
      setOrgs((orgRes.data ?? []) as unknown as OrgOption[]);
      setVenues((venueRes.data ?? []) as unknown as VenueOption[]);
      if (!isCreate && "data" in personRes && personRes.data) {
        const row = personRes.data as unknown as {
          full_name: string;
          affiliations: PersonAffiliation[];
          organization_id: string | null;
          role_title: string | null;
          email: string | null;
          phone: string | null;
          linkedin_url: string | null;
          tags: string[] | null;
        };
        const next: FormState = {
          full_name: row.full_name,
          affiliations: row.affiliations ?? [],
          organization_id: row.organization_id,
          role_title: row.role_title ?? "",
          email: row.email ?? "",
          phone: row.phone ?? "",
          linkedin_url: row.linkedin_url ?? "",
          tags: (row.tags ?? []).join(", "),
        };
        setForm(next);
        setInitial(next);
      }
      const ids = ((joinRes.data ?? []) as { venue_id: string }[]).map((r) => r.venue_id);
      setVenueIds(ids);
      setInitialVenueIds(ids);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [id, isCreate]);

  const dirty = useMemo(
    () =>
      JSON.stringify(form) !== JSON.stringify(initial) ||
      JSON.stringify([...venueIds].sort()) !== JSON.stringify([...initialVenueIds].sort()),
    [form, initial, venueIds, initialVenueIds],
  );

  const toggleAffiliation = (a: PersonAffiliation) => {
    setForm((f) => ({
      ...f,
      affiliations: f.affiliations.includes(a)
        ? f.affiliations.filter((x) => x !== a)
        : [...f.affiliations, a],
    }));
  };

  const onCancel = () => {
    if (!dirty) {
      navigate(isCreate ? "/people" : `/people/${id}`);
      return;
    }
    setConfirmLeaveOpen(true);
  };

  const onSave = async () => {
    if (!form.full_name.trim()) {
      toast({ title: "Full name is required", variant: "destructive" });
      return;
    }
    setSaving(true);

    const payload = {
      full_name: form.full_name.trim(),
      affiliations: form.affiliations,
      organization_id: form.organization_id,
      role_title: form.role_title || null,
      email: form.email || null,
      phone: form.phone || null,
      linkedin_url: form.linkedin_url || null,
      tags: form.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    };

    let personId = id ?? null;
    if (isCreate) {
      const { data: userRes } = await supabase.auth.getUser();
      const created_by = userRes.user?.id;
      const { data, error } = await supabase
        .from("people")
        .insert({ ...payload, created_by })
        .select("id")
        .single();
      if (error || !data) {
        setSaving(false);
        toast({ title: "Save failed", description: error?.message, variant: "destructive" });
        return;
      }
      personId = data.id;
    } else {
      const { error } = await supabase.from("people").update(payload).eq("id", id);
      if (error) {
        setSaving(false);
        toast({ title: "Save failed", description: error.message, variant: "destructive" });
        return;
      }
    }

    // Sync venue_contact_people rows when affiliations includes 'Venue'.
    if (personId) {
      const effectiveVenueIds = form.affiliations.includes("Venue") ? venueIds : [];
      const toAdd = effectiveVenueIds.filter((v) => !initialVenueIds.includes(v));
      const toRemove = initialVenueIds.filter((v) => !effectiveVenueIds.includes(v));
      for (const venueId of toAdd) {
        await supabase
          .from("venue_contact_people")
          .insert({ venue_id: venueId, person_id: personId });
      }
      for (const venueId of toRemove) {
        await supabase
          .from("venue_contact_people")
          .delete()
          .eq("venue_id", venueId)
          .eq("person_id", personId);
      }
    }

    setSaving(false);
    setInitial(form);
    setInitialVenueIds(venueIds);
    if (isCreate && personId) {
      toast({ title: "Person created" });
      navigate(`/people/${personId}`);
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

  const showVenuePicker = form.affiliations.includes("Venue");
  const availableVenues = venues.filter((v) => !venueIds.includes(v.id));

  return (
    <div className="stack-4" style={{ paddingBottom: 24, maxWidth: 880, marginLeft: "auto", marginRight: "auto" }}>
      <Link
        to={isCreate ? "/people" : `/people/${id}`}
        className="tlink"
        onClick={(e) => {
          if (dirty) {
            e.preventDefault();
            setConfirmLeaveOpen(true);
          }
        }}
      >
        <IconArrowLeft className="ic" />
        Back to {isCreate ? "People" : "person"}
      </Link>

      <div className="pagehead">
        <div className="eyebrow">Person</div>
        <h1 className="h-page">{isCreate ? "New Person" : "Edit Person"}</h1>
      </div>

      <section className="card">
        <div className="card-pad stack-4">
          <div className="block-lbl">
            <span className="label-section">Details</span>
          </div>
          <FormField label="Full Name" required>
            <input
              className={`input ${form.full_name ? "input--filled" : ""}`}
              value={form.full_name}
              onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
              placeholder="Sarah Klein"
            />
          </FormField>

          <FormField label="Affiliations">
            <div className="row-c wrap" style={{ gap: 6 }}>
              {PERSON_AFFILIATIONS.map((a) => {
                const active = form.affiliations.includes(a);
                return (
                  <button
                    key={a}
                    type="button"
                    className={`pill pill-sm p-${affiliationToken(a)}`}
                    style={{
                      cursor: "pointer",
                      opacity: active ? 1 : 0.55,
                      border: 0,
                    }}
                    onClick={() => toggleAffiliation(a)}
                  >
                    {a}
                  </button>
                );
              })}
            </div>
          </FormField>

          <div className="g2">
            <FormField label="Organization">
              <select
                className={`input ${form.organization_id ? "input--filled" : ""}`}
                value={form.organization_id ?? ""}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    organization_id: e.target.value || null,
                  }))
                }
              >
                <option value="">No organization</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Role / Title">
              <input
                className={`input ${form.role_title ? "input--filled" : ""}`}
                value={form.role_title}
                onChange={(e) => setForm((f) => ({ ...f, role_title: e.target.value }))}
                placeholder="VP Brand Marketing"
              />
            </FormField>
            <FormField label="Email">
              <input
                type="email"
                className={`input ${form.email ? "input--filled" : ""}`}
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="sarah@example.com"
              />
            </FormField>
            <FormField label="Phone">
              <input
                className={`input ${form.phone ? "input--filled" : ""}`}
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder="(212) 555-0000"
              />
            </FormField>
            <FormField label="LinkedIn URL">
              <input
                className={`input ${form.linkedin_url ? "input--filled" : ""}`}
                value={form.linkedin_url}
                onChange={(e) => setForm((f) => ({ ...f, linkedin_url: e.target.value }))}
                placeholder="https://linkedin.com/in/sarahklein"
              />
            </FormField>
            <FormField label="Tags">
              <input
                className={`input ${form.tags ? "input--filled" : ""}`}
                value={form.tags}
                onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
                placeholder="Decision maker, Prefers email"
              />
            </FormField>
          </div>
        </div>
      </section>

      {showVenuePicker ? (
        <section className="card">
          <div className="card-pad stack-4">
            <div className="block-lbl">
              <span className="label-section">Venues this person contacts</span>
            </div>
            <div className="row-c wrap" style={{ gap: 6 }}>
              {venueIds.map((vid) => {
                const v = venues.find((x) => x.id === vid);
                if (!v) return null;
                return (
                  <span key={vid} className="tag" style={{ display: "inline-flex", gap: 5, alignItems: "center" }}>
                    {v.name}
                    <button
                      type="button"
                      aria-label={`Remove ${v.name}`}
                      onClick={() => setVenueIds(venueIds.filter((x) => x !== vid))}
                      style={{
                        background: "transparent",
                        border: 0,
                        cursor: "pointer",
                        color: "inherit",
                        padding: 0,
                        display: "inline-flex",
                      }}
                    >
                      <IconX className="ic" style={{ width: 10, height: 10 }} />
                    </button>
                  </span>
                );
              })}
              <select
                className="input"
                style={{ height: 32, fontSize: 12, padding: "4px 8px" }}
                value=""
                onChange={(e) => {
                  if (!e.target.value) return;
                  setVenueIds([...venueIds, e.target.value]);
                }}
              >
                <option value="">Add venue...</option>
                {availableVenues.map((v) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
            </div>
          </div>
        </section>
      ) : null}

      <StickySaveBar
        dirty={dirty}
        saving={saving}
        onCancel={onCancel}
        onSave={onSave}
        saveLabel={isCreate ? "Create person" : "Save changes"}
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
              onClick={() => navigate(isCreate ? "/people" : `/people/${id}`)}
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
