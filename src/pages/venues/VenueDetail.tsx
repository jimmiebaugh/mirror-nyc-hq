import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { IconArrowLeft, IconLink, IconSlides } from "@/components/icons/HQIcons";
import { InternalNotesEditor } from "@/components/data/InternalNotesEditor";
import { formatShortDate } from "@/lib/hq/dates";
import { loadLatestVenueRates, type VenueRate } from "@/lib/venues/queries";
import { useBackHref } from "@/lib/hq/useBackHref";
import {
  TYPE_STYLES,
  TYPE_FALLBACK_STYLE,
  canonicalizeType,
  type CanonicalType,
} from "@/lib/venue-scout/venueTypes";

/**
 * Venue Detail (Surface 09).
 * Wireframe binding: OUTPUTS/phase-5-hq-wireframe-v1-LOCKED.html lines 1665-1781.
 * Build notes: OUTPUTS/phase-5-hq-wireframe-build-notes.md § "09 . Venues".
 *
 *   crumb -> title row (eyebrow + h-page + right-stacked Edit + Venue Slide buttons)
 *     -> meta row (type pills + neighborhood, city).
 *   2-col grid (1fr 332px):
 *     Left: Venue Details (two .kv blocks + Features tags) /
 *           About Venue (text block from venues.notes).
 *     Right: Files & Assets / Contacts (via venue_contact_people join) /
 *            Internal Notes / Past Projects.
 */

type Venue = {
  id: string;
  name: string;
  address: string | null;
  neighborhood: string | null;
  city: string | null;
  capacity: number | null;
  total_sq_ft: number | null;
  website_url: string | null;
  venue_slide_url: string | null;
  features: string[];
  notes: string | null;
  exclusive_vendor_ids: string[];
};

type Contact = { id: string; full_name: string; role_title: string | null };
type ProjectLink = { id: string; name: string; job_number: string | null };
type Vendor = { id: string; name: string };

export default function VenueDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [venue, setVenue] = useState<Venue | null>(null);
  const [venueTypes, setVenueTypes] = useState<string[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [projects, setProjects] = useState<ProjectLink[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [rates, setRates] = useState<VenueRate[]>([]);
  const [loading, setLoading] = useState(true);
  const back = useBackHref({ to: "/venues", label: "Venues" });

  useEffect(() => {
    if (!id) return;
    let active = true;
    (async () => {
      const venueRes = await supabase
        .from("venues")
        .select(
          "id, name, address, neighborhood, city, capacity, total_sq_ft, website_url, venue_slide_url, features, notes, exclusive_vendor_ids",
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
      setVenue(row);

      const [typesRes, contactsRes, projectsRes, vendorsRes, ratesRes] = await Promise.all([
        supabase
          .from("venue_venue_types")
          .select("venue_type:venue_types!venue_venue_types_venue_type_id_fkey(name)")
          .eq("venue_id", id),
        supabase
          .from("venue_contact_people")
          .select("person:people!venue_contact_people_person_id_fkey(id, full_name, role_title)")
          .eq("venue_id", id),
        supabase
          .from("project_venues")
          .select("project:projects!project_venues_project_id_fkey(id, name, job_number)")
          .eq("venue_id", id),
        row.exclusive_vendor_ids.length > 0
          ? supabase
              .from("vendors")
              .select("id, name")
              .in("id", row.exclusive_vendor_ids)
          : Promise.resolve({ data: [], error: null }),
        loadLatestVenueRates(row.id),
      ]);
      if (!active) return;
      setVenueTypes(
        ((typesRes.data ?? []) as unknown as { venue_type: { name: string } | null }[])
          .map((r) => r.venue_type?.name)
          .filter((n): n is string => Boolean(n)),
      );
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
      setVendors((vendorsRes.data ?? []) as unknown as Vendor[]);
      setRates(ratesRes);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [id]);

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
      <div className="stack-3">
        <Link to={back.to} className="crumb">
          <IconArrowLeft className="ic ic-sm" /> Back to {back.label}
        </Link>
        <div className="row between" style={{ alignItems: "flex-start", gap: 24 }}>
          <div>
            <div className="eyebrow">Venue</div>
            <h1 className="h-page" style={{ marginTop: 5 }}>{venue.name}</h1>
          </div>
          <div
            style={{ display: "flex", flexDirection: "column", gap: 8, width: 172, flex: "none" }}
          >
            <button
              type="button"
              className="btn btn-secondary"
              style={{ width: "100%" }}
              onClick={() => navigate(`/venues/${venue.id}/edit`)}
            >
              <Pencil className="ic" style={{ width: 14, height: 14 }} />
              Edit Venue
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
        <div
          className="row-c"
          style={{ gap: 12, fontSize: 15, color: "hsl(var(--muted-foreground))" }}
        >
          {venueTypes.map((t) => (
            <VenueTypePill key={t} type={t} />
          ))}
          <span>
            {[venue.neighborhood, venue.city].filter(Boolean).join(", ") || "-"}
          </span>
        </div>
      </div>

      <div
        className="grid"
        style={{ display: "grid", gridTemplateColumns: "1fr 332px", gap: 24, alignItems: "start" }}
      >
        <div className="stack-6">
          <section className="card">
            <div className="card-headbar">
              <span className="h-card">Venue Details</span>
            </div>
            <div className="card-pad">
              <div className="grid g2" style={{ gap: 28 }}>
                <dl className="kv" style={{ gridTemplateColumns: "130px 1fr" }}>
                  <dt>Venue Type</dt>
                  <dd>
                    {venueTypes.length === 0 ? (
                      <span className="muted subtle">-</span>
                    ) : (
                      <span className="row-c wrap" style={{ display: "inline-flex", gap: 5 }}>
                        {venueTypes.map((t) => (
                          <VenueTypePill key={t} type={t} small />
                        ))}
                      </span>
                    )}
                  </dd>
                  <dt>Address</dt>
                  <dd>{venue.address ?? <span className="muted subtle">-</span>}</dd>
                  <dt>Neighborhood</dt>
                  <dd>{venue.neighborhood ?? <span className="muted subtle">-</span>}</dd>
                  <dt>Capacity</dt>
                  <dd>
                    {venue.capacity != null ? (
                      venue.capacity.toLocaleString("en-US")
                    ) : (
                      <span className="muted subtle">-</span>
                    )}
                  </dd>
                  <dt>Exclusive Vendors</dt>
                  <dd>
                    {vendors.length === 0 ? (
                      <span className="muted subtle">-</span>
                    ) : (
                      <span className="row-c wrap" style={{ display: "inline-flex", gap: 8 }}>
                        {vendors.map((v, i) => (
                          <span key={v.id}>
                            <Link to={`/vendors/${v.id}`} className="tlink">
                              {v.name}
                            </Link>
                            {i < vendors.length - 1 ? <span className="muted">, </span> : null}
                          </span>
                        ))}
                      </span>
                    )}
                  </dd>
                </dl>
                <dl className="kv" style={{ gridTemplateColumns: "130px 1fr" }}>
                  <dt>Total Sq Ft</dt>
                  <dd>
                    {venue.total_sq_ft != null ? (
                      venue.total_sq_ft.toLocaleString("en-US")
                    ) : (
                      <span className="muted subtle">-</span>
                    )}
                  </dd>
                  <dt>Event Day Rate</dt>
                  <dd>
                    {eventRate ? (
                      <>
                        ${eventRate.amount_usd.toLocaleString("en-US")}{" "}
                        <span className="cap">as of {formatShortDate(eventRate.effective_from)}</span>
                      </>
                    ) : (
                      <span className="muted subtle">-</span>
                    )}
                  </dd>
                  <dt>Prod Day Rate</dt>
                  <dd>
                    {prodRate ? (
                      <>
                        ${prodRate.amount_usd.toLocaleString("en-US")}{" "}
                        <span className="cap">as of {formatShortDate(prodRate.effective_from)}</span>
                      </>
                    ) : (
                      <span className="muted subtle">-</span>
                    )}
                  </dd>
                </dl>
              </div>
              {venue.features.length > 0 ? (
                <div
                  style={{
                    marginTop: 20,
                    borderTop: "1px solid hsl(var(--border))",
                    paddingTop: 16,
                  }}
                >
                  <div
                    className="label-form"
                    style={{ color: "hsl(var(--subtle-foreground))", marginBottom: 9 }}
                  >
                    Features
                  </div>
                  <div className="row wrap" style={{ gap: 7 }}>
                    {venue.features.map((f) => (
                      <span key={f} className="tag">{f}</span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          <section className="card">
            <div className="card-headbar">
              <span className="h-card">About Venue</span>
              <Link
                to={`/venues/${venue.id}/edit`}
                className="tlink"
                style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
              >
                <Pencil className="ic" style={{ width: 12, height: 12 }} />
                Edit
              </Link>
            </div>
            <div className="card-pad">
              {venue.notes ? (
                <p
                  style={{
                    fontSize: 14,
                    lineHeight: 1.65,
                    color: "hsl(var(--muted-foreground))",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {venue.notes}
                </p>
              ) : (
                <p className="subtle" style={{ fontSize: 13 }}>
                  No deck-copy paragraph yet. Edit the venue to add one.
                </p>
              )}
            </div>
          </section>
        </div>

        <aside className="stack-6">
          <section className="card">
            <div className="card-headbar">
              <span className="h-card">Files &amp; Assets</span>
            </div>
            <div
              className="card-pad"
              style={{ display: "flex", flexDirection: "column", gap: 11 }}
            >
              {venue.website_url ? (
                <a
                  className="tlink"
                  style={{ fontSize: 14 }}
                  href={venue.website_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <IconLink className="ic ic-sm" /> Website
                </a>
              ) : (
                <span className="subtle" style={{ fontSize: 13 }}>
                  No website URL yet.
                </span>
              )}
              <span className="subtle" style={{ fontSize: 13 }}>
                Event Deck / Master Deck / Photos / Video assets land in 5.4.
              </span>
            </div>
          </section>

          <section className="card card-pad">
            <div className="block-lbl">
              <span className="label-section">Contacts</span>
            </div>
            {contacts.length === 0 ? (
              <p className="subtle" style={{ fontSize: 13 }}>No contacts yet.</p>
            ) : (
              <div className="stack-3">
                {contacts.map((c) => (
                  <Link
                    key={c.id}
                    to={`/people/${c.id}`}
                    className="row-c"
                    style={{ textDecoration: "none", color: "inherit" }}
                  >
                    <span className="av-i">
                      {(c.full_name ?? "?").slice(0, 2).toUpperCase()}
                    </span>
                    <div>
                      <div style={{ fontSize: 13 }}>{c.full_name}</div>
                      <div className="cap">{c.role_title ?? "-"}</div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>

          <InternalNotesEditor parentType="venue" parentId={venue.id} />

          <section className="card card-pad">
            <div className="block-lbl">
              <span className="label-section">Past Projects</span>
            </div>
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
                    {p.job_number ? `#${p.job_number} . ` : ""}
                    {p.name}
                  </Link>
                ))}
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

function VenueTypePill({ type, small }: { type: string; small?: boolean }) {
  const canonical = canonicalizeType(type) as CanonicalType | null;
  const style = canonical ? TYPE_STYLES[canonical] : TYPE_FALLBACK_STYLE;
  return (
    <span
      className={`pill ${small ? "pill-sm" : ""} ${style}`}
      style={{ borderWidth: 1, borderStyle: "solid" }}
    >
      {type}
    </span>
  );
}
