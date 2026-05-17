import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { StickySaveBar } from "@/components/data/StickySaveBar";
import { RecordCombobox } from "@/components/ui/RecordCombobox";
import {
  CLIENT_MINI_CREATE_FIELDS,
  createClientInline,
} from "@/lib/hq/inlineCreate";
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
import { toast } from "@/hooks/use-toast";
import { formatPhone } from "@/lib/hq/phone";

/**
 * Person Edit (Surface 11 create + edit).
 * Wireframe binding: Surface 08 Project Edit pattern (lines 1487-1583)
 * adapted per spec § 4.C.3 of Phase 5.2.3.
 *
 * Type selector adapted in Phase 5.2.3: the multi-chip affiliations
 * picker is gone (locked Q4: at most one org type per person). Replaced
 * with a single Type radio (Client / Vendor / Venue contact /
 * Unaffiliated); switching the radio re-routes which FK is set (clears
 * the opposite). DB mutex CHECK on (client_id, vendor_id) is the
 * safety net. When Type=Venue contact, a multi-select picks venues
 * this person contacts; save logic syncs venue_contact_people rows.
 */

type PersonType = "Client" | "Vendor" | "Venue" | "Unaffiliated";

type FormState = {
  full_name: string;
  type: PersonType;
  client_id: string | null;
  vendor_id: string | null;
  role_title: string;
  email: string;
  phone: string;
  linkedin_url: string;
  tags: string;
};

const EMPTY: FormState = {
  full_name: "",
  type: "Unaffiliated",
  client_id: null,
  vendor_id: null,
  role_title: "",
  email: "",
  phone: "",
  linkedin_url: "",
  tags: "",
};

type ClientOption = { id: string; name: string };
type VendorOption = { id: string; name: string };
type VenueOption = { id: string; name: string };

export default function PersonEdit() {
  const { id } = useParams<{ id?: string }>();
  const isCreate = !id;
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [initial, setInitial] = useState<FormState>(EMPTY);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [venues, setVenues] = useState<VenueOption[]>([]);
  const [venueIds, setVenueIds] = useState<string[]>([]);
  const [initialVenueIds, setInitialVenueIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(!isCreate);
  const [saving, setSaving] = useState(false);
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const [clientsRes, vendorsRes, venuesRes, personRes, joinRes] = await Promise.all([
        supabase.from("clients").select("id, name").order("name", { ascending: true }),
        supabase.from("vendors").select("id, name").order("name", { ascending: true }),
        supabase.from("venues").select("id, name").order("name", { ascending: true }),
        isCreate
          ? Promise.resolve({ data: null, error: null })
          : supabase
              .from("people")
              .select(
                "full_name, affiliation_type, client_id, vendor_id, role_title, email, phone, linkedin_url, tags",
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
      setClients((clientsRes.data ?? []) as unknown as ClientOption[]);
      setVendors((vendorsRes.data ?? []) as unknown as VendorOption[]);
      setVenues((venuesRes.data ?? []) as unknown as VenueOption[]);
      const ids = ((joinRes.data ?? []) as { venue_id: string }[]).map((r) => r.venue_id);
      setVenueIds(ids);
      setInitialVenueIds(ids);

      if (!isCreate && "data" in personRes && personRes.data) {
        const row = personRes.data as unknown as {
          full_name: string;
          affiliation_type: PersonType | null;
          client_id: string | null;
          vendor_id: string | null;
          role_title: string | null;
          email: string | null;
          phone: string | null;
          linkedin_url: string | null;
          tags: string[] | null;
        };
        // Phase 5.6.3: prefer the stored column; fall back to FK
        // derivation for safety if a row was written outside the new
        // migration window.
        let resolvedType: PersonType = row.affiliation_type ?? "Unaffiliated";
        if (!row.affiliation_type) {
          if (row.client_id) resolvedType = "Client";
          else if (row.vendor_id) resolvedType = "Vendor";
          else if (ids.length > 0) resolvedType = "Venue";
        }
        const next: FormState = {
          full_name: row.full_name,
          type: resolvedType,
          client_id: row.client_id,
          vendor_id: row.vendor_id,
          role_title: row.role_title ?? "",
          email: row.email ?? "",
          phone: row.phone ?? "",
          linkedin_url: row.linkedin_url ?? "",
          tags: (row.tags ?? []).join(", "),
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
      JSON.stringify([...venueIds].sort()) !==
        JSON.stringify([...initialVenueIds].sort()),
    [form, initial, venueIds, initialVenueIds],
  );

  const onTypeChange = (t: PersonType) => {
    setForm((f) => ({
      ...f,
      type: t,
      client_id: t === "Client" ? f.client_id : null,
      vendor_id: t === "Vendor" ? f.vendor_id : null,
    }));
    if (t !== "Venue") {
      setVenueIds([]);
    }
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
      affiliation_type: form.type,
      client_id: form.type === "Client" ? form.client_id : null,
      vendor_id: form.type === "Vendor" ? form.vendor_id : null,
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
      if (!created_by) {
        setSaving(false);
        toast({ title: "Not signed in", variant: "destructive" });
        return;
      }
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

    // Sync venue_contact_people rows when Type=Venue contact; otherwise clear all.
    if (personId) {
      const effectiveVenueIds = form.type === "Venue" ? venueIds : [];
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
    setInitialVenueIds(form.type === "Venue" ? venueIds : []);
    if (isCreate && personId) {
      toast({ title: "Person created" });
      navigate(`/people/${personId}`);
    } else {
      toast({ title: "Saved" });
    }
  };

  // Stable loader for RecordCombobox `record` mode (uses the venues already
  // loaded above; no extra round trip).
  //
  // Hooks must run above any early return per design-system § 12.2 — the
  // venueOptions / loadVenueOptions pair was previously below the loading
  // gate, which caused the "Rendered more hooks than during the previous
  // render" black-screen when loading flipped false. Moved above.
  const venueOptions = useMemo(
    () => venues.map((v) => ({ id: v.id, label: v.name })),
    [venues],
  );
  const loadVenueOptions = useCallback(async () => venueOptions, [venueOptions]);
  const clientOptions = useMemo(
    () => clients.map((c) => ({ id: c.id, label: c.name })),
    [clients],
  );
  const loadClientOptions = useCallback(async () => clientOptions, [clientOptions]);
  const vendorOptions = useMemo(
    () => vendors.map((v) => ({ id: v.id, label: v.name })),
    [vendors],
  );
  const loadVendorOptions = useCallback(async () => vendorOptions, [vendorOptions]);
  const handleCreateClient = useCallback(
    async (data: Record<string, string>) => {
      const created = await createClientInline(data);
      if (created) {
        setClients((prev) =>
          [...prev, { id: created.id, name: created.label }].sort((a, b) =>
            a.name.localeCompare(b.name),
          ),
        );
      }
      return created;
    },
    [],
  );

  if (loading) {
    return (
      <div className="empty">
        <p>Loading...</p>
      </div>
    );
  }

  const showClientPicker = form.type === "Client";
  const showVendorPicker = form.type === "Vendor";
  const showVenuePicker = form.type === "Venue";

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

          <FormField label="Type">
            <div className="row-c wrap" style={{ gap: 12 }}>
              {(["Client", "Vendor", "Venue", "Unaffiliated"] as PersonType[]).map(
                (t) => (
                  <label
                    key={t}
                    className="row-c"
                    style={{ gap: 6, cursor: "pointer", fontSize: 13 }}
                  >
                    <input
                      type="radio"
                      name="person-type"
                      checked={form.type === t}
                      onChange={() => onTypeChange(t)}
                    />
                    {t}
                  </label>
                ),
              )}
            </div>
          </FormField>

          {showClientPicker ? (
            <FormField label="Client">
              <RecordCombobox
                source={{ kind: "record", loadOptions: loadClientOptions }}
                value={form.client_id}
                onChange={(next) => setForm((f) => ({ ...f, client_id: next }))}
                entityLabel="Client"
                placeholder="No client"
                quickCreate
                miniCreateFields={CLIENT_MINI_CREATE_FIELDS}
                onMiniCreate={handleCreateClient}
              />
            </FormField>
          ) : null}

          {showVendorPicker ? (
            <FormField label="Vendor">
              <RecordCombobox
                source={{ kind: "record", loadOptions: loadVendorOptions }}
                value={form.vendor_id}
                onChange={(next) => setForm((f) => ({ ...f, vendor_id: next }))}
                entityLabel="Vendor"
                placeholder="No vendor"
              />
            </FormField>
          ) : null}

          <div className="g2">
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
                onBlur={() => setForm((f) => ({ ...f, phone: formatPhone(f.phone) }))}
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
              <span className="label-section">Venues Managed</span>
            </div>
            <RecordCombobox
              multi
              source={{ kind: "record", loadOptions: loadVenueOptions }}
              multiValue={venueIds}
              onMultiChange={setVenueIds}
              entityLabel="venue"
              placeholder="Add venue..."
            />
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
