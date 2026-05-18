import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Pencil } from "lucide-react";
import {
  IconArrowLeft,
  IconLink,
} from "@/components/icons/HQIcons";
import { StarRating } from "@/components/data/StarRating";
import { InternalNotesEditor } from "@/components/data/InternalNotesEditor";
import { VendorFilesEditor } from "@/components/data/VendorFilesEditor";
import { isInternalPartner } from "@/lib/vendors/queries";
import { InlineEditText } from "@/components/hq/InlineEditText";
import { InlineTagInput } from "@/components/hq/InlineTagInput";
import { RecordCombobox } from "@/components/ui/RecordCombobox";
import { useBackHref } from "@/lib/hq/useBackHref";
import { useAuth } from "@/hooks/useAuth";
import { useLookup, getLookupCached } from "@/lib/hq/lookups";
import { formatPhone } from "@/lib/hq/phone";
import { toast } from "@/hooks/use-toast";

/**
 * Vendor Detail.
 *
 * Phase 5.6.3.1: detail-page inline-edit pattern. Every field saves
 * itself optimistically; Pencil button (icon-only) on the header still
 * routes to `/vendors/:id/edit` as the power-edit fallback.
 *
 * Wireframe binding (DEVIATION carried over from 5.2): adapted from
 * Surface 10. Wireframe-v2 redraw deferred to a polish pass.
 */

type Vendor = {
  id: string;
  name: string;
  category_id: string | null;
  category_name: string | null;
  subcategory_id: string | null;
  subcategory_name: string | null;
  city: string | null;
  capabilities: string[];
  website_url: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  primary_address: string | null;
  tags: string[];
};

type Contact = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  role_title: string | null;
};

type ProjectLink = {
  id: string;
  name: string;
  job_number: string | null;
};

type RatingRow = {
  user_id: string;
  rating: number;
};

export default function VendorDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const currentUserId = user?.id ?? null;
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [projects, setProjects] = useState<ProjectLink[]>([]);
  const [ratings, setRatings] = useState<RatingRow[]>([]);
  const [primaryContactPersonId, setPrimaryContactPersonId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const back = useBackHref({ to: "/vendors", label: "Vendors" });
  const categories = useLookup("vendor_categories");
  const subcategories = useLookup("vendor_subcategories", {
    parentScopeId: vendor?.category_id || null,
  });

  useEffect(() => {
    if (!id) return;
    let active = true;
    (async () => {
      const [vendorRes, contactsRes, projectsRes, ratingsRes] = await Promise.all([
        supabase
          .from("vendors")
          .select(
            "id, name, category_id, subcategory_id, city, capabilities, website_url, contact_name, contact_email, contact_phone, primary_address, tags, " +
              "category:vendor_categories!vendors_category_id_fkey(id, name), " +
              "subcategory:vendor_subcategories!vendors_subcategory_id_fkey(id, name)",
          )
          .eq("id", id)
          .single(),
        supabase
          .from("people")
          .select("id, full_name, email, phone, role_title")
          .eq("vendor_id", id)
          .order("full_name", { ascending: true }),
        supabase
          .from("project_vendors")
          .select(
            "created_at, project:projects!project_vendors_project_id_fkey(id, name, job_number)",
          )
          .eq("vendor_id", id)
          .order("created_at", { ascending: false }),
        supabase
          .from("vendor_ratings")
          .select("user_id, rating")
          .eq("vendor_id", id),
      ]);
      if (!active) return;
      if (vendorRes.error || !vendorRes.data) {
        console.warn("vendor load failed", vendorRes.error);
        setLoading(false);
        return;
      }
      const v = vendorRes.data as unknown as Omit<Vendor, "category_name" | "subcategory_name" | "capabilities" | "tags"> & {
        category: { id: string; name: string | null } | null;
        subcategory: { id: string; name: string | null } | null;
        capabilities: string[] | null;
        tags: string[] | null;
      };
      setVendor({
        ...v,
        category_name: v.category?.name ?? null,
        subcategory_name: v.subcategory?.name ?? null,
        capabilities: v.capabilities ?? [],
        tags: v.tags ?? [],
      });
      setRatings((ratingsRes.data ?? []) as RatingRow[]);
      const contactRows = (contactsRes.data ?? []) as unknown as Contact[];
      setContacts(contactRows);
      // Best-effort resolve which person is the Primary Contact: match by
      // email first (most reliable), then by full_name. The vendor schema
      // doesn't carry a primary_contact_id FK today, so this is a derived
      // pointer; on pick, savePrimaryContact writes name/email/phone back
      // into the existing vendor.contact_* text columns.
      const byEmail = v.contact_email
        ? contactRows.find((c) => c.email && c.email === v.contact_email)
        : undefined;
      const byName = v.contact_name
        ? contactRows.find((c) => c.full_name === v.contact_name)
        : undefined;
      setPrimaryContactPersonId((byEmail ?? byName)?.id ?? null);

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

  const saveField = async <K extends keyof Vendor>(
    field: K,
    nextValue: Vendor[K],
  ): Promise<void> => {
    if (!vendor) return;
    const prev = vendor[field];
    setVendor({ ...vendor, [field]: nextValue });
    const { error } = await supabase
      .from("vendors")
      .update({ [field as string]: nextValue })
      .eq("id", vendor.id);
    if (error) {
      setVendor({ ...vendor, [field]: prev });
      throw error;
    }
  };

  // Category change clears Subcategory (the prior pick may not belong to
  // the new parent). Mirrors the VendorEdit form pattern.
  const saveCategoryId = async (nextId: string | null) => {
    if (!vendor) return;
    const prev = {
      category_id: vendor.category_id,
      category_name: vendor.category_name,
      subcategory_id: vendor.subcategory_id,
      subcategory_name: vendor.subcategory_name,
    };
    const nextCategory = nextId
      ? categories.options.find((o) => o.id === nextId) ?? null
      : null;
    setVendor({
      ...vendor,
      category_id: nextId,
      category_name: nextCategory?.name ?? null,
      subcategory_id: null,
      subcategory_name: null,
    });
    const { error } = await supabase
      .from("vendors")
      .update({ category_id: nextId, subcategory_id: null })
      .eq("id", vendor.id);
    if (error) {
      setVendor({ ...vendor, ...prev });
      toast({ title: "Category save failed", description: error.message, variant: "destructive" });
    }
  };

  const saveSubcategoryId = async (nextId: string | null) => {
    if (!vendor) return;
    const prev = {
      subcategory_id: vendor.subcategory_id,
      subcategory_name: vendor.subcategory_name,
    };
    const nextSub = nextId
      ? subcategories.options.find((o) => o.id === nextId) ?? null
      : null;
    setVendor({
      ...vendor,
      subcategory_id: nextId,
      subcategory_name: nextSub?.name ?? null,
    });
    const { error } = await supabase
      .from("vendors")
      .update({ subcategory_id: nextId })
      .eq("id", vendor.id);
    if (error) {
      setVendor({ ...vendor, ...prev });
      toast({ title: "Subcategory save failed", description: error.message, variant: "destructive" });
    }
  };

  // Category / Subcategory use RecordCombobox's `lookup` mode (binds option
  // names; the hook's addOption handles inline "+ Add"). We translate
  // id ↔ name at the prop boundary so saveCategoryId / saveSubcategoryId
  // can write the FK. Previously these were wired in `record` mode without
  // an onMiniCreate handler, which produced the "Create failed Please try
  // again." toast on inline-add.
  const selectedCategoryName = useMemo(() => {
    if (!vendor?.category_id) return null;
    return categories.options.find((o) => o.id === vendor.category_id)?.name ?? null;
  }, [vendor?.category_id, categories.options]);
  const selectedSubcategoryName = useMemo(() => {
    if (!vendor?.subcategory_id) return null;
    return subcategories.options.find((o) => o.id === vendor.subcategory_id)?.name ?? null;
  }, [vendor?.subcategory_id, subcategories.options]);
  // Capabilities live on a lookup table — surface as a multi typeahead
  // that binds option names directly (matches the existing
  // RecordCombobox lookup-mode contract).
  const capabilitiesLookup = useLookup("vendor_capabilities");
  const capabilitiesNames = useMemo(
    () => capabilitiesLookup.options.map((o) => o.name),
    [capabilitiesLookup.options],
  );

  // Primary Contact picker options: people already affiliated with THIS
  // vendor (Phase 5.6.3.1 — Jimmie's relation-field request). Inline
  // "+ Add" opens MiniCreateModal with name + email + role_title; the
  // new row is inserted with vendor_id = this vendor's id, then
  // pre-selected via the modal's onCreated path.
  const loadVendorContactOptions = useCallback(
    async () =>
      contacts.map((c) => ({
        id: c.id,
        label: c.full_name + (c.role_title ? ` · ${c.role_title}` : ""),
      })),
    [contacts],
  );

  const createVendorContact = useCallback(
    async (data: Record<string, string>) => {
      if (!vendor) return null;
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
          vendor_id: vendor.id,
          affiliation_type: "Vendor",
          created_by,
        })
        .select("id, full_name, email, phone, role_title")
        .single();
      if (error || !row) {
        toast({ title: "Create failed", description: error?.message, variant: "destructive" });
        return null;
      }
      const created = row as Contact;
      setContacts((prev) => [...prev, created].sort((a, b) => a.full_name.localeCompare(b.full_name)));
      // Auto-write the new contact's identity back into the vendor record
      // so the picker's onChange (which doesn't fire on mini-create) doesn't
      // miss the denormalize step.
      await applyPrimaryContact(created);
      return {
        id: created.id,
        label: created.full_name + (created.role_title ? ` · ${created.role_title}` : ""),
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vendor],
  );

  // Shared writer: takes a Contact and writes name/email/phone back into
  // the vendor's existing text columns (denormalized — no schema column
  // for primary_contact_id today). Called by savePrimaryContact and by
  // createVendorContact's auto-select step.
  const applyPrimaryContact = async (person: Contact | null) => {
    if (!vendor) return;
    const prev = {
      contact_name: vendor.contact_name,
      contact_email: vendor.contact_email,
      contact_phone: vendor.contact_phone,
    };
    const next = person
      ? {
          contact_name: person.full_name,
          contact_email: person.email,
          contact_phone: person.phone,
        }
      : { contact_name: null, contact_email: null, contact_phone: null };
    setVendor({ ...vendor, ...next });
    setPrimaryContactPersonId(person?.id ?? null);
    const { error } = await supabase
      .from("vendors")
      .update(next)
      .eq("id", vendor.id);
    if (error) {
      setVendor({ ...vendor, ...prev });
      toast({ title: "Primary Contact save failed", description: error.message, variant: "destructive" });
    }
  };

  const savePrimaryContact = async (nextId: string | null) => {
    if (nextId === null) {
      // Explicit deselect → clear the denormalized fields.
      await applyPrimaryContact(null);
      return;
    }
    const person = contacts.find((c) => c.id === nextId);
    if (!person) {
      // Lookup miss → the row was just created via mini-create and the
      // createVendorContact handler already wrote the new contact into the
      // vendor + bumped local state. The ComboboxView re-fires onChange
      // with the new id after; no-op so we don't clobber.
      return;
    }
    await applyPrimaryContact(person);
  };

  // Phase 5.7.13: per-user vendor ratings. `myRating` is the viewer's own
  // row (null if they haven't rated); aggregate is the team-wide average +
  // count across every rater. UPSERT on click; DELETE on Clear.
  const myRating = currentUserId
    ? ratings.find((r) => r.user_id === currentUserId)?.rating ?? null
    : null;
  const teamCount = ratings.length;
  const teamAverage =
    teamCount > 0 ? ratings.reduce((s, r) => s + r.rating, 0) / teamCount : 0;

  const saveMyRating = async (next: number | null) => {
    if (!id || !currentUserId) return;
    try {
      if (next === null) {
        const { error } = await supabase
          .from("vendor_ratings")
          .delete()
          .eq("vendor_id", id)
          .eq("user_id", currentUserId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("vendor_ratings")
          .upsert(
            { vendor_id: id, user_id: currentUserId, rating: next },
            { onConflict: "vendor_id,user_id" },
          );
        if (error) throw error;
      }
      const { data: r } = await supabase
        .from("vendor_ratings")
        .select("user_id, rating")
        .eq("vendor_id", id);
      setRatings((r ?? []) as RatingRow[]);
    } catch (err) {
      toast({
        title: "Could not save rating",
        description: err instanceof Error ? err.message : "Save failed",
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
        <Link to={back.to} className="crumb">
          <IconArrowLeft className="ic ic-sm" /> Back to {back.label}
        </Link>
        <div className="row between" style={{ alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="eyebrow">Vendor</div>
            <h1 className="h-page" style={{ marginTop: 5 }}>
              <InlineEditText
                value={vendor.name}
                required
                placeholder="Vendor name"
                renderRead={(v) => v ?? "(unnamed)"}
                onSave={(next) => saveField("name", next)}
              />
            </h1>
            {internalPartner ||
            vendor.category_name ||
            vendor.subcategory_name ||
            vendor.city ? (
              <div className="row-c" style={{ marginTop: 10 }}>
                {internalPartner ? (
                  <span className="pill pill-lg p-info">Internal</span>
                ) : null}
                {vendor.category_name || vendor.subcategory_name || vendor.city ? (
                  <span
                    style={{
                      fontSize: 14,
                      color: "hsl(var(--muted-foreground))",
                    }}
                  >
                    {[vendor.category_name, vendor.subcategory_name, vendor.city]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            aria-label="Edit Vendor"
            title="Edit Vendor"
            onClick={() => navigate(`/vendors/${vendor.id}/edit`)}
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
                <dt>Category</dt>
                <dd>
                  <RecordCombobox
                    source={{ kind: "lookup", table: "vendor_categories" }}
                    value={selectedCategoryName}
                    onChange={(name) => {
                      if (name === null) {
                        void saveCategoryId(null);
                        return;
                      }
                      // Closure-captured `categories.options` is stale
                      // right after inline-add (setState hasn't propagated
                      // yet). Fall back to the synchronous cache reader
                      // which sees the row addOption just inserted.
                      const opt =
                        categories.options.find((o) => o.name === name) ??
                        getLookupCached("vendor_categories").find((o) => o.name === name);
                      if (!opt) return;
                      void saveCategoryId(opt.id);
                    }}
                    entityLabel="Category"
                    placeholder="No category"
                  />
                </dd>
                <dt>Subcategory</dt>
                <dd>
                  <RecordCombobox
                    source={{
                      kind: "lookup",
                      table: "vendor_subcategories",
                      parentScopeId: vendor.category_id || null,
                      parentScopeLabel:
                        categories.options.find(
                          (o) => o.id === vendor.category_id,
                        )?.name ?? null,
                      parentScopeLabelKey: "Category",
                    }}
                    value={selectedSubcategoryName}
                    onChange={(name) => {
                      if (name === null) {
                        void saveSubcategoryId(null);
                        return;
                      }
                      const opt =
                        subcategories.options.find((o) => o.name === name) ??
                        getLookupCached(
                          "vendor_subcategories",
                          vendor.category_id || null,
                        ).find((o) => o.name === name);
                      if (!opt) return;
                      void saveSubcategoryId(opt.id);
                    }}
                    entityLabel="Subcategory"
                    placeholder={vendor.category_id ? "No subcategory" : "Pick Category first"}
                    disabled={!vendor.category_id}
                  />
                </dd>
                <dt>Capabilities</dt>
                <dd>
                  <RecordCombobox
                    multi
                    source={{ kind: "lookup", table: "vendor_capabilities" }}
                    multiValue={vendor.capabilities.filter((c) =>
                      capabilitiesNames.includes(c),
                    )}
                    onMultiChange={(next) => void saveField("capabilities", next)}
                    entityLabel="Capability"
                    placeholder="Add capability..."
                  />
                </dd>
                <dt>Website</dt>
                <dd>
                  <InlineEditText
                    value={vendor.website_url}
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
                <dt>Email</dt>
                <dd>
                  <InlineEditText
                    value={vendor.contact_email}
                    placeholder="contact@example.com"
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
                    onSave={(next) => saveField("contact_email", next || null)}
                  />
                </dd>
                <dt>Phone</dt>
                <dd>
                  <InlineEditText
                    value={vendor.contact_phone}
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
                <dt>Primary Contact</dt>
                <dd>
                  <RecordCombobox
                    source={{ kind: "record", loadOptions: loadVendorContactOptions }}
                    value={primaryContactPersonId}
                    onChange={(next) => void savePrimaryContact(next)}
                    entityLabel="contact"
                    placeholder="Pick or add a contact..."
                    getRecordHref={(id) => `/people/${id}`}
                    miniCreateFields={[
                      { key: "full_name", label: "Full name", required: true },
                      { key: "email", label: "Email" },
                      { key: "role_title", label: "Role / title" },
                    ]}
                    onMiniCreate={createVendorContact}
                  />
                </dd>
                <dt>Address</dt>
                <dd>
                  <InlineEditText
                    value={vendor.primary_address}
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
                    value={vendor.city || null}
                    onChange={(next) => void saveField("city", next || null)}
                    entityLabel="city"
                    placeholder="Select"
                  />
                </dd>
                <dt>Tags</dt>
                <dd>
                  <InlineTagInput
                    values={vendor.tags}
                    onChange={(next) => void saveField("tags", next)}
                  />
                </dd>
              </dl>
            </div>
          </section>

          <VendorFilesEditor vendorId={vendor.id} />
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
              <span className="h-card">Team Rating</span>
            </div>
            <div className="card-pad stack-3">
              <div className="row-c" style={{ gap: 8 }}>
                <StarRating
                  value={Math.round(teamAverage * 2) / 2}
                  editable={false}
                  size="lg"
                />
                <span className="cap">
                  {teamCount > 0
                    ? `${teamAverage.toFixed(1)} of 5 · ${teamCount} ${teamCount === 1 ? "rating" : "ratings"}`
                    : "No ratings yet"}
                </span>
              </div>
              <div
                className="row between"
                style={{
                  alignItems: "center",
                  borderTop: "1px solid hsl(var(--border))",
                  paddingTop: 12,
                }}
              >
                <span className="cap">Your rating</span>
                <div className="row-c" style={{ gap: 8 }}>
                  <StarRating
                    value={myRating}
                    editable
                    size="md"
                    onChange={(next) => void saveMyRating(next)}
                  />
                  {myRating != null ? (
                    <button
                      type="button"
                      className="tlink"
                      style={{
                        background: "none",
                        border: 0,
                        padding: 0,
                        cursor: "pointer",
                        fontSize: 12,
                      }}
                      onClick={() => void saveMyRating(null)}
                    >
                      Clear
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </section>

          <InternalNotesEditor parentType="vendor" parentId={vendor.id} />

          <section className="card">
            <div className="card-headbar">
              <span className="h-card">Projects</span>
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
