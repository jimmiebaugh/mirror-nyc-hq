import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { backState } from "@/lib/hq/useBackHref";
import { ViewSwitch, viewSwitchRoute, type ViewKind } from "@/components/data/ViewSwitch";
import { FilterBar, emptyFilterState, type FilterState } from "@/components/data/FilterBar";
import { SavedViewsDropdown } from "@/components/data/SavedViewsDropdown";
import { getDefaultSavedView } from "@/lib/hq/savedViews";
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
import { ClickPillCell } from "@/components/hq/ClickPillCell";
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

// Phase 5.7.6 follow-up: ordered to match the list-view DataTable
// column display order. The "Project / Client" column stacks the client
// link above the project name, so clientName is visually first after
// jobNumber. Remaining columns: category, city, status, ..., lead.
const FILTER_FIELDS = [
  { key: "clientName", label: "Client", type: "text" as const },
  { key: "category", label: "Category", type: "text" as const },
  { key: "city", label: "City", type: "text" as const },
  { key: "status", label: "Status", type: "enum" as const, options: PROJECT_STATUS_VALUES },
  // Phase 5.7.7: label renamed "Account" -> "Team". Key stays `leadName`
  // so existing saved views resolve unchanged; the applyFn callback in
  // `filtered` below remaps `leadName` -> the row's derived `teamNames`
  // string (lead + designer + project_members), broadening the matching
  // scope to the full team roster.
  { key: "leadName", label: "Team", type: "text" as const },
  // Phase 5.9.2: presence chip. Commits immediately (no value step) and filters
  // to projects that carry a bulk_import_session_id.
  { key: "bulkImportSessionId", label: "Bulk Imported", type: "presence" as const },
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

const FROM_LABEL = "Projects";

export default function ProjectsList({ view }: { view: ViewKind }) {
  const navigate = useNavigate();
  const location = useLocation();
  const fromState = backState(location, FROM_LABEL);
  const [rows, setRows] = useState<ProjectListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterState, setFilterState] = useState<FilterState>(emptyFilterState());
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

  // Phase 5.6.5: resolve the default saved view on mount (per-user wins,
  // then global, then leave the empty state alone). Phase 5.9.5: skip when
  // arriving from the bulk-import history "Open list" drill-down so the
  // session seed below isn't clobbered by the async default-view resolve.
  useEffect(() => {
    if ((location.state as { bulkImportSessionId?: string } | null)?.bulkImportSessionId) {
      return;
    }
    let active = true;
    getDefaultSavedView("project").then((v) => {
      if (!active || !v) return;
      setFilterState(v.filter_state);
      setActiveViewName(v.name);
    });
    return () => {
      active = false;
    };
  }, [location.state]);

  // Phase 5.9.5: "Open list" from the bulk-import history rail seeds a single
  // session-scoped chip so the list shows only that import's records.
  useEffect(() => {
    const sid = (location.state as { bulkImportSessionId?: string } | null)
      ?.bulkImportSessionId;
    if (!sid) return;
    setFilterState((prev) => ({
      ...prev,
      chips: [{ field: "bulkImportSessionId", op: "is", value: sid }],
    }));
    setActiveViewName("Custom filter");
  }, [location.state]);

  const handleResetToGlobal = async () => {
    const v = await getDefaultSavedView("project");
    if (v) {
      setFilterState(v.filter_state);
      setActiveViewName(v.name);
    } else {
      setFilterState(emptyFilterState());
      setActiveViewName("All projects");
    }
  };

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
        // Phase 5.7.7: the `leadName` filter (now labeled "Team") matches
        // against the union of every Account Manager + Designer + general
        // project_member name. The chip's stored key stays `leadName` for
        // saved-view back-compat; the lookup quietly remaps to the joined
        // `teamNames` string. The `leadName` column-cell render still reads
        // `row.leadName` (single first-name for the avatar initials).
        if (key === "leadName") {
          const r = row as unknown as ProjectListRow;
          const parts = [...r.leadNames, ...r.designerNames, ...r.memberNames];
          if (parts.length === 0) return null;
          return parts.join(" · ");
        }
        const val = (row as unknown as Record<string, unknown>)[key];
        if (val == null) return null;
        return typeof val === "string" ? val : String(val);
      }),
    [rows, filterState],
  );

  // Phase 5.7.6: distinct values per text/enum filter field.
  // Phase 5.7.7: `leadName` now pulls from the AM + Designer + project_member
  // name union so the "Team" filter's dropdown lists every name across the
  // three roster sources.
  const distinctValuesByField = useMemo(() => {
    const pick = (key: string) =>
      Array.from(
        new Set(
          rows
            .map((r) => (r as unknown as Record<string, unknown>)[key])
            .filter((v): v is string => typeof v === "string" && v.length > 0),
        ),
      ).sort();
    const teamUnion = Array.from(
      new Set([
        ...rows.flatMap((r) => r.leadNames),
        ...rows.flatMap((r) => r.designerNames),
        ...rows.flatMap((r) => r.memberNames),
      ]),
    )
      .filter(Boolean)
      .sort();
    return {
      status: pick("status"),
      category: pick("category"),
      city: pick("city"),
      clientName: pick("clientName"),
      leadName: teamUnion,
    };
  }, [rows]);

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
      <div className="row between" style={{ alignItems: "flex-end" }}>
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

      <ViewSwitch
        active={view}
        available={["list", "board", "timeline", "calendar"]}
        surface="projects"
      />

      <div className="row between wrap" style={{ alignItems: "center" }}>
        <FilterBar
          state={filterState}
          onChange={(next) => {
            setFilterState(next);
            setActiveViewName("Custom filter");
          }}
          fields={FILTER_FIELDS}
          distinctValuesByField={distinctValuesByField}
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
          onResetToGlobal={handleResetToGlobal}
        />
      </div>

      {loading ? (
        <div className="empty">
          <p>Loading...</p>
        </div>
      ) : view === "list" ? (
        <>
          <DataTable<ProjectListRow>
            rows={filtered}
            flat
            sort={filterState.sort ?? null}
            onSortChange={(next) =>
              setFilterState((prev) => ({ ...prev, sort: next }))
            }
            rowBorderToken={(r) => projectStatusToken(r.status)}
            onRowClick={(r) => navigate(`/projects/${r.id}`, { state: { from: fromState } })}
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
                width: 55,
                noRightDivider: true,
                headerStyle: { paddingLeft: 14, paddingRight: 2 },
                sort: (a, b) => (a.jobNumber ?? "").localeCompare(b.jobNumber ?? ""),
                render: (r) => (
                  <span className="mono muted">{r.jobNumber ?? "-"}</span>
                ),
              },
              {
                key: "name",
                label: "Project / Client",
                sort: (a, b) => a.name.localeCompare(b.name),
                render: (r) => {
                  // Resolve the client label defensively: prefer the embed,
                  // but if `clientName` came back null while `clientId` is set
                  // (PostgREST cardinality quirk), render "Client" as a
                  // placeholder so the row still shows the affiliation.
                  const clientLabel =
                    r.clientName ?? (r.clientId ? "View client" : null);
                  return (
                    <div>
                      {clientLabel ? (
                        r.clientId ? (
                          <Link
                            to={`/clients/${r.clientId}`}
                            className="sub"
                            style={{
                              color: "rgba(190,78,68,0.85)",
                              display: "block",
                              fontSize: 12,
                            }}
                            state={{ from: fromState }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {clientLabel}
                          </Link>
                        ) : (
                          <span
                            className="sub"
                            style={{
                              color: "rgba(190,78,68,0.85)",
                              display: "block",
                              fontSize: 12,
                            }}
                          >
                            {clientLabel}
                          </span>
                        )
                      ) : null}
                      <Link
                        to={`/projects/${r.id}`}
                        className="lead"
                        style={{ display: "block", fontSize: 13.5 }}
                        state={{ from: fromState }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {r.name}
                      </Link>
                    </div>
                  );
                },
              },
              {
                key: "category",
                label: "Category",
                width: 120,
                align: "c",
                sort: (a, b) => (a.category ?? "").localeCompare(b.category ?? ""),
                render: (r) => r.category ?? "-",
              },
              {
                key: "city",
                label: "City",
                align: "c",
                sort: (a, b) => (a.city ?? "").localeCompare(b.city ?? ""),
                render: (r) => r.city ?? "-",
              },
              {
                key: "status",
                label: "Status",
                align: "c",
                width: 96,
                sort: (a, b) => a.status.localeCompare(b.status),
                render: (r) => (
                  <ClickPillCell
                    value={r.status}
                    options={PROJECT_STATUS_VALUES}
                    tokenMap={projectStatusToken}
                    onSave={async (next) => {
                      await updateProjectStatus(r.id, next as ProjectStatus);
                      setRows((rs) =>
                        rs.map((row) =>
                          row.id === r.id ? { ...row, status: next as ProjectStatus } : row,
                        ),
                      );
                    }}
                  />
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
                key: "leadDesignerNames",
                label: "Account / Design Leads",
                width: 150,
                sort: (a, b) =>
                  (a.leadNames[0] ?? "").localeCompare(b.leadNames[0] ?? ""),
                render: (r) => {
                  // 5.7.4 smoke round 2: show first names only; both rows
                  // share the same text style; hairline divider is 60% of
                  // cell width with the left edge flush at the cell start.
                  const firstNamesOf = (names: string[]) =>
                    names
                      .map((n) => n.trim().split(/\s+/)[0])
                      .filter(Boolean);
                  const leads = firstNamesOf(r.leadNames);
                  const designers = firstNamesOf(r.designerNames);
                  return (
                    <div style={{ fontSize: 12, lineHeight: 1.35 }}>
                      <div>{leads.length ? leads.join(" · ") : "-"}</div>
                      <div
                        style={{
                          height: 1,
                          width: "75%",
                          background: "hsl(var(--border))",
                          margin: "4px 0",
                        }}
                      />
                      <div>{designers.length ? designers.join(" · ") : "-"}</div>
                    </div>
                  );
                },
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
          onCardClick={(r) => navigate(`/projects/${r.id}`, { state: { from: fromState } })}
          renderCard={(r) => (
            <>
              <div className="nm">
                {r.clientName ? `${r.clientName} · ${r.name}` : r.name}
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
              .filter(
                (r) =>
                  r.installStartIso ||
                  r.liveStartIso ||
                  r.removalStartIso,
              )
              .map((r) => {
                const bars: NonNullable<
                  Parameters<typeof TimelineView>[0]["rows"][number]["bars"]
                > = [];
                if (r.installStartIso) {
                  bars.push({
                    kind: "install" as const,
                    startIso: r.installStartIso,
                    endIso: r.installEndIso,
                    label: r.installEndIso
                      ? `Install · ${formatShortDate(r.installStartIso)} to ${formatShortDate(r.installEndIso)}`
                      : `Install · ${formatShortDate(r.installStartIso)}`,
                  });
                }
                if (r.liveStartIso) {
                  bars.push({
                    kind: "live" as const,
                    startIso: r.liveStartIso,
                    endIso: r.liveEndIso,
                    label: r.liveEndIso
                      ? `Live · ${formatShortDate(r.liveStartIso)} to ${formatShortDate(r.liveEndIso)}`
                      : `Live · ${formatShortDate(r.liveStartIso)}`,
                  });
                }
                if (r.removalStartIso) {
                  bars.push({
                    kind: "removal" as const,
                    startIso: r.removalStartIso,
                    endIso: r.removalEndIso,
                    label: r.removalEndIso
                      ? `Removal · ${formatShortDate(r.removalStartIso)} to ${formatShortDate(r.removalEndIso)}`
                      : `Removal · ${formatShortDate(r.removalStartIso)}`,
                  });
                }
                return {
                  id: r.id,
                  token: projectStatusToken(r.status),
                  name: r.clientName ? `${r.clientName} · ${r.name}` : r.name,
                  subText: `${r.jobNumber ? `#${r.jobNumber} · ` : ""}${r.city ?? ""}`.trim(),
                  bars,
                };
              })}
            onBarClick={(id) => navigate(`/projects/${id}`, { state: { from: fromState } })}
          />
        </>
      ) : null}
    </div>
  );
}

