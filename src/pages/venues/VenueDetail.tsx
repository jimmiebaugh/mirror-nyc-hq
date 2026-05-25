import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Loader2, Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { IconArrowLeft, IconLink, IconSlides } from "@/components/icons/HQIcons";
import { InternalNotesEditor } from "@/components/data/InternalNotesEditor";
import { InlineEditText } from "@/components/hq/InlineEditText";
import { ContactsCard } from "@/components/hq/ContactsCard";
import { DField } from "@/components/hq/DField";
import { RecordCombobox } from "@/components/ui/RecordCombobox";
import { formatShortDate } from "@/lib/hq/dates";
import { loadLatestVenueRates, type VenueRate } from "@/lib/venues/queries";
import { useBackHref } from "@/lib/hq/useBackHref";
import { useLookup, getLookupCached } from "@/lib/hq/lookups";
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
import { prettyHost } from "@/lib/url";
import { VenueTypePill } from "@/components/venues/VenueTypePill";
import { toast } from "@/hooks/use-toast";

/**
 * Venue Detail (Surface 09).
 *
 * Phase 5.6.3.1: detail-page inline-edit pattern. Every editable field
 * saves itself optimistically. Pencil icon button stays as the
 * power-edit fallback. Out of scope for inline edit (deferred): Venue
 * Type multi-select (via venue_venue_types join), Event/Prod Day Rate
 * (history table — needs the "append a new history row" UX), Contacts
 * (separate join surface).
 */

type Venue = {
  id: string;
  name: string;
  address: string | null;
  neighborhood: string | null;
  city: string | null;
  capacity: number | null;
  total_sq_ft: number | null;
  general_email: string | null;
  website_url: string | null;
  venue_slide_url: string | null;
  features: string[];
  about_venue: string | null;
  exclusive_vendor_ids: string[];
};

type Contact = { id: string; full_name: string; email: string | null; role_title: string | null };
type ProjectLink = { id: string; name: string; job_number: string | null };
type VendorRow = { id: string; name: string };

export default function VenueDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [venue, setVenue] = useState<Venue | null>(null);
  const [venueTypeIds, setVenueTypeIds] = useState<string[]>([]);
  const [venueTypes, setVenueTypes] = useState<string[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [projects, setProjects] = useState<ProjectLink[]>([]);
  const [vendors, setVendors] = useState<VendorRow[]>([]);
  const [vendorOptions, setVendorOptions] = useState<{ id: string; label: string }[]>([]);
  const [rates, setRates] = useState<VenueRate[]>([]);
  const [rateModalKind, setRateModalKind] = useState<"event_day" | "prod_day" | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [regenerateConfirmOpen, setRegenerateConfirmOpen] = useState(false);
  const back = useBackHref({ to: "/venues", label: "Venues" });
  const venueTypesLookup = useLookup("venue_types");

  useEffect(() => {
    if (!id) return;
    let active = true;
    (async () => {
      const venueRes = await supabase
        .from("venues")
        .select(
          "id, name, address, neighborhood, city, capacity, total_sq_ft, general_email, website_url, venue_slide_url, features, about_venue, exclusive_vendor_ids",
        )
        .eq("id", id)
        .single();
      if (!active) return;
      if (venueRes.error || !venueRes.data) {
        console.warn("venue load failed", venueRes.error);
        setLoading(false);
        return;
      }
      const row = venueRes.data as unknown as Venue;
      setVenue({ ...row, features: row.features ?? [], exclusive_vendor_ids: row.exclusive_vendor_ids ?? [] });

      const [typesRes, contactsRes, projectsRes, vendorsRes, allVendorsRes, ratesRes] = await Promise.all([
        supabase
          .from("venue_venue_types")
          .select("venue_type_id, venue_type:venue_types!venue_venue_types_venue_type_id_fkey(id, name)")
          .eq("venue_id", id),
        supabase
          .from("venue_contact_people")
          .select("person:people!venue_contact_people_person_id_fkey(id, full_name, email, role_title)")
          .eq("venue_id", id),
        supabase
          .from("project_venues")
          .select("project:projects!project_venues_project_id_fkey(id, name, job_number)")
          .eq("venue_id", id),
        row.exclusive_vendor_ids.length > 0
          ? supabase.from("vendors").select("id, name").in("id", row.exclusive_vendor_ids)
          : Promise.resolve({ data: [], error: null }),
        supabase.from("vendors").select("id, name").order("name", { ascending: true }),
        loadLatestVenueRates(row.id),
      ]);
      if (!active) return;
      const typeRows = (typesRes.data ?? []) as unknown as {
        venue_type_id: string;
        venue_type: { id: string; name: string } | null;
      }[];
      setVenueTypes(
        typeRows.map((r) => r.venue_type?.name).filter((n): n is string => Boolean(n)),
      );
      setVenueTypeIds(typeRows.map((r) => r.venue_type_id));
      setContacts(
        ((contactsRes.data ?? []) as unknown as { person: Contact | null }[])
          .map((r) => r.person)
          .filter((p): p is Contact => Boolean(p)),
      );
      setProjects(
        ((projectsRes.data ?? []) as unknown as { project: ProjectLink | null }[])
          .map((r) => r.project)
          .filter((p): p is ProjectLink => Boolean(p)),
      );
      setVendors((vendorsRes.data ?? []) as unknown as VendorRow[]);
      setVendorOptions(
        ((allVendorsRes.data ?? []) as { id: string; name: string | null }[]).map((v) => ({
          id: v.id,
          label: v.name ?? "Untitled",
        })),
      );
      setRates(ratesRes);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [id]);

  const saveField = async <K extends keyof Venue>(
    field: K,
    nextValue: Venue[K],
  ): Promise<void> => {
    if (!venue) return;
    const prev = venue[field];
    setVenue({ ...venue, [field]: nextValue });
    const { error } = await supabase
      .from("venues")
      .update({ [field as string]: nextValue })
      .eq("id", venue.id);
    if (error) {
      setVenue({ ...venue, [field]: prev });
      throw error;
    }
  };

  // Phase 5.10.0: generate the About Venue paragraph via the hq edge function.
  // The function persists about_venue to the DB and returns it; we mirror the
  // value into local state optimistically. Used for both Generate (empty) and
  // Regenerate (populated, gated by the confirm dialog).
  const handleGenerate = async () => {
    if (!venue) return;
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "hq-generate-venue-about",
        { body: { venue_id: venue.id } },
      );
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "Generation failed");
      setVenue((v) => (v ? { ...v, about_venue: data.about_venue } : v));
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

  // exclusive_vendor_ids is a uuid[] on the row; saving uses the same
  // single-field UPDATE. The visible vendor links list re-derives from
  // the picker option labels.
  const saveExclusiveVendorIds = async (nextIds: string[]) => {
    if (!venue) return;
    const prevIds = venue.exclusive_vendor_ids;
    const prevVendors = vendors;
    setVenue({ ...venue, exclusive_vendor_ids: nextIds });
    setVendors(
      nextIds
        .map((vid) => vendorOptions.find((o) => o.id === vid))
        .filter((o): o is { id: string; label: string } => !!o)
        .map((o) => ({ id: o.id, name: o.label })),
    );
    const { error } = await supabase
      .from("venues")
      .update({ exclusive_vendor_ids: nextIds })
      .eq("id", venue.id);
    if (error) {
      setVenue({ ...venue, exclusive_vendor_ids: prevIds });
      setVendors(prevVendors);
      toast({ title: "Exclusive Vendors save failed", description: error.message, variant: "destructive" });
    }
  };

  const loadVendorOptions = useCallback(async () => vendorOptions, [vendorOptions]);

  // Venue Types diff-on-save: insert added, delete removed rows in the
  // venue_venue_types join. Mirrors PersonDetail's saveVenueIds shape.
  const saveVenueTypeIds = async (nextIds: string[]) => {
    if (!venue) return;
    const prevIds = venueTypeIds;
    const prevLabels = venueTypes;
    setVenueTypeIds(nextIds);
    setVenueTypes(
      nextIds
        .map((tid) => venueTypesLookup.options.find((o) => o.id === tid)?.name)
        .filter((n): n is string => !!n),
    );
    const toAdd = nextIds.filter((t) => !prevIds.includes(t));
    const toRemove = prevIds.filter((t) => !nextIds.includes(t));
    try {
      for (const typeId of toAdd) {
        const { error } = await supabase
          .from("venue_venue_types")
          .insert({ venue_id: venue.id, venue_type_id: typeId });
        if (error) throw error;
      }
      for (const typeId of toRemove) {
        const { error } = await supabase
          .from("venue_venue_types")
          .delete()
          .eq("venue_id", venue.id)
          .eq("venue_type_id", typeId);
        if (error) throw error;
      }
    } catch (err) {
      setVenueTypeIds(prevIds);
      setVenueTypes(prevLabels);
      const message = err instanceof Error ? err.message : "Save failed";
      toast({ title: "Venue Type save failed", description: message, variant: "destructive" });
    }
  };

  // Append a new rate row to venue_rate_history (append-only table; we
  // never UPDATE — every change is a new row with effective_from). The
  // most-recent row per rate_kind drives the "as of <date>" display.
  const saveNewRate = async (kind: "event_day" | "prod_day", amount: number, effectiveFrom: string) => {
    if (!venue) return;
    const { data: userRes } = await supabase.auth.getUser();
    const created_by = userRes.user?.id;
    if (!created_by) {
      toast({ title: "Not signed in", variant: "destructive" });
      return;
    }
    const { error } = await supabase.from("venue_rate_history").insert({
      venue_id: venue.id,
      rate_kind: kind,
      amount_usd: amount,
      effective_from: effectiveFrom,
      created_by,
    });
    if (error) {
      toast({ title: "Rate save failed", description: error.message, variant: "destructive" });
      return;
    }
    // Re-load latest rates so the kv shows the new one.
    const fresh = await loadLatestVenueRates(venue.id);
    setRates(fresh);
    setRateModalKind(null);
    toast({ title: `${kind === "event_day" ? "Event Day" : "Prod Day"} Rate updated` });
  };

  if (loading) {
    return (
      <div className="empty">
        <p>Loading...</p>
      </div>
    );
  }
  if (!venue) {
    return (
      <div className="empty">
        <p>Venue not found.</p>
      </div>
    );
  }

  const eventRate = rates.find((r) => r.rate_kind === "event_day");
  const prodRate = rates.find((r) => r.rate_kind === "prod_day");

  return (
    <div className="stack-6">
      <div className="stack-2">
        <Link to={back.to} className="crumb">
          <IconArrowLeft className="ic ic-sm" /> Back to {back.label}
        </Link>
        <div className="row between" style={{ alignItems: "flex-end", gap: 24, paddingTop: 16 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="eyebrow" style={{ paddingTop: 8 }}>Venue</div>
            <div
              className="row-c"
              style={{ gap: 16, alignItems: "center", flexWrap: "wrap", marginTop: 5, minWidth: 0 }}
            >
              <h1 className="h-page" style={{ minWidth: 0 }}>
                {venue.name || "(unnamed)"}
              </h1>
              {venueTypes.map((t) => (
                <VenueTypePill key={t} type={t} large />
              ))}
            </div>
            {(venue.city || venue.neighborhood) ? (
              <div className="row-c detail-meta" style={{ gap: 12, marginTop: 8 }}>
                <span>
                  {[venue.city, venue.neighborhood ? `(${venue.neighborhood})` : null]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
            ) : null}
          </div>
          <div
            style={{ display: "flex", flexDirection: "column", gap: 8, width: 172, flex: "none" }}
          >
            <button
              type="button"
              className="btn btn-secondary"
              aria-label="Edit Venue"
              title="Edit Venue"
              style={{ width: "100%", padding: "0 10px" }}
              onClick={() => navigate(`/venues/${venue.id}/edit`)}
            >
              <Pencil className="ic" style={{ width: 14, height: 14 }} />
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ width: "100%" }}
              disabled={!venue.venue_slide_url}
              onClick={() => {
                if (venue.venue_slide_url)
                  window.open(venue.venue_slide_url, "_blank", "noopener,noreferrer");
              }}
            >
              <IconSlides className="ic" />
              Venue Slide
            </button>
          </div>
        </div>
      </div>

      <div className="detail-2col">
        <div className="stack-6">
          <section className="card">
            <div className="card-headbar">
              <span className="h-card">Details</span>
            </div>
            <div className="card-pad stack-4 vd-fields">
              {/* Phase 5.10.1: label-above layout matching VenueEdit (Venue
                  Types full row; City | Neighborhood; 3-col Address / Total
                  Sq Ft / Capacity; Website | General Email; Features), with
                  a hairline between rows. Rates + Exclusive Vendors are now
                  their own cards below. Venue Slide stays the header button.
                  Phase 5.11.1 swapped the Address row above the Website row. */}
              <div className="g2">
                <DField label="Name">
                  <InlineEditText
                    value={venue.name}
                    required
                    placeholder="Venue name"
                    renderRead={(v) => (v ? v : <span className="muted subtle">(unnamed)</span>)}
                    onSave={(next) => saveField("name", next)}
                  />
                </DField>
                <DField label="Venue Types">
                  <div style={{ display: "flex", flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                  {venueTypes.length > 0 ? (
                    <span className="row-c wrap" style={{ display: "inline-flex", gap: 5 }}>
                      {venueTypes.map((t) => (
                        <VenueTypePill key={t} type={t} />
                      ))}
                    </span>
                  ) : null}
                  <RecordCombobox
                    multi
                    hideMultiValueChips
                    source={{ kind: "lookup", table: "venue_types" }}
                    multiValue={venueTypesLookup.options
                      .filter((o) => venueTypeIds.includes(o.id))
                      .map((o) => o.name)}
                    onMultiChange={(nextNames) => {
                      const cached = getLookupCached("venue_types");
                      const nextIds = nextNames
                        .map(
                          (n) =>
                            venueTypesLookup.options.find((o) => o.name === n)?.id ??
                            cached.find((o) => o.name === n)?.id,
                        )
                        .filter((x): x is string => !!x);
                      if (nextIds.length !== nextNames.length) return;
                      void saveVenueTypeIds(nextIds);
                    }}
                    entityLabel="Venue type"
                    placeholder="Select"
                  />
                </div>
                </DField>
              </div>
              <div style={{ borderTop: "1px solid hsl(var(--border))" }} />
              <div className="g2">
                <DField label="City">
                  <RecordCombobox
                    source={{ kind: "lookup", table: "cities" }}
                    value={venue.city || null}
                    onChange={(next) => void saveField("city", next || null)}
                    entityLabel="city"
                    placeholder="Select"
                  />
                </DField>
                <DField label="Neighborhood">
                  <InlineEditText
                    value={venue.neighborhood}
                    placeholder="Neighborhood"
                    renderRead={(v) => (v ? v : <span className="muted subtle">-</span>)}
                    onSave={(next) => saveField("neighborhood", next || null)}
                  />
                </DField>
              </div>
              <div style={{ borderTop: "1px solid hsl(var(--border))" }} />
              {/* Address takes the left half (matches the g2 left column above);
                  the right half nests another g2 to split Total Sq Ft / Capacity
                  evenly. This keeps Total Sq Ft's left edge aligned with the
                  right-column labels above (City right, Website right, etc.). */}
              <div className="g2">
                <DField label="Address">
                  <InlineEditText
                    value={venue.address}
                    placeholder="Street address"
                    renderRead={(v) => (v ? v : <span className="muted subtle">-</span>)}
                    onSave={(next) => saveField("address", next || null)}
                  />
                </DField>
                <div className="g2">
                  <DField label="Total Sq Ft">
                    <InlineEditText
                      value={venue.total_sq_ft != null ? String(venue.total_sq_ft) : null}
                      placeholder="Total sq ft"
                      inputType="number"
                      renderRead={(v) =>
                        v ? Number(v).toLocaleString("en-US") : <span className="muted subtle">-</span>
                      }
                      onSave={(next) => {
                        const parsed = next ? Number(next.replace(/[^0-9]/g, "")) : null;
                        return saveField(
                          "total_sq_ft",
                          parsed != null && Number.isFinite(parsed) ? parsed : null,
                        );
                      }}
                    />
                  </DField>
                  <DField label="Capacity">
                    <InlineEditText
                      value={venue.capacity != null ? String(venue.capacity) : null}
                      placeholder="Capacity"
                      inputType="number"
                      renderRead={(v) =>
                        v ? Number(v).toLocaleString("en-US") : <span className="muted subtle">-</span>
                      }
                      onSave={(next) => {
                        const parsed = next ? Number(next.replace(/[^0-9]/g, "")) : null;
                        return saveField(
                          "capacity",
                          parsed != null && Number.isFinite(parsed) ? parsed : null,
                        );
                      }}
                    />
                  </DField>
                </div>
              </div>
              <div style={{ borderTop: "1px solid hsl(var(--border))" }} />
              <div className="g2">
                <DField label="Website">
                  <InlineEditText
                    value={venue.website_url}
                    placeholder="https://example.com"
                    inputType="url"
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
                        <span className="muted subtle">-</span>
                      )
                    }
                    onSave={(next) => saveField("website_url", next || null)}
                  />
                </DField>
                <DField label="General Email">
                  <InlineEditText
                    value={venue.general_email}
                    placeholder="bookings@example.com"
                    inputType="email"
                    renderRead={(v) =>
                      v ? (
                        <a
                          className="tlink inline-block max-w-full truncate align-bottom"
                          href={`mailto:${v}`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {v}
                        </a>
                      ) : (
                        <span className="muted subtle">-</span>
                      )
                    }
                    onSave={(next) => saveField("general_email", next || null)}
                  />
                </DField>
              </div>
              <div style={{ borderTop: "1px solid hsl(var(--border))" }} />
              <div className="field-chips">
                <DField label="Features">
                  <RecordCombobox
                    multi
                    source={{ kind: "lookup", table: "venue_features" }}
                    multiValue={venue.features}
                    onMultiChange={(next) => void saveField("features", next)}
                    entityLabel="Feature"
                    placeholder="Add feature..."
                  />
                </DField>
              </div>
            </div>
          </section>

          <section className="card">
            <div
              className="card-headbar"
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
            >
              <span className="h-card">About Venue</span>
              <Button
                variant="outline"
                size="sm"
                onClick={
                  venue.about_venue?.trim()
                    ? () => setRegenerateConfirmOpen(true)
                    : handleGenerate
                }
                disabled={generating}
              >
                {generating ? (
                  <>
                    <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                    Generating…
                  </>
                ) : venue.about_venue?.trim() ? (
                  "Regenerate About Paragraph"
                ) : (
                  "Generate About Paragraph"
                )}
              </Button>
            </div>
            <div className="card-pad">
              <InlineEditText
                value={venue.about_venue}
                placeholder="Deck-copy paragraph about the venue..."
                multiline
                renderRead={(v) =>
                  v ? (
                    <p
                      style={{
                        fontSize: 15,
                        lineHeight: 1.65,
                        color: "hsl(var(--muted-foreground))",
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {v}
                    </p>
                  ) : (
                    <p className="subtle" style={{ fontSize: 13 }}>
                      No deck-copy paragraph yet. Click to add one.
                    </p>
                  )
                }
                onSave={(next) => saveField("about_venue", next || null)}
              />
            </div>
          </section>

          <section className="card">
            <div className="card-headbar">
              <span className="h-card">Rates</span>
            </div>
            <div className="card-pad">
              <div className="g2">
                <DField label="Event Day Rate">
                  <button
                    type="button"
                    className="inline-edit-read"
                    title="Click to add a new rate"
                    onClick={() => setRateModalKind("event_day")}
                    style={{ background: "transparent", border: 0, padding: "1px 4px", margin: "-1px -4px", cursor: "text", textAlign: "left", font: "inherit", color: "inherit" }}
                  >
                    {eventRate ? (
                      <>
                        ${eventRate.amount_usd.toLocaleString("en-US")}{" "}
                        <span className="cap">as of {formatShortDate(eventRate.effective_from)}</span>
                      </>
                    ) : (
                      <span className="muted subtle">Click to add</span>
                    )}
                  </button>
                </DField>
                <DField label="Prod Day Rate">
                  <button
                    type="button"
                    className="inline-edit-read"
                    title="Click to add a new rate"
                    onClick={() => setRateModalKind("prod_day")}
                    style={{ background: "transparent", border: 0, padding: "1px 4px", margin: "-1px -4px", cursor: "text", textAlign: "left", font: "inherit", color: "inherit" }}
                  >
                    {prodRate ? (
                      <>
                        ${prodRate.amount_usd.toLocaleString("en-US")}{" "}
                        <span className="cap">as of {formatShortDate(prodRate.effective_from)}</span>
                      </>
                    ) : (
                      <span className="muted subtle">Click to add</span>
                    )}
                  </button>
                </DField>
              </div>
            </div>
          </section>

          <section className="card">
            <div className="card-headbar">
              <span className="h-card">Exclusive Vendors</span>
              <div className="combo-as-link">
                <RecordCombobox
                  multi
                  hideMultiValueChips
                  source={{ kind: "record", loadOptions: loadVendorOptions }}
                  multiValue={venue.exclusive_vendor_ids}
                  onMultiChange={(next) => void saveExclusiveVendorIds(next)}
                  entityLabel="Vendor"
                  placeholder="+ Add"
                />
              </div>
            </div>
            <div className="card-pad">
              {vendors.length > 0 ? (
                <span className="row-c wrap" style={{ display: "inline-flex", gap: 6 }}>
                  {vendors.map((v, i) => (
                    <span key={v.id} className="row-c" style={{ gap: 6 }}>
                      <Link to={`/vendors/${v.id}`} className="tlink">
                        {v.name}
                      </Link>
                      {i < vendors.length - 1 ? (
                        <span className="muted" aria-hidden="true">·</span>
                      ) : null}
                    </span>
                  ))}
                </span>
              ) : (
                <span className="muted subtle">No exclusive vendors yet.</span>
              )}
            </div>
          </section>
        </div>

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

        <aside className="stack-6">
          <ContactsCard contacts={contacts} />

          <InternalNotesEditor parentType="venue" parentId={venue.id} />

          <section className="card">
            <div className="card-headbar">
              <span className="h-card">Past Projects</span>
            </div>
            <div className="card-pad">
              {projects.length === 0 ? (
                <p className="subtle" style={{ fontSize: 13 }}>No projects yet.</p>
              ) : (
                <div className="stack-2">
                  {projects.map((p) => (
                    <Link
                      key={p.id}
                      to={`/projects/${p.id}`}
                      className="tlink"
                      style={{ fontSize: 12.5 }}
                    >
                      {p.job_number ? `#${p.job_number} ` : ""}
                      {p.name}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </section>
        </aside>
      </div>

      <AddRateModal
        kind={rateModalKind}
        onCancel={() => setRateModalKind(null)}
        onSubmit={saveNewRate}
      />
    </div>
  );
}

function AddRateModal({
  kind,
  onCancel,
  onSubmit,
}: {
  kind: "event_day" | "prod_day" | null;
  onCancel: () => void;
  onSubmit: (kind: "event_day" | "prod_day", amount: number, effectiveFrom: string) => Promise<void>;
}) {
  const [amount, setAmount] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [submitting, setSubmitting] = useState(false);

  // Re-seed inputs whenever the modal opens.
  useEffect(() => {
    if (kind) {
      setAmount("");
      setEffectiveFrom(new Date().toISOString().slice(0, 10));
    }
  }, [kind]);

  if (!kind) return null;
  const title = kind === "event_day" ? "Add Event Day Rate" : "Add Prod Day Rate";
  const parsed = Number(amount.replace(/[^0-9]/g, ""));
  const valid = Number.isFinite(parsed) && parsed > 0 && !!effectiveFrom;

  const handleSubmit = async () => {
    if (!valid || submitting) return;
    setSubmitting(true);
    await onSubmit(kind, parsed, effectiveFrom);
    setSubmitting(false);
  };

  return (
    <AlertDialog open={!!kind} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent className="max-w-sm">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
        </AlertDialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="label-form">Amount (USD)</label>
            <input
              className="input"
              placeholder="6500"
              autoFocus
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label className="label-form">Effective from</label>
            <input
              className="input"
              type="date"
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
            />
          </div>
          <p className="cap" style={{ lineHeight: 1.5 }}>
            Rates are append-only — every change adds a new history row. The
            most-recent row drives the "as of" display.
          </p>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              void handleSubmit();
            }}
            disabled={!valid || submitting}
          >
            Save
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
