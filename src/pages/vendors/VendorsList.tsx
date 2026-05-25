import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { backState } from "@/lib/hq/useBackHref";
import { FilterBar, emptyFilterState, type FilterFieldDef, type FilterState } from "@/components/data/FilterBar";
import { SavedViewsDropdown } from "@/components/data/SavedViewsDropdown";
import { getDefaultSavedView } from "@/lib/hq/savedViews";
import { DataTable } from "@/components/data/DataTable";
import { StarRating } from "@/components/data/StarRating";
import { OverflowList, type OverflowItem } from "@/components/hq/OverflowList";
import { ListChipRadioGroup, ListSearchInput } from "@/components/data/ListPageChrome";
import { WebsiteActionButton } from "@/components/hq/WebsiteActionButton";
import { IconPlus } from "@/components/icons/HQIcons";
import { applyFilters } from "@/lib/hq/filterStateApply";
import {
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

// Phase 5.7.6 follow-up: ordered to match the list-view DataTable
// column display order (name, category_name, subcategory_name, city,
// capabilities, team_rating, projects). tags has no visible column
// so it lands at the end.
const VENDOR_FILTER_FIELDS: FilterFieldDef[] = [
  { key: "category_name", label: "Category", type: "text" },
  { key: "subcategory_name", label: "Subcategory", type: "text" },
  { key: "city", label: "City", type: "text" },
  { key: "capabilities", label: "Capabilities", type: "text" },
  { key: "tags", label: "Tags", type: "text" },
  // Phase 5.9.3: presence chip. Commits immediately (no value step) and filters
  // to vendors that carry a bulk_import_session_id.
  { key: "bulkImportSessionId", label: "Bulk Imported", type: "presence" },
];

const FROM_LABEL = "Vendors";

type CityFilter = "All" | "NYC" | "LA";

const CITY_BUTTONS: { value: CityFilter; label: string }[] = [
  { value: "All", label: "All" },
  { value: "NYC", label: "NYC" },
  { value: "LA", label: "LA" },
];

type VendorFilterState = FilterState & {
  searchQuery?: string;
  cityFilter?: CityFilter;
};

export default function VendorsList() {
  const navigate = useNavigate();
  const location = useLocation();
  const fromState = backState(location, FROM_LABEL);
  const [rows, setRows] = useState<VendorListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterState, setFilterState] = useState<VendorFilterState>(emptyFilterState());
  const [activeViewName, setActiveViewName] = useState("All vendors");

  const searchQuery = filterState.searchQuery ?? "";
  const activeCityFilter: CityFilter = filterState.cityFilter ?? "All";

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

  // Phase 5.6.5: resolve default saved view on mount. Phase 5.9.5: skip when
  // arriving from the bulk-import history "Open list" drill-down so the
  // session seed below isn't clobbered by the async default-view resolve.
  useEffect(() => {
    if ((location.state as { bulkImportSessionId?: string } | null)?.bulkImportSessionId) {
      return;
    }
    let active = true;
    getDefaultSavedView("vendor").then((v) => {
      if (!active || !v) return;
      setFilterState(v.filter_state as VendorFilterState);
      setActiveViewName(v.name);
    });
    return () => {
      active = false;
    };
  }, [location.state]);

  // Phase 5.9.5: "Open list" from the bulk-import history rail seeds a single
  // session-scoped chip so the list shows only that import's records.
  useEffect(() => {
    const sid = (location.state as { bulkImportSessionId?: string } | null)
      ?.bulkImportSessionId;
    if (!sid) return;
    setFilterState((prev) => ({
      ...prev,
      chips: [{ field: "bulkImportSessionId", op: "is", value: sid }],
    }));
    setActiveViewName("Custom filter");
  }, [location.state]);

  const handleResetToGlobal = async () => {
    const v = await getDefaultSavedView("vendor");
    if (v) {
      setFilterState(v.filter_state as VendorFilterState);
      setActiveViewName(v.name);
    } else {
      setFilterState(emptyFilterState());
      setActiveViewName("All vendors");
    }
  };

  const setSearchQuery = (next: string) => {
    setFilterState((prev) => ({ ...prev, searchQuery: next }));
    setActiveViewName("Custom filter");
  };

  const setActiveCityFilter = (next: CityFilter) => {
    setFilterState((prev) => ({ ...prev, cityFilter: next }));
    setActiveViewName("Custom filter");
  };

  const filtered = useMemo(() => {
    let result = applyFilters(
      rows,
      filterState,
      (row, key) => {
        const val = (row as unknown as Record<string, unknown>)[key];
        if (val == null) return null;
        if (Array.isArray(val)) return val.map(String);
        return typeof val === "string" ? val : String(val);
      },
      undefined,
      // Nationwide vendors satisfy any city filter (Phase 5.9.3.1).
      { city: (row) => row.nationwide },
    );

    // Phase 5.11.3: NYC / LA preset radio. vendors.city stores literal
    // "NYC" / "LA" (mirrors VenuesList). Nationwide vendors pass any city
    // preset for the same reason as the chip filter.
    if (activeCityFilter !== "All") {
      result = result.filter(
        (r) => r.nationwide || r.city === activeCityFilter,
      );
    }

    // Phase 5.7.8 search bar (scope: name + category + subcategory + capabilities + tags).
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      result = result.filter((r) => {
        if (r.name.toLowerCase().includes(q)) return true;
        if (r.category_name && r.category_name.toLowerCase().includes(q)) return true;
        if (r.subcategory_name && r.subcategory_name.toLowerCase().includes(q)) return true;
        if (r.capabilities.some((c) => c.toLowerCase().includes(q))) return true;
        if (r.tags.some((t) => t.toLowerCase().includes(q))) return true;
        return false;
      });
    }

    return result;
  }, [rows, filterState, searchQuery, activeCityFilter]);

  // Phase 5.7.6: distinct values per text/enum filter field. Some
  // vendor fields are arrays (capabilities, tags) — flatten before
  // distincting so each element becomes its own combobox option.
  const distinctValuesByField = useMemo(() => {
    const pickScalar = (key: string) =>
      Array.from(
        new Set(
          rows
            .map((r) => (r as unknown as Record<string, unknown>)[key])
            .filter((v): v is string => typeof v === "string" && v.length > 0),
        ),
      ).sort();
    const pickArray = (key: string) =>
      Array.from(
        new Set(
          rows.flatMap((r) => {
            const v = (r as unknown as Record<string, unknown>)[key];
            return Array.isArray(v) ? v.map(String).filter(Boolean) : [];
          }),
        ),
      ).sort();
    return {
      category_name: pickScalar("category_name"),
      subcategory_name: pickScalar("subcategory_name"),
      city: pickScalar("city"),
      capabilities: pickArray("capabilities"),
      tags: pickArray("tags"),
    };
  }, [rows]);

  return (
    <div className="stack-4">
      <div className="row between list-head">
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

      <ListSearchInput
        value={searchQuery}
        onChange={setSearchQuery}
        placeholder="Search vendors..."
      />

      <div
        className="row-c"
        style={{ gap: 14, flexWrap: "wrap", alignItems: "center" }}
      >
        <ListChipRadioGroup
          buttons={CITY_BUTTONS}
          active={activeCityFilter}
          onPick={setActiveCityFilter}
        />
      </div>

      <div className="row between wrap" style={{ alignItems: "center" }}>
        <FilterBar
          state={filterState}
          onChange={(next) => {
            setFilterState((prev) => ({
              ...next,
              searchQuery: prev.searchQuery,
              cityFilter: prev.cityFilter,
            }));
            setActiveViewName("Custom filter");
          }}
          fields={VENDOR_FILTER_FIELDS}
          distinctValuesByField={distinctValuesByField}
        />
        <SavedViewsDropdown
          entityType="vendor"
          activeName={activeViewName}
          activeViewKind="list"
          activeFilterState={filterState}
          onPick={(v) => {
            setFilterState(v.filter_state as VendorFilterState);
            setActiveViewName(v.name);
          }}
          onResetToGlobal={handleResetToGlobal}
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
            sort={filterState.sort ?? null}
            onSortChange={(next) =>
              setFilterState((prev) => ({ ...prev, sort: next }))
            }
            onRowClick={(r) => navigate(`/vendors/${r.id}`, { state: { from: fromState } })}
            empty={{
              message:
                searchQuery.trim()
                  ? `No matches for "${searchQuery.trim()}".`
                  : "No vendors match your filters.",
              ctaLabel: "+ New Vendor",
              onCta: () => navigate("/vendors/new"),
            }}
            columns={[
              {
                key: "name",
                label: "Vendor",
                sort: (a, b) => a.name.localeCompare(b.name),
                render: (r) => (
                  <span className="lead">{r.name}</span>
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
              {
                key: "website_url",
                label: "Website",
                align: "c",
                render: (r) => <WebsiteActionButton url={r.website_url} />,
              },
              {
                key: "team_rating",
                label: "Rating",
                align: "c",
                sort: (a, b) => (a.teamAverage ?? -1) - (b.teamAverage ?? -1),
                render: (r) =>
                  r.teamCount > 0 ? (
                    <StarRating
                      value={Math.round((r.teamAverage ?? 0) * 2) / 2}
                      size="sm"
                    />
                  ) : (
                    <span className="muted subtle">-</span>
                  ),
              },
              {
                key: "projects",
                label: "Projects",
                render: (r) => (
                  <span className="list-projects">
                    <OverflowList
                      fromLabel={FROM_LABEL}
                      items={r.recentProjects.map<OverflowItem>((p) => ({
                        id: p.id,
                        label: p.name,
                        href: `/projects/${p.id}`,
                      }))}
                    />
                  </span>
                ),
              },
            ]}
          />
          <span className="cap">{filtered.length} vendors</span>
        </>
      )}
    </div>
  );
}
