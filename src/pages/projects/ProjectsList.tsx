import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ViewSwitch, type ViewKind } from "@/components/data/ViewSwitch";
import { FilterBar, emptyFilterState, type FilterState } from "@/components/data/FilterBar";
import { SavedViewsDropdown } from "@/components/data/SavedViewsDropdown";
import { DataTable } from "@/components/data/DataTable";
import { BoardView, type BoardRow } from "@/components/data/BoardView";
import { TimelineView } from "@/components/data/TimelineView";
import { Button } from "@/components/ui/button";
import { applyFilters } from "@/lib/hq/filterStateApply";
import { formatShortDate } from "@/lib/hq/dates";
import {
  loadProjects,
  updateProjectStatus,
  PROJECT_STATUS_VALUES,
  TERMINAL_PROJECT_STATUSES,
  type ProjectListRow,
  type ProjectStatus,
} from "@/lib/projects/queries";
import { hqPillClass, projectStatusToken } from "@/lib/home/projectStatusToken";
import { supabase } from "@/integrations/supabase/client";

/**
 * Surfaces 04 / 05 / 06 / 07 list / board / timeline + the calendar tab
 * that stubs to /calendar?source=projects. Lifts the RoleDashboard.tsx
 * shell from Talent Scout and replaces the table with the generic
 * <DataTable />; replaces the kanban with the generic <BoardView />.
 */

const FILTER_FIELDS = [
  { key: "status", label: "Status", type: "enum" as const, options: PROJECT_STATUS_VALUES },
  { key: "clientName", label: "Client", type: "text" as const },
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

  // Realtime: subscribe to project status changes so Board drag-drop
  // updates from peers land here without a manual refresh.
  useEffect(() => {
    const ch = supabase
      .channel("projects-list-realtime")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "projects" },
        (payload) => {
          const next = payload.new as { id: string; status: ProjectStatus };
          setRows((rs) => rs.map((r) => (r.id === next.id ? { ...r, status: next.status } : r)));
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

  // Calendar tab redirects out to the unified /calendar surface (Surface 15;
  // lands 5.3). Effect-driven so we never call navigate during render.
  useEffect(() => {
    if (view !== "calendar") return;
    navigate(`/calendar?source=projects${location.search.replace(/^\?/, "&")}`, { replace: true });
  }, [view, location.search, navigate]);

  if (view === "calendar") return null;

  const tabs: ViewKind[] = ["list", "board", "timeline", "calendar"];

  const handleBoardMove = async (project: ProjectListRow, _from: string, to: string) => {
    const next = to as ProjectStatus;
    setRows((rs) => rs.map((r) => (r.id === project.id ? { ...r, status: next } : r)));
    try {
      await updateProjectStatus(project.id, next);
    } catch (err) {
      console.error("status update failed", err);
      setRows((rs) => rs.map((r) => (r.id === project.id ? { ...r, status: project.status } : r)));
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex items-center justify-between gap-3">
        <h1 className="h-page">Projects</h1>
        <Button onClick={() => navigate("/projects/new")}>+ New Project</Button>
      </header>

      <div className="hq-tbl-toolbar">
        <div className="flex items-center gap-3">
          <ViewSwitch active={view} surface="projects" available={tabs} />
          <SavedViewsDropdown
            entityType="project"
            activeName={activeViewName}
            activeViewKind={view}
            activeFilterState={filterState}
            onPick={(v) => {
              setFilterState(v.filter_state);
              setActiveViewName(v.name);
            }}
          />
        </div>
      </div>

      <FilterBar
        entityType="project"
        state={filterState}
        onChange={(next) => {
          setFilterState(next);
          setActiveViewName("All projects");
        }}
        fields={FILTER_FIELDS}
      />

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : view === "list" ? (
        <DataTable<ProjectListRow>
          rows={filtered}
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
              key: "name",
              label: "Project / Client",
              sort: (a, b) => a.name.localeCompare(b.name),
              render: (r) => (
                <div>
                  <div className="font-medium">{r.name}</div>
                  {r.clientName ? (
                    <Link
                      to={`/projects/${r.id}`}
                      className="text-[11.5px]"
                      style={{ color: "rgba(190,78,68,0.85)" }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {r.clientName}
                    </Link>
                  ) : null}
                </div>
              ),
            },
            {
              key: "status",
              label: "Status",
              sort: (a, b) => a.status.localeCompare(b.status),
              render: (r) => (
                <span className={hqPillClass(r.status)}>
                  <span className="hq-pill-dt" />
                  {r.status}
                </span>
              ),
            },
            {
              key: "live",
              label: "Live",
              sort: (a, b) => (a.liveStartIso ?? "").localeCompare(b.liveStartIso ?? ""),
              render: (r) =>
                r.liveStartIso
                  ? `${formatShortDate(r.liveStartIso)}${r.liveEndIso ? ` to ${formatShortDate(r.liveEndIso)}` : ""}`
                  : "-",
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
      ) : view === "board" ? (
        <BoardView<ProjectListRow>
          rows={
            BOARD_ROWS.map((br): BoardRow<ProjectListRow> => ({
              label: br.label,
              columns: br.statuses.map((s) => ({
                id: s,
                label: s,
                token: projectStatusToken(s),
                rows: filtered.filter((r) => r.status === s),
              })),
            }))
          }
          columnsPerRow={(ri) => BOARD_ROWS[ri].statuses.length}
          onCardMove={handleBoardMove}
          onCardClick={(r) => navigate(`/projects/${r.id}`)}
          renderCard={(r) => (
            <div>
              <div className="hq-board-card-row">
                <span className="font-medium">{r.name}</span>
              </div>
              <div className="hq-board-card-row">
                <span className="hq-board-card-sub">{r.clientName ?? "-"}</span>
                <span className="hq-board-card-sub">
                  {r.liveStartIso ? formatShortDate(r.liveStartIso) : ""}
                </span>
              </div>
            </div>
          )}
        />
      ) : view === "timeline" ? (
        <TimelineView
          rows={filtered
            .filter((r) => r.liveStartIso || r.liveEndIso)
            .map((r) => ({
              id: r.id,
              token: projectStatusToken(r.status),
              label: (
                <div>
                  <div className="font-medium">{r.name}</div>
                  <div className="text-[11px] text-[hsl(var(--subtle-foreground))]">
                    {r.clientName ?? ""}
                  </div>
                </div>
              ),
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
      ) : null}

      {view === "list" ? (
        <p className="text-[11px] font-mono uppercase tracking-widest text-[hsl(var(--subtle-foreground))]">
          {filtered.filter((r) => !TERMINAL_PROJECT_STATUSES.includes(r.status)).length} active projects shown ·{" "}
          {filtered.filter((r) => TERMINAL_PROJECT_STATUSES.includes(r.status)).length} complete or cancelled hidden
        </p>
      ) : null}
    </div>
  );
}
