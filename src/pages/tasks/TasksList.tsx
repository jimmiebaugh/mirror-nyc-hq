import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ViewSwitch, type ViewKind } from "@/components/data/ViewSwitch";
import { FilterBar, type FilterState } from "@/components/data/FilterBar";
import { SavedViewsDropdown } from "@/components/data/SavedViewsDropdown";
import { DataTable } from "@/components/data/DataTable";
import { BoardView, type BoardRow } from "@/components/data/BoardView";
import { applyFilters } from "@/lib/hq/filterStateApply";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  loadTasks,
  updateTaskStatus,
  TASK_PRIORITY_VALUES,
  TASK_STATUS_VALUES,
  type TaskListRow,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/tasks/queries";
import { taskStatusToken, statusTextDecoration } from "@/lib/home/projectStatusToken";
import { formatShortDate } from "@/lib/hq/dates";
import { toast } from "@/hooks/use-toast";

const FILTER_FIELDS = [
  { key: "status", label: "Status", type: "enum" as const, options: TASK_STATUS_VALUES },
  { key: "priority", label: "Priority", type: "enum" as const, options: TASK_PRIORITY_VALUES },
  { key: "assigneeName", label: "Assignee", type: "text" as const },
  { key: "projectName", label: "Project", type: "text" as const },
];

function priorityClass(p: TaskPriority): string {
  switch (p) {
    case "Urgent": return "hq-pill hq-pill--destructive";
    case "High": return "hq-pill hq-pill--warn";
    default: return "hq-pill hq-pill--muted";
  }
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
        // Set the "mine + not Done" default filter once we know who I am.
        if (user?.id) {
          setFilterState({
            connector: "AND",
            chips: [
              { field: "assigneeName", op: "contains", value: user.email ?? "" },
              { field: "status", op: "is not", value: "Done" },
            ],
          });
        }
        // Pre-resolve blocked_by titles so the Notes / Blocks cell can render.
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
          setRows((rs) => rs.map((r) => (r.id === next.id ? { ...r, status: next.status } : r)));
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
      assigneeName: t.assignee?.full_name ?? t.assignee?.email ?? "",
      projectName: t.project?.name ?? "",
      clientName: t.project?.client?.name ?? "",
    }));
  }, [rows]);

  const filtered = useMemo(
    () =>
      applyFilters(flatRows, filterState, (row, key) => {
        const v = (row as unknown as Record<string, unknown>)[key];
        if (v == null) return null;
        return typeof v === "string" ? v : String(v);
      }),
    [flatRows, filterState],
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
         assignee:users(id, full_name, email)`,
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
    setRows((rs) => rs.map((r) => (r.id === task.id ? { ...r, status: next } : r)));
    try {
      await updateTaskStatus(task.id, next);
    } catch (err) {
      console.error("task status update failed", err);
      setRows((rs) => rs.map((r) => (r.id === task.id ? { ...r, status: task.status } : r)));
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex items-center justify-between gap-3">
        <h1 className="h-page">Tasks</h1>
        <Button onClick={() => navigate("/tasks/new")}>+ New Task</Button>
      </header>

      <div className="hq-tbl-toolbar">
        <div className="flex items-center gap-3">
          <ViewSwitch active={view} surface="tasks" available={["list", "board", "calendar"]} />
          <SavedViewsDropdown
            entityType="task"
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
        entityType="task"
        state={filterState}
        onChange={(next) => {
          setFilterState(next);
          setActiveViewName("Custom filter");
        }}
        fields={FILTER_FIELDS}
      />

      {view === "list" ? (
        <div className="rounded-md border border-dashed border-[hsl(var(--border-strong))] p-3 flex items-center gap-3">
          <span className="inline-block h-[15px] w-[15px] rounded-[3px] border border-[hsl(var(--border-strong))]" />
          <Input
            value={quickAdd}
            onChange={(e) => setQuickAdd(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleQuickAdd()}
            placeholder="Quick add task..."
            disabled={adding}
            className="flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0"
          />
          <span className="text-[11px] font-mono uppercase tracking-widest text-[hsl(var(--subtle-foreground))]">
            Project optional
          </span>
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : view === "list" ? (
        <DataTable<typeof filtered[number]>
          rows={filtered}
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
                <span className={statusTextDecoration("task", r.status)}>{r.title}</span>
              ),
            },
            {
              key: "project",
              label: "Project / Client",
              sort: (a, b) => a.projectName.localeCompare(b.projectName),
              render: (r) => (
                <div>
                  {r.project ? (
                    <Link to={`/projects/${r.project.id}`} className="hq-tlink">
                      {r.project.name}
                    </Link>
                  ) : (
                    "-"
                  )}
                  {r.project?.client ? (
                    <Link
                      to={`/organizations/${r.project.client.id}`}
                      className="block text-[11px]"
                      style={{ color: "rgba(190,78,68,0.85)" }}
                    >
                      {r.project.client.name}
                    </Link>
                  ) : null}
                </div>
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
                <span className={`hq-pill hq-pill--${taskStatusToken(r.status)}`}>
                  <span className="hq-pill-dt" />
                  {r.status}
                </span>
              ),
            },
            {
              key: "priority",
              label: "Priority",
              sort: (a, b) => a.priority.localeCompare(b.priority),
              render: (r) => <span className={priorityClass(r.priority)}>{r.priority}</span>,
            },
            {
              key: "notesblocks",
              label: "Notes / Blocks",
              render: (r) => (
                <div className="text-[11.5px] text-[hsl(var(--muted-foreground))] max-w-[260px]">
                  {r.description ? <div className="truncate">{r.description}</div> : null}
                  {r.blocked_by.length > 0 ? (
                    <div className="text-[hsl(var(--destructive))]">
                      Blocked by:{" "}
                      {r.blocked_by.map((id) => blockedTitles[id] ?? id.slice(0, 6)).join(", ")}
                    </div>
                  ) : null}
                  {!r.description && r.blocked_by.length === 0 ? "-" : null}
                </div>
              ),
            },
            {
              key: "due_date",
              label: "Due",
              align: "right",
              sort: (a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""),
              render: (r) => (r.due_date ? formatShortDate(r.due_date) : "-"),
            },
          ]}
        />
      ) : view === "board" ? (
        <BoardView<TaskListRow>
          rows={[
            {
              label: "By Status",
              columns: TASK_STATUS_VALUES.map((s): BoardRow<TaskListRow>["columns"][number] => ({
                id: s,
                label: s,
                token: taskStatusToken(s),
                rows: filtered.filter((r) => r.status === s),
              })),
            },
          ]}
          onCardMove={handleBoardMove}
          onCardClick={(r) => navigate(`/tasks/${r.id}`)}
          renderCard={(r) => (
            <div>
              <div className="hq-board-card-row">
                <span className={`font-medium ${statusTextDecoration("task", r.status)}`}>
                  {r.title}
                </span>
              </div>
              <div className="hq-board-card-row">
                <span className="hq-board-card-sub">
                  {r.project?.name ? r.project.name : "No project"}
                </span>
                <span className="hq-board-card-sub">
                  {r.due_date ? formatShortDate(r.due_date) : ""}
                </span>
              </div>
              <div className="hq-board-card-row">
                <span className={priorityClass(r.priority)}>{r.priority}</span>
                <span className="hq-board-card-sub">
                  {r.assignee?.full_name?.split(" ")[0] ?? r.assignee?.email?.split("@")[0] ?? ""}
                </span>
              </div>
              {r.status === "Blocked" && r.blocked_by[0] ? (
                <div className="hq-board-card-row text-[11px] text-[hsl(var(--destructive))]">
                  Blocked by: {blockedTitles[r.blocked_by[0]] ?? r.blocked_by[0].slice(0, 6)}
                </div>
              ) : null}
            </div>
          )}
        />
      ) : null}
    </div>
  );
}
