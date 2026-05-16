import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  IconArrowLeft,
  IconLink,
  IconPlus,
} from "@/components/icons/HQIcons";
import { Pencil } from "lucide-react";
import { StarRating } from "@/components/data/StarRating";
import { InternalNotesEditor } from "@/components/data/InternalNotesEditor";
import { typeToken, type OrgType } from "@/lib/organizations/queries";
import { toast } from "@/hooks/use-toast";

/**
 * Organization Detail (Surface 10).
 * Wireframe binding: OUTPUTS/phase-5-hq-wireframe-v1-LOCKED.html lines 1856-1969.
 * Build notes: OUTPUTS/phase-5-hq-wireframe-build-notes.md § "10 . Organizations".
 *
 *   crumb -> eyebrow "Organization" + h-page name + type-pill meta row
 *   2-col grid (1fr 332px):
 *     Left: Details (.card .card-headbar + .kv) /
 *           Internal Notes (<InternalNotesEditor />) /
 *           Files & Assets (empty for 5.2.2).
 *     Right: Contacts (people WHERE organization_id = ?) /
 *            Internal Rating (Vendor-only; <StarRating editable />) /
 *            Past Projects.
 */

type Organization = {
  id: string;
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

type Contact = {
  id: string;
  full_name: string;
  role_title: string | null;
};

type PastProject = {
  id: string;
  name: string;
  job_number: string | null;
};

export default function OrganizationDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [org, setOrg] = useState<Organization | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [projects, setProjects] = useState<PastProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [ratingSaving, setRatingSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    let active = true;
    (async () => {
      const [orgRes, contactsRes, projectsRes] = await Promise.all([
        supabase
          .from("organizations")
          .select(
            "id, name, type, city, capabilities, website_url, contact_name, contact_email, contact_phone, tags, internal_rating",
          )
          .eq("id", id)
          .single(),
        supabase
          .from("people")
          .select("id, full_name, role_title")
          .eq("organization_id", id)
          .order("full_name", { ascending: true })
          .limit(5),
        supabase
          .from("projects")
          .select("id, name, job_number")
          .eq("organization_id", id)
          .order("created_at", { ascending: false }),
      ]);
      if (!active) return;
      if (orgRes.error || !orgRes.data) {
        console.warn("organization load failed", orgRes.error);
        setLoading(false);
        return;
      }
      setOrg(orgRes.data as unknown as Organization);
      setContacts((contactsRes.data ?? []) as unknown as Contact[]);
      setProjects((projectsRes.data ?? []) as unknown as PastProject[]);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [id]);

  const onRatingChange = async (next: number) => {
    if (!org) return;
    setRatingSaving(true);
    const prev = org.internal_rating;
    setOrg({ ...org, internal_rating: next });
    const { error } = await supabase
      .from("organizations")
      .update({ internal_rating: next })
      .eq("id", org.id);
    setRatingSaving(false);
    if (error) {
      setOrg({ ...org, internal_rating: prev });
      toast({
        title: "Could not save rating",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  if (loading) {
    return (
      <div className="empty">
        <p>Loading...</p>
      </div>
    );
  }
  if (!org) {
    return (
      <div className="empty">
        <p>Organization not found.</p>
      </div>
    );
  }

  const showCapabilities = org.type === "Vendor" || org.type === "Internal";
  const showRating = org.type === "Vendor";

  return (
    <div className="stack-6">
      <div className="stack-3">
        <Link to="/organizations" className="crumb">
          <IconArrowLeft className="ic ic-sm" /> Back to Organizations
        </Link>
        <div className="row between" style={{ alignItems: "flex-start" }}>
          <div>
            <div className="eyebrow">Organization</div>
            <h1 className="h-page" style={{ marginTop: 5 }}>{org.name}</h1>
            <div className="row-c" style={{ marginTop: 10 }}>
              <span className={`pill pill-lg p-${typeToken(org.type)}`}>
                <span className="dt" />
                {org.type}
              </span>
              {org.city ? <span className="cap">{org.city}</span> : null}
            </div>
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate(`/organizations/${org.id}/edit`)}
          >
            <Pencil className="ic" style={{ width: 14, height: 14 }} />
            Edit Organization
          </button>
        </div>
      </div>

      <div
        className="grid"
        style={{ display: "grid", gridTemplateColumns: "1fr 332px", gap: 24, alignItems: "start" }}
      >
        <div className="stack-6">
          <section className="card">
            <div className="card-headbar">
              <span className="h-card">Details</span>
            </div>
            <div className="card-pad">
              <dl className="kv">
                <dt>Type</dt>
                <dd>
                  <span className="tag">{org.type}</span>
                </dd>
                {showCapabilities ? (
                  <>
                    <dt>Capabilities</dt>
                    <dd>
                      {org.capabilities && org.capabilities.length > 0 ? (
                        <span className="row-c wrap" style={{ display: "inline-flex", gap: 6 }}>
                          {org.capabilities.map((c) => (
                            <span key={c} className="tag">{c}</span>
                          ))}
                        </span>
                      ) : (
                        <span className="muted subtle">-</span>
                      )}
                    </dd>
                  </>
                ) : null}
                <dt>Website</dt>
                <dd>
                  {org.website_url ? (
                    <a
                      className="tlink"
                      href={org.website_url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <IconLink className="ic ic-sm" /> {prettyHost(org.website_url)}
                    </a>
                  ) : (
                    <span className="muted subtle">-</span>
                  )}
                </dd>
                <dt>Primary Contact</dt>
                <dd>
                  {org.contact_name ? (
                    org.contact_email ? (
                      <a
                        className="tlink inline-block max-w-full truncate align-bottom"
                        href={`mailto:${org.contact_email}`}
                      >
                        {org.contact_name}
                      </a>
                    ) : (
                      org.contact_name
                    )
                  ) : (
                    <span className="muted subtle">-</span>
                  )}
                </dd>
                <dt>Phone</dt>
                <dd className="mono" style={{ fontSize: 13 }}>
                  {org.contact_phone ?? <span className="muted subtle">-</span>}
                </dd>
                <dt>City</dt>
                <dd>
                  {org.city ? (
                    <span className="tag">{org.city}</span>
                  ) : (
                    <span className="muted subtle">-</span>
                  )}
                </dd>
                <dt>Tags</dt>
                <dd>
                  {org.tags && org.tags.length > 0 ? (
                    <span className="row-c wrap" style={{ display: "inline-flex", gap: 6 }}>
                      {org.tags.map((t) => (
                        <span key={t} className="tag">{t}</span>
                      ))}
                    </span>
                  ) : (
                    <span className="muted subtle">-</span>
                  )}
                </dd>
              </dl>
            </div>
          </section>

          <InternalNotesEditor parentType="organization" parentId={org.id} />

          <section className="card">
            <div className="card-headbar">
              <span className="h-card">Files &amp; Assets</span>
              <button type="button" className="tlink" disabled style={{ opacity: 0.45, cursor: "not-allowed" }}>
                <IconPlus className="ic ic-sm" /> Add
              </button>
            </div>
            <div className="card-pad subtle" style={{ fontSize: 13 }}>
              File uploads land in 5.4. For now, link to drive/dropbox URLs
              via the Capability Deck / MSA fields when that surface ships.
            </div>
          </section>
        </div>

        <aside className="stack-6">
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

          {showRating ? (
            <section className="card card-pad">
              <div className="block-lbl">
                <span className="label-section">Internal Rating</span>
              </div>
              <div className="row-c" style={{ gap: 8 }}>
                <StarRating
                  value={org.internal_rating}
                  editable
                  size="lg"
                  onChange={onRatingChange}
                />
                <span className="cap">
                  {org.internal_rating != null
                    ? `${org.internal_rating} of 5`
                    : "Not rated"}
                  {ratingSaving ? " . saving" : ""}
                </span>
              </div>
              <p className="cap" style={{ marginTop: 10, lineHeight: 1.5 }}>
                Visible to all Standard users.
              </p>
            </section>
          ) : null}

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

function prettyHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
