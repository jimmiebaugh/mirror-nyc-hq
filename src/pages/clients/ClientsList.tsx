import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { backState } from "@/lib/hq/useBackHref";
import { FilterBar, emptyFilterState, type FilterFieldDef, type FilterState } from "@/components/data/FilterBar";
import { SavedViewsDropdown } from "@/components/data/SavedViewsDropdown";
import { getDefaultSavedView } from "@/lib/hq/savedViews";
import { DataTable } from "@/components/data/DataTable";
import { OverflowList, type OverflowItem } from "@/components/hq/OverflowList";
import { IconPlus } from "@/components/icons/HQIcons";
import { applyFilters } from "@/lib/hq/filterStateApply";
import { loadClients, type ClientListRow } from "@/lib/clients/queries";

/**
 * Clients List.
 *
 * Phase 5.6.2 reshape: four columns (Client / Contacts / Deliverables /
 * Projects). The 5.2.3 Industry / Primary Contact / City / Past Projects /
 * Tags columns are dropped. Contacts and Deliverables and Projects all
 * render through the shared OverflowList (first 3 hyperlinks + "+N more"
 * popover). Empty cells render `-`. Default sort by name ascending.
 *
 * Wireframe binding (DEVIATION): no wireframe exists for this surface.
 * Surface 10 was drawn as a unified Organizations surface; per the
 * 2026-05-16 locked decisions split (spec § 0c Q3), Organizations breaks
 * into Clients + Vendors. This is the Clients half. Wireframe-v2 redraw
 * deferred to a future polish pass; see design-system § 11.
 */

const CLIENT_FILTER_FIELDS: FilterFieldDef[] = [
  { key: "city", label: "City", type: "text" },
  { key: "industry", label: "Industry", type: "text" },
];

const FROM_LABEL = "Clients";

export default function ClientsList() {
  const navigate = useNavigate();
  const location = useLocation();
  const fromState = backState(location, FROM_LABEL);
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

  // Phase 5.6.5: resolve default saved view on mount.
  useEffect(() => {
    let active = true;
    getDefaultSavedView("client").then((v) => {
      if (!active || !v) return;
      setFilterState(v.filter_state);
      setActiveViewName(v.name);
    });
    return () => {
      active = false;
    };
  }, []);

  const handleResetToGlobal = async () => {
    const v = await getDefaultSavedView("client");
    if (v) {
      setFilterState(v.filter_state);
      setActiveViewName(v.name);
    } else {
      setFilterState(emptyFilterState());
      setActiveViewName("All clients");
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
            onResetToGlobal={handleResetToGlobal}
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
            onRowClick={(r) => navigate(`/clients/${r.id}`, { state: { from: fromState } })}
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
                  <Link
                    to={`/clients/${r.id}`}
                    className="lead"
                    state={{ from: fromState }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {r.name}
                  </Link>
                ),
              },
              {
                key: "contacts",
                label: "Contacts",
                render: (r) => (
                  <OverflowList
                    fromLabel={FROM_LABEL}
                    items={r.contacts.map<OverflowItem>((c) => ({
                      id: c.id,
                      label: c.label,
                      href: `/people/${c.id}`,
                    }))}
                  />
                ),
              },
              {
                key: "deliverables",
                label: "Deliverables",
                render: (r) => (
                  <OverflowList
                    fromLabel={FROM_LABEL}
                    items={r.upcomingDeliverables.map<OverflowItem>((d) => ({
                      id: d.id,
                      label: d.label,
                      href: `/deliverables/${d.id}`,
                    }))}
                  />
                ),
              },
              {
                key: "projects",
                label: "Projects",
                render: (r) => (
                  <OverflowList
                    fromLabel={FROM_LABEL}
                    items={r.activeProjects.map<OverflowItem>((p) => ({
                      id: p.id,
                      label: p.label,
                      href: `/projects/${p.id}`,
                    }))}
                  />
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
