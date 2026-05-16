import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Pencil } from "lucide-react";
import {
  IconArrowLeft,
  IconLink,
  IconPlus,
} from "@/components/icons/HQIcons";
import { StarRating } from "@/components/data/StarRating";
import { InternalNotesEditor } from "@/components/data/InternalNotesEditor";
import { isInternalPartner } from "@/lib/vendors/queries";
import { OverflowList, type OverflowItem } from "@/components/hq/OverflowList";
import { toast } from "@/hooks/use-toast";

/**
 * Vendor Detail.
 *
 * Wireframe binding (DEVIATION): adapted from Surface 10
 * (OUTPUTS/phase-5-hq-wireframe-v1-LOCKED.html lines 1856-1969) which
 * was drawn as a unified Organization Detail. Per the 2026-05-16
 * locked decisions split (spec § 0c Q3), Organizations breaks into
 * Clients + Vendors. This is the Vendors half. Internal Rating shown
 * always (every detail is a Vendor); Internal Partner badge appears
 * when the 'Internal Partner' tag is present (locked Q1); Category
 * surfaces in Details kv from the new vendor_categories lookup.
 * Wireframe-v2 redraw deferred to a future polish pass; see
 * design-system § 11.
 *
 * 5.2 cleanup: Primary Address row added to the Details kv (matches
 * ClientDetail shape; backed by the new `vendors.primary_address`
 * column added in the cleanup migration).
 */

type Vendor = {
  id: string;
  name: string;
  category_id: string | null;
  category_name: string | null;
  city: string | null;
  capabilities: string[] | null;
  website_url: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  primary_address: string | null;
  tags: string[] | null;
  internal_rating: number | null;
};

type Contact = {
  id: string;
  full_name: string;
  role_title: string | null;
};

type ProjectLink = {
  id: string;
  name: string;
  job_number: string | null;
};

export default function VendorDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [projects, setProjects] = useState<ProjectLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [ratingSaving, setRatingSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    let active = true;
    (async () => {
      const [vendorRes, contactsRes, projectsRes] = await Promise.all([
        supabase
          .from("vendors")
          .select(
            "id, name, category_id, city, capabilities, website_url, contact_name, contact_email, contact_phone, primary_address, tags, internal_rating, " +
              "category:vendor_categories!vendors_category_id_fkey(id, name)",
          )
          .eq("id", id)
          .single(),
        supabase
          .from("people")
          .select("id, full_name, role_title")
          .eq("vendor_id", id)
          .order("full_name", { ascending: true })
          .limit(5),
        supabase
          .from("project_vendors")
          .select(
            "created_at, project:projects!project_vendors_project_id_fkey(id, name, job_number)",
          )
          .eq("vendor_id", id)
          .order("created_at", { ascending: false }),
      ]);
      if (!active) return;
      if (vendorRes.error || !vendorRes.data) {
        console.warn("vendor load failed", vendorRes.error);
        setLoading(false);
        return;
      }
      const v = vendorRes.data as unknown as Omit<Vendor, "category_name"> & {
        category: { id: string; name: string | null } | null;
      };
      setVendor({
        ...v,
        category_name: v.category?.name ?? null,
      });
      setContacts((contactsRes.data ?? []) as unknown as Contact[]);

      const projs: ProjectLink[] = [];
      for (const r of projectsRes.data ?? []) {
        const pr = r as unknown as {
          project: { id: string; name: string | null; job_number: string | null } | null;
        };
        if (pr.project) {
          projs.push({
            id: pr.project.id,
            name: pr.project.name ?? "Untitled",
            job_number: pr.project.job_number,
          });
        }
      }
      setProjects(projs);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [id]);

  const onRatingChange = async (next: number) => {
    if (!vendor) return;
    setRatingSaving(true);
    const prev = vendor.internal_rating;
    setVendor({ ...vendor, internal_rating: next });
    const { error } = await supabase
      .from("vendors")
      .update({ internal_rating: next })
      .eq("id", vendor.id);
    setRatingSaving(false);
    if (error) {
      setVendor({ ...vendor, internal_rating: prev });
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
  if (!vendor) {
    return (
      <div className="empty">
        <p>Vendor not found.</p>
      </div>
    );
  }

  const internalPartner = isInternalPartner(vendor.tags);

  return (
    <div className="stack-6">
      <div className="stack-3">
        <Link to="/vendors" className="crumb">
          <IconArrowLeft className="ic ic-sm" /> Back to Vendors
        </Link>
        <div className="row between" style={{ alignItems: "flex-start" }}>
          <div>
            <div className="eyebrow">Vendor</div>
            <h1 className="h-page" style={{ marginTop: 5 }}>{vendor.name}</h1>
            <div className="row-c" style={{ marginTop: 10 }}>
              {internalPartner ? (
                <span className="pill pill-lg p-info">Internal Partner</span>
              ) : null}
              {vendor.category_name ? (
                <span className="cap">{vendor.category_name}</span>
              ) : null}
              {vendor.city ? <span className="cap">{vendor.city}</span> : null}
            </div>
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate(`/vendors/${vendor.id}/edit`)}
          >
            <Pencil className="ic" style={{ width: 14, height: 14 }} />
            Edit Vendor
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
                <dt>Category</dt>
                <dd>
                  {vendor.category_name ? (
                    <span>{vendor.category_name}</span>
                  ) : (
                    <span className="muted subtle">-</span>
                  )}
                </dd>
                <dt>Capabilities</dt>
                <dd>
                  {vendor.capabilities && vendor.capabilities.length > 0 ? (
                    <span className="row-c wrap" style={{ display: "inline-flex", gap: 6 }}>
                      {vendor.capabilities.map((c) => (
                        <span key={c} className="tag">{c}</span>
                      ))}
                    </span>
                  ) : (
                    <span className="muted subtle">-</span>
                  )}
                </dd>
                <dt>Website</dt>
                <dd>
                  {vendor.website_url ? (
                    <a
                      className="tlink"
                      href={vendor.website_url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <IconLink className="ic ic-sm" /> {prettyHost(vendor.website_url)}
                    </a>
                  ) : (
                    <span className="muted subtle">-</span>
                  )}
                </dd>
                <dt>Primary Contact</dt>
                <dd>
                  {vendor.contact_name ? (
                    vendor.contact_email ? (
                      <a
                        className="tlink inline-block max-w-full truncate align-bottom"
                        href={`mailto:${vendor.contact_email}`}
                      >
                        {vendor.contact_name}
                      </a>
                    ) : (
                      vendor.contact_name
                    )
                  ) : (
                    <span className="muted subtle">-</span>
                  )}
                </dd>
                <dt>Phone</dt>
                <dd className="mono" style={{ fontSize: 13 }}>
                  {vendor.contact_phone ?? <span className="muted subtle">-</span>}
                </dd>
                <dt>Primary Address</dt>
                <dd>
                  {vendor.primary_address ? (
                    <span style={{ whiteSpace: "pre-wrap" }}>{vendor.primary_address}</span>
                  ) : (
                    <span className="muted subtle">-</span>
                  )}
                </dd>
                <dt>City</dt>
                <dd>
                  {vendor.city ? (
                    <span className="tag">{vendor.city}</span>
                  ) : (
                    <span className="muted subtle">-</span>
                  )}
                </dd>
                <dt>Tags</dt>
                <dd>
                  {vendor.tags && vendor.tags.length > 0 ? (
                    <span className="row-c wrap" style={{ display: "inline-flex", gap: 6 }}>
                      {vendor.tags.map((t) => (
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

          <InternalNotesEditor parentType="vendor" parentId={vendor.id} />

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
              <span className="label-section">Internal Rating</span>
            </div>
            <div className="row-c" style={{ gap: 8 }}>
              <StarRating
                value={vendor.internal_rating}
                editable
                size="lg"
                onChange={onRatingChange}
              />
              <span className="cap">
                {vendor.internal_rating != null
                  ? `${vendor.internal_rating} of 5`
                  : "Not rated"}
                {ratingSaving ? " . saving" : ""}
              </span>
            </div>
            <p className="cap" style={{ marginTop: 10, lineHeight: 1.5 }}>
              Visible to all Standard users.
            </p>
          </section>

          <section className="card card-pad">
            <div className="block-lbl">
              <span className="label-section">Projects</span>
            </div>
            {projects.length === 0 ? (
              <p className="subtle" style={{ fontSize: 13 }}>No projects yet.</p>
            ) : (
              <div style={{ fontSize: 12.5 }}>
                <OverflowList
                  items={projects.map<OverflowItem>((p) => ({
                    id: p.id,
                    label: p.job_number ? `#${p.job_number} ${p.name}` : p.name,
                    href: `/projects/${p.id}`,
                  }))}
                />
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
