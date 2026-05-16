import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FilterBar, emptyFilterState, type FilterFieldDef, type FilterState } from "@/components/data/FilterBar";
import { SavedViewsDropdown } from "@/components/data/SavedViewsDropdown";
import { DataTable } from "@/components/data/DataTable";
import { StarRating } from "@/components/data/StarRating";
import { IconPlus } from "@/components/icons/HQIcons";
import { applyFilters } from "@/lib/hq/filterStateApply";
import {
  loadOrganizations,
  typeToken,
  ORG_TYPES,
  type OrgListRow,
  type OrgType,
} from "@/lib/organizations/queries";
import type { StatusToken } from "@/lib/home/projectStatusToken";

/**
 * Organizations List (Surface 10).
 * Wireframe binding: OUTPUTS/phase-5-hq-wireframe-v1-LOCKED.html lines 1791-1854.
 * Build notes: OUTPUTS/phase-5-hq-wireframe-build-notes.md § "10 . Organizations".
 *
 * Type filter chips render OUTSIDE the FilterBar (per wireframe lines
 * 1826-1831); they live in a `.row-c.wrap` of `.pill.pill-lg` chips above
 * the standard toolbar row. Each chip carries its count from the loaded
 * rowset. Toolbar row stays Saved Views dropdown + + Add filter only (no
 * view switcher per locked Q3, entity surfaces ship List only).
 */

const ORG_FILTER_FIELDS: FilterFieldDef[] = [
  { key: "type", label: "Type", type: "enum", options: [...ORG_TYPES] },
  { key: "city", label: "City", type: "text" },
  { key: "capabilities", label: "Capabilities", type: "text" },
  { key: "tags", label: "Tags", type: "text" },
];

export default function OrganizationsList() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<OrgListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterState, setFilterState] = useState<FilterState>(emptyFilterState());
  const [typeFilter, setTypeFilter] = useState<OrgType | null>(null);
  const [activeViewName, setActiveViewName] = useState("All organizations");

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadOrganizations().then((r) => {
      if (active) {
        setRows(r);
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const counts = useMemo(() => {
    const c = { all: rows.length, Client: 0, Vendor: 0, Internal: 0 };
    for (const r of rows) c[r.type] += 1;
    return c;
  }, [rows]);

  const typeFiltered = useMemo(
    () => (typeFilter == null ? rows : rows.filter((r) => r.type === typeFilter)),
    [rows, typeFilter],
  );

  const filtered = useMemo(
    () =>
      applyFilters(typeFiltered, filterState, (row, key) => {
        const val = (row as unknown as Record<string, unknown>)[key];
        if (val == null) return null;
        if (Array.isArray(val)) return val.map(String);
        return typeof val === "string" ? val : String(val);
      }),
    [typeFiltered, filterState],
  );

  return (
    <div className="stack-4">
      <div className="pagehead">
        <div className="row between">
          <h1 className="h-page">Organizations</h1>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => navigate("/organizations/new")}
          >
            <IconPlus className="ic" />
            New Organization
          </button>
        </div>
      </div>

      <div className="row-c wrap">
        <TypeChip
          label="All"
          count={counts.all}
          active={typeFilter == null}
          color="p-muted"
          onClick={() => setTypeFilter(null)}
        />
        <TypeChip
          label="Clients"
          count={counts.Client}
          active={typeFilter === "Client"}
          color="p-primary"
          onClick={() => setTypeFilter(typeFilter === "Client" ? null : "Client")}
        />
        <TypeChip
          label="Vendors"
          count={counts.Vendor}
          active={typeFilter === "Vendor"}
          color="p-purple"
          onClick={() => setTypeFilter(typeFilter === "Vendor" ? null : "Vendor")}
        />
        <TypeChip
          label="Internal"
          count={counts.Internal}
          active={typeFilter === "Internal"}
          color="p-info"
          onClick={() => setTypeFilter(typeFilter === "Internal" ? null : "Internal")}
        />
      </div>

      <div className="row between wrap" style={{ alignItems: "center" }}>
        <div className="row-c">
          <SavedViewsDropdown
            entityType="organization"
            activeName={activeViewName}
            activeViewKind="list"
            activeFilterState={filterState}
            onPick={(v) => {
              setFilterState(v.filter_state);
              setActiveViewName(v.name);
            }}
          />
        </div>
        <FilterBar
          state={filterState}
          onChange={(next) => {
            setFilterState(next);
            setActiveViewName("Custom filter");
          }}
          fields={ORG_FILTER_FIELDS}
        />
      </div>

      {loading ? (
        <div className="empty">
          <p>Loading...</p>
        </div>
      ) : (
        <>
          <DataTable<OrgListRow>
            rows={filtered}
            rowBorderToken={(r) =>
              (r.type === "Internal" ? "info" : "muted") as StatusToken
            }
            onRowClick={(r) => navigate(`/organizations/${r.id}`)}
            empty={{
              message: "No organizations match your filters.",
              ctaLabel: "+ New Organization",
              onCta: () => navigate("/organizations/new"),
            }}
            columns={[
              {
                key: "name",
                label: "Organization",
                sort: (a, b) => a.name.localeCompare(b.name),
                render: (r) => <span className="lead">{r.name}</span>,
              },
              {
                key: "type",
                label: "Type",
                sort: (a, b) => a.type.localeCompare(b.type),
                render: (r) => (
                  <span className={`pill pill-sm p-${typeToken(r.type)}`}>
                    {r.type}
                  </span>
                ),
              },
              {
                key: "capabilities",
                label: "Capabilities",
                render: (r) =>
                  r.type === "Vendor" || r.type === "Internal" ? (
                    r.capabilities.length > 0 ? (
                      <span className="muted">{r.capabilities.join(", ")}</span>
                    ) : (
                      <span className="muted subtle">-</span>
                    )
                  ) : (
                    <span className="muted subtle">-</span>
                  ),
              },
              {
                key: "city",
                label: "Location",
                sort: (a, b) => (a.city ?? "").localeCompare(b.city ?? ""),
                render: (r) =>
                  r.city ? (
                    <span className="muted">{r.city}</span>
                  ) : (
                    <span className="muted subtle">-</span>
                  ),
              },
              {
                key: "internal_rating",
                label: "Rating",
                align: "c",
                sort: (a, b) =>
                  (a.internal_rating ?? -1) - (b.internal_rating ?? -1),
                render: (r) =>
                  r.type === "Vendor" ? (
                    r.internal_rating != null ? (
                      <StarRating value={r.internal_rating} size="sm" />
                    ) : (
                      <span className="muted subtle">-</span>
                    )
                  ) : (
                    <span className="muted subtle">-</span>
                  ),
              },
              {
                key: "pastProjectCount",
                label: "Past Projects",
                align: "r",
                sort: (a, b) => a.pastProjectCount - b.pastProjectCount,
                render: (r) => <span className="muted">{r.pastProjectCount}</span>,
              },
            ]}
          />
          <span className="cap">
            Showing all {filtered.length} organizations &middot; grouped views available in the Wiki "Vendors at a Glance" page
          </span>
        </>
      )}
    </div>
  );
}

function TypeChip({
  label,
  count,
  active,
  color,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  color: "p-muted" | "p-primary" | "p-purple" | "p-info";
  onClick: () => void;
}) {
  return (
    <span
      role="button"
      className={`pill pill-lg ${color}`}
      style={{ opacity: active ? 1 : 0.55, cursor: "pointer" }}
      onClick={onClick}
    >
      {label}{" "}
      <span className="cap" style={{ color: "inherit", opacity: 0.7 }}>
        {count}
      </span>
    </span>
  );
}
