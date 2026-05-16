import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FilterBar, type FilterFieldDef, type FilterState } from "@/components/data/FilterBar";
import { SavedViewsDropdown } from "@/components/data/SavedViewsDropdown";
import { DataTable } from "@/components/data/DataTable";
import { IconPlus } from "@/components/icons/HQIcons";
import { applyFilters } from "@/lib/hq/filterStateApply";
import {
  loadPeople,
  affiliationToken,
  PERSON_AFFILIATIONS,
  type PersonListRow,
} from "@/lib/people/queries";

/**
 * People List (Surface 11).
 * Wireframe binding: OUTPUTS/phase-5-hq-wireframe-v1-LOCKED.html lines 1979-2031.
 * Build notes: OUTPUTS/phase-5-hq-wireframe-build-notes.md § "11 . People".
 *
 * `flat` DataTable (uses `.tbl--flat` so the colored row left-border is
 * stripped per wireframe line 2018). Affiliation pill is multi-rendered:
 * one chip per value in `affiliations[]`. Organization cell renders in
 * muted coral (`rgba(190,78,68,.85)`) per build-notes Surface 11.
 *
 * Default filter chip: `Affiliation is Client` (wireframe line 2015), so
 * the People list lands sorted by client contacts first.
 */

const PEOPLE_FILTER_FIELDS: FilterFieldDef[] = [
  {
    key: "affiliations",
    label: "Affiliation",
    type: "enum",
    options: [...PERSON_AFFILIATIONS],
  },
  { key: "organization_name", label: "Organization", type: "text" },
  { key: "tags", label: "Tags", type: "text" },
];

const DEFAULT_FILTER_STATE: FilterState = {
  connector: "AND",
  chips: [{ field: "affiliations", op: "is", value: "Client" }],
};

export default function PeopleList() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<PersonListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterState, setFilterState] = useState<FilterState>(DEFAULT_FILTER_STATE);
  const [activeViewName, setActiveViewName] = useState("All people");

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadPeople().then((r) => {
      if (active) {
        setRows(r);
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, []);

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
          <h1 className="h-page">People</h1>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => navigate("/people/new")}
          >
            <IconPlus className="ic" />
            New Person
          </button>
        </div>
      </div>

      <div className="row between wrap" style={{ alignItems: "center" }}>
        <div className="row-c">
          <SavedViewsDropdown
            entityType="person"
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
          fields={PEOPLE_FILTER_FIELDS}
        />
      </div>

      {loading ? (
        <div className="empty">
          <p>Loading...</p>
        </div>
      ) : (
        <>
          <DataTable<PersonListRow>
            rows={filtered}
            flat
            onRowClick={(r) => navigate(`/people/${r.id}`)}
            empty={{
              message: "No people match your filters.",
              ctaLabel: "+ New Person",
              onCta: () => navigate("/people/new"),
            }}
            columns={[
              {
                key: "full_name",
                label: "Name",
                sort: (a, b) => a.full_name.localeCompare(b.full_name),
                render: (r) => <span className="lead">{r.full_name}</span>,
              },
              {
                key: "affiliations",
                label: "Affiliation",
                render: (r) =>
                  r.affiliations.length === 0 ? (
                    <span className="muted subtle">-</span>
                  ) : (
                    <span className="row-c wrap" style={{ display: "inline-flex", gap: 4 }}>
                      {r.affiliations.map((a) => (
                        <span key={a} className={`pill pill-sm p-${affiliationToken(a)}`}>
                          {a}
                        </span>
                      ))}
                    </span>
                  ),
              },
              {
                key: "organization_name",
                label: "Organization",
                sort: (a, b) =>
                  (a.organization_name ?? "").localeCompare(b.organization_name ?? ""),
                render: (r) =>
                  r.organization_id && r.organization_name ? (
                    <Link
                      to={`/organizations/${r.organization_id}`}
                      className="tlink"
                      style={{ color: "rgba(190,78,68,.85)" }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {r.organization_name}
                    </Link>
                  ) : (
                    <span className="muted subtle">-</span>
                  ),
              },
              {
                key: "role_title",
                label: "Role / Title",
                sort: (a, b) =>
                  (a.role_title ?? "").localeCompare(b.role_title ?? ""),
                render: (r) =>
                  r.role_title ? (
                    <span className="muted">{r.role_title}</span>
                  ) : (
                    <span className="muted subtle">-</span>
                  ),
              },
              {
                key: "email",
                label: "Email",
                render: (r) =>
                  r.email ? (
                    <a
                      className="muted mono inline-block max-w-full truncate align-bottom"
                      style={{ fontSize: 12 }}
                      href={`mailto:${r.email}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {r.email}
                    </a>
                  ) : (
                    <span className="muted subtle">-</span>
                  ),
              },
              {
                key: "phone",
                label: "Phone",
                render: (r) =>
                  r.phone ? (
                    <span className="muted mono" style={{ fontSize: 12 }}>
                      {r.phone}
                    </span>
                  ) : (
                    <span className="muted subtle">-</span>
                  ),
              },
            ]}
          />
          <span className="cap">{filtered.length} contacts shown</span>
        </>
      )}
    </div>
  );
}
