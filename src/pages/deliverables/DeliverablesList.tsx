import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ViewSwitch, type ViewKind } from "@/components/data/ViewSwitch";
import { FilterBar, emptyFilterState, type FilterState } from "@/components/data/FilterBar";
import { SavedViewsDropdown } from "@/components/data/SavedViewsDropdown";
import { DataTable } from "@/components/data/DataTable";
import { BoardView, type BoardColumn } from "@/components/data/BoardView";
import { CalendarMonthView } from "@/components/data/CalendarMonthView";
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
import { formatShortDate } from "@/lib/hq/dates";

const FILTER_FIELDS = [
  { key: "status", label: "Status", type: "enum" as const, options: DELIVERABLE_STATUS_VALUES },
  { key: "type", label: "Type", type: "text" as const },
  { key: "projectName", label: "Project", type: "text" as const },
];

export default function DeliverablesList({ view }: { view: ViewKind }) {
  const navigate = useNavigate();
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

  useEffect(() => {
    const ch = supabase
      .channel("deliverables-list-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "deliverables" },
        (payload) => {
          if (payload.eventType === "UPDATE") {
            // Patch the local row in place. The Realtime payload doesn't
            // carry the project join, so keep the existing project subobject
            // on the row and only update the scalar columns we care about.
            const next = payload.new as Partial<DeliverableListRow> & { id: string };
            setRows((rs) =>
              rs.map((r) => (r.id === next.id ? { ...r, ...next, project: r.project } : r)),
            );
          } else if (payload.eventType === "DELETE") {
            const oldRow = payload.old as { id: string };
            setRows((rs) => rs.filter((r) => r.id !== oldRow.id));
          } else if (payload.eventType === "INSERT") {
            // INSERTs need the project join the Realtime payload omits;
            // a full refetch is the simplest correct path and INSERT
            // frequency is far lower than UPDATE.
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

  const handleBoardMove = async (deliverable: DeliverableListRow, _from: string, to: string) => {
    const next = to as DeliverableStatus;
    setRows((rs) => rs.map((r) => (r.id === deliverable.id ? { ...r, status: next } : r)));
    try {
      await updateDeliverableStatus(deliverable.id, next);
    } catch (err) {
      console.error("deliverable status update failed", err);
      setRows((rs) => rs.map((r) => (r.id === deliverable.id ? { ...r, status: deliverable.status } : r)));
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex items-center justify-between gap-3">
        <h1 className="h-page">Deliverables</h1>
        <Button onClick={() => navigate("/deliverables/new")}>+ New Deliverable</Button>
      </header>

      <div className="hq-tbl-toolbar">
        <div className="flex items-center gap-3">
          <ViewSwitch active={view} surface="deliverables" available={["list", "board", "calendar"]} />
          <SavedViewsDropdown
            entityType="deliverable"
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
        entityType="deliverable"
        state={filterState}
        onChange={(next) => {
          setFilterState(next);
          setActiveViewName("Custom filter");
        }}
        fields={FILTER_FIELDS}
      />

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : view === "calendar" ? (
        <CalendarMonthView
          events={filtered
            .filter((d) => d.due_date)
            .map((d) => ({
              id: d.id,
              dateIso: d.due_date!,
              projectTitle: d.project?.name ?? "(no project)",
              title: d.title,
              token: deliverableStatusToken(d.status),
              strikethrough: d.status === "Skipped",
            }))}
          onEventClick={(ev) => navigate(`/deliverables/${ev.id}`)}
        />
      ) : view === "list" ? (
        <DataTable<typeof filtered[number]>
          rows={filtered}
          rowBorderToken={(r) => deliverableStatusToken(r.status)}
          onRowClick={(r) => navigate(`/deliverables/${r.id}`)}
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
                <span className={statusTextDecoration("deliverable", r.status)}>{r.title}</span>
              ),
            },
            {
              key: "projectName",
              label: "Project",
              sort: (a, b) => a.projectName.localeCompare(b.projectName),
              render: (r) => (
                r.project ? (
                  <Link to={`/projects/${r.project.id}`} className="hq-tlink">
                    {r.project.name}
                  </Link>
                ) : (
                  "-"
                )
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
                <span className={`hq-pill hq-pill--${deliverableStatusToken(r.status)}`}>
                  <span className="hq-pill-dt" />
                  {r.status}
                </span>
              ),
            },
            {
              key: "due_date",
              label: "Due",
              align: "right",
              sort: (a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""),
              render: (r) => (r.due_date ? formatShortDate(r.due_date) : "-"),
            },
            {
              key: "assignees",
              label: "Assignees",
              render: (r) => (r.assigned_user_ids.length === 0 ? "-" : `${r.assigned_user_ids.length}`),
            },
          ]}
        />
      ) : view === "board" ? (
        <BoardByProject
          rows={filtered}
          onMove={handleBoardMove}
          onClick={(r) => navigate(`/deliverables/${r.id}`)}
        />
      ) : null}
    </div>
  );
}

function BoardByProject({
  rows,
  onMove,
  onClick,
}: {
  rows: DeliverableListRow[];
  onMove: (row: DeliverableListRow, from: string, to: string) => void;
  onClick: (row: DeliverableListRow) => void;
}) {
  // Group by project; columns are still status buckets within each project
  // group. Recommend grouping by Project per build notes Surface 14: one
  // column per active project, with cards listing every deliverable for it.
  // To support drag-drop status changes we use one row per project and
  // columns = the 4 statuses. Projects with no deliverables are skipped.
  const grouped = new Map<string, { name: string; rows: DeliverableListRow[] }>();
  for (const r of rows) {
    const pid = r.project?.id ?? "__none";
    if (!grouped.has(pid)) {
      grouped.set(pid, { name: r.project?.name ?? "(no project)", rows: [] });
    }
    grouped.get(pid)!.rows.push(r);
  }
  const rowsForBoard = Array.from(grouped.entries()).map(([pid, g]) => ({
    label: g.name,
    columns: DELIVERABLE_STATUS_VALUES.map((s): BoardColumn<DeliverableListRow> => ({
      id: `${pid}:${s}`,
      label: s,
      token: deliverableStatusToken(s),
      rows: g.rows.filter((r) => r.status === s),
    })),
  }));

  return (
    <BoardView<DeliverableListRow>
      rows={rowsForBoard}
      onCardMove={(row, fromId, toId) => {
        const toStatus = toId.split(":")[1] as DeliverableStatus;
        onMove(row, fromId, toStatus);
      }}
      onCardClick={onClick}
      renderCard={(r) => (
        <div>
          <div className={`hq-board-card-row font-medium ${statusTextDecoration("deliverable", r.status)}`}>
            {r.title}
          </div>
          <div className="hq-board-card-row">
            <span className="hq-board-card-sub">{r.type ?? "-"}</span>
            <span className="hq-board-card-sub">{r.due_date ? formatShortDate(r.due_date) : ""}</span>
          </div>
        </div>
      )}
    />
  );
}
