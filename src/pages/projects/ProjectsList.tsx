import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ViewSwitch, viewSwitchRoute, type ViewKind } from "@/components/data/ViewSwitch";
import { FilterBar, emptyFilterState, type FilterState } from "@/components/data/FilterBar";
import { SavedViewsDropdown } from "@/components/data/SavedViewsDropdown";
import { DataTable } from "@/components/data/DataTable";
import { BoardView, type BoardRow } from "@/components/data/BoardView";
import { TimelineView } from "@/components/data/TimelineView";
import { IconPlus } from "@/components/icons/HQIcons";
import { applyFilters } from "@/lib/hq/filterStateApply";
import { formatShortDate, relativeDay } from "@/lib/hq/dates";
import {
  loadProjects,
  updateProjectStatus,
  PROJECT_STATUS_VALUES,
  TERMINAL_PROJECT_STATUSES,
  type ProjectListRow,
  type ProjectStatus,
} from "@/lib/projects/queries";
import { projectStatusToken } from "@/lib/home/projectStatusToken";
import { supabase } from "@/integrations/supabase/client";

/**
 * Surfaces 04 / 05 / 06 / 07 list / board / timeline + the calendar tab
 * that stubs to /calendar?source=projects. Wireframe-fidelity rebuild
 * (Phase 5.2.1 Revision); consumes the lifted .tbl / .board-stack / .tl
 * classes through the rewritten data components.
 *
 * Wireframe references:
 *   List     -> lines 938-1053
 *   Board    -> lines 1056-1207 (stacked 4-row layout per Surface 05 LOCK)
 *   Timeline -> lines 1210-1315
 */

const FILTER_FIELDS = [
  { key: "status", label: "Status", type: "enum" as const, options: PROJECT_STATUS_VALUES },
  { key: "category", label: "Category", type: "text" as const },
  { key: "city", label: "City", type: "text" as const },
  { key: "organizationName", label: "Client", type: "text" as const },
  { key: "leadName", label: "Lead", type: "text" as const },
];

const BOARD_ROWS: { label: string; statuses: ProjectStatus[] }[] = [
  {
    label: "Active Production",
    statuses: ["Approved", "In Production", "In Progress", "Location Scouting"],
  },
  { label: "On Site", statuses: ["Install", "Removal", "Billing"] },
  { label: "Pre-Production", statuses: ["Queued", "Quoting", "Quote Sent", "Awaiting Feedback"] },
  { label: "Inactive", statuses: ["On Hold", "Complete", "Cancelled"] },
];

export default function ProjectsList({ view }: { view: ViewKind }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [rows, setRows] = useState<ProjectListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterState, setFilterState] = useState<FilterState>(emptyFilterState());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeViewName, setActiveViewName] = useState("All projects");

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadProjects().then((r) => {
      if (active) {
        setRows(r);
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const ch = supabase
      .channel("projects-list-realtime")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "projects" },
        (payload) => {
          const next = payload.new as { id: string; status: ProjectStatus };
          setRows((rs) =>
            rs.map((r) => (r.id === next.id ? { ...r, status: next.status } : r)),
          );
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  const filtered = useMemo(
    () =>
      applyFilters(rows, filterState, (row, key) => {
        const val = (row as unknown as Record<string, unknown>)[key];
        if (val == null) return null;
        return typeof val === "string" ? val : String(val);
      }),
    [rows, filterState],
  );

  // Calendar tab routes out to the unified /calendar surface (lands 5.3).
  useEffect(() => {
    if (view !== "calendar") return;
    navigate(`/calendar?source=projects${location.search.replace(/^\?/, "&")}`, { replace: true });
  }, [view, location.search, navigate]);

  if (view === "calendar") return null;

  const activeCount = filtered.filter((r) => !TERMINAL_PROJECT_STATUSES.includes(r.status)).length;
  const terminalCount = filtered.filter((r) => TERMINAL_PROJECT_STATUSES.includes(r.status)).length;

  const handleBoardMove = async (project: ProjectListRow, _from: string, to: string) => {
    const next = to as ProjectStatus;
    setRows((rs) =>
      rs.map((r) => (r.id === project.id ? { ...r, status: next } : r)),
    );
    try {
      await updateProjectStatus(project.id, next);
    } catch (err) {
      console.error("status update failed", err);
      setRows((rs) =>
        rs.map((r) => (r.id === project.id ? { ...r, status: project.status } : r)),
      );
    }
  };

  return (
    <div className="stack-4">
      <div className="pagehead">
        <div className="row between">
          <h1 className="h-page">Projects</h1>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => navigate("/projects/new")}
          >
            <IconPlus className="ic" />
            New Project
          </button>
        </div>
        <p className="desc">Every active project across the agency.</p>
      </div>

      <div className="row between wrap" style={{ alignItems: "center" }}>
        <div className="row-c">
          <ViewSwitch
            active={view}
            available={["list", "board", "timeline", "calendar"]}
            surface="projects"
          />
          <SavedViewsDropdown
            entityType="project"
            activeName={activeViewName}
            activeViewKind={view}
            activeFilterState={filterState}
            onPick={(v) => {
              setFilterState(v.filter_state);
              setActiveViewName(v.name);
            }}
            onNavigate={(kind) => {
              const target = viewSwitchRoute("projects", kind);
              if (target) navigate(target);
            }}
          />
        </div>
        <div className="row-c">
          <button type="button" className="btn btn-secondary btn-sm">Columns</button>
          <button type="button" className="btn btn-secondary btn-sm">Save view</button>
        </div>
      </div>

      <FilterBar
        state={filterState}
        onChange={(next) => {
          setFilterState(next);
          setActiveViewName("Custom filter");
        }}
        fields={FILTER_FIELDS}
      />

      {selected.size > 0 ? (
        <div className="bulkbar">
          <span className="cnt">{selected.size} SELECTED</span>
          <button type="button" className="btn btn-tertiary btn-sm">Change status</button>
          <button type="button" className="btn btn-tertiary btn-sm">Assign lead</button>
          <button type="button" className="btn btn-tertiary btn-sm">Add tag</button>
          <button type="button" className="btn btn-tertiary btn-sm">Export</button>
          <button
            type="button"
            className="btn btn-tertiary btn-sm"
            style={{ marginLeft: "auto" }}
            onClick={() => setSelected(new Set())}
          >
            Close
          </button>
        </div>
      ) : null}

      {loading ? (
        <div className="empty">
          <p>Loading...</p>
        </div>
      ) : view === "list" ? (
        <>
          <DataTable<ProjectListRow>
            rows={filtered}
            flat
            rowBorderToken={(r) => projectStatusToken(r.status)}
            onRowClick={(r) => navigate(`/projects/${r.id}`)}
            selection={{ selectedIds: selected, onChange: setSelected }}
            twoTier={{
              isTerminal: (r) => TERMINAL_PROJECT_STATUSES.includes(r.status),
              dividerLabel: (n) => `Complete & Cancelled · ${n} hidden`,
            }}
            empty={{
              message: "No active projects",
              ctaLabel: "+ New Project",
              onCta: () => navigate("/projects/new"),
            }}
            columns={[
              {
                key: "jobNumber",
                label: "Job #",
                width: 76,
                sort: (a, b) => (a.jobNumber ?? "").localeCompare(b.jobNumber ?? ""),
                render: (r) => (
                  <span className="mono muted">{r.jobNumber ?? "-"}</span>
                ),
              },
              {
                key: "name",
                label: "Project / Client",
                sort: (a, b) => a.name.localeCompare(b.name),
                render: (r) => (
                  <div>
                    <div className="lead">{r.name}</div>
                    {r.organizationName ? (
                      <Link
                        to={r.organizationId ? `/organizations/${r.organizationId}` : "#"}
                        className="sub"
                        style={{ color: "rgba(190,78,68,0.85)" }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {r.organizationName}
                      </Link>
                    ) : null}
                  </div>
                ),
              },
              {
                key: "category",
                label: "Category",
                sort: (a, b) => (a.category ?? "").localeCompare(b.category ?? ""),
                render: (r) => r.category ?? "-",
              },
              {
                key: "city",
                label: "City",
                sort: (a, b) => (a.city ?? "").localeCompare(b.city ?? ""),
                render: (r) => r.city ?? "-",
              },
              {
                key: "status",
                label: "Status",
                sort: (a, b) => a.status.localeCompare(b.status),
                render: (r) => (
                  <span className={`pill p-${projectStatusToken(r.status)}`}>
                    <span className="dt" />
                    {r.status}
                  </span>
                ),
              },
              {
                key: "nextDeliverable",
                label: "Next Deliverable",
                render: (r) =>
                  r.nextDeliverableTitle ? (
                    <div>
                      <div className="lead">{r.nextDeliverableTitle}</div>
                      <div className="sub">
                        {r.nextDeliverableDueIso ? relativeDay(r.nextDeliverableDueIso) : ""}
                      </div>
                    </div>
                  ) : (
                    <span className="subtle">-</span>
                  ),
              },
              {
                key: "live",
                label: "Live",
                sort: (a, b) => (a.liveStartIso ?? "").localeCompare(b.liveStartIso ?? ""),
                render: (r) =>
                  r.liveStartIso ? (
                    <span className="mono">
                      {formatShortDate(r.liveStartIso)}
                      {r.liveEndIso ? ` to ${formatShortDate(r.liveEndIso)}` : ""}
                    </span>
                  ) : (
                    "-"
                  ),
              },
              {
                key: "leadName",
                label: "Lead",
                sort: (a, b) => (a.leadName ?? "").localeCompare(b.leadName ?? ""),
                render: (r) => r.leadName ?? "-",
              },
              {
                key: "designerName",
                label: "Design",
                sort: (a, b) => (a.designerName ?? "").localeCompare(b.designerName ?? ""),
                render: (r) => r.designerName ?? "-",
              },
            ]}
          />
          <span className="cap">
            {activeCount} active projects shown · {terminalCount} complete or cancelled hidden
          </span>
        </>
      ) : view === "board" ? (
        <BoardView<ProjectListRow>
          layout="stacked"
          rows={
            BOARD_ROWS.map((br): BoardRow<ProjectListRow> => ({
              label: br.label,
              rowCaption: `${br.statuses.length} columns`,
              columns: br.statuses.map((s) => ({
                id: s,
                label: s,
                token: projectStatusToken(s),
                rows: filtered.filter((r) => r.status === s),
              })),
            }))
          }
          onCardMove={handleBoardMove}
          onCardClick={(r) => navigate(`/projects/${r.id}`)}
          renderCard={(r) => (
            <>
              <div className="nm">
                {r.organizationName ? `${r.organizationName} · ${r.name}` : r.name}
              </div>
              <div className="meta">
                <span className="cap">
                  {[r.city, r.liveStartIso ? formatShortDate(r.liveStartIso) : null]
                    .filter(Boolean)
                    .join(" · ") || "-"}
                </span>
                {r.leadName ? (
                  <span className="av-i" title={r.leadName}>
                    {r.leadName.slice(0, 2).toUpperCase()}
                  </span>
                ) : null}
              </div>
            </>
          )}
        />
      ) : view === "timeline" ? (
        <>
          <div className="callegend" style={{ justifyContent: "flex-end" }}>
            <span>
              <i style={{ background: "#06B6D4" }} /> Install
            </span>
            <span>
              <i style={{ background: "hsl(var(--primary))" }} /> Live
            </span>
            <span>
              <i style={{ background: "hsl(var(--warn))" }} /> Removal
            </span>
          </div>
          <TimelineView
            rows={filtered
              .filter((r) => r.liveStartIso || r.liveEndIso)
              .map((r) => ({
                id: r.id,
                token: projectStatusToken(r.status),
                name: r.organizationName ? `${r.organizationName} · ${r.name}` : r.name,
                subText: `${r.jobNumber ? `#${r.jobNumber} · ` : ""}${r.city ?? ""}`.trim(),
                bars: r.liveStartIso
                  ? [
                      {
                        kind: "live" as const,
                        startIso: r.liveStartIso,
                        endIso: r.liveEndIso,
                        label: r.liveEndIso
                          ? `Live · ${formatShortDate(r.liveStartIso)} to ${formatShortDate(r.liveEndIso)}`
                          : `Live · ${formatShortDate(r.liveStartIso)}`,
                      },
                    ]
                  : [],
              }))}
            onBarClick={(id) => navigate(`/projects/${id}`)}
          />
        </>
      ) : null}
    </div>
  );
}

