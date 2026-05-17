import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { backState } from "@/lib/hq/useBackHref";
import { FilterBar, emptyFilterState, type FilterFieldDef, type FilterState } from "@/components/data/FilterBar";
import { SavedViewsDropdown } from "@/components/data/SavedViewsDropdown";
import { getDefaultSavedView } from "@/lib/hq/savedViews";
import { DataTable } from "@/components/data/DataTable";
import { IconPlus } from "@/components/icons/HQIcons";
import { applyFilters } from "@/lib/hq/filterStateApply";
import { loadVenues, type VenueListRow } from "@/lib/venues/queries";
import { useLookup } from "@/lib/hq/lookups";
import {
  TYPE_STYLES,
  TYPE_FALLBACK_STYLE,
  canonicalizeType,
  type CanonicalType,
} from "@/lib/venue-scout/venueTypes";

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
 */

const FROM_LABEL = "Venues";

export default function VenuesList() {
  const navigate = useNavigate();
  const location = useLocation();
  const fromState = backState(location, FROM_LABEL);
  const [rows, setRows] = useState<VenueListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterState, setFilterState] = useState<FilterState>(emptyFilterState());
  const [activeViewName, setActiveViewName] = useState("All venues");
  const venueTypesLookup = useLookup("venue_types");

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

  // Phase 5.6.5: resolve default saved view on mount.
  useEffect(() => {
    let active = true;
    getDefaultSavedView("venue").then((v) => {
      if (!active || !v) return;
      setFilterState(v.filter_state);
      setActiveViewName(v.name);
    });
    return () => {
      active = false;
    };
  }, []);

  const handleResetToGlobal = async () => {
    const v = await getDefaultSavedView("venue");
    if (v) {
      setFilterState(v.filter_state);
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
    ],
    [venueTypesLookup.options],
  );

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
        <p className="desc">
          Every venue Mirror uses. Venue Scout writes here when a scout's chosen venue is promoted.
        </p>
      </div>

      <div className="row between wrap" style={{ alignItems: "center" }}>
        <div className="row-c">
          <SavedViewsDropdown
            entityType="venue"
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
          fields={venueFilterFields}
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
              message: "No venues match your filters.",
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
                        <VenueTypePill key={t} type={t} />
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

function VenueTypePill({ type }: { type: string }) {
  const canonical = canonicalizeType(type) as CanonicalType | null;
  const style = canonical ? TYPE_STYLES[canonical] : TYPE_FALLBACK_STYLE;
  return (
    <span
      className={`pill pill-sm ${style}`}
      style={{ borderWidth: 1, borderStyle: "solid" }}
    >
      {type}
    </span>
  );
}
