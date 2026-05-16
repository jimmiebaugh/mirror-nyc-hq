import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { IconArrowLeft, IconLink } from "@/components/icons/HQIcons";
import { InternalNotesEditor } from "@/components/data/InternalNotesEditor";
import { personType, personTypeToken } from "@/lib/people/queries";

/**
 * Person Detail (Surface 11).
 * Wireframe binding: OUTPUTS/phase-5-hq-wireframe-v1-LOCKED.html lines 2033-2110.
 * Build notes: OUTPUTS/phase-5-hq-wireframe-build-notes.md § "11 . People".
 *
 * Type / Affiliation rendering adapted in Phase 5.2.3: the wireframe's
 * multi-pill `affiliations[]` is gone (locked Q4: at most one org type
 * per person; FK presence resolves type). Single Type pill + single
 * Affiliation link (to /clients/<id> OR /vendors/<id>). For
 * Venue-contact people, a Venues block lists the venues they contact
 * via the venue_contact_people join. Projects sidebar pulls projects
 * linked to the person's client (Vendor-touched projects + venue-contact
 * coverage deferred to a future polish pass).
 */

type Person = {
  id: string;
  full_name: string;
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

type ProjectLink = {
  id: string;
  name: string;
  job_number: string | null;
};

type VenueLink = {
  id: string;
  name: string;
};

export default function PersonDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [person, setPerson] = useState<Person | null>(null);
  const [projects, setProjects] = useState<ProjectLink[]>([]);
  const [venues, setVenues] = useState<VenueLink[]>([]);
  const [isVenueContact, setIsVenueContact] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    let active = true;
    (async () => {
      // Person fetch + venue-contacts fetch run in parallel; both depend
      // only on the URL `id`. The projects fetch chains off person.client_id
      // (only fires when the person actually has a client tie).
      const [personRes, vcpRes] = await Promise.all([
        supabase
          .from("people")
          .select(
            "id, full_name, client_id, vendor_id, role_title, email, phone, linkedin_url, tags, " +
              "client:clients!people_client_id_fkey(id, name), " +
              "vendor:vendors!people_vendor_id_fkey(id, name)",
          )
          .eq("id", id)
          .single(),
        supabase
          .from("venue_contact_people")
          .select("venue_id, venue:venues!venue_contact_people_venue_id_fkey(id, name)")
          .eq("person_id", id),
      ]);
      if (!active) return;
      if (personRes.error || !personRes.data) {
        setLoading(false);
        return;
      }
      const row = personRes.data as unknown as Person;
      setPerson(row);

      const vRows = (vcpRes.data ?? []) as unknown as {
        venue: { id: string; name: string | null } | null;
      }[];
      const venueList: VenueLink[] = [];
      for (const r of vRows) {
        if (r.venue) {
          venueList.push({ id: r.venue.id, name: r.venue.name ?? "Untitled" });
        }
      }
      setVenues(venueList);
      setIsVenueContact(venueList.length > 0);

      // Projects card: pull projects linked to this person's client (if any).
      if (row.client_id) {
        const { data: projData } = await supabase
          .from("projects")
          .select("id, name, job_number")
          .eq("client_id", row.client_id)
          .order("created_at", { ascending: false })
          .limit(8);
        if (active) {
          setProjects((projData ?? []) as unknown as ProjectLink[]);
        }
      } else if (active) {
        setProjects([]);
      }

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
    client_id: person.client_id,
    vendor_id: person.vendor_id,
    is_venue_contact: isVenueContact,
  });

  const affiliationLabel = person.client?.name ?? person.vendor?.name ?? null;

  return (
    <div className="stack-6">
      <div className="stack-3">
        <Link to="/people" className="crumb">
          <IconArrowLeft className="ic ic-sm" /> Back to People
        </Link>
        <div className="row between" style={{ alignItems: "flex-start" }}>
          <div className="row-c">
            <span
              className="av-i"
              style={{ width: 52, height: 52, fontSize: 16, borderRadius: 999 }}
            >
              {initials}
            </span>
            <div>
              <div className="eyebrow">Person</div>
              <h1 className="h-page" style={{ marginTop: 3 }}>{person.full_name}</h1>
              <div className="cap" style={{ marginTop: 6 }}>
                {[person.role_title, affiliationLabel].filter(Boolean).join(" . ") || "-"}
              </div>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate(`/people/${person.id}/edit`)}
          >
            <Pencil className="ic" style={{ width: 14, height: 14 }} />
            Edit Person
          </button>
        </div>
      </div>

      <div
        className="grid"
        style={{ display: "grid", gridTemplateColumns: "1fr 332px", gap: 24, alignItems: "start" }}
      >
        <section className="card">
          <div className="card-headbar">
            <span className="h-card">Details</span>
          </div>
          <div className="card-pad">
            <dl className="kv">
              <dt>Type</dt>
              <dd>
                <span className={`pill pill-sm p-${personTypeToken(t)}`}>{t}</span>
              </dd>
              <dt>Affiliation</dt>
              <dd>
                {person.client_id && person.client?.name ? (
                  <Link to={`/clients/${person.client_id}`} className="tlink">
                    {person.client.name}
                  </Link>
                ) : person.vendor_id && person.vendor?.name ? (
                  <Link to={`/vendors/${person.vendor_id}`} className="tlink">
                    {person.vendor.name}
                  </Link>
                ) : (
                  <span className="muted subtle">-</span>
                )}
              </dd>
              <dt>Role / Title</dt>
              <dd>{person.role_title ?? <span className="muted subtle">-</span>}</dd>
              <dt>Email</dt>
              <dd>
                {person.email ? (
                  <a
                    className="tlink inline-block max-w-full truncate align-bottom"
                    href={`mailto:${person.email}`}
                  >
                    {person.email}
                  </a>
                ) : (
                  <span className="muted subtle">-</span>
                )}
              </dd>
              <dt>Phone</dt>
              <dd className="muted">{person.phone ?? <span className="muted subtle">-</span>}</dd>
              <dt>LinkedIn</dt>
              <dd>
                {person.linkedin_url ? (
                  <a
                    className="tlink"
                    href={person.linkedin_url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <IconLink className="ic ic-sm" /> {prettyLinkedIn(person.linkedin_url)}
                  </a>
                ) : (
                  <span className="muted subtle">-</span>
                )}
              </dd>
              <dt>Tags</dt>
              <dd>
                {person.tags.length === 0 ? (
                  <span className="muted subtle">-</span>
                ) : (
                  <span className="row-c wrap" style={{ display: "inline-flex", gap: 6 }}>
                    {person.tags.map((tag) => (
                      <span key={tag} className="tag">{tag}</span>
                    ))}
                  </span>
                )}
              </dd>
            </dl>
          </div>
        </section>

        <aside className="stack-6">
          {venues.length > 0 ? (
            <section className="card card-pad">
              <div className="block-lbl">
                <span className="label-section">Venues contacted</span>
              </div>
              <div className="stack-2">
                {venues.map((v) => (
                  <Link key={v.id} to={`/venues/${v.id}`} className="tlink" style={{ fontSize: 12.5 }}>
                    {v.name}
                  </Link>
                ))}
              </div>
            </section>
          ) : null}

          {person.client_id ? (
            <section className="card card-pad">
              <div className="block-lbl">
                <span className="label-section">Projects</span>
              </div>
              {projects.length === 0 ? (
                <p className="subtle" style={{ fontSize: 13 }}>
                  No projects yet.
                </p>
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
          ) : null}

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
