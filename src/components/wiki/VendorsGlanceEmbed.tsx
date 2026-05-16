import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "@/hooks/useUserRole";
import {
  IconCheck,
  IconPencil,
  IconStar,
} from "@/components/icons/HQIcons";
import {
  isInternalPartner,
  loadVendors,
  type VendorListRow,
} from "@/lib/vendors/queries";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";

/**
 * Wiki Preferred Vendors embed (Phase 5.4 feedback round 2). Renders a
 * curated subset of the Vendors database: only rows where `preferred = true`.
 * Grouped by category (one row per vendor, not per capability).
 *
 * Admins get a "Manage" button that opens a multi-select picker of every
 * vendor in the DB with a checkbox to toggle the preferred flag inline.
 *
 * Component name / file path kept (VendorsGlanceEmbed) because the wiki
 * page_type enum value is still `vendors_glance`. The wiki page row's
 * title + slug are "Preferred Vendors" / `preferred-vendors`.
 */
export function VendorsGlanceEmbed() {
  const { isAdmin } = useUserRole();
  const [rows, setRows] = useState<VendorListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    const r = await loadVendors();
    setRows(r);
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  if (loading) {
    return (
      <p className="cap" style={{ textAlign: "center", padding: "48px 0" }}>
        Loading vendors...
      </p>
    );
  }

  const preferred = rows.filter((v) => v.preferred);

  // Bucket vendors by category. Vendors without a category get bucketed
  // under "Uncategorized" so they still surface.
  const buckets = new Map<string, VendorListRow[]>();
  for (const v of preferred) {
    const key = v.category_name ?? "Uncategorized";
    const list = buckets.get(key) ?? [];
    list.push(v);
    buckets.set(key, list);
  }
  const sortedCaps = [...buckets.keys()].sort((a, b) => {
    if (a === "Uncategorized") return 1;
    if (b === "Uncategorized") return -1;
    return a.localeCompare(b);
  });

  return (
    <div className="stack-4">
      {isAdmin ? (
        <div className="row" style={{ justifyContent: "flex-end", marginBottom: 4 }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setPickerOpen(true)}
          >
            <IconPencil className="ic" />
            Manage Preferred List
          </button>
        </div>
      ) : null}

      {preferred.length === 0 ? (
        <div className="empty">
          <p>No preferred vendors selected yet.</p>
          {isAdmin ? (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{ marginTop: 16 }}
              onClick={() => setPickerOpen(true)}
            >
              <IconPencil className="ic" />
              Manage Preferred List
            </button>
          ) : null}
        </div>
      ) : (
        sortedCaps.map((cap) => (
          <div key={cap}>
            <div className="block-lbl">
              <span className="label-section">{cap}</span>
            </div>
            <div className="tbl-wrap">
              <table className="tbl">
                <tbody>
                  {(buckets.get(cap) ?? []).map((v) => (
                    <tr
                      key={v.id}
                      className={isInternalPartner(v.tags) ? "rb-info" : "rb-muted"}
                    >
                      <td className="lead" style={{ width: 240 }}>
                        <Link
                          to={`/vendors/${v.id}`}
                          className="tlink"
                          style={{
                            color: "hsl(var(--foreground))",
                            fontSize: 13,
                          }}
                        >
                          {v.name}
                        </Link>
                        {isInternalPartner(v.tags) ? (
                          <span
                            className="pill p-info pill-sm"
                            style={{ marginLeft: 6 }}
                          >
                            Internal
                          </span>
                        ) : null}
                      </td>
                      <td className="muted">
                        {v.capabilities.join(", ") || "-"}
                      </td>
                      <td className="muted">{v.city ?? "-"}</td>
                      <td className="r">
                        <Stars rating={v.internal_rating ?? 0} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}

      {pickerOpen ? (
        <ManagePreferredDialog
          allVendors={rows}
          onClose={() => setPickerOpen(false)}
          onSaved={async () => {
            setPickerOpen(false);
            await reload();
          }}
        />
      ) : null}
    </div>
  );
}

function ManagePreferredDialog({
  allVendors,
  onClose,
  onSaved,
}: {
  allVendors: VendorListRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  // Picker stores the desired-set; on Save we diff against the initial-set
  // and only write the rows that flipped.
  const initialIds = useMemo(
    () => new Set(allVendors.filter((v) => v.preferred).map((v) => v.id)),
    [allVendors],
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(initialIds);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allVendors;
    return allVendors.filter(
      (v) =>
        v.name.toLowerCase().includes(q) ||
        v.capabilities.some((c) => c.toLowerCase().includes(q)) ||
        (v.city ?? "").toLowerCase().includes(q),
    );
  }, [allVendors, search]);

  const dirty = useMemo(() => {
    if (selectedIds.size !== initialIds.size) return true;
    for (const id of selectedIds) if (!initialIds.has(id)) return true;
    return false;
  }, [selectedIds, initialIds]);

  const onSave = async () => {
    const toAdd: string[] = [];
    const toRemove: string[] = [];
    for (const id of selectedIds) if (!initialIds.has(id)) toAdd.push(id);
    for (const id of initialIds) if (!selectedIds.has(id)) toRemove.push(id);
    if (toAdd.length === 0 && toRemove.length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    if (toAdd.length > 0) {
      const { error } = await supabase
        .from("vendors")
        .update({ preferred: true })
        .in("id", toAdd);
      if (error) {
        setSaving(false);
        toast({
          title: "Update failed",
          description: error.message,
          variant: "destructive",
        });
        return;
      }
    }
    if (toRemove.length > 0) {
      const { error } = await supabase
        .from("vendors")
        .update({ preferred: false })
        .in("id", toRemove);
      if (error) {
        setSaving(false);
        toast({
          title: "Update failed",
          description: error.message,
          variant: "destructive",
        });
        return;
      }
    }
    setSaving(false);
    toast({
      title: `Preferred list updated · ${toAdd.length} added, ${toRemove.length} removed`,
    });
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent style={{ maxWidth: 640 }}>
        <DialogHeader>
          <DialogTitle>Manage Preferred Vendors</DialogTitle>
        </DialogHeader>
        <div className="stack-3">
          <input
            className="input"
            placeholder="Filter vendors by name, capability, or city..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          <div
            style={{
              maxHeight: 420,
              overflowY: "auto",
              border: "1px solid hsl(var(--border))",
              borderRadius: "var(--radius)",
            }}
          >
            {filtered.length === 0 ? (
              <p className="cap" style={{ padding: 24, textAlign: "center" }}>
                No matching vendors.
              </p>
            ) : (
              filtered.map((v) => {
                const on = selectedIds.has(v.id);
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => toggle(v.id)}
                    className="row-c"
                    style={{
                      width: "100%",
                      padding: "10px 14px",
                      gap: 12,
                      background: on
                        ? "rgba(190,78,68,.07)"
                        : "transparent",
                      borderBottom: "1px solid hsl(var(--border))",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <span
                      className={`checkbox ${on ? "checkbox--on" : ""}`}
                      style={{ flex: "none" }}
                    >
                      {on ? <IconCheck className="ic" /> : null}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 500,
                          color: "hsl(var(--foreground))",
                        }}
                      >
                        {v.name}
                      </div>
                      <div className="cap" style={{ marginTop: 2 }}>
                        {v.capabilities.join(" · ") || "No capabilities set"}
                        {v.city ? ` · ${v.city}` : ""}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
          <p className="cap">
            {selectedIds.size} selected · {allVendors.length} total vendors
          </p>
        </div>
        <DialogFooter>
          <button type="button" className="btn btn-tertiary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onSave}
            disabled={!dirty || saving}
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stars({ rating }: { rating: number }) {
  const filled = Math.max(0, Math.min(5, Math.round(rating)));
  return (
    <span className="stars" style={{ display: "inline-flex", gap: 1 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <IconStar
          key={n}
          className={`ic ic-sm ${n > filled ? "star-off" : ""}`}
          style={{
            color:
              n > filled
                ? "hsl(var(--subtle-foreground))"
                : "hsl(var(--warn))",
            fill: n > filled ? "none" : "hsl(var(--warn))",
            opacity: n > filled ? 0.35 : 1,
          }}
        />
      ))}
    </span>
  );
}
