import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { backState } from "@/lib/hq/useBackHref";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
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
import { daysUntil, deliverableDueLabel, formatShortDate } from "@/lib/hq/dates";

/**
 * Surface 14 Deliverables list / board / calendar. Wireframe-fidelity
 * rebuild (Phase 5.2.1 Revision); calendar is the default view per build
 * notes Surface 14. Board layout flipped to one-column-per-project per
 * revision spec § 4.C.2 (was rows-per-project in original 5.2.1; code-
 * reviewer C2 from that pass).
 */

// Phase 5.7.6 follow-up: ordered to match the visual layout — each
// subgroup header reads client (coral, left) then project (white bold,
// next), and the per-group DataTable's only filterable column is Status
// at the right.
const FILTER_FIELDS = [
  { key: "clientName", label: "Client", type: "text" as const },
  { key: "projectName", label: "Project", type: "text" as const },
  { key: "status", label: "Status", type: "enum" as const, options: DELIVERABLE_STATUS_VALUES },
];

// Maps deliverable_status -> calendar event banner class per spec § 2.G.
function calendarKind(status: DeliverableStatus): CalendarEventKind {
  switch (status) {
    case "Complete": return "del";
    case "Upcoming": return "rem";
    case "Skipped": return "plain";
  }
}

const FROM_LABEL = "Deliverables";

export default function DeliverablesList({ view }: { view: ViewKind }) {
  const navigate = useNavigate();
  const location = useLocation();
  const fromState = backState(location, FROM_LABEL);
  const { user } = useAuth();
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

  // Phase 5.7.6: distinct values per text/enum filter field, derived
  // from the current page's rows. FilterBar swaps its text/enum value-
  // step input for a searchable combobox listing exactly these values.
  const distinctValuesByField = useMemo(() => {
    const pick = (key: string) =>
      Array.from(
        new Set(
          flat
            .map((r) => (r as unknown as Record<string, unknown>)[key])
            .filter((v): v is string => typeof v === "string" && v.length > 0),
        ),
      ).sort();
    return {
      status: pick("status"),
      projectName: pick("projectName"),
      clientName: pick("clientName"),
    };
  }, [flat]);

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
          Every dated project checkpoint. Board is the default view.
        </p>
      </div>

      <div className="row between wrap" style={{ alignItems: "center" }}>
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

      <FilterBar
        state={filterState}
        onChange={(next) => {
          setFilterState(next);
          setActiveViewName("Custom filter");
        }}
        fields={FILTER_FIELDS}
        distinctValuesByField={distinctValuesByField}
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
        <DeliverablesGroupedList
          rows={filtered}
          createdBy={user?.id ?? null}
          onRowClick={(r) =>
            navigate(`/deliverables/${r.id}`, { state: { from: fromState } })
          }
          onStatusChange={(id, next) => {
            setRows((rs) =>
              rs.map((row) =>
                row.id === id ? { ...row, status: next } : row,
              ),
            );
          }}
          onCreated={() => {
            // Realtime INSERT handler will refresh; fall back to a refetch
            // in case Realtime is slow or filtered out.
            loadDeliverables().then(setRows);
          }}
          onNew={() => navigate("/deliverables/new")}
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
 * Phase 5.7.5 follow-up round 1: card background color scale.
 * - Complete -> muted green
 * - Skipped  -> muted grey (strikethrough applied via statusTextDecoration)
 * - Upcoming + due ≤ 7 days (includes overdue / negative) -> coral
 * - Upcoming + 7 < due ≤ 14 days -> amber
 * - Upcoming + due > 14 days OR no due date -> grey
 */
function deliverableCardBgClass(
  status: DeliverableStatus,
  dueDate: string | null,
): string {
  if (status === "Complete") return "bcard--bg-green";
  if (status === "Skipped") return "bcard--bg-skipped";
  const n = daysUntil(dueDate);
  if (n === null) return "bcard--bg-grey";
  if (n <= 7) return "bcard--bg-coral";
  if (n <= 14) return "bcard--bg-amber";
  return "bcard--bg-grey";
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
  const columns: BoardColumn<DeliverableListRow>[] = Array.from(grouped.values()).map((g) => {
    const sample = g.rows[0];
    const client = sample?.project?.client ?? null;
    return {
      id: g.id,
      label: g.name,
      labelExtra: client ? (
        <Link
          to={`/clients/${client.id}`}
          className="tlink"
          style={{ color: "rgba(190,78,68,.85)", fontSize: 11 }}
          onClick={(e) => e.stopPropagation()}
        >
          {client.name}
        </Link>
      ) : null,
      rows: g.rows.sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? "")),
    };
  });

  return (
    <BoardView<DeliverableListRow>
      layout="horizontal"
      rows={[{ label: "By Project", columns }]}
      onCardClick={onClick}
      cardClassName={(r) => deliverableCardBgClass(r.status, r.due_date)}
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
          <div className="cap" style={{ marginTop: 9 }}>
            {deliverableDueLabel({
              dueDate: r.due_date,
              status: r.status,
              completedAt: r.completed_at,
            })}
          </div>
        </>
      )}
    />
  );
}

/**
 * Phase 5.7.5 § 5.C (+ follow-up round 2): grouped list. One DataTable
 * per project, with a section header above each. Columns: Title / Due
 * (relative subcell) / Due (date subcell) / Status. The two Due
 * subcells share a merged "Due" group header via the new Column.group
 * field. Subgroup header drops the count caption and renders a coral
 * "+" quick-add affordance instead — click prepends a draft row to the
 * project's table with an inline title input; Enter / blur-with-value
 * commits an INSERT, Escape / blur-empty cancels.
 *
 * Sort is per-group internal (DataTable's uncontrolled mode). Saved-view
 * sort persistence intentionally does NOT apply to the grouped list view.
 */
function DeliverablesGroupedList({
  rows,
  createdBy,
  onRowClick,
  onStatusChange,
  onCreated,
  onNew,
}: {
  rows: (DeliverableListRow & { projectName: string; clientName: string })[];
  createdBy: string | null;
  onRowClick: (row: DeliverableListRow) => void;
  onStatusChange: (id: string, next: DeliverableStatus) => void;
  onCreated: () => void;
  onNew: () => void;
}) {
  // Draft state keyed by group id (== project id for normal projects,
  // "__none" for orphans). Value is the in-progress title text.
  const [drafts, setDrafts] = useState<Map<string, string>>(new Map());
  const [pendingGroupIds, setPendingGroupIds] = useState<Set<string>>(new Set());

  type Row = (typeof rows)[number];
  type Group = {
    id: string;
    project: { id: string; name: string; client: { id: string; name: string | null } | null } | null;
    rows: Row[];
  };

  const draftIdFor = (groupId: string) => `__draft-${groupId}`;

  const startDraft = (groupId: string) => {
    setDrafts((prev) => {
      const next = new Map(prev);
      next.set(groupId, "");
      return next;
    });
  };

  const cancelDraft = (groupId: string) => {
    setDrafts((prev) => {
      const next = new Map(prev);
      next.delete(groupId);
      return next;
    });
  };

  const commitDraft = async (groupId: string, projectId: string | null) => {
    const title = (drafts.get(groupId) ?? "").trim();
    if (!title) {
      cancelDraft(groupId);
      return;
    }
    if (!createdBy || !projectId) {
      // Can't quick-add without a project FK (orphan group) or auth user.
      // Fall back to the normal Edit page flow.
      cancelDraft(groupId);
      onNew();
      return;
    }
    setPendingGroupIds((p) => new Set(p).add(groupId));
    const { error } = await supabase
      .from("deliverables")
      .insert({
        title,
        project_id: projectId,
        status: "Upcoming",
        created_by: createdBy,
      });
    setPendingGroupIds((p) => {
      const next = new Set(p);
      next.delete(groupId);
      return next;
    });
    if (error) {
      toast({
        title: "Could not create deliverable",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    cancelDraft(groupId);
    onCreated();
  };

  if (rows.length === 0 && drafts.size === 0) {
    return (
      <div className="empty">
        <p>No deliverables yet</p>
        <button type="button" className="btn btn-primary" onClick={onNew}>
          + New Deliverable
        </button>
      </div>
    );
  }

  const groupedMap = new Map<string, Group>();
  for (const r of rows) {
    const pid = r.project?.id ?? "__none";
    if (!groupedMap.has(pid)) {
      groupedMap.set(pid, { id: pid, project: r.project, rows: [] });
    }
    groupedMap.get(pid)!.rows.push(r);
  }
  // A draft in a group with no existing rows means we still need to
  // render that group (orphans can't quick-add but normal projects can).
  for (const gid of drafts.keys()) {
    if (!groupedMap.has(gid)) continue; // safety: drafts always pre-exist a group
  }
  const groups = Array.from(groupedMap.values()).sort((a, b) =>
    (a.project?.name ?? "").localeCompare(b.project?.name ?? ""),
  );

  return (
    <div className="stack-6">
      {groups.map((group) => {
        const draftTitle = drafts.get(group.id);
        const hasDraft = draftTitle !== undefined;
        const isPending = pendingGroupIds.has(group.id);

        // Synthetic draft row prepended so the input renders inline as
        // the first table row. The draft id has the __draft- prefix so
        // the Title column's render() can switch into input mode.
        const draftRow: Row | null = hasDraft
          ? ({
              id: draftIdFor(group.id),
              title: "",
              status: "Upcoming",
              due_date: null,
              completed_at: null,
              assigned_user_ids: [],
              notes: null,
              project: group.project,
              projectName: group.project?.name ?? "",
              clientName: group.project?.client?.name ?? "",
            } as Row)
          : null;
        const tableRows: Row[] = draftRow ? [draftRow, ...group.rows] : group.rows;

        const isDraftRow = (r: Row) => r.id === draftIdFor(group.id);

        return (
          <div key={group.id} className="stack-3">
            <div
              className="row-c"
              style={{
                gap: 12,
                alignItems: "baseline",
                borderBottom: "1px solid hsl(var(--border))",
                paddingBottom: 6,
              }}
            >
              {group.project?.client ? (
                <Link
                  to={`/clients/${group.project.client.id}`}
                  className="tlink"
                  style={{ color: "rgba(190,78,68,.85)", fontSize: 11.5 }}
                >
                  {group.project.client.name}
                </Link>
              ) : null}
              {group.project ? (
                <Link
                  to={`/projects/${group.project.id}`}
                  style={{
                    color: "hsl(var(--foreground))",
                    fontWeight: 700,
                    fontSize: 14,
                    textDecoration: "none",
                  }}
                >
                  {group.project.name}
                </Link>
              ) : (
                <span
                  style={{
                    color: "hsl(var(--foreground))",
                    fontWeight: 700,
                    fontSize: 14,
                  }}
                >
                  (no project)
                </span>
              )}
              {group.project ? (
                <button
                  type="button"
                  className="btn-quickadd"
                  aria-label={`Add deliverable to ${group.project.name}`}
                  title="Add deliverable"
                  onClick={() => startDraft(group.id)}
                  disabled={hasDraft}
                  style={{ marginLeft: "auto" }}
                >
                  <IconPlus
                    className="ic"
                    style={{ width: 14, height: 14 }}
                    strokeWidth={4.5}
                  />
                </button>
              ) : null}
            </div>
            <DataTable<Row>
              rows={tableRows}
              flat
              rowBorderToken={(r) => deliverableStatusToken(r.status)}
              onRowClick={(r) => {
                if (isDraftRow(r)) return;
                onRowClick(r);
              }}
              columns={[
                {
                  key: "title",
                  label: "Title",
                  sort: (a, b) => a.title.localeCompare(b.title),
                  render: (r) =>
                    isDraftRow(r) ? (
                      <input
                        autoFocus
                        className="input"
                        value={drafts.get(group.id) ?? ""}
                        placeholder="Venues Deck, Design R1 Deck..."
                        disabled={isPending}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          const v = e.target.value;
                          setDrafts((prev) => {
                            const next = new Map(prev);
                            next.set(group.id, v);
                            return next;
                          });
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void commitDraft(group.id, group.project?.id ?? null);
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            cancelDraft(group.id);
                          }
                        }}
                        onBlur={() => {
                          // Blur with content commits; blur with empty cancels.
                          void commitDraft(group.id, group.project?.id ?? null);
                        }}
                        style={{
                          height: 28,
                          padding: "0 6px",
                          background: "rgba(190,78,68,.08)",
                          border: "1px solid transparent",
                          width: "100%",
                        }}
                      />
                    ) : (
                      <span
                        className={`lead ${statusTextDecoration("deliverable", r.status)}`}
                      >
                        {r.title}
                      </span>
                    ),
                },
                {
                  key: "due_relative",
                  label: "",
                  group: "Due",
                  align: "c",
                  width: 160,
                  sort: (a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""),
                  render: (r) =>
                    isDraftRow(r) ? (
                      <span className="muted subtle">-</span>
                    ) : r.status === "Complete" || r.status === "Skipped" ? (
                      <span className="muted subtle">-</span>
                    ) : (
                      <span className="muted" style={{ fontSize: 12 }}>
                        {deliverableDueLabel({
                          dueDate: r.due_date,
                          status: r.status,
                          completedAt: r.completed_at,
                        }) || "-"}
                      </span>
                    ),
                },
                {
                  key: "due_date",
                  label: "",
                  group: "Due",
                  align: "c",
                  width: 110,
                  sort: (a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""),
                  render: (r) =>
                    isDraftRow(r) ? (
                      <span className="muted subtle">-</span>
                    ) : r.due_date ? (
                      <span className="mono" style={{ fontSize: 12 }}>
                        {formatShortDate(r.due_date)}
                      </span>
                    ) : (
                      <span className="muted subtle">-</span>
                    ),
                },
                {
                  key: "status",
                  label: "Status",
                  width: 140,
                  sort: (a, b) => a.status.localeCompare(b.status),
                  render: (r) =>
                    isDraftRow(r) ? (
                      <span className="muted subtle">Upcoming</span>
                    ) : (
                      <ClickPillCell
                        value={r.status}
                        options={DELIVERABLE_STATUS_VALUES}
                        tokenMap={deliverableStatusToken}
                        onSave={async (next) => {
                          await updateDeliverableStatus(r.id, next as DeliverableStatus);
                          onStatusChange(r.id, next as DeliverableStatus);
                        }}
                      />
                    ),
                },
              ]}
            />
          </div>
        );
      })}
    </div>
  );
}
