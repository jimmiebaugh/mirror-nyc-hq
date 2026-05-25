import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { backState } from "@/lib/hq/useBackHref";
import { FilterBar, emptyFilterState, type FilterFieldDef, type FilterState } from "@/components/data/FilterBar";
import { SavedViewsDropdown } from "@/components/data/SavedViewsDropdown";
import { getDefaultSavedView } from "@/lib/hq/savedViews";
import { DataTable } from "@/components/data/DataTable";
import { IconPlus, IconSearch } from "@/components/icons/HQIcons";
import { applyFilters } from "@/lib/hq/filterStateApply";
import { loadVenues, type VenueListRow } from "@/lib/venues/queries";
import { useLookup } from "@/lib/hq/lookups";
import { VenueTypePill } from "@/components/venues/VenueTypePill";

/**
 * Venues List (Surface 09).
 * Wireframe binding: OUTPUTS/phase-5-hq-wireframe-v1-LOCKED.html lines 1592-1663.
 * Build notes: OUTPUTS/phase-5-hq-wireframe-build-notes.md § "09 . Venues".
 *
 * Venue Type column renders one pill per join row stacked vertically (per
 * wireframe line 1651). Pill colors LIFT from Venue Scout's
 * `TYPE_STYLES` map (build notes Surface 09); do NOT use the `.vt-event`
 * etc. classes from the wireframe HTML which are wireframe-side
 * approximations only.
 *
 * Phase 5.7.8: filter row reshape. New search bar above the filter row
 * (scope: name + notes + features). New NYC/LA radio + Size bucket radio
 * on row 1 alongside SavedViewsDropdown; FilterBar drops to row 2.
 * search / cityFilter / sizeFilter persist into saved_views.filter_state
 * via local jsonb extension; old saved views without these fields fall
 * back to defaults.
 */

type CityFilter = "All" | "NYC" | "LA";
type SizeFilter = "All" | "Tiny" | "Small" | "Medium" | "Large";

type VenueFilterState = FilterState & {
  searchQuery?: string;
  cityFilter?: CityFilter;
  sizeFilter?: SizeFilter;
};

const CITY_BUTTONS: { value: CityFilter; label: string }[] = [
  { value: "All", label: "All" },
  { value: "NYC", label: "NYC" },
  { value: "LA", label: "LA" },
];

const SIZE_BUTTONS: { value: SizeFilter; label: string }[] = [
  { value: "All", label: "All Sizes" },
  { value: "Tiny", label: "1k sq ft" },
  { value: "Small", label: "2.5k sq ft" },
  { value: "Medium", label: "5k sq ft" },
  { value: "Large", label: "+5k sq ft" },
];

const FROM_LABEL = "Venues";

export default function VenuesList() {
  const navigate = useNavigate();
  const location = useLocation();
  const fromState = backState(location, FROM_LABEL);
  const [rows, setRows] = useState<VenueListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterState, setFilterState] = useState<VenueFilterState>(emptyFilterState());
  const [activeViewName, setActiveViewName] = useState("All venues");
  const venueTypesLookup = useLookup("venue_types");

  const searchQuery = filterState.searchQuery ?? "";
  const activeCityFilter: CityFilter = filterState.cityFilter ?? "All";
  const activeSizeFilter: SizeFilter = filterState.sizeFilter ?? "All";

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadVenues().then((r) => {
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
    getDefaultSavedView("venue").then((v) => {
      if (!active || !v) return;
      setFilterState(v.filter_state as VenueFilterState);
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
    const v = await getDefaultSavedView("venue");
    if (v) {
      setFilterState(v.filter_state as VenueFilterState);
      setActiveViewName(v.name);
    } else {
      setFilterState(emptyFilterState());
      setActiveViewName("All venues");
    }
  };

  const venueFilterFields: FilterFieldDef[] = useMemo(
    () => [
      {
        key: "venueTypes",
        label: "Venue Type",
        type: "enum",
        options: venueTypesLookup.options.map((o) => o.name),
      },
      { key: "city", label: "City", type: "text" },
      { key: "neighborhood", label: "Neighborhood", type: "text" },
      // Phase 5.9.4: presence chip. Commits immediately (no value step) and
      // filters to venues that carry a bulk_import_session_id.
      { key: "bulkImportSessionId", label: "Bulk Imported", type: "presence" },
    ],
    [venueTypesLookup.options],
  );

  const filtered = useMemo(() => {
    let result = applyFilters(rows, filterState, (row, key) => {
      const val = (row as unknown as Record<string, unknown>)[key];
      if (val == null) return null;
      if (Array.isArray(val)) return val.map(String);
      return typeof val === "string" ? val : String(val);
    });

    // Phase 5.7.8 search bar (plan decision #13 scope: name + about_venue + features).
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      result = result.filter((r) => {
        if (r.name.toLowerCase().includes(q)) return true;
        if (r.about_venue && r.about_venue.toLowerCase().includes(q)) return true;
        if (r.features.some((f) => f.toLowerCase().includes(q))) return true;
        return false;
      });
    }

    // City radio (NYC / LA / All). venues.city stores literal "NYC" / "LA" (verified 2026-05-17 SQL spot-check).
    if (activeCityFilter !== "All") {
      result = result.filter((r) => r.city === activeCityFilter);
    }

    // Size bucket radio. Mutually exclusive ranges; NULL sq_ft drops out of every bucket except "All".
    if (activeSizeFilter !== "All") {
      result = result.filter((r) => {
        if (r.total_sq_ft == null) return false;
        switch (activeSizeFilter) {
          case "Tiny":
            return r.total_sq_ft < 1000;
          case "Small":
            return r.total_sq_ft >= 1000 && r.total_sq_ft < 2500;
          case "Medium":
            return r.total_sq_ft >= 2500 && r.total_sq_ft < 5000;
          case "Large":
            return r.total_sq_ft >= 5000;
          default:
            return true;
        }
      });
    }

    return result;
  }, [rows, filterState, searchQuery, activeCityFilter, activeSizeFilter]);

  // Phase 5.7.6: distinct values per text/enum filter field. venueTypes
  // is an array column flattened to per-element distincts. city +
  // neighborhood are scalar text.
  const distinctValuesByField = useMemo(() => {
    const pickScalar = (key: string) =>
      Array.from(
        new Set(
          rows
            .map((r) => (r as unknown as Record<string, unknown>)[key])
            .filter((v): v is string => typeof v === "string" && v.length > 0),
        ),
      ).sort();
    const venueTypes = Array.from(
      new Set(
        rows.flatMap((r) => {
          const v = (r as unknown as Record<string, unknown>).venueTypes;
          return Array.isArray(v) ? v.map(String).filter(Boolean) : [];
        }),
      ),
    ).sort();
    return {
      city: pickScalar("city"),
      neighborhood: pickScalar("neighborhood"),
      venueTypes,
    };
  }, [rows]);

  const setSearchQuery = (next: string) => {
    setFilterState((prev) => ({ ...prev, searchQuery: next }));
    setActiveViewName("Custom filter");
  };

  const setActiveCityFilter = (next: CityFilter) => {
    setFilterState((prev) => ({ ...prev, cityFilter: next }));
    setActiveViewName("Custom filter");
  };

  const setActiveSizeFilter = (next: SizeFilter) => {
    setFilterState((prev) => ({ ...prev, sizeFilter: next }));
    setActiveViewName("Custom filter");
  };

  return (
    <div className="stack-4">
      <div className="row between" style={{ alignItems: "flex-end" }}>
        <h1 className="h-page">Venues</h1>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => navigate("/venues/new")}
        >
          <IconPlus className="ic" />
          New Venue
        </button>
      </div>

      <SearchInput
        value={searchQuery}
        onChange={setSearchQuery}
        placeholder="Search venues..."
      />

      <div
        className="row-c"
        style={{ gap: 14, flexWrap: "wrap", alignItems: "center" }}
      >
        <ChipRadioGroup
          buttons={CITY_BUTTONS}
          active={activeCityFilter}
          onPick={setActiveCityFilter}
        />
        <ChipRadioGroup
          buttons={SIZE_BUTTONS}
          active={activeSizeFilter}
          onPick={setActiveSizeFilter}
        />
      </div>

      <div className="row between wrap" style={{ alignItems: "center" }}>
        <FilterBar
          state={filterState}
          onChange={(next) => {
            setFilterState((prev) => ({ ...next, searchQuery: prev.searchQuery, cityFilter: prev.cityFilter, sizeFilter: prev.sizeFilter }));
            setActiveViewName("Custom filter");
          }}
          fields={venueFilterFields}
          distinctValuesByField={distinctValuesByField}
        />
        <SavedViewsDropdown
          entityType="venue"
          activeName={activeViewName}
          activeViewKind="list"
          activeFilterState={filterState}
          onPick={(v) => {
            setFilterState(v.filter_state as VenueFilterState);
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
          <DataTable<VenueListRow>
            rows={filtered}
            sort={filterState.sort ?? null}
            onSortChange={(next) =>
              setFilterState((prev) => ({ ...prev, sort: next }))
            }
            onRowClick={(r) => navigate(`/venues/${r.id}`, { state: { from: fromState } })}
            empty={{
              message:
                searchQuery.trim()
                  ? `No matches for "${searchQuery.trim()}".`
                  : "No venues match your filters.",
              ctaLabel: "+ New Venue",
              onCta: () => navigate("/venues/new"),
            }}
            columns={[
              {
                key: "name",
                label: "Venue",
                sort: (a, b) => a.name.localeCompare(b.name),
                render: (r) => <span className="lead">{r.name}</span>,
              },
              {
                key: "venueTypes",
                label: "Venue Type",
                align: "c",
                render: (r) =>
                  r.venueTypes.length === 0 ? (
                    <span className="muted subtle">-</span>
                  ) : (
                    <span
                      style={{ display: "inline-flex", flexDirection: "column", gap: 7 }}
                    >
                      {r.venueTypes.map((t) => (
                        <VenueTypePill key={t} type={t} small />
                      ))}
                    </span>
                  ),
              },
              {
                key: "city",
                label: "City",
                align: "c",
                sort: (a, b) => (a.city ?? "").localeCompare(b.city ?? ""),
                render: (r) =>
                  r.city ? (
                    <span className="muted">{r.city}</span>
                  ) : (
                    <span className="muted subtle">-</span>
                  ),
              },
              {
                key: "neighborhood",
                label: "Neighborhood",
                align: "c",
                sort: (a, b) =>
                  (a.neighborhood ?? "").localeCompare(b.neighborhood ?? ""),
                render: (r) =>
                  r.neighborhood ? (
                    <span className="muted">{r.neighborhood}</span>
                  ) : (
                    <span className="muted subtle">-</span>
                  ),
              },
              {
                key: "total_sq_ft",
                label: "Total Sq Ft",
                align: "c",
                sort: (a, b) => (a.total_sq_ft ?? 0) - (b.total_sq_ft ?? 0),
                render: (r) =>
                  r.total_sq_ft != null ? (
                    <span className="mono">{r.total_sq_ft.toLocaleString("en-US")}</span>
                  ) : (
                    <span className="muted subtle">-</span>
                  ),
              },
              {
                key: "website_url",
                label: "Website",
                align: "c",
                render: (r) => (
                  <a
                    className="btn btn-coral btn-sm"
                    href={r.website_url ?? "#"}
                    target={r.website_url ? "_blank" : undefined}
                    rel={r.website_url ? "noopener noreferrer" : undefined}
                    style={
                      r.website_url
                        ? undefined
                        : { opacity: 0.45, pointerEvents: "none", cursor: "not-allowed" }
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!r.website_url) e.preventDefault();
                    }}
                  >
                    Website
                  </a>
                ),
              },
              {
                key: "pastProjectCount",
                label: "Past Projects",
                align: "c",
                sort: (a, b) => a.pastProjectCount - b.pastProjectCount,
                render: (r) => <span className="muted">{r.pastProjectCount}</span>,
              },
            ]}
          />
          <span className="cap">{filtered.length} venues</span>
        </>
      )}
    </div>
  );
}

/**
 * Phase 5.7.8 search input chrome. No debounce per the TopBar pattern
 * (src/components/shell/TopBar.tsx:60-64). Coral `tlink` Clear button
 * sits inline; it's clickable text so coral is permitted per
 * feedback_coral_reserved_for_hyperlinks.md.
 */
function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div
      className="row-c"
      style={{
        gap: 8,
        padding: "8px 12px",
        border: "1px solid hsl(var(--border))",
        borderRadius: "var(--radius)",
        background: "hsl(var(--surface-alt))",
      }}
    >
      <IconSearch className="h-[14px] w-[14px]" />
      <input
        style={{
          height: 30,
          border: "none",
          background: "none",
          padding: 0,
          flex: 1,
          outline: "none",
          color: "hsl(var(--foreground))",
          fontSize: 13,
        }}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          className="tlink"
          style={{ fontSize: 11, background: "none", border: 0, padding: 0, cursor: "pointer" }}
        >
          Clear
        </button>
      ) : null}
    </div>
  );
}

/**
 * Phase 5.7.8 chip radio group — lifts AFFILIATION_BUTTONS shape
 * (src/pages/people/PeopleList.tsx:222-260). Inline color/opacity on
 * inner <span> because .fchip--btn span hard-codes muted-foreground for
 * inactive buttons; the button-level color is consumed by .fchip--active's
 * currentColor mix only. Active selection uses success token when "All"
 * is selected; foreground otherwise. Inactive siblings render in
 * foreground when "All" is active, muted-foreground at opacity 0.5 when
 * a specific value is active.
 */
function ChipRadioGroup<T extends string>({
  buttons,
  active,
  onPick,
}: {
  buttons: { value: T; label: string }[];
  active: T;
  onPick: (v: T) => void;
}) {
  return (
    <div className="row-c" style={{ gap: 6, flexWrap: "wrap" }}>
      {buttons.map((b) => {
        const isActive = active === b.value;
        const isAllActive = active === ("All" as T);
        let color: string;
        let opacity = 1;
        if (isActive) {
          color = b.value === ("All" as T) ? "hsl(var(--success))" : "hsl(var(--foreground))";
        } else if (isAllActive) {
          color = "hsl(var(--foreground))";
        } else {
          color = "hsl(var(--muted-foreground))";
          opacity = 0.5;
        }
        return (
          <button
            key={b.value}
            type="button"
            className={`fchip fchip--btn fchip--lg ${isActive ? "fchip--active" : ""}`}
            style={{ color }}
            onClick={() => onPick(b.value)}
          >
            <span style={{ color, opacity }}>{b.label}</span>
          </button>
        );
      })}
    </div>
  );
}
