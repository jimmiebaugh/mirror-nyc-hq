import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { IconLink } from "@/components/icons/HQIcons";
import { InternalNotesEditor } from "@/components/data/InternalNotesEditor";
import { InlineEditText } from "@/components/hq/InlineEditText";
import { DField } from "@/components/hq/DField";
import { RecordCombobox } from "@/components/ui/RecordCombobox";
import { personType, personTypeToken, type PersonType } from "@/lib/people/queries";
import { formatPhone } from "@/lib/hq/phone";
import {
  createClientInline,
  createVenueInline,
  CLIENT_MINI_CREATE_FIELDS,
} from "@/lib/hq/inlineCreate";
import { toast } from "@/hooks/use-toast";

/**
 * Person Detail (Surface 11).
 * Wireframe binding: OUTPUTS/phase-5-hq-wireframe-v1-LOCKED.html lines 2033-2110.
 * Build notes: OUTPUTS/phase-5-hq-wireframe-build-notes.md § "11 . People".
 *
 * Type / Affiliation rendering adapted in Phase 5.2.3: the wireframe's
 * multi-pill `affiliations[]` is gone (locked Q4: at most one org type
 * per person; FK presence resolves type). Single Type pill + single
 * Organization link (to /clients/<id> OR /vendors/<id>). For
 * Venue-contact people, a Venues block lists the venues they contact
 * via the venue_contact_people join. Projects sidebar pulls projects
 * linked to the person's client (Vendor-touched projects + venue-contact
 * coverage deferred to a future polish pass).
 *
 * 5.2 cleanup: kv label flipped from "Affiliation" -> "Organization" to
 * match wireframe Surface 11 line 2019.
 */

type Person = {
  id: string;
  full_name: string;
  affiliation_type: PersonType;
  client_id: string | null;
  vendor_id: string | null;
  role_title: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  tags: string[];
  client: { id: string; name: string | null } | null;
  vendor: { id: string; name: string | null } | null;
};

type VenueLink = {
  id: string;
  name: string;
};

export default function PersonDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [person, setPerson] = useState<Person | null>(null);
  const [venues, setVenues] = useState<VenueLink[]>([]);
  const [isVenueContact, setIsVenueContact] = useState(false);
  const [loading, setLoading] = useState(true);
  const [clientOptions, setClientOptions] = useState<{ id: string; label: string }[]>([]);
  const [vendorOptions, setVendorOptions] = useState<{ id: string; label: string }[]>([]);
  const [venueOptions, setVenueOptions] = useState<{ id: string; label: string }[]>([]);
  const [venueIds, setVenueIds] = useState<string[]>([]);

  useEffect(() => {
    if (!id) return;
    let active = true;
    (async () => {
      // Person + venue-contacts + the three inline-edit picker option
      // lists all load in parallel. Inline edit pattern (Phase 5.6.3)
      // needs the option lists available the moment a user clicks a
      // typeahead field.
      const [personRes, vcpRes, clientsRes, vendorsRes, venuesAllRes] = await Promise.all([
        supabase
          .from("people")
          .select(
            "id, full_name, affiliation_type, client_id, vendor_id, role_title, email, phone, linkedin_url, tags, " +
              "client:clients!people_client_id_fkey(id, name), " +
              "vendor:vendors!people_vendor_id_fkey(id, name)",
          )
          .eq("id", id)
          .single(),
        supabase
          .from("venue_contact_people")
          .select("venue_id, venue:venues!venue_contact_people_venue_id_fkey(id, name)")
          .eq("person_id", id),
        supabase.from("clients").select("id, name").order("name", { ascending: true }),
        supabase.from("vendors").select("id, name").order("name", { ascending: true }),
        supabase.from("venues").select("id, name").order("name", { ascending: true }),
      ]);
      if (!active) return;
      if (personRes.error || !personRes.data) {
        setLoading(false);
        return;
      }
      const row = personRes.data as unknown as Person;
      setPerson(row);
      setClientOptions(
        ((clientsRes.data ?? []) as { id: string; name: string | null }[]).map((c) => ({
          id: c.id,
          label: c.name ?? "Untitled",
        })),
      );
      setVendorOptions(
        ((vendorsRes.data ?? []) as { id: string; name: string | null }[]).map((v) => ({
          id: v.id,
          label: v.name ?? "Untitled",
        })),
      );
      setVenueOptions(
        ((venuesAllRes.data ?? []) as { id: string; name: string | null }[]).map((v) => ({
          id: v.id,
          label: v.name ?? "Untitled",
        })),
      );

      const vRows = (vcpRes.data ?? []) as unknown as {
        venue_id: string;
        venue: { id: string; name: string | null } | null;
      }[];
      const venueList: VenueLink[] = [];
      const venueIdList: string[] = [];
      for (const r of vRows) {
        if (r.venue) {
          venueList.push({ id: r.venue.id, name: r.venue.name ?? "Untitled" });
          venueIdList.push(r.venue_id);
        }
      }
      setVenues(venueList);
      setVenueIds(venueIdList);
      setIsVenueContact(venueList.length > 0);

      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [id]);

  // Shared single-field save helper for the inline-edit-on-detail-pages
  // pattern (Phase 5.6.3 prototype). Optimistic UI: caller updates local
  // state via the returned promise's resolution; on throw, primitive
  // reverts + toasts.
  const savePersonField = async <K extends keyof Person>(
    field: K,
    nextValue: Person[K],
  ): Promise<void> => {
    if (!person) return;
    const prev = person[field];
    setPerson({ ...person, [field]: nextValue });
    const { error } = await supabase
      .from("people")
      .update({ [field as string]: nextValue })
      .eq("id", person.id);
    if (error) {
      setPerson({ ...person, [field]: prev });
      throw error;
    }
  };


  // Venue-contact-people diff save: insert added, delete removed. The
  // primitive (RecordCombobox multi) calls this on every chip add/remove.
  const saveVenueIds = async (nextIds: string[]) => {
    if (!person) return;
    const prev = venueIds;
    setVenueIds(nextIds);
    const toAdd = nextIds.filter((v) => !prev.includes(v));
    const toRemove = prev.filter((v) => !nextIds.includes(v));
    try {
      for (const venueId of toAdd) {
        const { error } = await supabase
          .from("venue_contact_people")
          .insert({ venue_id: venueId, person_id: person.id });
        if (error) throw error;
      }
      for (const venueId of toRemove) {
        const { error } = await supabase
          .from("venue_contact_people")
          .delete()
          .eq("venue_id", venueId)
          .eq("person_id", person.id);
        if (error) throw error;
      }
      // Refresh the visible venue label list for the sidebar.
      setVenues(
        nextIds
          .map((vid) => venueOptions.find((o) => o.id === vid))
          .filter((o): o is { id: string; label: string } => !!o)
          .map((o) => ({ id: o.id, name: o.label })),
      );
      setIsVenueContact(nextIds.length > 0);
    } catch (err) {
      setVenueIds(prev);
      const message = err instanceof Error ? err.message : "Save failed";
      toast({ title: "Venue update failed", description: message, variant: "destructive" });
    }
  };

  // Organization (FK) save: writes only client_id or vendor_id, never
  // touches `people.affiliation_type`. Phase 5.6.3's separate type column
  // lets users clear/swap the FK without flipping the Type pill. Changing
  // Type itself still requires the Edit form (plan decision 25).
  const saveOrgFk = async (kind: "client_id" | "vendor_id", nextId: string | null) => {
    if (!person) return;
    const prevId = person[kind];
    setPerson({ ...person, [kind]: nextId });
    const { error } = await supabase
      .from("people")
      .update({ [kind]: nextId })
      .eq("id", person.id);
    if (error) {
      setPerson({ ...person, [kind]: prevId });
      toast({ title: "Organization save failed", description: error.message, variant: "destructive" });
    }
  };

  const loadClientOptions = useCallback(async () => clientOptions, [clientOptions]);
  const loadVendorOptions = useCallback(async () => vendorOptions, [vendorOptions]);
  const loadVenueOptions = useCallback(async () => venueOptions, [venueOptions]);

  if (loading) {
    return (
      <div className="empty">
        <p>Loading...</p>
      </div>
    );
  }
  if (!person) {
    return (
      <div className="empty">
        <p>Person not found.</p>
      </div>
    );
  }

  const initials = (person.full_name || "?")
    .split(" ")
    .slice(0, 2)
    .map((s) => s.charAt(0).toUpperCase())
    .join("");

  const t = personType({
    affiliation_type: person.affiliation_type,
    client_id: person.client_id,
    vendor_id: person.vendor_id,
    is_venue_contact: isVenueContact,
  });

  const affiliationLabel = person.client?.name ?? person.vendor?.name ?? null;

  return (
    <div className="stack-6">
      <div className="stack-3">
        {/* R7 amendment v3 § 3: per-page back-crumb retired; TopBar carries it. */}
        <div className="row between" style={{ alignItems: "flex-start", paddingTop: 16 }}>
          <div className="row-c" style={{ flex: 1, minWidth: 0 }}>
            <span
              className="av-i"
              style={{ width: 52, height: 52, fontSize: 16, borderRadius: 999 }}
            >
              {initials}
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="eyebrow" style={{ paddingTop: 8 }}>Person</div>
              <div className="row-c" style={{ gap: 10, marginTop: 3, minWidth: 0 }}>
                <h1
                  className="h-page"
                  style={{ margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}
                >
                  {person.full_name || "(unnamed)"}
                </h1>
                <button
                  type="button"
                  onClick={() => navigate(`/people/${person.id}/edit`)}
                  className={`pill pill-lg p-${personTypeToken(t)}`}
                  title="Edit type / affiliation"
                  style={{ border: "none", cursor: "pointer" }}
                >
                  {t}
                </button>
              </div>
              <div className="row-c detail-meta" style={{ gap: 12, marginTop: 8 }}>
                <span>
                  {[person.role_title, affiliationLabel].filter(Boolean).join(" · ") || "-"}
                </span>
              </div>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            aria-label="Edit Person"
            title="Edit Person"
            onClick={() => navigate(`/people/${person.id}/edit`)}
            style={{ padding: "0 10px" }}
          >
            <Pencil className="ic" style={{ width: 14, height: 14 }} />
          </button>
        </div>
      </div>

      <div className="detail-2col">
        <div className="stack-6">
          <section className="card">
            <div className="card-headbar">
              <span className="h-card">Details</span>
            </div>
            <div className="card-pad stack-4">
              <div className="g2">
                <DField label="Affiliation">
                  {t === "Client" ? (
                    <RecordCombobox
                      source={{ kind: "record", loadOptions: loadClientOptions }}
                      value={person.client_id}
                      onChange={(next) => void saveOrgFk("client_id", next)}
                      entityLabel="Client"
                      placeholder="Pick a client..."
                      quickCreate
                      getRecordHref={(id) => `/clients/${id}`}
                      miniCreateFields={CLIENT_MINI_CREATE_FIELDS}
                      onMiniCreate={async (data) => {
                        const created = await createClientInline(data);
                        if (created) {
                          setClientOptions((prev) =>
                            [...prev, created].sort((a, b) =>
                              a.label.localeCompare(b.label),
                            ),
                          );
                        }
                        return created;
                      }}
                    />
                  ) : t === "Vendor" ? (
                    <RecordCombobox
                      source={{ kind: "record", loadOptions: loadVendorOptions }}
                      value={person.vendor_id}
                      onChange={(next) => void saveOrgFk("vendor_id", next)}
                      entityLabel="Vendor"
                      placeholder="Pick a vendor..."
                      getRecordHref={(id) => `/vendors/${id}`}
                    />
                  ) : t === "Venue" ? (
                    <span className="muted">Venue contact</span>
                  ) : (
                    <span className="muted subtle">-</span>
                  )}
                </DField>
                <DField label="Role Title">
                  <InlineEditText
                    value={person.role_title}
                    placeholder="Role / title"
                    renderRead={(v) =>
                      v ? v : <span className="muted subtle">-</span>
                    }
                    onSave={(next) => savePersonField("role_title", next || null)}
                  />
                </DField>
              </div>
              <div style={{ borderTop: "1px solid hsl(var(--border))" }} />
              <div className="g2">
                <DField label="Email">
                  <InlineEditText
                    value={person.email}
                    placeholder="email@example.com"
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
                    onSave={(next) => savePersonField("email", next || null)}
                  />
                </DField>
                <DField label="Phone">
                  <InlineEditText
                    value={person.phone}
                    placeholder="(212) 555-0000"
                    onBlurFormat={formatPhone}
                    renderRead={(v) =>
                      v ? (
                        <span className="muted">{v}</span>
                      ) : (
                        <span className="muted subtle">-</span>
                      )
                    }
                    onSave={(next) => savePersonField("phone", next || null)}
                  />
                </DField>
              </div>
              <div style={{ borderTop: "1px solid hsl(var(--border))" }} />
              <DField label="LinkedIn">
                <InlineEditText
                  value={person.linkedin_url}
                  placeholder="https://linkedin.com/in/..."
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
                        <IconLink className="ic ic-sm" /> {prettyLinkedIn(v)}
                      </a>
                    ) : (
                      <span className="muted subtle">-</span>
                    )
                  }
                  onSave={(next) => savePersonField("linkedin_url", next || null)}
                />
              </DField>
            </div>
          </section>

          {t === "Venue" ? (
            <section className="card">
              <div className="card-headbar">
                <span className="h-card">Associated Venues</span>
                <div className="combo-as-link">
                  <RecordCombobox
                    multi
                    hideMultiValueChips
                    source={{ kind: "record", loadOptions: loadVenueOptions }}
                    multiValue={venueIds}
                    onMultiChange={(next) => void saveVenueIds(next)}
                    entityLabel="venue"
                    placeholder="+ Add"
                    // Single-field venue create -> immediate add on Enter, no
                    // modal (Phase 6.5 follow-up); createVenueInline needs only
                    // { name }.
                    quickCreate
                    onMiniCreate={async (data) => {
                      const created = await createVenueInline(data);
                      if (created) {
                        setVenueOptions((prev) =>
                          [...prev, created].sort((a, b) =>
                            a.label.localeCompare(b.label),
                          ),
                        );
                      }
                      return created;
                    }}
                  />
                </div>
              </div>
              <div className="card-pad">
                {venues.length > 0 ? (
                  <span className="row-c wrap" style={{ display: "inline-flex", gap: 6 }}>
                    {venues.map((v, i) => (
                      <span key={v.id} className="row-c" style={{ gap: 6 }}>
                        <Link to={`/venues/${v.id}`} className="tlink">
                          {v.name}
                        </Link>
                        {i < venues.length - 1 ? (
                          <span className="muted" aria-hidden="true">·</span>
                        ) : null}
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="muted subtle">No venues linked yet.</span>
                )}
              </div>
            </section>
          ) : null}
        </div>

        <aside className="stack-6">
          <InternalNotesEditor parentType="person" parentId={person.id} />
        </aside>
      </div>
    </div>
  );
}

function prettyLinkedIn(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, "")}${u.pathname}`;
  } catch {
    return url;
  }
}
