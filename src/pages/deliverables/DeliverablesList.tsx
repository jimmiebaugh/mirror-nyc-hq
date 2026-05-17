import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { backState } from "@/lib/hq/useBackHref";
import { ViewSwitch, viewSwitchRoute, type ViewKind } from "@/components/data/ViewSwitch";
import { FilterBar, emptyFilterState, type FilterState } from "@/components/data/FilterBar";
import { SavedViewsDropdown } from "@/components/data/SavedViewsDropdown";
import { getDefaultSavedView } from "@/lib/hq/savedViews";
import { DataTable } from "@/components/data/DataTable";
import { BoardView, type BoardColumn } from "@/components/data/BoardView";
import { CalendarMonthView, type CalendarEventKind } from "@/components/data/CalendarMonthView";
import { IconPlus } from "@/components/icons/HQIcons";
import { applyFilters } from "@/lib/hq/filterStateApply";
import { supabase } from "@/integrations/supabase/client";
import {
  loadDeliverables,
  updateDeliverableStatus,
  DELIVERABLE_STATUS_VALUES,
  type DeliverableListRow,
  type DeliverableStatus,
} from "@/lib/deliverables/queries";
import { deliverableStatusToken, statusTextDecoration } from "@/lib/home/projectStatusToken";
import { ClickPillCell } from "@/components/hq/ClickPillCell";
import { formatShortDate } from "@/lib/hq/dates";

/**
 * Surface 14 Deliverables list / board / calendar. Wireframe-fidelity
 * rebuild (Phase 5.2.1 Revision); calendar is the default view per build
 * notes Surface 14. Board layout flipped to one-column-per-project per
 * revision spec § 4.C.2 (was rows-per-project in original 5.2.1; code-
 * reviewer C2 from that pass).
 */

const FILTER_FIELDS = [
  { key: "status", label: "Status", type: "enum" as const, options: DELIVERABLE_STATUS_VALUES },
  { key: "type", label: "Type", type: "text" as const },
  { key: "projectName", label: "Project", type: "text" as const },
];

// Maps deliverable_status -> calendar event banner class per spec § 2.G.
function calendarKind(status: DeliverableStatus): CalendarEventKind {
  switch (status) {
    case "Complete": return "del";
    case "In Progress": return "in";
    case "Upcoming": return "rem";
    case "Skipped": return "plain";
  }
}

const FROM_LABEL = "Deliverables";

export default function DeliverablesList({ view }: { view: ViewKind }) {
  const navigate = useNavigate();
  const location = useLocation();
  const fromState = backState(location, FROM_LABEL);
  const [rows, setRows] = useState<DeliverableListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterState, setFilterState] = useState<FilterState>(emptyFilterState());
  const [activeViewName, setActiveViewName] = useState("All deliverables");

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadDeliverables().then((r) => {
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
    getDefaultSavedView("deliverable").then((v) => {
      if (!active || !v) return;
      setFilterState(v.filter_state);
      setActiveViewName(v.name);
    });
    return () => {
      active = false;
    };
  }, []);

  const handleResetToGlobal = async () => {
    const v = await getDefaultSavedView("deliverable");
    if (v) {
      setFilterState(v.filter_state);
      setActiveViewName(v.name);
    } else {
      setFilterState(emptyFilterState());
      setActiveViewName("All deliverables");
    }
  };

  useEffect(() => {
    const ch = supabase
      .channel("deliverables-list-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "deliverables" },
        (payload) => {
          if (payload.eventType === "UPDATE") {
            const next = payload.new as Partial<DeliverableListRow> & { id: string };
            setRows((rs) =>
              rs.map((r) => (r.id === next.id ? { ...r, ...next, project: r.project } : r)),
            );
          } else if (payload.eventType === "DELETE") {
            const oldRow = payload.old as { id: string };
            setRows((rs) => rs.filter((r) => r.id !== oldRow.id));
          } else if (payload.eventType === "INSERT") {
            loadDeliverables().then(setRows);
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  const flat = useMemo(
    () =>
      rows.map((d) => ({
        ...d,
        projectName: d.project?.name ?? "",
        clientName: d.project?.client?.name ?? "",
      })),
    [rows],
  );

  const filtered = useMemo(
    () =>
      applyFilters(flat, filterState, (row, key) => {
        const v = (row as unknown as Record<string, unknown>)[key];
        if (v == null) return null;
        return typeof v === "string" ? v : String(v);
      }),
    [flat, filterState],
  );

  return (
    <div className="stack-4">
      <div className="pagehead">
        <div className="row between">
          <h1 className="h-page">Deliverables</h1>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => navigate("/deliverables/new")}
          >
            <IconPlus className="ic" />
            New Deliverable
          </button>
        </div>
        <p className="desc">
          Every dated project checkpoint. Calendar is the default view.
        </p>
      </div>

      <div className="row between wrap" style={{ alignItems: "center" }}>
        <div className="row-c">
          <ViewSwitch
            active={view}
            available={["list", "board", "calendar"]}
            surface="deliverables"
          />
          <SavedViewsDropdown
            entityType="deliverable"
            activeName={activeViewName}
            activeViewKind={view}
            activeFilterState={filterState}
            onPick={(v) => {
              setFilterState(v.filter_state);
              setActiveViewName(v.name);
            }}
            onNavigate={(kind) => {
              const target = viewSwitchRoute("deliverables", kind);
              if (target) navigate(target);
            }}
            onResetToGlobal={handleResetToGlobal}
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

      {loading ? (
        <div className="empty">
          <p>Loading...</p>
        </div>
      ) : view === "calendar" ? (
        <CalendarMonthView
          events={filtered
            .filter((d) => d.due_date)
            .map((d) => ({
              id: d.id,
              dateIso: d.due_date!,
              projectTitle: d.project?.name ?? "(no project)",
              title: d.title,
              kind: calendarKind(d.status),
              strikethrough: d.status === "Skipped",
            }))}
          onEventClick={(ev) => navigate(`/deliverables/${ev.id}`, { state: { from: fromState } })}
          toolbarRight={
            <div className="callegend">
              <span><i style={{ background: "#06B6D4" }} /> In progress</span>
              <span><i style={{ background: "hsl(var(--warn))" }} /> Upcoming</span>
              <span><i style={{ background: "hsl(var(--success))" }} /> Complete</span>
              <span>
                <i
                  style={{ background: "hsl(var(--border-strong))" }}
                />{" "}
                <span style={{ textDecoration: "line-through", opacity: 0.6 }}>
                  Skipped
                </span>
              </span>
            </div>
          }
        />
      ) : view === "list" ? (
        <DataTable<typeof filtered[number]>
          rows={filtered}
          flat
          rowBorderToken={(r) => deliverableStatusToken(r.status)}
          onRowClick={(r) => navigate(`/deliverables/${r.id}`, { state: { from: fromState } })}
          empty={{
            message: "No deliverables yet",
            ctaLabel: "+ New Deliverable",
            onCta: () => navigate("/deliverables/new"),
          }}
          columns={[
            {
              key: "title",
              label: "Title",
              sort: (a, b) => a.title.localeCompare(b.title),
              render: (r) => (
                <span className={`lead ${statusTextDecoration("deliverable", r.status)}`}>
                  {r.title}
                </span>
              ),
            },
            {
              key: "projectName",
              label: "Project",
              sort: (a, b) => a.projectName.localeCompare(b.projectName),
              render: (r) =>
                r.project ? (
                  <Link
                    to={`/projects/${r.project.id}`}
                    className="tlink"
                    state={{ from: fromState }}
                  >
                    {r.project.name}
                  </Link>
                ) : (
                  "-"
                ),
            },
            {
              key: "type",
              label: "Type",
              sort: (a, b) => (a.type ?? "").localeCompare(b.type ?? ""),
              render: (r) => r.type ?? "-",
            },
            {
              key: "status",
              label: "Status",
              sort: (a, b) => a.status.localeCompare(b.status),
              render: (r) => (
                <ClickPillCell
                  value={r.status}
                  options={DELIVERABLE_STATUS_VALUES}
                  tokenMap={deliverableStatusToken}
                  onSave={async (next) => {
                    await updateDeliverableStatus(r.id, next as DeliverableStatus);
                    setRows((rs) =>
                      rs.map((row) =>
                        row.id === r.id ? { ...row, status: next as DeliverableStatus } : row,
                      ),
                    );
                  }}
                />
              ),
            },
            {
              key: "due_date",
              label: "Due",
              align: "r",
              sort: (a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""),
              render: (r) =>
                r.due_date ? <span className="mono">{formatShortDate(r.due_date)}</span> : "-",
            },
            {
              key: "assignees",
              label: "Assignees",
              align: "c",
              render: (r) =>
                r.assigned_user_ids.length === 0 ? "-" : `${r.assigned_user_ids.length}`,
            },
          ]}
        />
      ) : view === "board" ? (
        <DeliverablesByProjectBoard
          rows={filtered}
          onClick={(r) => navigate(`/deliverables/${r.id}`, { state: { from: fromState } })}
        />
      ) : null}
    </div>
  );
}

/**
 * Per build notes Surface 14 + revision spec § 4.C.2: one column per
 * project (horizontal scroll). Cards show deliverable title + due date in
 * the upper right, plus project + client-link lines below.
 *
 * Drag-drop is intentionally omitted on this view. Status drag-drop only
 * makes sense between status buckets; here every column is a project so
 * dropping a card into a different column would imply re-parenting the
 * deliverable, which is a heavier intent than drag-drop conveys. Status
 * changes happen via the deliverable detail page or the (future) inline
 * status pill on the card.
 */
function DeliverablesByProjectBoard({
  rows,
  onClick,
}: {
  rows: DeliverableListRow[];
  onClick: (row: DeliverableListRow) => void;
}) {
  const grouped = new Map<string, { id: string; name: string; rows: DeliverableListRow[] }>();
  for (const r of rows) {
    const pid = r.project?.id ?? "__none";
    if (!grouped.has(pid)) {
      grouped.set(pid, {
        id: pid,
        name: r.project?.name ?? "(no project)",
        rows: [],
      });
    }
    grouped.get(pid)!.rows.push(r);
  }
  const columns: BoardColumn<DeliverableListRow>[] = Array.from(grouped.values()).map((g) => ({
    id: g.id,
    label: g.name,
    rows: g.rows.sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? "")),
  }));

  return (
    <BoardView<DeliverableListRow>
      layout="horizontal"
      rows={[{ label: "By Project", columns }]}
      onCardClick={onClick}
      renderCard={(r) => (
        <>
          <div className="row between" style={{ alignItems: "flex-start", gap: 8 }}>
            <div className={`nm flex1 ${statusTextDecoration("deliverable", r.status)}`}>
              {r.title}
            </div>
            <div className="cap" style={{ flex: "none" }}>
              {r.due_date ? formatShortDate(r.due_date) : ""}
            </div>
          </div>
          <div style={{ marginTop: 9, display: "flex", flexDirection: "column", gap: 2 }}>
            {r.project ? (
              <Link
                to={`/projects/${r.project.id}`}
                className="tlink"
                style={{ fontSize: 11.5 }}
              >
                {r.project.name}
              </Link>
            ) : null}
            {r.project?.client ? (
              <Link
                to={`/clients/${r.project.client.id}`}
                className="tlink"
                style={{ fontSize: 11, color: "rgba(190,78,68,.85)" }}
              >
                {r.project.client.name}
              </Link>
            ) : null}
          </div>
        </>
      )}
    />
  );
}
