import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { backState } from "@/lib/hq/useBackHref";
import { FilterBar, type FilterFieldDef, type FilterState } from "@/components/data/FilterBar";
import { SavedViewsDropdown } from "@/components/data/SavedViewsDropdown";
import { getDefaultSavedView } from "@/lib/hq/savedViews";
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
 *
 * Phase 5.6.2 reshape: column header "Type" -> "Affiliation"; PERSON_TYPES
 * value "Venue contact" -> "Venue" (matches PersonEdit radio label).
 * Default filter chip dropped (page loads with every person visible).
 * Unaffiliated rows render a blank Affiliation cell (no pill, no
 * placeholder). New inline Affiliation filter buttons row sits next to
 * the SavedViewsDropdown: All / Client / Vendor / Venue, single-tap
 * (radio) toggle, color-keyed to the affiliation pill tokens. The button
 * state is mirrored into `filterState` as an `affiliation is X` chip so
 * saved views capture the selection.
 *
 * Wireframe binding (DEVIATION carried over from 5.2 cleanup): no
 * surface-11 wireframe redraw exists for the new column header /
 * filter-button row. Wireframe-v2 redraw deferred to a future polish
 * pass; see design-system § 11.
 */

const DEFAULT_FILTER_STATE: FilterState = {
  connector: "AND",
  chips: [],
};

type AffiliationFilter = "All" | "Client" | "Vendor" | "Venue";

// Colors mirror personTypeToken() so the buttons read as the same family
// as the in-row pills (.p-primary / .p-purple / .p-info). Slightly muted
// fill is delegated to .fchip--active in src/index.css.
const AFFILIATION_BUTTONS: { value: AffiliationFilter; label: string; color: string }[] = [
  { value: "All", label: "All", color: "hsl(var(--success))" },
  { value: "Client", label: "Client", color: "hsl(var(--primary))" },
  { value: "Vendor", label: "Vendor", color: "#B57BF5" },
  { value: "Venue", label: "Venue", color: "#06B6D4" },
];

type PersonRowWithDerived = PersonListRow & {
  type: string;
  organization_id: string | null;
  organization_name: string | null;
};

const FROM_LABEL = "People";

export default function PeopleList() {
  const navigate = useNavigate();
  const location = useLocation();
  const fromState = backState(location, FROM_LABEL);
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

  // Phase 5.6.5: resolve default saved view on mount.
  useEffect(() => {
    let active = true;
    getDefaultSavedView("person").then((v) => {
      if (!active || !v) return;
      setFilterState(v.filter_state);
      setActiveViewName(v.name);
    });
    return () => {
      active = false;
    };
  }, []);

  const handleResetToGlobal = async () => {
    const v = await getDefaultSavedView("person");
    if (v) {
      setFilterState(v.filter_state);
      setActiveViewName(v.name);
    } else {
      setFilterState(DEFAULT_FILTER_STATE);
      setActiveViewName("All people");
    }
  };

  // Field defs depend on the loaded clients+vendors lookup so the
  // Organization chip picker can render the merged option list. Mutex
  // CHECK on people guarantees client_id XOR vendor_id, so the decorated
  // `organization_id` collapses to a single uuid that matches the chip
  // value (also a uuid) via the engine's `is` op.
  const peopleFilterFields: FilterFieldDef[] = useMemo(
    () => [
      {
        key: "type",
        label: "Affiliation",
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

  const activeAffiliation: AffiliationFilter = useMemo(() => {
    const chip = filterState.chips.find(
      (c) => c.field === "type" && c.op === "is",
    );
    if (!chip) return "All";
    const v = chip.value as string;
    if (v === "Client" || v === "Vendor" || v === "Venue") return v;
    return "All";
  }, [filterState]);

  const setAffiliationFilter = (next: AffiliationFilter) => {
    setFilterState((prev) => {
      const others = prev.chips.filter(
        (c) => !(c.field === "type" && c.op === "is"),
      );
      const nextChips =
        next === "All"
          ? others
          : [...others, { field: "type", op: "is" as const, value: next }];
      return { ...prev, chips: nextChips };
    });
    setActiveViewName("Custom filter");
  };

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

  // Phase 5.7.6: distinct values per text/enum filter field. `type` is
  // the derived person type (Client / Vendor / Venue / Unaffiliated);
  // `tags` is an array column flattened to per-element distincts.
  // organization_id is a lookup type and keeps its existing picker.
  const distinctValuesByField = useMemo(() => {
    const types = Array.from(
      new Set(
        decorated
          .map((r) => r.type)
          .filter((v): v is string => typeof v === "string" && v.length > 0),
      ),
    ).sort();
    const tags = Array.from(
      new Set(
        decorated.flatMap((r) => {
          const v = (r as unknown as Record<string, unknown>).tags;
          return Array.isArray(v) ? v.map(String).filter(Boolean) : [];
        }),
      ),
    ).sort();
    return { type: types, tags };
  }, [decorated]);

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
        <div className="row-c" style={{ gap: 6 }}>
          {AFFILIATION_BUTTONS.map((b) => {
            const isActive = activeAffiliation === b.value;
            // 5.7.4 smoke round 3: button color rules.
            //   All active   -> All highlighted in success; siblings render
            //                   in their full tier color at opacity 1 (no
            //                   mutedness).
            //   Tier active  -> selected pill in its tier color highlighted;
            //                   ALL siblings (including All) render as
            //                   muted-foreground at opacity 0.5.
            // Inline color/opacity must land on the inner <span> because
            // `.fchip--btn span` (src/index.css:1213) hard-codes
            // color:muted-foreground for inactive buttons; the button-
            // level color is only consumed by .fchip--active's currentColor
            // border + background mix.
            let color: string;
            let opacity = 1;
            if (isActive) {
              color = b.color;
            } else if (activeAffiliation === "All") {
              color = b.color;
            } else {
              color = "hsl(var(--muted-foreground))";
              opacity = 0.3;
            }
            return (
              <button
                key={b.value}
                type="button"
                className={`fchip fchip--btn fchip--lg ${isActive ? "fchip--active" : ""}`}
                style={{ color }}
                onClick={() => setAffiliationFilter(b.value)}
              >
                <span style={{ color, opacity }}>{b.label}</span>
              </button>
            );
          })}
        </div>
        <SavedViewsDropdown
          entityType="person"
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
        fields={peopleFilterFields}
        distinctValuesByField={distinctValuesByField}
      />

      {loading ? (
        <div className="empty">
          <p>Loading...</p>
        </div>
      ) : (
        <>
          <DataTable<PersonRowWithDerived>
            rows={filtered}
            flat
            sort={filterState.sort ?? null}
            onSortChange={(next) =>
              setFilterState((prev) => ({ ...prev, sort: next }))
            }
            onRowClick={(r) => navigate(`/people/${r.id}`, { state: { from: fromState } })}
            empty={{
              message: "No people match your filters.",
              ctaLabel: "+ New Person",
              onCta: () => navigate("/people/new"),
            }}
            columns={[
              {
                key: "type",
                label: "",
                width: 64,
                noRightDivider: true,
                sort: (a, b) => a.type.localeCompare(b.type),
                render: (r) => {
                  const t = personType(r);
                  if (t === "Unaffiliated") return <span />;
                  // 5.7.4 smoke followup: pill shrinks ~5% on this column
                  // (font 9.5 -> 9, padding 2/7 -> 2/6) to fit the 64px
                  // column without crowding the Name cell.
                  return (
                    <span
                      className={`pill pill-sm p-${personTypeToken(t)}`}
                      style={{ fontSize: 9, padding: "2px 6px" }}
                    >
                      {t}
                    </span>
                  );
                },
              },
              {
                key: "full_name",
                label: "Name",
                sort: (a, b) => a.full_name.localeCompare(b.full_name),
                render: (r) => <span className="lead">{r.full_name}</span>,
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
                    (a.is_venue_contact && a.venues.length > 0
                      ? a.venues.length === 1
                        ? a.venues[0].name
                        : `${a.venues.length} venues`
                      : "");
                  const bKey =
                    b.organization_name ??
                    (b.is_venue_contact && b.venues.length > 0
                      ? b.venues.length === 1
                        ? b.venues[0].name
                        : `${b.venues.length} venues`
                      : "");
                  return aKey.localeCompare(bKey);
                },
                render: (r) => {
                  // 5.7.4 smoke followup: Organization link color matches
                  // the affiliation pill (coral client / purple vendor /
                  // cyan venue). Multi-venue cell stays plain text (no
                  // link) at muted cyan opacity per Jimmie's spec.
                  if (r.client_id && r.client_name) {
                    return (
                      <Link
                        to={`/clients/${r.client_id}`}
                        className="tlink"
                        style={{ color: "hsl(var(--primary))" }}
                        state={{ from: fromState }}
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
                        style={{ color: "#B57BF5" }}
                        state={{ from: fromState }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {r.vendor_name}
                      </Link>
                    );
                  }
                  if (r.is_venue_contact && r.venues.length > 0) {
                    return r.venues.length === 1 ? (
                      <Link
                        to={`/venues/${r.venues[0].id}`}
                        className="tlink"
                        style={{ color: "#06B6D4" }}
                        state={{ from: fromState }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {r.venues[0].name}
                      </Link>
                    ) : (
                      <span style={{ color: "#06B6D4", opacity: 0.6, fontWeight: 400 }}>
                        {r.venues.length} venues
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
