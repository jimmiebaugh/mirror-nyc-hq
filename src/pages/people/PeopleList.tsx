import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FilterBar, type FilterFieldDef, type FilterState } from "@/components/data/FilterBar";
import { SavedViewsDropdown } from "@/components/data/SavedViewsDropdown";
import { DataTable } from "@/components/data/DataTable";
import { IconPlus } from "@/components/icons/HQIcons";
import { applyFilters } from "@/lib/hq/filterStateApply";
import {
  loadPeople,
  personType,
  personTypeToken,
  PERSON_TYPES,
  type PersonListRow,
} from "@/lib/people/queries";

/**
 * People List (Surface 11).
 * Wireframe binding: OUTPUTS/phase-5-hq-wireframe-v1-LOCKED.html lines 1979-2031.
 * Build notes: OUTPUTS/phase-5-hq-wireframe-build-notes.md § "11 . People".
 *
 * Affiliation rendering adapted in Phase 5.2.3: the wireframe's multi-pill
 * `affiliations[]` column is gone (locked Q4 dropped the array; at most
 * one org-type per person). Single "Type" pill resolved from which FK is
 * set (client_id / vendor_id / venue_contact_people join); Affiliation
 * column links to the right table (/clients/<id> OR /vendors/<id>).
 *
 * `flat` DataTable (uses `.tbl--flat` per wireframe line 2018).
 * Organization cell renders in muted coral (`rgba(190,78,68,.85)`) per
 * build-notes Surface 11.
 *
 * Default filter chip: `Type is Client` (replaces the 5.2.2
 * Affiliation-is-Client default; semantically equivalent).
 */

const PEOPLE_FILTER_FIELDS: FilterFieldDef[] = [
  {
    key: "type",
    label: "Type",
    type: "enum",
    options: [...PERSON_TYPES],
  },
  { key: "affiliation_name", label: "Affiliation", type: "text" },
  { key: "tags", label: "Tags", type: "text" },
];

const DEFAULT_FILTER_STATE: FilterState = {
  connector: "AND",
  chips: [{ field: "type", op: "is", value: "Client" }],
};

type PersonRowWithDerived = PersonListRow & {
  type: string;
  affiliation_name: string | null;
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

  // Fold the derived Type + affiliation_name into the row so the FilterBar
  // can filter on those keys via the generic getField accessor.
  const decorated: PersonRowWithDerived[] = useMemo(
    () =>
      rows.map((r) => ({
        ...r,
        type: personType(r),
        affiliation_name: r.client_name ?? r.vendor_name ?? null,
      })),
    [rows],
  );

  const filtered = useMemo(
    () =>
      applyFilters(decorated, filterState, (row, key) => {
        const val = (row as unknown as Record<string, unknown>)[key];
        if (val == null) return null;
        if (Array.isArray(val)) return val.map(String);
        return typeof val === "string" ? val : String(val);
      }),
    [decorated, filterState],
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
          <DataTable<PersonRowWithDerived>
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
                key: "type",
                label: "Type",
                sort: (a, b) => a.type.localeCompare(b.type),
                render: (r) => {
                  const t = personType(r);
                  return (
                    <span className={`pill pill-sm p-${personTypeToken(t)}`}>{t}</span>
                  );
                },
              },
              {
                key: "affiliation_name",
                label: "Affiliation",
                sort: (a, b) =>
                  (a.affiliation_name ?? "").localeCompare(b.affiliation_name ?? ""),
                render: (r) => {
                  if (r.client_id && r.client_name) {
                    return (
                      <Link
                        to={`/clients/${r.client_id}`}
                        className="tlink"
                        style={{ color: "rgba(190,78,68,.85)" }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {r.client_name}
                      </Link>
                    );
                  }
                  if (r.vendor_id && r.vendor_name) {
                    return (
                      <Link
                        to={`/vendors/${r.vendor_id}`}
                        className="tlink"
                        style={{ color: "rgba(190,78,68,.85)" }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {r.vendor_name}
                      </Link>
                    );
                  }
                  return <span className="muted subtle">-</span>;
                },
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
