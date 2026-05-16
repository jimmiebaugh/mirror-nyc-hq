import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FilterBar, type FilterFieldDef, type FilterState } from "@/components/data/FilterBar";
import { SavedViewsDropdown } from "@/components/data/SavedViewsDropdown";
import { DataTable } from "@/components/data/DataTable";
import { IconPlus } from "@/components/icons/HQIcons";
import { applyFilters } from "@/lib/hq/filterStateApply";
import { useClientsAndVendors } from "@/lib/hq/useClientsAndVendors";
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
 * set (client_id / vendor_id / venue_contact_people join).
 *
 * 5.2 cleanup: column header relabeled "Affiliation" -> "Organization"
 * to match wireframe Surface 11 line 2019. Cell extended for the
 * venue-contact case (no client_id / vendor_id but has venues) to show
 * the venue name (single) or "{N} venues" (multi) as plain `.cap` text.
 * Filter chip "Affiliation" (text) replaced with "Organization"
 * (composite lookup over clients + vendors via useClientsAndVendors).
 *
 * `flat` DataTable (uses `.tbl--flat` per wireframe line 2018).
 * Organization tlinks render in muted coral (`rgba(190,78,68,.85)`) per
 * build-notes Surface 11.
 *
 * Default filter chip: `Type is Client` (replaces the 5.2.2
 * Affiliation-is-Client default; semantically equivalent).
 */

const DEFAULT_FILTER_STATE: FilterState = {
  connector: "AND",
  chips: [{ field: "type", op: "is", value: "Client" }],
};

type PersonRowWithDerived = PersonListRow & {
  type: string;
  organization_id: string | null;
  organization_name: string | null;
};

export default function PeopleList() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<PersonListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterState, setFilterState] = useState<FilterState>(DEFAULT_FILTER_STATE);
  const [activeViewName, setActiveViewName] = useState("All people");
  const { options: orgOptions } = useClientsAndVendors();

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

  // Field defs depend on the loaded clients+vendors lookup so the
  // Organization chip picker can render the merged option list. Mutex
  // CHECK on people guarantees client_id XOR vendor_id, so the decorated
  // `organization_id` collapses to a single uuid that matches the chip
  // value (also a uuid) via the engine's `is` op.
  const peopleFilterFields: FilterFieldDef[] = useMemo(
    () => [
      {
        key: "type",
        label: "Type",
        type: "enum",
        options: [...PERSON_TYPES],
      },
      {
        key: "organization_id",
        label: "Organization",
        type: "lookup",
        lookupOptions: orgOptions,
      },
      { key: "tags", label: "Tags", type: "text" },
    ],
    [orgOptions],
  );

  // Fold the derived Type + organization fields into the row so the
  // FilterBar can filter on those keys via the generic getField accessor.
  const decorated: PersonRowWithDerived[] = useMemo(
    () =>
      rows.map((r) => ({
        ...r,
        type: personType(r),
        organization_id: r.client_id ?? r.vendor_id ?? null,
        organization_name: r.client_name ?? r.vendor_name ?? null,
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
          fields={peopleFilterFields}
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
                key: "organization_name",
                label: "Organization",
                // Sort key mirrors what the cell renders: client/vendor name
                // when an FK is set; the venue name (single) or "{N} venues"
                // (multi) for venue-contact people; empty string otherwise.
                // Keeps sort stable with what the user sees in the column.
                sort: (a, b) => {
                  const aKey =
                    a.organization_name ??
                    (a.is_venue_contact && a.venue_names.length > 0
                      ? a.venue_names.length === 1
                        ? a.venue_names[0]
                        : `${a.venue_names.length} venues`
                      : "");
                  const bKey =
                    b.organization_name ??
                    (b.is_venue_contact && b.venue_names.length > 0
                      ? b.venue_names.length === 1
                        ? b.venue_names[0]
                        : `${b.venue_names.length} venues`
                      : "");
                  return aKey.localeCompare(bKey);
                },
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
                  if (r.is_venue_contact && r.venue_names.length > 0) {
                    return (
                      <span className="cap">
                        {r.venue_names.length === 1
                          ? r.venue_names[0]
                          : `${r.venue_names.length} venues`}
                      </span>
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
