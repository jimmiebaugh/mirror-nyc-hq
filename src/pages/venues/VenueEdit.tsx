import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { StickySaveBar } from "@/components/data/StickySaveBar";
import { HQFormField } from "@/components/hq/HQFormField";
import { RecordCombobox, type Option } from "@/components/ui/RecordCombobox";
import { InlineEditText } from "@/components/hq/InlineEditText";
import { IconArrowLeft, IconLink, IconSlides } from "@/components/icons/HQIcons";
import { prettyHost } from "@/lib/url";
import { VenueTypePill } from "@/components/venues/VenueTypePill";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
import { useCityIdForName, useLookup } from "@/lib/hq/lookups";
import { formatShortDate } from "@/lib/hq/dates";
import { loadLatestVenueRates, type VenueRate } from "@/lib/venues/queries";

/**
 * Venue Edit (Surface 09 create + edit).
 * Wireframe binding: Surface 08 Project Edit pattern (lines 1487-1583)
 * applied to the Venue fieldset per spec § 5.C.3.
 *
 *   crumb -> eyebrow + h-page -> .card blocks (card-headbar header matching
 *   VenueDetail) for:
 *     1. Details (2-col: Name | Venue Types pills, City | Neighborhood,
 *        Website | General Email, divider, 3-col Address/Total Sq Ft/Capacity,
 *        divider, Features tag input). Venue Types writes to the
 *        venue_venue_types join on save; Features is a string[] via
 *        InlineTagInput; Website is an inline coral link (prettyHost).
 *     2. Master Venue Deck Slide (venue_slide_url -> "Venue Slide" button when
 *        set + Edit-link toggle to the input)
 *     3. About Venue (venues.about_venue textarea + Generate button)
 *     4. Rates (Event Day + Prod Day; "Log new rate" opens a mini-dialog
 *        that INSERTs into venue_rate_history; existing rows immutable)
 *     5. Exclusive Vendors (multi-select Vendor picker;
 *        writes to venues.exclusive_vendor_ids)
 *   -> .savebar sticky bottom.
 */

type FormState = {
  name: string;
  address: string;
  neighborhood: string;
  city: string;
  capacity: string;
  total_sq_ft: string;
  general_email: string;
  website_url: string;
  venue_slide_url: string;
  aboutVenue: string;
  features: string[];
};

const EMPTY: FormState = {
  name: "",
  address: "",
  neighborhood: "",
  city: "",
  capacity: "",
  total_sq_ft: "",
  general_email: "",
  website_url: "",
  venue_slide_url: "",
  aboutVenue: "",
  features: [],
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
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [regenerateConfirmOpen, setRegenerateConfirmOpen] = useState(false);
  const [slideEditing, setSlideEditing] = useState(false);
  const [logRateOpen, setLogRateOpen] = useState<"event_day" | "prod_day" | null>(null);
  const [newRateAmount, setNewRateAmount] = useState("");
  const [newRateDate, setNewRateDate] = useState(new Date().toISOString().slice(0, 10));
  const venueTypes = useLookup("venue_types");
  // Phase 5.12.9: resolve form.city -> canonical cities.id so the
  // neighborhoods picker can parent-scope. Returns null while loading or
  // when city is blank / not a canonical lookup name; picker stays
  // disabled until a real city is chosen.
  const cityId = useCityIdForName(form?.city ?? null);

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
                "name, address, neighborhood, city, capacity, total_sq_ft, general_email, website_url, venue_slide_url, about_venue, features, exclusive_vendor_ids",
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
          general_email: string | null;
          website_url: string | null;
          venue_slide_url: string | null;
          about_venue: string | null;
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
          general_email: row.general_email ?? "",
          website_url: row.website_url ?? "",
          venue_slide_url: row.venue_slide_url ?? "",
          aboutVenue: row.about_venue ?? "",
          features: row.features ?? [],
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

  const vendorRecordOptions: Option[] = useMemo(
    () => vendorOptions.map((v) => ({ id: v.id, label: v.name })),
    [vendorOptions],
  );
  const loadVendorOptions = useCallback(
    () => Promise.resolve(vendorRecordOptions),
    [vendorRecordOptions],
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
      general_email: form.general_email || null,
      website_url: form.website_url || null,
      venue_slide_url: form.venue_slide_url || null,
      about_venue: form.aboutVenue || null,
      features: form.features,
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

  // Phase 5.7.3 § 3.B: hard delete. Cascade posture (verified against the
  // FK graph): venues delete cascades `venue_venue_types`, `venue_rate_history`,
  // `venue_contact_people`, and `project_venues` join/per-venue rows, and
  // sets `people.venue_id` and `vs_scouts.linked_venue_id` to NULL.
  // No standalone records cascade.
  const handleDelete = async () => {
    if (!id) return;
    setDeleting(true);
    const { error } = await supabase.from("venues").delete().eq("id", id);
    if (error) {
      setDeleting(false);
      setConfirmDeleteOpen(false);
      toast({
        title: "Could not delete venue",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    toast({ title: "Deleted venue" });
    navigate("/venues");
  };

  // Phase 5.10.0: generate the About Venue paragraph. The edge function reads
  // the SAVED venue row + persists about_venue, so we sync BOTH form state and
  // the initial snapshot to the returned value -> the form stays clean (no
  // dirty marker) because the DB value now matches the form value. Only fires
  // when the form is not dirty (button is disabled otherwise) so the generator
  // never runs against stale-saved values while edits are pending.
  const handleGenerate = async () => {
    if (!id) return;
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "hq-generate-venue-about",
        { body: { venue_id: id } },
      );
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "Generation failed");
      setForm((f) => ({ ...f, aboutVenue: data.about_venue }));
      setInitial((i) => ({ ...i, aboutVenue: data.about_venue }));
      toast({ title: "About paragraph generated" });
    } catch (err) {
      toast({
        title: "Couldn't generate paragraph",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
    }
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
  const typeNames = typeIds
    .map((tid) => venueTypes.options.find((o) => o.id === tid)?.name)
    .filter((n): n is string => Boolean(n));

  return (
    <div className="stack-4 hq-form" style={{ paddingBottom: 120, maxWidth: 880, marginLeft: "auto", marginRight: "auto" }}>
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
                placeholder="The Glasshouse"
              />
            </HQFormField>
            <HQFormField label="Venue Types">
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 8 }}>
                {typeNames.length > 0 ? (
                  <span className="row-c wrap" style={{ display: "inline-flex", gap: 5 }}>
                    {typeNames.map((t) => (
                      <VenueTypePill key={t} type={t} />
                    ))}
                  </span>
                ) : null}
                <RecordCombobox
                  multi
                  hideMultiValueChips
                  source={{ kind: "lookup", table: "venue_types" }}
                  multiValue={typeNames}
                  onMultiChange={(names) => {
                    const nextIds: string[] = [];
                    for (const n of names) {
                      const match = venueTypes.options.find((o) => o.name === n);
                      if (match) nextIds.push(match.id);
                    }
                    setTypeIds(nextIds);
                  }}
                  entityLabel="Venue Type"
                  placeholder="Add venue type..."
                />
              </div>
            </HQFormField>
          </div>
          <div style={{ borderTop: "1px solid hsl(var(--border))" }} />
          <div className="g2">
            <HQFormField label="City">
              <RecordCombobox
                source={{ kind: "lookup", table: "cities" }}
                value={form.city || null}
                onChange={(v) =>
                  // Phase 5.12.9: city change clears neighborhood
                  // (prior pick may not exist under the new city).
                  setForm((f) => ({ ...f, city: v ?? "", neighborhood: "" }))
                }
                entityLabel="city"
              />
            </HQFormField>
            <HQFormField label="Neighborhood">
              <RecordCombobox
                source={{
                  kind: "lookup",
                  table: "neighborhoods",
                  parentScopeId: cityId,
                  parentScopeLabel: form.city || null,
                  parentScopeLabelKey: "City",
                }}
                value={form.neighborhood || null}
                onChange={(v) => setForm((f) => ({ ...f, neighborhood: v ?? "" }))}
                entityLabel="neighborhood"
                placeholder={cityId ? "Select" : "Pick a city first"}
                disabled={!cityId}
              />
            </HQFormField>
          </div>
          <div style={{ borderTop: "1px solid hsl(var(--border))" }} />
          <div className="g2">
            <HQFormField label="Website URL">
              <InlineEditText
                value={form.website_url || null}
                inputType="url"
                placeholder="https://theglasshouse.com"
                renderRead={(v) =>
                  v ? (
                    <a
                      className="tlink"
                      href={v}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <IconLink className="ic ic-sm" /> {prettyHost(v)}
                    </a>
                  ) : (
                    <span className="muted subtle">Add website URL</span>
                  )
                }
                onSave={(next) => {
                  setForm((f) => ({ ...f, website_url: next }));
                  return Promise.resolve();
                }}
              />
            </HQFormField>
            <HQFormField label="General Email">
              <input
                type="email"
                className={`input ${form.general_email ? "input--filled" : ""}`}
                value={form.general_email}
                onChange={(e) => setForm((f) => ({ ...f, general_email: e.target.value }))}
                placeholder="bookings@theglasshouse.com"
              />
            </HQFormField>
          </div>
          <div style={{ borderTop: "1px solid hsl(var(--border))" }} />
          <div className="venue-addr-row">
            <HQFormField label="Address">
              <input
                className={`input ${form.address ? "input--filled" : ""}`}
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                placeholder="545 W 25th St, New York, NY 10001"
              />
            </HQFormField>
            <HQFormField label="Total Sq Ft">
              <input
                className={`input ${form.total_sq_ft ? "input--filled" : ""}`}
                value={form.total_sq_ft}
                onChange={(e) => setForm((f) => ({ ...f, total_sq_ft: e.target.value }))}
                placeholder="75000"
              />
            </HQFormField>
            <HQFormField label="Capacity">
              <input
                className={`input ${form.capacity ? "input--filled" : ""}`}
                value={form.capacity}
                onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))}
                placeholder="1875"
              />
            </HQFormField>
          </div>
          <div style={{ borderTop: "1px solid hsl(var(--border))" }} />
          <HQFormField label="Features">
            <div className="field-chips">
              <RecordCombobox
                multi
                source={{ kind: "lookup", table: "venue_features" }}
                multiValue={form.features}
                onMultiChange={(next) => setForm((f) => ({ ...f, features: next }))}
                entityLabel="Feature"
                placeholder="Add feature..."
              />
            </div>
          </HQFormField>
        </div>
      </section>

      <section className="card">
        <div className="card-headbar">
          <span className="h-card">Master Venue Deck Slide</span>
        </div>
        <div className="card-pad stack-4">
          {form.venue_slide_url && !slideEditing ? (
            <div className="row-c" style={{ gap: 12, alignItems: "center" }}>
              <a
                className="btn btn-secondary"
                href={form.venue_slide_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <IconSlides className="ic" /> Venue Slide
              </a>
              <button type="button" className="tlink" onClick={() => setSlideEditing(true)}>
                Edit link
              </button>
            </div>
          ) : (
            <input
              className={`input ${form.venue_slide_url ? "input--filled" : ""}`}
              value={form.venue_slide_url}
              onChange={(e) => setForm((f) => ({ ...f, venue_slide_url: e.target.value }))}
              onBlur={() => setSlideEditing(false)}
              autoFocus={slideEditing}
              placeholder="https://docs.google.com/presentation/..."
            />
          )}
        </div>
      </section>

      <section className="card">
        <div className="card-headbar">
          <span className="h-card">About Venue</span>
          {!isCreate && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={
                      form.aboutVenue.trim()
                        ? () => setRegenerateConfirmOpen(true)
                        : handleGenerate
                    }
                    disabled={generating || dirty}
                  >
                    {generating ? (
                      <>
                        <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                        Generating…
                      </>
                    ) : form.aboutVenue.trim() ? (
                      "Regenerate"
                    ) : (
                      "Generate"
                    )}
                  </Button>
                </span>
              </TooltipTrigger>
              {dirty && (
                <TooltipContent>
                  Save your changes first to generate based on current data.
                </TooltipContent>
              )}
            </Tooltip>
          )}
        </div>
        <div className="card-pad stack-4">
          <HQFormField label="Deck-copy paragraph">
            <textarea
              className={`input textarea ${form.aboutVenue ? "input--filled" : ""}`}
              value={form.aboutVenue}
              onChange={(e) => setForm((f) => ({ ...f, aboutVenue: e.target.value }))}
              rows={6}
              placeholder="The Glasshouse is a three-floor Chelsea venue..."
            />
          </HQFormField>
        </div>
      </section>

      <section className="card">
        <div className="card-headbar">
          <span className="h-card">Rates</span>
        </div>
        <div className="card-pad stack-4">
          <div className="g2">
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
          </div>
          {isCreate ? (
            <p className="subtle" style={{ fontSize: 12 }}>
              Save the venue first, then log rates on the Edit screen.
            </p>
          ) : null}
        </div>
      </section>

      <section className="card">
        <div className="card-headbar">
          <span className="h-card">Exclusive Vendors</span>
        </div>
        <div className="card-pad stack-4">
          <RecordCombobox
            multi
            source={{ kind: "record", loadOptions: loadVendorOptions }}
            multiValue={vendorIds}
            onMultiChange={setVendorIds}
            entityLabel="Vendor"
            placeholder="Add vendor..."
          />
        </div>
      </section>

      <StickySaveBar
        dirty={dirty}
        saving={saving}
        onCancel={onCancel}
        onSave={onSave}
        saveLabel={isCreate ? "Create venue" : "Save changes"}
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
              onClick={() => navigate(isCreate ? "/venues" : `/venues/${id}`)}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this venue?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. The venue and its records will be removed
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


      <AlertDialog open={regenerateConfirmOpen} onOpenChange={setRegenerateConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Regenerate About paragraph?</AlertDialogTitle>
            <AlertDialogDescription>
              The current About paragraph will be cleared and overwritten. This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setRegenerateConfirmOpen(false);
                void handleGenerate();
              }}
            >
              Regenerate
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
    <div className="row" style={{ alignItems: "center", gap: 12 }}>
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
