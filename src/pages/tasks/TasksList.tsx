import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ViewSwitch, viewSwitchRoute, type ViewKind } from "@/components/data/ViewSwitch";
import { FilterBar, type FilterState } from "@/components/data/FilterBar";
import { SavedViewsDropdown } from "@/components/data/SavedViewsDropdown";
import { DataTable } from "@/components/data/DataTable";
import { BoardView, type BoardColumn } from "@/components/data/BoardView";
import { IconPlus } from "@/components/icons/HQIcons";
import { applyFilters } from "@/lib/hq/filterStateApply";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  loadTasks,
  updateTaskPriority,
  updateTaskStatus,
  TASK_PRIORITY_VALUES,
  TASK_STATUS_VALUES,
  type TaskListRow,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/tasks/queries";
import {
  statusTextDecoration,
  taskPriorityToken,
  taskStatusToken,
} from "@/lib/home/projectStatusToken";
import { ClickPillCell } from "@/components/hq/ClickPillCell";
import { formatShortDate } from "@/lib/hq/dates";
import { toast } from "@/hooks/use-toast";

/**
 * Surface 13 Tasks list + board. Wireframe-fidelity rebuild (Phase 5.2.1
 * Revision) consuming the lifted .tbl + .board + .filterbar + .viewswitch
 * classes through the rewritten data components. Wireframe lines
 * 2185-2367.
 */

// `assigneeId` is hidden from the + Add filter popover (its add-popover
// input would be a raw UUID text box, which isn't usable). The default
// "Me" chip is constructed in code below; FilterBar still needs the def
// to resolve the chip's label.
const FILTER_FIELDS = [
  { key: "status", label: "Status", type: "enum" as const, options: TASK_STATUS_VALUES },
  { key: "priority", label: "Priority", type: "enum" as const, options: TASK_PRIORITY_VALUES },
  { key: "assigneeId", label: "Assignee", type: "user" as const, hidden: true },
  { key: "assigneeName", label: "Assignee name", type: "text" as const },
  { key: "projectName", label: "Project", type: "text" as const },
];

function priorityTokenClass(p: TaskPriority): string {
  return `pill pill-sm p-${taskPriorityToken(p)}`;
}

export default function TasksList({ view }: { view: ViewKind }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [rows, setRows] = useState<TaskListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterState, setFilterState] = useState<FilterState>(() => ({
    connector: "AND",
    chips: [],
  }));
  const [activeViewName, setActiveViewName] = useState("My open tasks");
  const [quickAdd, setQuickAdd] = useState("");
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [blockedTitles, setBlockedTitles] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadTasks().then((r) => {
      if (active) {
        setRows(r);
        setLoading(false);
        if (user?.id) {
          setFilterState({
            connector: "AND",
            chips: [
              // "Me" resolves to auth.uid() via applyFilters context (Revision NIT 3).
              { field: "assigneeId", op: "is", value: "Me" },
              { field: "status", op: "is not", value: "Done" },
            ],
          });
        }
        const ids = new Set<string>();
        for (const t of r) for (const b of t.blocked_by) ids.add(b);
        if (ids.size > 0) {
          supabase
            .from("tasks")
            .select("id, title")
            .in("id", Array.from(ids))
            .then(({ data }) => {
              if (!active) return;
              const map: Record<string, string> = {};
              for (const t of data ?? []) map[t.id] = t.title;
              setBlockedTitles(map);
            });
        }
      }
    });
    return () => {
      active = false;
    };
  }, [user?.id, user?.email]);

  useEffect(() => {
    const ch = supabase
      .channel("tasks-list-realtime")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "tasks" },
        (payload) => {
          const next = payload.new as { id: string; status: TaskStatus };
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

  const flatRows = useMemo(() => {
    return rows.map((t) => ({
      ...t,
      // `assigneeId` is a flat string for the `assigneeId is Me` chip;
      // distinct key so we don't shadow the nested `assignee` object the
      // board card reads at render time.
      assigneeId: t.assignee?.id ?? "",
      assigneeName: t.assignee?.full_name ?? t.assignee?.email ?? "",
      projectName: t.project?.name ?? "",
      clientName: t.project?.client?.name ?? "",
    }));
  }, [rows]);

  const filtered = useMemo(
    () =>
      applyFilters(
        flatRows,
        filterState,
        (row, key) => {
          const v = (row as unknown as Record<string, unknown>)[key];
          if (v == null) return null;
          return typeof v === "string" ? v : String(v);
        },
        { meUserId: user?.id ?? null },
      ),
    [flatRows, filterState, user?.id],
  );

  const handleQuickAdd = async () => {
    if (!quickAdd.trim() || !user?.id) return;
    setAdding(true);
    const { data, error } = await supabase
      .from("tasks")
      .insert({
        title: quickAdd.trim(),
        assignee_id: user.id,
        created_by: user.id,
        status: "To Do",
        priority: "Normal",
      })
      .select(
        `id, title, description, status, priority, due_date, blocked_by,
         project:projects(id, name, client:clients(id, name)),
         assignee:users!tasks_assignee_id_fkey(id, full_name, email)`,
      )
      .single();
    setAdding(false);
    if (error) {
      toast({ title: "Add failed", description: error.message, variant: "destructive" });
      return;
    }
    setRows((rs) => [data as unknown as TaskListRow, ...rs]);
    setQuickAdd("");
  };

  const handleBoardMove = async (task: TaskListRow, _from: string, to: string) => {
    const next = to as TaskStatus;
    setRows((rs) =>
      rs.map((r) => (r.id === task.id ? { ...r, status: next } : r)),
    );
    try {
      await updateTaskStatus(task.id, next);
    } catch (err) {
      console.error("task status update failed", err);
      setRows((rs) =>
        rs.map((r) => (r.id === task.id ? { ...r, status: task.status } : r)),
      );
    }
  };

  return (
    <div className="stack-4">
      <div className="pagehead">
        <div className="row between">
          <h1 className="h-page">Tasks</h1>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => navigate("/tasks/new")}
          >
            <IconPlus className="ic" />
            New Task
          </button>
        </div>
        <p className="desc">Default view: my open tasks across every project.</p>
      </div>

      <div className="row between wrap" style={{ alignItems: "center" }}>
        <div className="row-c">
          <ViewSwitch active={view} available={["list", "board", "calendar"]} surface="tasks" />
          <SavedViewsDropdown
            entityType="task"
            activeName={activeViewName}
            activeViewKind={view}
            activeFilterState={filterState}
            onPick={(v) => {
              setFilterState(v.filter_state);
              setActiveViewName(v.name);
            }}
            onNavigate={(kind) => {
              const target = viewSwitchRoute("tasks", kind);
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

      {view === "list" ? (
        <div
          className="row-c"
          style={{
            background: "hsl(var(--surface-alt))",
            border: "1px dashed hsl(var(--border-strong))",
            borderRadius: "var(--radius)",
            padding: "8px 12px",
          }}
        >
          <span className="checkbox" />
          <input
            className="input"
            style={{ height: 30, border: "none", background: "none", padding: 0 }}
            value={quickAdd}
            onChange={(e) => setQuickAdd(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleQuickAdd()}
            placeholder="Add a task and press Enter..."
            disabled={adding}
          />
          <span className="cap" style={{ marginLeft: "auto" }}>
            Project optional
          </span>
        </div>
      ) : null}

      {loading ? (
        <div className="empty">
          <p>Loading...</p>
        </div>
      ) : view === "list" ? (
        <DataTable<typeof filtered[number]>
          rows={filtered}
          flat
          rowBorderToken={(r) => taskStatusToken(r.status)}
          onRowClick={(r) => navigate(`/tasks/${r.id}`)}
          selection={{ selectedIds: selected, onChange: setSelected }}
          twoTier={{
            isTerminal: (r) => r.status === "Done",
            dividerLabel: (n) => `Done · ${n} hidden`,
          }}
          empty={{
            message: "No tasks match these filters",
            ctaLabel: "+ New Task",
            onCta: () => navigate("/tasks/new"),
          }}
          columns={[
            {
              key: "title",
              label: "Task",
              sort: (a, b) => a.title.localeCompare(b.title),
              render: (r) => (
                <span className={`lead ${statusTextDecoration("task", r.status)}`}>
                  {r.title}
                </span>
              ),
            },
            {
              key: "project",
              label: "Project / Client",
              sort: (a, b) => a.projectName.localeCompare(b.projectName),
              render: (r) =>
                r.project ? (
                  <div>
                    {r.project.client ? (
                      <Link
                        to={`/clients/${r.project.client.id}`}
                        className="sub"
                        style={{ color: "rgba(190,78,68,0.85)", display: "block" }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {r.project.client.name}
                      </Link>
                    ) : null}
                    <Link
                      to={`/projects/${r.project.id}`}
                      className="lead"
                      style={{ display: "block" }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {r.project.name}
                    </Link>
                  </div>
                ) : (
                  <span className="subtle">-</span>
                ),
            },
            {
              key: "assigneeName",
              label: "Assignee",
              sort: (a, b) => a.assigneeName.localeCompare(b.assigneeName),
              render: (r) => r.assigneeName || "-",
            },
            {
              key: "status",
              label: "Status",
              sort: (a, b) => a.status.localeCompare(b.status),
              render: (r) => (
                <ClickPillCell
                  value={r.status}
                  options={TASK_STATUS_VALUES}
                  tokenMap={taskStatusToken}
                  onSave={async (next) => {
                    await updateTaskStatus(r.id, next as TaskStatus);
                    setRows((rs) =>
                      rs.map((row) =>
                        row.id === r.id ? { ...row, status: next as TaskStatus } : row,
                      ),
                    );
                  }}
                />
              ),
            },
            {
              key: "priority",
              label: "Priority",
              sort: (a, b) => a.priority.localeCompare(b.priority),
              render: (r) => (
                <ClickPillCell
                  value={r.priority}
                  options={TASK_PRIORITY_VALUES}
                  tokenMap={taskPriorityToken}
                  onSave={async (next) => {
                    await updateTaskPriority(r.id, next as TaskPriority);
                    setRows((rs) =>
                      rs.map((row) =>
                        row.id === r.id ? { ...row, priority: next as TaskPriority } : row,
                      ),
                    );
                  }}
                />
              ),
            },
            {
              key: "notesblocks",
              label: "Notes / Blocks",
              render: (r) => (
                <div
                  className="muted"
                  style={{ fontSize: 11.5, maxWidth: 260 }}
                >
                  {r.description ? (
                    <div
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {r.description}
                    </div>
                  ) : null}
                  {r.blocked_by.length > 0 ? (
                    <div style={{ color: "hsl(var(--destructive))" }}>
                      Blocked by:{" "}
                      {r.blocked_by
                        .map((id) => blockedTitles[id] ?? id.slice(0, 6))
                        .join(", ")}
                    </div>
                  ) : null}
                  {!r.description && r.blocked_by.length === 0 ? "-" : null}
                </div>
              ),
            },
            {
              key: "due_date",
              label: "Due",
              align: "r",
              sort: (a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""),
              render: (r) =>
                r.due_date ? (
                  <span className="mono">{formatShortDate(r.due_date)}</span>
                ) : (
                  "-"
                ),
            },
          ]}
        />
      ) : view === "board" ? (
        <BoardView<TaskListRow>
          layout="horizontal"
          rows={[
            {
              label: "By Status",
              columns: TASK_STATUS_VALUES.map((s): BoardColumn<TaskListRow> => ({
                id: s,
                label: s,
                token: taskStatusToken(s),
                rows: filtered.filter((r) => r.status === s),
                addLabel: s === "To Do" ? "+ Add task" : undefined,
                onAdd: s === "To Do" ? () => navigate("/tasks/new") : undefined,
              })),
            },
          ]}
          onCardMove={handleBoardMove}
          onCardClick={(r) => navigate(`/tasks/${r.id}`)}
          renderCard={(r) => (
            <>
              <div className="row between" style={{ alignItems: "flex-start", gap: 8 }}>
                <div className={`nm flex1 ${statusTextDecoration("task", r.status)}`}>
                  {r.title}
                </div>
                <div style={{ textAlign: "right", flex: "none" }}>
                  <div className="cap" style={{ lineHeight: 1.2 }}>
                    {r.due_date ? formatShortDate(r.due_date) : ""}
                  </div>
                  <div className="cap muted" style={{ lineHeight: 1.2, marginTop: 2 }}>
                    {r.assignee?.full_name?.split(" ")[0] ??
                      r.assignee?.email?.split("@")[0] ??
                      ""}
                  </div>
                </div>
              </div>
              <div
                className="row-c wrap"
                style={{ marginTop: 9 }}
              >
                <span className={priorityTokenClass(r.priority)}>{r.priority}</span>
                <span className="cap">
                  {r.project?.name ? r.project.name : "No project"}
                </span>
              </div>
              {r.status === "Blocked" && r.blocked_by[0] ? (
                <div
                  className="cap"
                  style={{ marginTop: 7, color: "hsl(var(--destructive))" }}
                >
                  Blocked by:{" "}
                  {blockedTitles[r.blocked_by[0]] ?? r.blocked_by[0].slice(0, 6)}
                </div>
              ) : null}
            </>
          )}
        />
      ) : null}
    </div>
  );
}
