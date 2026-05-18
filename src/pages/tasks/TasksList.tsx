import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { backState } from "@/lib/hq/useBackHref";
import { ViewSwitch, viewSwitchRoute, type ViewKind } from "@/components/data/ViewSwitch";
import { FilterBar, type FilterState } from "@/components/data/FilterBar";
import { SavedViewsDropdown } from "@/components/data/SavedViewsDropdown";
import { getDefaultSavedView } from "@/lib/hq/savedViews";
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
import { InlineEditText } from "@/components/hq/InlineEditText";
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
// Phase 5.7.6 follow-up: ordered to match the list-view DataTable
// column display order (title, project, assigneeName, status, priority,
// notesblocks, due_date). title isn't filterable; the hidden assigneeId
// chip backs the "Me" filter and stays last (not user-visible).
const FILTER_FIELDS = [
  { key: "projectName", label: "Project", type: "text" as const },
  { key: "assigneeName", label: "Assignee name", type: "text" as const },
  { key: "status", label: "Status", type: "enum" as const, options: TASK_STATUS_VALUES },
  { key: "priority", label: "Priority", type: "enum" as const, options: TASK_PRIORITY_VALUES },
  { key: "assigneeId", label: "Assignee", type: "user" as const, hidden: true },
];

function priorityTokenClass(p: TaskPriority): string {
  return `pill pill-sm p-${taskPriorityToken(p)}`;
}

const FROM_LABEL = "Tasks";

export default function TasksList({ view }: { view: ViewKind }) {
  const navigate = useNavigate();
  const location = useLocation();
  const fromState = backState(location, FROM_LABEL);
  const { user } = useAuth();
  const [rows, setRows] = useState<TaskListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterState, setFilterState] = useState<FilterState>(() => ({
    connector: "AND",
    chips: [],
  }));
  const [activeViewName, setActiveViewName] = useState("My open tasks");
  const [adding, setAdding] = useState(false);
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);
  const [blockedTitles, setBlockedTitles] = useState<Record<string, string>>({});
  /**
   * Phase 5.6.5: tracks whether the on-mount default-view resolution
   * picked up a saved view. The legacy "My open tasks" baseline only
   * applies when no per-user or global default exists.
   */
  const savedViewAppliedRef = useRef(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadTasks().then((r) => {
      if (active) {
        setRows(r);
        setLoading(false);
        if (user?.id && !savedViewAppliedRef.current) {
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

  // Phase 5.6.5: resolve default saved view on mount. Per-user wins,
  // then global. When applied, set a ref so the loadTasks completion
  // doesn't overwrite with the "My open tasks" baseline.
  useEffect(() => {
    let active = true;
    getDefaultSavedView("task").then((v) => {
      if (!active || !v) return;
      savedViewAppliedRef.current = true;
      setFilterState(v.filter_state);
      setActiveViewName(v.name);
    });
    return () => {
      active = false;
    };
  }, []);


  const handleResetToGlobal = async () => {
    const v = await getDefaultSavedView("task");
    if (v) {
      savedViewAppliedRef.current = true;
      setFilterState(v.filter_state);
      setActiveViewName(v.name);
    } else {
      savedViewAppliedRef.current = false;
      // Fall back to the "My open tasks" baseline when signed in;
      // otherwise an empty filter.
      if (user?.id) {
        setFilterState({
          connector: "AND",
          chips: [
            { field: "assigneeId", op: "is", value: "Me" },
            { field: "status", op: "is not", value: "Done" },
          ],
        });
        setActiveViewName("My open tasks");
      } else {
        setFilterState({ connector: "AND", chips: [] });
        setActiveViewName("All tasks");
      }
    }
  };

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

  // Phase 5.7.6: distinct values per text/enum filter field.
  const distinctValuesByField = useMemo(() => {
    const pick = (key: string) =>
      Array.from(
        new Set(
          flatRows
            .map((r) => (r as unknown as Record<string, unknown>)[key])
            .filter((v): v is string => typeof v === "string" && v.length > 0),
        ),
      ).sort();
    return {
      status: pick("status"),
      priority: pick("priority"),
      assigneeName: pick("assigneeName"),
      projectName: pick("projectName"),
    };
  }, [flatRows]);

  // Phase 5.7.7 followup-1: the quick-add now lives as an inline row at
  // the bottom of the DataTable's active section. One click inserts a
  // draft task with sensible defaults; the user then edits inline (Status
  // / Priority via ClickPillCell) or clicks through to TaskDetail for
  // title / project / due-date / description edits.
  const handleQuickAdd = async () => {
    if (!user?.id) return;
    setAdding(true);
    const { data, error } = await supabase
      .from("tasks")
      .insert({
        title: "",
        assignee_id: user.id,
        created_by: user.id,
        status: "To Do",
        priority: "Normal",
      })
      .select(
        `id, title, description, status, priority, due_date, blocked_by,
         project:projects!tasks_project_id_fkey(id, name, client:clients!projects_client_id_fkey(id, name)),
         assignee:users!tasks_assignee_id_fkey(id, full_name, email)`,
      )
      .single();
    setAdding(false);
    if (error) {
      toast({ title: "Add failed", description: error.message, variant: "destructive" });
      return;
    }
    // Append at the bottom of the active list (the quick-add row sits
    // just below); flag pendingFocusId so the title cell mounts already
    // in edit mode with focus.
    setRows((rs) => [...rs, data as unknown as TaskListRow]);
    setPendingFocusId((data as { id: string }).id);
  };

  const saveTaskTitle = async (taskId: string, next: string) => {
    const { error } = await supabase
      .from("tasks")
      .update({ title: next })
      .eq("id", taskId);
    if (error) throw error;
    setRows((rs) =>
      rs.map((r) => (r.id === taskId ? { ...r, title: next } : r)),
    );
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
      <div className="row between" style={{ alignItems: "flex-end" }}>
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

      <ViewSwitch active={view} available={["list", "board"]} surface="tasks" />

      <div className="row between wrap" style={{ alignItems: "center" }}>
        <FilterBar
          state={filterState}
          onChange={(next) => {
            setFilterState(next);
            setActiveViewName("Custom filter");
          }}
          fields={FILTER_FIELDS}
          distinctValuesByField={distinctValuesByField}
          allowIsNot
        />
        <SavedViewsDropdown
          entityType="task"
          activeName={activeViewName}
          activeViewKind={view}
          activeFilterState={filterState}
          onPick={(v) => {
            savedViewAppliedRef.current = true;
            setFilterState(v.filter_state);
            setActiveViewName(v.name);
          }}
          onNavigate={(kind) => {
            const target = viewSwitchRoute("tasks", kind);
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
        <DataTable<typeof filtered[number]>
          rows={filtered}
          flat
          sort={filterState.sort ?? null}
          onSortChange={(next) =>
            setFilterState((prev) => ({ ...prev, sort: next }))
          }
          rowBorderToken={(r) => taskStatusToken(r.status)}
          onRowClick={(r) => navigate(`/tasks/${r.id}`, { state: { from: fromState } })}
          twoTier={{
            isTerminal: (r) => r.status === "Done",
            dividerLabel: (n) => `Done · ${n} hidden`,
          }}
          quickAdd={{
            label: "Click to Quick Add Task",
            onClick: handleQuickAdd,
            disabled: adding,
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
                <span
                  className={`lead ${statusTextDecoration("task", r.status)}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <InlineEditText
                    value={r.title}
                    required
                    defaultEditing={pendingFocusId === r.id}
                    onEditingChange={(editing) => {
                      if (!editing && pendingFocusId === r.id) {
                        setPendingFocusId(null);
                      }
                    }}
                    placeholder="Untitled task"
                    renderRead={(v) => <span>{v || "Untitled task"}</span>}
                    onSave={(next) => saveTaskTitle(r.id, next)}
                  />
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
                        state={{ from: fromState }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {r.project.client.name ?? "View client"}
                      </Link>
                    ) : null}
                    <Link
                      to={`/projects/${r.project.id}`}
                      className="lead"
                      style={{ display: "block" }}
                      state={{ from: fromState }}
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
              // 5.7.4 smoke followup: sort by displayed first name so sort
              // order matches what the user sees in the cell.
              sort: (a, b) =>
                (a.assigneeName.split(" ")[0] ?? "").localeCompare(
                  b.assigneeName.split(" ")[0] ?? "",
                ),
              render: (r) => (r.assigneeName ? r.assigneeName.split(" ")[0] : "-"),
            },
            {
              key: "status",
              label: "Status",
              align: "c",
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
              align: "c",
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
          onCardClick={(r) => navigate(`/tasks/${r.id}`, { state: { from: fromState } })}
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
                {r.project?.name ? (
                  <span className="cap">{r.project.name}</span>
                ) : null}
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
