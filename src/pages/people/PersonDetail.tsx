import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { IconArrowLeft, IconLink } from "@/components/icons/HQIcons";
import { InternalNotesEditor } from "@/components/data/InternalNotesEditor";
import { affiliationToken, type PersonAffiliation } from "@/lib/people/queries";

/**
 * Person Detail (Surface 11).
 * Wireframe binding: OUTPUTS/phase-5-hq-wireframe-v1-LOCKED.html lines 2033-2110.
 * Build notes: OUTPUTS/phase-5-hq-wireframe-build-notes.md § "11 . People".
 *
 *   crumb -> avatar + eyebrow "Person" + h-page name + cap "Role . Org"
 *   2-col grid (1fr 332px):
 *     Left: Details card with .kv block (affiliations / org / role / email
 *           / phone / linkedin / tags).
 *     Right: Projects (linked via primary organization) /
 *            Notes (InternalNotesEditor).
 */

type Person = {
  id: string;
  full_name: string;
  affiliations: PersonAffiliation[];
  organization_id: string | null;
  role_title: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  tags: string[];
  organization: { id: string; name: string | null } | null;
};

type ProjectLink = {
  id: string;
  name: string;
  job_number: string | null;
};

export default function PersonDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [person, setPerson] = useState<Person | null>(null);
  const [projects, setProjects] = useState<ProjectLink[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    let active = true;
    (async () => {
      const { data, error } = await supabase
        .from("people")
        .select(
          "id, full_name, affiliations, organization_id, role_title, email, phone, linkedin_url, tags, organization:organizations!people_organization_id_fkey(id, name)",
        )
        .eq("id", id)
        .single();
      if (!active) return;
      if (error || !data) {
        setLoading(false);
        return;
      }
      const row = data as unknown as Person;
      setPerson(row);
      if (row.organization_id) {
        const { data: projData } = await supabase
          .from("projects")
          .select("id, name, job_number")
          .eq("organization_id", row.organization_id)
          .order("created_at", { ascending: false })
          .limit(8);
        if (active) {
          setProjects((projData ?? []) as unknown as ProjectLink[]);
        }
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

  const initials = (person.full_name || "?").split(" ").slice(0, 2).map((s) => s.charAt(0).toUpperCase()).join("");

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
                {[person.role_title, person.organization?.name].filter(Boolean).join(" . ") || "-"}
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
              <dt>Affiliation</dt>
              <dd>
                {person.affiliations.length === 0 ? (
                  <span className="muted subtle">-</span>
                ) : (
                  <span className="row-c wrap" style={{ display: "inline-flex", gap: 6 }}>
                    {person.affiliations.map((a) => (
                      <span key={a} className={`pill pill-sm p-${affiliationToken(a)}`}>
                        {a}
                      </span>
                    ))}
                  </span>
                )}
              </dd>
              <dt>Organization</dt>
              <dd>
                {person.organization?.id && person.organization.name ? (
                  <Link
                    to={`/organizations/${person.organization.id}`}
                    className="tlink"
                  >
                    {person.organization.name}
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
                    {person.tags.map((t) => (
                      <span key={t} className="tag">{t}</span>
                    ))}
                  </span>
                )}
              </dd>
            </dl>
          </div>
        </section>

        <aside className="stack-6">
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
