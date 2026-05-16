import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { StickySaveBar } from "@/components/data/StickySaveBar";
import { InlineAddSelect } from "@/components/data/InlineAddSelect";
import { MultiTagInput } from "@/components/data/MultiTagInput";
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
import { useLookup } from "@/lib/hq/lookups";
import { formatShortDate } from "@/lib/hq/dates";
import { loadLatestVenueRates, type VenueRate } from "@/lib/venues/queries";

/**
 * Venue Edit (Surface 09 create + edit).
 * Wireframe binding: Surface 08 Project Edit pattern (lines 1487-1583)
 * applied to the Venue fieldset per spec § 5.C.3.
 *
 *   crumb -> eyebrow + h-page -> .card .card-pad blocks for:
 *     1. Details (Name / Address / Neighborhood / City inline-add /
 *        Capacity / Total Sq Ft)
 *     2. Venue Types (multi-select via venue_types lookup; writes to
 *        venue_venue_types join on save)
 *     3. Rates (Event Day + Prod Day; "Log new rate" opens a mini-dialog
 *        that INSERTs into venue_rate_history; existing rows immutable)
 *     4. Links & References (website_url, venue_slide_url)
 *     5. Exclusive Vendors (multi-select Vendor picker;
 *        writes to venues.exclusive_vendor_ids)
 *     6. About Venue (venues.notes textarea)
 *   -> .savebar sticky bottom.
 */

type FormState = {
  name: string;
  address: string;
  neighborhood: string;
  city: string;
  capacity: string;
  total_sq_ft: string;
  website_url: string;
  venue_slide_url: string;
  notes: string;
  features: string;
};

const EMPTY: FormState = {
  name: "",
  address: "",
  neighborhood: "",
  city: "",
  capacity: "",
  total_sq_ft: "",
  website_url: "",
  venue_slide_url: "",
  notes: "",
  features: "",
};

type VendorOption = { id: string; name: string };

export default function VenueEdit() {
  const { id } = useParams<{ id?: string }>();
  const isCreate = !id;
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [initial, setInitial] = useState<FormState>(EMPTY);
  const [typeIds, setTypeIds] = useState<string[]>([]);
  const [initialTypeIds, setInitialTypeIds] = useState<string[]>([]);
  const [vendorIds, setVendorIds] = useState<string[]>([]);
  const [initialVendorIds, setInitialVendorIds] = useState<string[]>([]);
  const [vendorOptions, setVendorOptions] = useState<VendorOption[]>([]);
  const [rates, setRates] = useState<VenueRate[]>([]);
  const [loading, setLoading] = useState(!isCreate);
  const [saving, setSaving] = useState(false);
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);
  const [logRateOpen, setLogRateOpen] = useState<"event_day" | "prod_day" | null>(null);
  const [newRateAmount, setNewRateAmount] = useState("");
  const [newRateDate, setNewRateDate] = useState(new Date().toISOString().slice(0, 10));
  const [addTypeOpen, setAddTypeOpen] = useState(false);
  const [newTypeName, setNewTypeName] = useState("");

  const cities = useLookup("cities");
  const venueTypes = useLookup("venue_types");

  useEffect(() => {
    let active = true;
    (async () => {
      const [vendorRes, venueRes, typeRes, rateRows] = await Promise.all([
        supabase
          .from("vendors")
          .select("id, name")
          .order("name", { ascending: true }),
        isCreate
          ? Promise.resolve({ data: null, error: null })
          : supabase
              .from("venues")
              .select(
                "name, address, neighborhood, city, capacity, total_sq_ft, website_url, venue_slide_url, notes, features, exclusive_vendor_ids",
              )
              .eq("id", id)
              .single(),
        isCreate
          ? Promise.resolve({ data: [], error: null })
          : supabase
              .from("venue_venue_types")
              .select("venue_type_id")
              .eq("venue_id", id),
        isCreate ? Promise.resolve([] as VenueRate[]) : loadLatestVenueRates(id ?? ""),
      ]);
      if (!active) return;
      setVendorOptions((vendorRes.data ?? []) as unknown as VendorOption[]);
      if (!isCreate && "data" in venueRes && venueRes.data) {
        const row = venueRes.data as unknown as {
          name: string;
          address: string | null;
          neighborhood: string | null;
          city: string | null;
          capacity: number | null;
          total_sq_ft: number | null;
          website_url: string | null;
          venue_slide_url: string | null;
          notes: string | null;
          features: string[] | null;
          exclusive_vendor_ids: string[] | null;
        };
        const next: FormState = {
          name: row.name,
          address: row.address ?? "",
          neighborhood: row.neighborhood ?? "",
          city: row.city ?? "",
          capacity: row.capacity != null ? String(row.capacity) : "",
          total_sq_ft: row.total_sq_ft != null ? String(row.total_sq_ft) : "",
          website_url: row.website_url ?? "",
          venue_slide_url: row.venue_slide_url ?? "",
          notes: row.notes ?? "",
          features: (row.features ?? []).join(", "),
        };
        setForm(next);
        setInitial(next);
        const vids = row.exclusive_vendor_ids ?? [];
        setVendorIds(vids);
        setInitialVendorIds(vids);
      }
      const tIds = ((typeRes.data ?? []) as { venue_type_id: string }[]).map((r) => r.venue_type_id);
      setTypeIds(tIds);
      setInitialTypeIds(tIds);
      setRates(rateRows);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [id, isCreate]);

  const dirty = useMemo(
    () =>
      JSON.stringify(form) !== JSON.stringify(initial) ||
      JSON.stringify([...typeIds].sort()) !== JSON.stringify([...initialTypeIds].sort()) ||
      JSON.stringify([...vendorIds].sort()) !== JSON.stringify([...initialVendorIds].sort()),
    [form, initial, typeIds, initialTypeIds, vendorIds, initialVendorIds],
  );

  const onCancel = () => {
    if (!dirty) {
      navigate(isCreate ? "/venues" : `/venues/${id}`);
      return;
    }
    setConfirmLeaveOpen(true);
  };

  const onSave = async () => {
    if (!form.name.trim()) {
      toast({ title: "Venue name is required", variant: "destructive" });
      return;
    }
    const capacity = form.capacity.trim() ? Number(form.capacity.replace(/[,\s]/g, "")) : null;
    const totalSqFt = form.total_sq_ft.trim() ? Number(form.total_sq_ft.replace(/[,\s]/g, "")) : null;
    if (form.capacity.trim() && (capacity == null || Number.isNaN(capacity))) {
      toast({ title: "Capacity must be a number", variant: "destructive" });
      return;
    }
    if (form.total_sq_ft.trim() && (totalSqFt == null || Number.isNaN(totalSqFt))) {
      toast({ title: "Total Sq Ft must be a number", variant: "destructive" });
      return;
    }
    setSaving(true);

    const payload = {
      name: form.name.trim(),
      address: form.address || null,
      neighborhood: form.neighborhood || null,
      city: form.city || null,
      capacity,
      total_sq_ft: totalSqFt,
      website_url: form.website_url || null,
      venue_slide_url: form.venue_slide_url || null,
      notes: form.notes || null,
      features: form.features
        .split(",")
        .map((f) => f.trim())
        .filter(Boolean),
      exclusive_vendor_ids: vendorIds,
    };

    let venueId = id ?? null;
    if (isCreate) {
      const { data: userRes } = await supabase.auth.getUser();
      const created_by = userRes.user?.id;
      const { data, error } = await supabase
        .from("venues")
        .insert({ ...payload, created_by })
        .select("id")
        .single();
      if (error || !data) {
        setSaving(false);
        toast({ title: "Save failed", description: error?.message, variant: "destructive" });
        return;
      }
      venueId = data.id;
    } else {
      const { error } = await supabase.from("venues").update(payload).eq("id", id);
      if (error) {
        setSaving(false);
        toast({ title: "Save failed", description: error.message, variant: "destructive" });
        return;
      }
    }

    if (venueId) {
      const toAdd = typeIds.filter((t) => !initialTypeIds.includes(t));
      const toRemove = initialTypeIds.filter((t) => !typeIds.includes(t));
      for (const venueTypeId of toAdd) {
        await supabase
          .from("venue_venue_types")
          .insert({ venue_id: venueId, venue_type_id: venueTypeId });
      }
      for (const venueTypeId of toRemove) {
        await supabase
          .from("venue_venue_types")
          .delete()
          .eq("venue_id", venueId)
          .eq("venue_type_id", venueTypeId);
      }
    }

    setSaving(false);
    setInitial(form);
    setInitialTypeIds(typeIds);
    setInitialVendorIds(vendorIds);
    if (isCreate && venueId) {
      toast({ title: "Venue created" });
      navigate(`/venues/${venueId}`);
    } else {
      toast({ title: "Saved" });
    }
  };

  const onLogRate = async () => {
    if (!logRateOpen || !id) return;
    const amount = Number(newRateAmount.replace(/[$,\s]/g, ""));
    if (Number.isNaN(amount) || amount <= 0) {
      toast({ title: "Amount must be a positive number", variant: "destructive" });
      return;
    }
    const { data: userRes } = await supabase.auth.getUser();
    const created_by = userRes.user?.id;
    if (!created_by) return;
    const { error } = await supabase.from("venue_rate_history").insert({
      venue_id: id,
      rate_kind: logRateOpen,
      amount_usd: amount,
      effective_from: newRateDate,
      created_by,
    });
    if (error) {
      toast({ title: "Could not log rate", description: error.message, variant: "destructive" });
      return;
    }
    const next = await loadLatestVenueRates(id);
    setRates(next);
    setLogRateOpen(null);
    setNewRateAmount("");
    setNewRateDate(new Date().toISOString().slice(0, 10));
    toast({ title: "Rate logged" });
  };

  if (loading) {
    return (
      <div className="empty">
        <p>Loading...</p>
      </div>
    );
  }

  const eventRate = rates.find((r) => r.rate_kind === "event_day");
  const prodRate = rates.find((r) => r.rate_kind === "prod_day");
  const availableTypes = venueTypes.options.filter((o) => !typeIds.includes(o.id));
  const availableVendors = vendorOptions.filter((v) => !vendorIds.includes(v.id));

  return (
    <div className="stack-4" style={{ paddingBottom: 24, maxWidth: 880, marginLeft: "auto", marginRight: "auto" }}>
      <Link
        to={isCreate ? "/venues" : `/venues/${id}`}
        className="tlink"
        onClick={(e) => {
          if (dirty) {
            e.preventDefault();
            setConfirmLeaveOpen(true);
          }
        }}
      >
        <IconArrowLeft className="ic" />
        Back to {isCreate ? "Venues" : "venue"}
      </Link>

      <div className="pagehead">
        <div className="eyebrow">Venue</div>
        <h1 className="h-page">{isCreate ? "New Venue" : "Edit Venue"}</h1>
      </div>

      <section className="card">
        <div className="card-pad stack-4">
          <div className="block-lbl">
            <span className="label-section">Details</span>
          </div>
          <FormField label="Name" required>
            <input
              className={`input ${form.name ? "input--filled" : ""}`}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="The Glasshouse"
            />
          </FormField>
          <FormField label="Address">
            <input
              className={`input ${form.address ? "input--filled" : ""}`}
              value={form.address}
              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              placeholder="545 W 25th St, New York, NY 10001"
            />
          </FormField>
          <div className="g2">
            <FormField label="Neighborhood">
              <input
                className={`input ${form.neighborhood ? "input--filled" : ""}`}
                value={form.neighborhood}
                onChange={(e) => setForm((f) => ({ ...f, neighborhood: e.target.value }))}
                placeholder="Chelsea"
              />
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
            <FormField label="Capacity">
              <input
                className={`input ${form.capacity ? "input--filled" : ""}`}
                value={form.capacity}
                onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))}
                placeholder="1875"
              />
            </FormField>
            <FormField label="Total Sq Ft">
              <input
                className={`input ${form.total_sq_ft ? "input--filled" : ""}`}
                value={form.total_sq_ft}
                onChange={(e) => setForm((f) => ({ ...f, total_sq_ft: e.target.value }))}
                placeholder="75000"
              />
            </FormField>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-pad stack-4">
          <div className="block-lbl">
            <span className="label-section">Venue Types</span>
          </div>
          <div className="row-c wrap" style={{ gap: 6 }}>
            {typeIds.map((tid) => {
              const t = venueTypes.options.find((o) => o.id === tid);
              if (!t) return null;
              return (
                <span key={tid} className="tag" style={{ display: "inline-flex", gap: 5, alignItems: "center" }}>
                  {t.name}
                  <button
                    type="button"
                    aria-label={`Remove ${t.name}`}
                    onClick={() => setTypeIds(typeIds.filter((x) => x !== tid))}
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
                if (e.target.value === "__add_new__") {
                  setNewTypeName("");
                  setAddTypeOpen(true);
                  return;
                }
                setTypeIds([...typeIds, e.target.value]);
              }}
            >
              <option value="">Add venue type...</option>
              {availableTypes.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
              <option value="__add_new__">+ Add new...</option>
            </select>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-pad stack-4">
          <div className="block-lbl">
            <span className="label-section">Rates</span>
          </div>
          <RateRow
            label="Event Day Rate"
            rate={eventRate}
            disabled={isCreate}
            onLogNew={() => setLogRateOpen("event_day")}
          />
          <RateRow
            label="Prod Day Rate"
            rate={prodRate}
            disabled={isCreate}
            onLogNew={() => setLogRateOpen("prod_day")}
          />
          {isCreate ? (
            <p className="subtle" style={{ fontSize: 12 }}>
              Save the venue first, then log rates on the Edit screen.
            </p>
          ) : null}
        </div>
      </section>

      <section className="card">
        <div className="card-pad stack-4">
          <div className="block-lbl">
            <span className="label-section">Links &amp; References</span>
          </div>
          <div className="g2">
            <FormField label="Website URL">
              <input
                className={`input ${form.website_url ? "input--filled" : ""}`}
                value={form.website_url}
                onChange={(e) => setForm((f) => ({ ...f, website_url: e.target.value }))}
                placeholder="https://theglasshouse.com"
              />
            </FormField>
            <FormField label="Venue Slide URL">
              <input
                className={`input ${form.venue_slide_url ? "input--filled" : ""}`}
                value={form.venue_slide_url}
                onChange={(e) => setForm((f) => ({ ...f, venue_slide_url: e.target.value }))}
                placeholder="https://docs.google.com/presentation/..."
              />
            </FormField>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-pad stack-4">
          <div className="block-lbl">
            <span className="label-section">Exclusive Vendors</span>
          </div>
          <div className="row-c wrap" style={{ gap: 6 }}>
            {vendorIds.map((vid) => {
              const v = vendorOptions.find((x) => x.id === vid);
              if (!v) return null;
              return (
                <span key={vid} className="tag" style={{ display: "inline-flex", gap: 5, alignItems: "center" }}>
                  {v.name}
                  <button
                    type="button"
                    aria-label={`Remove ${v.name}`}
                    onClick={() => setVendorIds(vendorIds.filter((x) => x !== vid))}
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
                setVendorIds([...vendorIds, e.target.value]);
              }}
            >
              <option value="">Add vendor...</option>
              {availableVendors.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-pad stack-4">
          <div className="block-lbl">
            <span className="label-section">About Venue</span>
          </div>
          <FormField label="Deck-copy paragraph">
            <textarea
              className={`input textarea ${form.notes ? "input--filled" : ""}`}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              rows={6}
              placeholder="The Glasshouse is a three-floor Chelsea venue..."
            />
          </FormField>
          <FormField label="Features (comma-separated)">
            <input
              className={`input ${form.features ? "input--filled" : ""}`}
              value={form.features}
              onChange={(e) => setForm((f) => ({ ...f, features: e.target.value }))}
              placeholder="Loading Dock, Freight Elevator, AV In-House"
            />
          </FormField>
        </div>
      </section>

      <StickySaveBar
        dirty={dirty}
        saving={saving}
        onCancel={onCancel}
        onSave={onSave}
        saveLabel={isCreate ? "Create venue" : "Save changes"}
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
              onClick={() => navigate(isCreate ? "/venues" : `/venues/${id}`)}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={addTypeOpen} onOpenChange={setAddTypeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Add a new venue type</AlertDialogTitle>
          </AlertDialogHeader>
          <input
            className="input"
            autoFocus
            placeholder="e.g. White Box"
            value={newTypeName}
            onChange={(e) => setNewTypeName(e.target.value)}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                const trimmed = newTypeName.trim();
                if (!trimmed) return;
                const added = await venueTypes.addOption(trimmed);
                if (added) {
                  setTypeIds([...typeIds, added.id]);
                  setAddTypeOpen(false);
                  setNewTypeName("");
                }
              }}
            >
              Add
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(logRateOpen)}
        onOpenChange={(v) => !v && setLogRateOpen(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Log a new {logRateOpen === "event_day" ? "Event Day Rate" : "Prod Day Rate"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Existing rate history rows stay locked. The new row becomes the
              most-recent rate displayed on the Detail page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="stack-3" style={{ marginTop: 8 }}>
            <div className="field">
              <label className="label-form">Amount (USD)</label>
              <input
                className="input"
                value={newRateAmount}
                onChange={(e) => setNewRateAmount(e.target.value)}
                placeholder="42000"
              />
            </div>
            <div className="field">
              <label className="label-form">Effective from</label>
              <input
                type="date"
                className="input"
                value={newRateDate}
                onChange={(e) => setNewRateDate(e.target.value)}
              />
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onLogRate}>Log rate</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function RateRow({
  label,
  rate,
  disabled,
  onLogNew,
}: {
  label: string;
  rate: VenueRate | undefined;
  disabled: boolean;
  onLogNew: () => void;
}) {
  return (
    <div className="row between" style={{ alignItems: "center" }}>
      <div>
        <div className="label-form">{label}</div>
        <div style={{ marginTop: 4 }}>
          {rate ? (
            <>
              <span className="mono">${rate.amount_usd.toLocaleString("en-US")}</span>{" "}
              <span className="cap">as of {formatShortDate(rate.effective_from)}</span>
            </>
          ) : (
            <span className="muted subtle">No rate logged yet.</span>
          )}
        </div>
      </div>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={onLogNew}
        disabled={disabled}
      >
        Log new rate
      </button>
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
