import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Pencil } from "lucide-react";
import {
  IconArrowLeft,
  IconLink,
  IconPlus,
} from "@/components/icons/HQIcons";
import { InternalNotesEditor } from "@/components/data/InternalNotesEditor";
import { useBackHref } from "@/lib/hq/useBackHref";

/**
 * Client Detail.
 *
 * Wireframe binding (DEVIATION): no wireframe exists for this surface.
 * Surface 10 (OUTPUTS/phase-5-hq-wireframe-v1-LOCKED.html lines 1856-1969)
 * was drawn as a unified Organization Detail. Per the 2026-05-16 locked
 * decisions split (spec § 0c Q3), Organizations breaks into Clients +
 * Vendors. This is the Clients half; slim shape: Details kv + Internal
 * Notes + Contacts + Past Projects. No Capabilities, no Internal Rating
 * (vendor concepts). Wireframe-v2 redraw deferred to a future polish
 * pass; see design-system § 11.
 */

type Client = {
  id: string;
  name: string;
  industry: string | null;
  city: string | null;
  primary_address: string | null;
  website_url: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  tags: string[] | null;
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

export default function ClientDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [client, setClient] = useState<Client | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [projects, setProjects] = useState<PastProject[]>([]);
  const [loading, setLoading] = useState(true);
  const back = useBackHref({ to: "/clients", label: "Clients" });

  useEffect(() => {
    if (!id) return;
    let active = true;
    (async () => {
      const [clientRes, contactsRes, projectsRes] = await Promise.all([
        supabase
          .from("clients")
          .select(
            "id, name, industry, city, primary_address, website_url, contact_name, contact_email, contact_phone, tags",
          )
          .eq("id", id)
          .single(),
        supabase
          .from("people")
          .select("id, full_name, role_title")
          .eq("client_id", id)
          .order("full_name", { ascending: true })
          .limit(5),
        supabase
          .from("projects")
          .select("id, name, job_number")
          .eq("client_id", id)
          .order("created_at", { ascending: false }),
      ]);
      if (!active) return;
      if (clientRes.error || !clientRes.data) {
        console.warn("client load failed", clientRes.error);
        setLoading(false);
        return;
      }
      setClient(clientRes.data as unknown as Client);
      setContacts((contactsRes.data ?? []) as unknown as Contact[]);
      setProjects((projectsRes.data ?? []) as unknown as PastProject[]);
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
  if (!client) {
    return (
      <div className="empty">
        <p>Client not found.</p>
      </div>
    );
  }

  return (
    <div className="stack-6">
      <div className="stack-3">
        <Link to={back.to} className="crumb">
          <IconArrowLeft className="ic ic-sm" /> Back to {back.label}
        </Link>
        <div className="row between" style={{ alignItems: "flex-start" }}>
          <div>
            <div className="eyebrow">Client</div>
            <h1 className="h-page" style={{ marginTop: 5 }}>{client.name}</h1>
            <div className="row-c" style={{ marginTop: 10 }}>
              {client.industry ? <span className="cap">{client.industry}</span> : null}
              {client.city ? <span className="cap">{client.city}</span> : null}
            </div>
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate(`/clients/${client.id}/edit`)}
          >
            <Pencil className="ic" style={{ width: 14, height: 14 }} />
            Edit Client
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
                <dt>Industry</dt>
                <dd>
                  {client.industry ? (
                    <span>{client.industry}</span>
                  ) : (
                    <span className="muted subtle">-</span>
                  )}
                </dd>
                <dt>Website</dt>
                <dd>
                  {client.website_url ? (
                    <a
                      className="tlink"
                      href={client.website_url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <IconLink className="ic ic-sm" /> {prettyHost(client.website_url)}
                    </a>
                  ) : (
                    <span className="muted subtle">-</span>
                  )}
                </dd>
                <dt>Primary Contact</dt>
                <dd>
                  {client.contact_name ? (
                    client.contact_email ? (
                      <a
                        className="tlink inline-block max-w-full truncate align-bottom"
                        href={`mailto:${client.contact_email}`}
                      >
                        {client.contact_name}
                      </a>
                    ) : (
                      client.contact_name
                    )
                  ) : (
                    <span className="muted subtle">-</span>
                  )}
                </dd>
                <dt>Phone</dt>
                <dd className="mono" style={{ fontSize: 13 }}>
                  {client.contact_phone ?? <span className="muted subtle">-</span>}
                </dd>
                <dt>Primary Address</dt>
                <dd>
                  {client.primary_address ?? <span className="muted subtle">-</span>}
                </dd>
                <dt>City</dt>
                <dd>
                  {client.city ? (
                    <span className="tag">{client.city}</span>
                  ) : (
                    <span className="muted subtle">-</span>
                  )}
                </dd>
                <dt>Tags</dt>
                <dd>
                  {client.tags && client.tags.length > 0 ? (
                    <span className="row-c wrap" style={{ display: "inline-flex", gap: 6 }}>
                      {client.tags.map((t) => (
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

          <InternalNotesEditor parentType="client" parentId={client.id} />

          <section className="card">
            <div className="card-headbar">
              <span className="h-card">Files &amp; Assets</span>
              <button type="button" className="tlink" disabled style={{ opacity: 0.45, cursor: "not-allowed" }}>
                <IconPlus className="ic ic-sm" /> Add
              </button>
            </div>
            <div className="card-pad subtle" style={{ fontSize: 13 }}>
              File uploads land in 5.4.
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
