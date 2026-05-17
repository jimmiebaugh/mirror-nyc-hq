import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { backState } from "@/lib/hq/useBackHref";
import { FilterBar, emptyFilterState, type FilterFieldDef, type FilterState } from "@/components/data/FilterBar";
import { SavedViewsDropdown } from "@/components/data/SavedViewsDropdown";
import { getDefaultSavedView } from "@/lib/hq/savedViews";
import { DataTable } from "@/components/data/DataTable";
import { StarRating } from "@/components/data/StarRating";
import { OverflowList, type OverflowItem } from "@/components/hq/OverflowList";
import { IconPlus } from "@/components/icons/HQIcons";
import { applyFilters } from "@/lib/hq/filterStateApply";
import {
  isInternalPartner,
  loadVendors,
  type VendorListRow,
} from "@/lib/vendors/queries";

/**
 * Vendors List.
 *
 * Wireframe binding (DEVIATION): adapted from Surface 10
 * (OUTPUTS/phase-5-hq-wireframe-v1-LOCKED.html lines 1791-1854) which
 * was drawn as a unified Organizations surface with a Type filter pill
 * row. Per the 2026-05-16 locked decisions split (spec § 0c Q3),
 * Organizations breaks into separate Clients + Vendors surfaces. This
 * is the Vendors half. Type filter pill row dropped (no Client /
 * Vendor / Internal mix to filter); Category column added via the new
 * vendor_categories lookup; Internal Partner badge column derived from
 * the 'Internal Partner' tag (locked Q1 collapses internal into
 * tags[]). Star Rating shows on every row (every row is a Vendor).
 * Wireframe-v2 redraw deferred to a future polish pass; see
 * design-system § 11.
 */

const VENDOR_FILTER_FIELDS: FilterFieldDef[] = [
  { key: "category_name", label: "Category", type: "text" },
  { key: "subcategory_name", label: "Subcategory", type: "text" },
  { key: "capabilities", label: "Capabilities", type: "text" },
  { key: "city", label: "City", type: "text" },
  { key: "tags", label: "Tags", type: "text" },
];

const FROM_LABEL = "Vendors";

export default function VendorsList() {
  const navigate = useNavigate();
  const location = useLocation();
  const fromState = backState(location, FROM_LABEL);
  const [rows, setRows] = useState<VendorListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterState, setFilterState] = useState<FilterState>(emptyFilterState());
  const [activeViewName, setActiveViewName] = useState("All vendors");

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadVendors().then((r) => {
      if (active) {
        setRows(r);
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  // Phase 5.6.5: resolve default saved view on mount.
  useEffect(() => {
    let active = true;
    getDefaultSavedView("vendor").then((v) => {
      if (!active || !v) return;
      setFilterState(v.filter_state);
      setActiveViewName(v.name);
    });
    return () => {
      active = false;
    };
  }, []);

  const handleResetToGlobal = async () => {
    const v = await getDefaultSavedView("vendor");
    if (v) {
      setFilterState(v.filter_state);
      setActiveViewName(v.name);
    } else {
      setFilterState(emptyFilterState());
      setActiveViewName("All vendors");
    }
  };

  const filtered = useMemo(
    () =>
      applyFilters(rows, filterState, (row, key) => {
        const val = (row as unknown as Record<string, unknown>)[key];
        if (val == null) return null;
        if (Array.isArray(val)) return val.map(String);
        return typeof val === "string" ? val : String(val);
      }),
    [rows, filterState],
  );

  return (
    <div className="stack-4">
      <div className="pagehead">
        <div className="row between">
          <h1 className="h-page">Vendors</h1>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => navigate("/vendors/new")}
          >
            <IconPlus className="ic" />
            New Vendor
          </button>
        </div>
      </div>

      <div className="row between wrap" style={{ alignItems: "center" }}>
        <div className="row-c">
          <SavedViewsDropdown
            entityType="vendor"
            activeName={activeViewName}
            activeViewKind="list"
            activeFilterState={filterState}
            onPick={(v) => {
              setFilterState(v.filter_state);
              setActiveViewName(v.name);
            }}
            onResetToGlobal={handleResetToGlobal}
          />
        </div>
        <FilterBar
          state={filterState}
          onChange={(next) => {
            setFilterState(next);
            setActiveViewName("Custom filter");
          }}
          fields={VENDOR_FILTER_FIELDS}
        />
      </div>

      {loading ? (
        <div className="empty">
          <p>Loading...</p>
        </div>
      ) : (
        <>
          <DataTable<VendorListRow>
            rows={filtered}
            flat
            onRowClick={(r) => navigate(`/vendors/${r.id}`, { state: { from: fromState } })}
            empty={{
              message: "No vendors match your filters.",
              ctaLabel: "+ New Vendor",
              onCta: () => navigate("/vendors/new"),
            }}
            columns={[
              {
                key: "name",
                label: "Vendor",
                sort: (a, b) => a.name.localeCompare(b.name),
                render: (r) => (
                  <span className="row-c" style={{ display: "inline-flex", gap: 6 }}>
                    <span className="lead">{r.name}</span>
                    {isInternalPartner(r.tags) ? (
                      <span className="pill pill-sm p-info">Internal</span>
                    ) : null}
                  </span>
                ),
              },
              {
                key: "category_name",
                label: "Category",
                sort: (a, b) => (a.category_name ?? "").localeCompare(b.category_name ?? ""),
                render: (r) =>
                  r.category_name ? (
                    <span className="muted">{r.category_name}</span>
                  ) : (
                    <span className="muted subtle">-</span>
                  ),
              },
              {
                key: "subcategory_name",
                label: "Subcategory",
                sort: (a, b) =>
                  (a.subcategory_name ?? "").localeCompare(b.subcategory_name ?? ""),
                render: (r) =>
                  r.subcategory_name ? (
                    <span className="muted">{r.subcategory_name}</span>
                  ) : (
                    <span className="muted subtle">-</span>
                  ),
              },
              {
                key: "city",
                label: "City",
                sort: (a, b) => (a.city ?? "").localeCompare(b.city ?? ""),
                render: (r) =>
                  r.city ? (
                    <span className="muted">{r.city}</span>
                  ) : (
                    <span className="muted subtle">-</span>
                  ),
              },
              {
                key: "capabilities",
                label: "Capabilities",
                render: (r) => (
                  <OverflowList
                    asChip
                    items={r.capabilities.map<OverflowItem>((c) => ({
                      id: c,
                      label: c,
                      href: null,
                    }))}
                  />
                ),
              },
              // (Rating column below)
              {
                key: "internal_rating",
                label: "Rating",
                align: "c",
                sort: (a, b) => (a.internal_rating ?? -1) - (b.internal_rating ?? -1),
                render: (r) =>
                  r.internal_rating != null ? (
                    <StarRating value={r.internal_rating} size="sm" />
                  ) : (
                    <span className="muted subtle">-</span>
                  ),
              },
              {
                key: "projects",
                label: "Projects",
                render: (r) => (
                  <OverflowList
                    fromLabel={FROM_LABEL}
                    items={r.recentProjects.map<OverflowItem>((p) => ({
                      id: p.id,
                      label: p.name,
                      href: `/projects/${p.id}`,
                    }))}
                  />
                ),
              },
            ]}
          />
          <span className="cap">
            Showing {filtered.length} vendors &middot; grouped views available in the Wiki "Vendors at a Glance" page
          </span>
        </>
      )}
    </div>
  );
}
