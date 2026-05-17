import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Pencil } from "lucide-react";
import {
  IconArrowLeft,
  IconLink,
} from "@/components/icons/HQIcons";
import { InternalNotesEditor } from "@/components/data/InternalNotesEditor";
import { InlineEditText } from "@/components/hq/InlineEditText";
import { InlineTagInput } from "@/components/hq/InlineTagInput";
import { RecordCombobox } from "@/components/ui/RecordCombobox";
import { useBackHref } from "@/lib/hq/useBackHref";
import { formatPhone } from "@/lib/hq/phone";
import { toast } from "@/hooks/use-toast";

/**
 * Client Detail.
 *
 * Phase 5.6.3.1: detail-page inline-edit pattern (PersonDetail prototype
 * locked in 5.6.3). Every field saves itself optimistically. Pencil
 * button (icon-only) on the header still routes to `/clients/:id/edit`
 * as the power-edit / bulk fallback.
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
  tags: string[];
};

type Contact = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
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
  const [primaryContactPersonId, setPrimaryContactPersonId] = useState<string | null>(null);
  const [primaryContactEditing, setPrimaryContactEditing] = useState(false);
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
          .select("id, full_name, email, phone, role_title")
          .eq("client_id", id)
          .order("full_name", { ascending: true }),
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
      const row = clientRes.data as unknown as Omit<Client, "tags"> & { tags: string[] | null };
      setClient({ ...row, tags: row.tags ?? [] });
      const contactRows = (contactsRes.data ?? []) as unknown as Contact[];
      setContacts(contactRows);
      // Resolve which person is the Primary Contact: match by email (most
      // reliable) then full_name. Denormalized — no client.primary_contact_id
      // FK today; on pick, savePrimaryContact writes name/email/phone back
      // into the existing client.contact_* text columns.
      const byEmail = row.contact_email
        ? contactRows.find((c) => c.email && c.email === row.contact_email)
        : undefined;
      const byName = row.contact_name
        ? contactRows.find((c) => c.full_name === row.contact_name)
        : undefined;
      setPrimaryContactPersonId((byEmail ?? byName)?.id ?? null);
      setProjects((projectsRes.data ?? []) as unknown as PastProject[]);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [id]);

  const saveField = async <K extends keyof Client>(
    field: K,
    nextValue: Client[K],
  ): Promise<void> => {
    if (!client) return;
    const prev = client[field];
    setClient({ ...client, [field]: nextValue });
    const { error } = await supabase
      .from("clients")
      .update({ [field as string]: nextValue })
      .eq("id", client.id);
    if (error) {
      setClient({ ...client, [field]: prev });
      throw error;
    }
  };

  // Primary Contact relation (Phase 5.6.3.1 — Jimmie's request). Loads
  // people scoped to this client; "+ Add" inserts a new person row with
  // client_id = this.client.id. On pick, writes the person's name/email/
  // phone back into the denormalized client.contact_* text columns.
  // contact_email becomes derived (the inline-edit field below shows
  // the autofilled email read-only).
  const loadClientContactOptions = useCallback(
    async () =>
      contacts.map((c) => ({
        id: c.id,
        label: c.full_name + (c.role_title ? ` · ${c.role_title}` : ""),
      })),
    [contacts],
  );

  const applyPrimaryContact = async (person: Contact | null) => {
    if (!client) return;
    const prev = {
      contact_name: client.contact_name,
      contact_email: client.contact_email,
      contact_phone: client.contact_phone,
    };
    const next = person
      ? {
          contact_name: person.full_name,
          contact_email: person.email,
          contact_phone: person.phone,
        }
      : { contact_name: null, contact_email: null, contact_phone: null };
    setClient({ ...client, ...next });
    setPrimaryContactPersonId(person?.id ?? null);
    const { error } = await supabase.from("clients").update(next).eq("id", client.id);
    if (error) {
      setClient({ ...client, ...prev });
      toast({ title: "Primary Contact save failed", description: error.message, variant: "destructive" });
    }
  };

  const savePrimaryContact = async (nextId: string | null) => {
    if (nextId === null) {
      await applyPrimaryContact(null);
      return;
    }
    const person = contacts.find((c) => c.id === nextId);
    if (!person) {
      // Lookup miss → createClientContact already wrote the new contact;
      // no-op to avoid clobbering with null.
      return;
    }
    await applyPrimaryContact(person);
  };

  const createClientContact = useCallback(
    async (data: Record<string, string>) => {
      if (!client) return null;
      const { data: userRes } = await supabase.auth.getUser();
      const created_by = userRes.user?.id;
      if (!created_by) {
        toast({ title: "Not signed in", variant: "destructive" });
        return null;
      }
      const { data: row, error } = await supabase
        .from("people")
        .insert({
          full_name: data.full_name,
          email: data.email || null,
          role_title: data.role_title || null,
          client_id: client.id,
          affiliation_type: "Client",
          created_by,
        })
        .select("id, full_name, email, phone, role_title")
        .single();
      if (error || !row) {
        toast({ title: "Create failed", description: error?.message, variant: "destructive" });
        return null;
      }
      const created = row as Contact;
      setContacts((prev) =>
        [...prev, created].sort((a, b) => a.full_name.localeCompare(b.full_name)),
      );
      await applyPrimaryContact(created);
      return {
        id: created.id,
        label: created.full_name + (created.role_title ? ` · ${created.role_title}` : ""),
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client],
  );

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
            <h1 className="h-page" style={{ marginTop: 5 }}>
              <InlineEditText
                value={client.name}
                required
                placeholder="Client name"
                renderRead={(v) => v ?? "(unnamed)"}
                onSave={(next) => saveField("name", next)}
              />
            </h1>
            <div className="row-c" style={{ marginTop: 10 }}>
              {client.industry ? <span className="cap">{client.industry}</span> : null}
              {client.city ? <span className="cap">{client.city}</span> : null}
            </div>
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            aria-label="Edit Client"
            title="Edit Client"
            onClick={() => navigate(`/clients/${client.id}/edit`)}
            style={{ padding: "0 10px" }}
          >
            <Pencil className="ic" style={{ width: 14, height: 14 }} />
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
                  <InlineEditText
                    value={client.industry}
                    placeholder="Industry"
                    renderRead={(v) => (v ? v : <span className="muted subtle">-</span>)}
                    onSave={(next) => saveField("industry", next || null)}
                  />
                </dd>
                <dt>Website</dt>
                <dd>
                  <InlineEditText
                    value={client.website_url}
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
                </dd>
                <dt>Primary Contact</dt>
                <dd>
                  {primaryContactEditing ? (
                    <RecordCombobox
                      source={{ kind: "record", loadOptions: loadClientContactOptions }}
                      value={primaryContactPersonId}
                      onChange={(next) => {
                        void savePrimaryContact(next);
                        setPrimaryContactEditing(false);
                      }}
                      entityLabel="contact"
                      placeholder="Pick or add a contact..."
                      getRecordHref={(id) => `/people/${id}`}
                      miniCreateFields={[
                        { key: "full_name", label: "Full name", required: true },
                        { key: "email", label: "Email" },
                        { key: "role_title", label: "Role / title" },
                      ]}
                      onMiniCreate={async (data) => {
                        const result = await createClientContact(data);
                        if (result) setPrimaryContactEditing(false);
                        return result;
                      }}
                    />
                  ) : (
                    <span
                      role="button"
                      tabIndex={0}
                      className="inline-edit-read"
                      title="Click to edit"
                      onClick={() => setPrimaryContactEditing(true)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setPrimaryContactEditing(true);
                        }
                      }}
                    >
                      {(() => {
                        const p = primaryContactPersonId
                          ? contacts.find((c) => c.id === primaryContactPersonId)
                          : null;
                        if (!p) return <span className="muted subtle">-</span>;
                        return (
                          <>
                            {p.full_name}
                            {p.role_title ? (
                              <>
                                <span className="muted" style={{ margin: "0 6px" }}>·</span>
                                <span className="cap">{p.role_title}</span>
                              </>
                            ) : null}
                          </>
                        );
                      })()}
                    </span>
                  )}
                </dd>
                <dt>Email</dt>
                <dd>
                  {client.contact_email ? (
                    <a
                      className="tlink inline-block max-w-full truncate align-bottom"
                      href={`mailto:${client.contact_email}`}
                      onClick={(e) => e.stopPropagation()}
                      title="Auto-filled from Primary Contact"
                    >
                      {client.contact_email}
                    </a>
                  ) : (
                    <span className="muted subtle" title="Auto-fills from Primary Contact">
                      - (set Primary Contact above)
                    </span>
                  )}
                </dd>
                <dt>Phone</dt>
                <dd>
                  <InlineEditText
                    value={client.contact_phone}
                    placeholder="(212) 555-0000"
                    onBlurFormat={formatPhone}
                    renderRead={(v) =>
                      v ? (
                        <span className="mono" style={{ fontSize: 13 }}>{v}</span>
                      ) : (
                        <span className="muted subtle">-</span>
                      )
                    }
                    onSave={(next) => saveField("contact_phone", next || null)}
                  />
                </dd>
                <dt>Primary Address</dt>
                <dd>
                  <InlineEditText
                    value={client.primary_address}
                    placeholder="50 W 34th St, New York NY 10001"
                    multiline
                    renderRead={(v) =>
                      v ? (
                        <span style={{ whiteSpace: "pre-wrap" }}>{v}</span>
                      ) : (
                        <span className="muted subtle">-</span>
                      )
                    }
                    onSave={(next) => saveField("primary_address", next || null)}
                  />
                </dd>
                <dt>City</dt>
                <dd>
                  <RecordCombobox
                    source={{ kind: "lookup", table: "cities" }}
                    value={client.city || null}
                    onChange={(next) => void saveField("city", next || null)}
                    entityLabel="city"
                    placeholder="Select"
                  />
                </dd>
                <dt>Tags</dt>
                <dd>
                  <InlineTagInput
                    values={client.tags}
                    onChange={(next) => void saveField("tags", next)}
                  />
                </dd>
              </dl>
            </div>
          </section>

          <InternalNotesEditor parentType="client" parentId={client.id} />
        </div>

        <aside className="stack-6">
          <section className="card">
            <div className="card-headbar">
              <span className="h-card">Contacts</span>
            </div>
            <div className="card-pad">
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
            </div>
          </section>

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
