import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { backState } from "@/hooks/useReferrerCrumb";
import { FilterBar, emptyFilterState, type FilterFieldDef, type FilterState } from "@/components/data/FilterBar";
import { SavedViewsDropdown } from "@/components/data/SavedViewsDropdown";
import { getDefaultSavedView } from "@/lib/hq/savedViews";
import { DataTable } from "@/components/data/DataTable";
import { OverflowList, type OverflowItem } from "@/components/hq/OverflowList";
import { WebsiteActionButton } from "@/components/hq/WebsiteActionButton";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { IconPlus } from "@/components/icons/HQIcons";
import { applyFilters } from "@/lib/hq/filterStateApply";
import { loadClients, type ClientListRow, type ClientRollupRef } from "@/lib/clients/queries";

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

  // Phase 5.7.6: distinct values per text/enum filter field.
  const distinctValuesByField = useMemo(() => {
    const pick = (key: string) =>
      Array.from(
        new Set(
          rows
            .map((r) => (r as unknown as Record<string, unknown>)[key])
            .filter((v): v is string => typeof v === "string" && v.length > 0),
        ),
      ).sort();
    return {
      city: pick("city"),
      industry: pick("industry"),
    };
  }, [rows]);

  return (
    <div className="stack-4">
      <div className="row between list-head">
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

      <div className="row between wrap" style={{ alignItems: "center" }}>
        <FilterBar
          state={filterState}
          onChange={(next) => {
            setFilterState(next);
            setActiveViewName("Custom filter");
          }}
          fields={CLIENT_FILTER_FIELDS}
          distinctValuesByField={distinctValuesByField}
        />
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

      {loading ? (
        <div className="empty">
          <p>Loading...</p>
        </div>
      ) : (
        <>
          <div className="tbl-list">
          <DataTable<ClientListRow>
            rows={filtered}
            flat
            sort={filterState.sort ?? null}
            onSortChange={(next) =>
              setFilterState((prev) => ({ ...prev, sort: next }))
            }
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
                align: "l",
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
                key: "projects",
                label: "Active Projects",
                align: "l",
                headerTitle:
                  "Counts only active projects. Complete, Cancelled, and On Hold projects are excluded.",
                render: (r) => (
                  <span className="list-projects">
                    <OverflowList
                      fromLabel={FROM_LABEL}
                      items={r.activeProjects.map<OverflowItem>((p) => ({
                        id: p.id,
                        label: p.label,
                        href: `/projects/${p.id}`,
                      }))}
                    />
                  </span>
                ),
              },
              {
                key: "deliverables",
                label: "Deliverables",
                align: "l",
                // 5.7.4 smoke followup: stacked render — Deliverable title
                // on top (coral hyperlink), Project title beneath (muted).
                // "in X days" suffix on the deliverable title lands in a
                // later Deliverables refactor sub-phase. Caps at 3 visible
                // entries with the same "+N more" popover treatment as
                // OverflowList.
                render: (r) => (
                  <DeliverablesStack
                    items={r.upcomingDeliverables}
                    fromLabel={FROM_LABEL}
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
                key: "total_projects",
                label: "Total Projects",
                align: "c",
                sort: (a, b) => a.totalProjectCount - b.totalProjectCount,
                render: (r) => <span className="muted">{r.totalProjectCount}</span>,
              },
            ]}
          />
          </div>
          <span className="cap">{filtered.length} clients</span>
        </>
      )}
    </div>
  );
}

/**
 * 5.7.4 smoke followup: vertically stacked Deliverables cell. Each entry
 * renders Deliverable title (coral hyperlink) above Project title
 * (muted). Caps at 3 visible entries; the rest spill into a "+N more"
 * popover, matching the OverflowList affordance shape used elsewhere.
 */
function DeliverablesStack({
  items,
  fromLabel,
  visible = 3,
}: {
  items: ClientRollupRef[];
  fromLabel: string;
  visible?: number;
}) {
  const location = useLocation();
  const fromState = backState(location, fromLabel);

  if (items.length === 0) return <span className="muted subtle">-</span>;

  const head = items.slice(0, visible);
  const rest = items.slice(visible);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {head.map((d) => (
        <div key={d.id}>
          <Link
            to={`/deliverables/${d.id}`}
            className="tlink"
            style={{ display: "block", lineHeight: 1.25 }}
            state={{ from: fromState }}
            onClick={(e) => e.stopPropagation()}
          >
            {d.label}
          </Link>
          {d.subLabel ? (
            <div
              className="muted"
              style={{ fontSize: 11.5, lineHeight: 1.25 }}
            >
              {d.subLabel}
            </div>
          ) : null}
        </div>
      ))}
      {rest.length > 0 ? (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="cap muted"
              style={{
                background: "transparent",
                border: 0,
                padding: 0,
                cursor: "pointer",
                textDecoration: "underline",
                textAlign: "left",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              +{rest.length} more
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-[260px] p-3"
            onClick={(e) => e.stopPropagation()}
          >
            <ul
              className="stack-2"
              style={{ listStyle: "none", padding: 0, margin: 0 }}
            >
              {rest.map((d) => (
                <li key={d.id}>
                  <Link
                    to={`/deliverables/${d.id}`}
                    className="tlink"
                    style={{ display: "block", lineHeight: 1.25 }}
                    state={{ from: fromState }}
                  >
                    {d.label}
                  </Link>
                  {d.subLabel ? (
                    <div
                      className="muted"
                      style={{ fontSize: 11.5, lineHeight: 1.25 }}
                    >
                      {d.subLabel}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  );
}
