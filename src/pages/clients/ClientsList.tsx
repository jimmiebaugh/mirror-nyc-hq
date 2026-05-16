import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FilterBar, emptyFilterState, type FilterFieldDef, type FilterState } from "@/components/data/FilterBar";
import { SavedViewsDropdown } from "@/components/data/SavedViewsDropdown";
import { DataTable } from "@/components/data/DataTable";
import { IconPlus } from "@/components/icons/HQIcons";
import { applyFilters } from "@/lib/hq/filterStateApply";
import { loadClients, type ClientListRow } from "@/lib/clients/queries";

/**
 * Clients List.
 *
 * Wireframe binding (DEVIATION): no wireframe exists for this surface.
 * Surface 10 (OUTPUTS/phase-5-hq-wireframe-v1-LOCKED.html lines 1791-1854)
 * was drawn as a unified Organizations surface; per the 2026-05-16 locked
 * decisions split (spec § 0c Q3), Organizations breaks into Clients +
 * Vendors. This is the Clients half. Slim shape: name + industry +
 * primary contact + city + past projects + tags. No Type filter (single
 * entity) and no Category column (clients don't carry vendor taxonomy).
 * Default sort by name ascending. Wireframe-v2 redraw deferred to a
 * future polish pass; see design-system § 11 for the canonical
 * deviation-binding contract.
 */

const CLIENT_FILTER_FIELDS: FilterFieldDef[] = [
  { key: "city", label: "City", type: "text" },
  { key: "industry", label: "Industry", type: "text" },
  { key: "tags", label: "Tags", type: "text" },
];

export default function ClientsList() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<ClientListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterState, setFilterState] = useState<FilterState>(emptyFilterState());
  const [activeViewName, setActiveViewName] = useState("All clients");

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadClients().then((r) => {
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
          <h1 className="h-page">Clients</h1>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => navigate("/clients/new")}
          >
            <IconPlus className="ic" />
            New Client
          </button>
        </div>
      </div>

      <div className="row between wrap" style={{ alignItems: "center" }}>
        <div className="row-c">
          <SavedViewsDropdown
            entityType="client"
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
          fields={CLIENT_FILTER_FIELDS}
        />
      </div>

      {loading ? (
        <div className="empty">
          <p>Loading...</p>
        </div>
      ) : (
        <>
          <DataTable<ClientListRow>
            rows={filtered}
            flat
            onRowClick={(r) => navigate(`/clients/${r.id}`)}
            empty={{
              message: "No clients match your filters.",
              ctaLabel: "+ New Client",
              onCta: () => navigate("/clients/new"),
            }}
            columns={[
              {
                key: "name",
                label: "Client",
                sort: (a, b) => a.name.localeCompare(b.name),
                render: (r) => (
                  <div>
                    <span className="lead">{r.name}</span>
                    {r.city ? (
                      <div className="sub">{r.city}</div>
                    ) : null}
                  </div>
                ),
              },
              {
                key: "industry",
                label: "Industry",
                sort: (a, b) => (a.industry ?? "").localeCompare(b.industry ?? ""),
                render: (r) =>
                  r.industry ? (
                    <span className="muted">{r.industry}</span>
                  ) : (
                    <span className="muted subtle">-</span>
                  ),
              },
              {
                key: "contact_email",
                label: "Primary Contact",
                render: (r) =>
                  r.contact_email ? (
                    <a
                      className="tlink inline-block max-w-full truncate align-bottom"
                      href={`mailto:${r.contact_email}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {r.contact_name ?? r.contact_email}
                    </a>
                  ) : r.contact_name ? (
                    <span>{r.contact_name}</span>
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
                key: "pastProjectCount",
                label: "Past Projects",
                align: "r",
                sort: (a, b) => a.pastProjectCount - b.pastProjectCount,
                render: (r) => <span className="muted tnum">{r.pastProjectCount}</span>,
              },
              {
                key: "tags",
                label: "Tags",
                render: (r) =>
                  r.tags.length === 0 ? (
                    <span className="muted subtle">-</span>
                  ) : (
                    <span className="row-c wrap" style={{ display: "inline-flex", gap: 6 }}>
                      {r.tags.map((t) => (
                        <span key={t} className="tag">{t}</span>
                      ))}
                    </span>
                  ),
              },
            ]}
          />
          <span className="cap">
            Showing {filtered.length} clients &middot; sorted by name
          </span>
        </>
      )}
    </div>
  );
}
