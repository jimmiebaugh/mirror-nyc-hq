import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarMonthView,
  type CalendarEvent,
} from "@/components/data/CalendarMonthView";
import { CalendarDayView } from "@/components/data/CalendarDayView";
import { CalendarWeekView } from "@/components/data/CalendarWeekView";
import {
  CalendarVisibilityPanel,
  type VisibilityProject,
} from "@/components/calendar/VisibilityPanel";
import {
  IconArrowLeft,
  IconChevronRight,
} from "@/components/icons/HQIcons";
import {
  loadCalendarProjects,
  loadCalendarDeliverables,
  loadCalendarTasks,
} from "@/lib/calendar/queries";
import { useMirrorHolidays } from "@/lib/calendar/holidays";
import {
  useCalendarVisibility,
  type CalendarSource,
  type CalendarViewKind,
} from "@/lib/calendar/useCalendarVisibility";
import { useUserRole } from "@/hooks/useUserRole";
import { supabase } from "@/integrations/supabase/client";
import { hasGlobalDefault } from "@/lib/hq/savedViews";
import { toast } from "@/hooks/use-toast";
import { addDays, addMonths, startOfWeek } from "@/lib/hq/dates";

/**
 * Surface 15 unified Calendar.
 * Wireframe binding: OUTPUTS/phase-5-hq-wireframe-v1-LOCKED.html
 * Surface 15 (Calendar). Spec: OUTPUTS/phase-5-3-spec.md § 4a.
 *
 * Pulls Install / Live / Removal date ranges from projects + due dates
 * from deliverables + shared Outlook entries + Mirror Holidays. Right rail
 * carries master + per-project visibility toggles persisted per user via
 * the `saved_views` row (entity_type='calendar', name='__calendar_default').
 *
 * Filter chips (Lead / Category) stay component-local; the visibility
 * toggles persist. Behavior nuances locked-decisions § 3 + § 4 of the
 * spec.
 */

const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function formatMonthYear(d: Date): string {
  return `${MONTH_LABELS[d.getMonth()]} ${d.getFullYear()}`;
}

function isoOf(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function parseDateOnly(iso: string): Date {
  // DB date columns serialize as "YYYY-MM-DD". `new Date(iso)` parses these
  // as UTC midnight per the ES spec, which in any non-UTC timezone shifts
  // the day backward when `.getDate()` reads it. Use explicit local-time
  // construction so a 2026-06-15 install date renders on June 15 in NYC.
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function isoRange(start: string | null, end: string | null): string[] {
  if (!start) return [];
  const s = parseDateOnly(start);
  const e = end ? parseDateOnly(end) : s;
  if (e < s) return [start];
  const out: string[] = [];
  const cur = new Date(s);
  while (cur <= e) {
    out.push(isoOf(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

export default function CalendarPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sourceParam = searchParams.get("source");
  const source: CalendarSource =
    sourceParam === "projects" || sourceParam === "tasks" ? sourceParam : null;

  const { isOwner } = useUserRole();

  // Phase 5.7.9 §9.D: current user id for the personal tasks query.
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(({ data }) => {
      if (active) setUserId(data.user?.id ?? null);
    });
    return () => {
      active = false;
    };
  }, []);

  const today = new Date();
  // Phase 5.7.9 §9.E: `activeFocus` is the focus date for the current view
  // (day-of, week-of, month-of). Keeps the existing month-window query keys
  // working since `windowStart`/`windowEnd` still derive from it.
  const [activeFocus, setActiveFocus] = useState<Date>(
    new Date(today.getFullYear(), today.getMonth(), 1),
  );
  const activeMonth = activeFocus;
  const setActiveMonth = setActiveFocus;

  const visibility = useCalendarVisibility(source);

  // Phase 5.6.5: is there an owner-published global calendar default?
  // Gates the "Reset to global default" button. Refetched after a
  // publish or reset action so the affordance recomputes without a
  // page reload.
  const [hasGlobalCalendarDefault, setHasGlobalCalendarDefault] =
    useState(false);
  const [globalDefaultTick, setGlobalDefaultTick] = useState(0);

  useEffect(() => {
    let active = true;
    hasGlobalDefault("calendar")
      .then((v) => {
        if (active) setHasGlobalCalendarDefault(v);
      })
      .catch(() => {
        if (active) setHasGlobalCalendarDefault(false);
      });
    return () => {
      active = false;
    };
  }, [globalDefaultTick]);

  const handlePublishGlobalCalendarDefault = useCallback(async () => {
    const { data: userRes } = await supabase.auth.getUser();
    const userId = userRes.user?.id;
    if (!userId) return;
    // Clear any prior global default (same clear-then-set pattern as
    // createSavedView for global rows).
    const clearRes = await supabase
      .from("saved_views")
      .update({ is_default: false })
      .eq("scope", "global")
      .eq("entity_type", "calendar");
    if (clearRes.error) {
      console.error("clear prior global calendar default failed", clearRes.error);
      toast({ title: "Save failed", variant: "destructive" });
      return;
    }
    const { error } = await supabase.from("saved_views").insert({
      user_id: userId,
      entity_type: "calendar",
      name: "__calendar_default",
      view_kind: "calendar",
      filter_state: visibility.state as unknown as Record<string, unknown>,
      is_default: true,
      scope: "global",
    } as never);
    if (error) {
      console.error("publish global calendar default failed", error);
      toast({ title: "Save failed", variant: "destructive" });
      return;
    }
    setGlobalDefaultTick((t) => t + 1);
    toast({ title: "Saved as global calendar default" });
  }, [visibility.state]);

  const handleResetCalendarToGlobal = useCallback(async () => {
    const { data: userRes } = await supabase.auth.getUser();
    const userId = userRes.user?.id;
    if (!userId) return;
    // The calendar hook reads ANY per-user `__calendar_default` row by
    // (user_id, entity_type, name); flipping is_default to false would
    // still leave the per-user row winning over the global. Delete the
    // per-user row so the global becomes authoritative again.
    const { error } = await supabase
      .from("saved_views")
      .delete()
      .eq("user_id", userId)
      .eq("entity_type", "calendar")
      .eq("name", "__calendar_default")
      .eq("scope", "user");
    if (error) {
      console.error("reset calendar to global failed", error);
      toast({ title: "Reset failed", variant: "destructive" });
      return;
    }
    visibility.refresh();
    toast({ title: "Reset to global default" });
  }, [visibility]);

  // Projects: full set (no window filter; cheap given the row count).
  const projectsQuery = useQuery({
    queryKey: ["calendar-projects"],
    queryFn: loadCalendarProjects,
  });

  // Window: active month ± 1 month for cheap month-nav.
  const windowStart = new Date(
    activeMonth.getFullYear(),
    activeMonth.getMonth() - 1,
    1,
  );
  const windowEnd = new Date(
    activeMonth.getFullYear(),
    activeMonth.getMonth() + 2,
    0,
  );
  const windowStartIso = isoOf(windowStart);
  const windowEndIso = isoOf(windowEnd);

  const deliverablesQuery = useQuery({
    queryKey: ["calendar-deliverables", windowStartIso, windowEndIso],
    queryFn: () => loadCalendarDeliverables(windowStartIso, windowEndIso),
  });

  // Phase 5.7.9 §9.D: personal tasks layer (assignee_id = me, due in window,
  // status != Done). Gated client-side by `visibility.state.showMyTasks` in
  // the events useMemo; the query still runs in the background so toggling
  // doesn't trigger a refetch.
  const tasksQuery = useQuery({
    queryKey: ["calendar-tasks", userId, windowStartIso, windowEndIso],
    queryFn: () =>
      userId
        ? loadCalendarTasks(userId, windowStartIso, windowEndIso)
        : Promise.resolve([]),
    enabled: !!userId,
  });

  const projects = projectsQuery.data ?? [];
  const deliverables = deliverablesQuery.data ?? [];
  const tasks = tasksQuery.data ?? [];
  const { holidays: mirrorHolidays } = useMirrorHolidays();

  // Visibility panel project list (sorted alphabetically by display).
  const visibilityProjects: VisibilityProject[] = useMemo(() => {
    return projects
      .map((p) => ({ id: p.id, clientName: p.clientName, name: p.name }))
      .sort((a, b) => {
        const al = a.clientName ? `${a.clientName} · ${a.name}` : a.name;
        const bl = b.clientName ? `${b.clientName} · ${b.name}` : b.name;
        return al.localeCompare(bl);
      });
  }, [projects]);

  // Build the CalendarEvent[] array for CalendarMonthView.
  const events: CalendarEvent[] = useMemo(() => {
    const out: CalendarEvent[] = [];
    const hiddenSet = new Set(visibility.state.hiddenProjectIds);

    // Project Install / Live / Removal ranges. ID encoding uses `|` as the
    // separator so the projectId (which contains `-`) parses cleanly back
    // out for click routing.
    for (const p of projects) {
      if (hiddenSet.has(p.id)) continue;

      for (const iso of isoRange(p.installStartIso, p.installEndIso)) {
        out.push({
          id: `proj|${p.id}|install|${iso}`,
          dateIso: iso,
          projectTitle: p.name,
          title: "Install",
          kind: "in",
        });
      }
      for (const iso of isoRange(p.liveStartIso, p.liveEndIso)) {
        out.push({
          id: `proj|${p.id}|live|${iso}`,
          dateIso: iso,
          projectTitle: p.name,
          title: "Live",
          kind: "live",
        });
      }
      for (const iso of isoRange(p.removalStartIso, p.removalEndIso)) {
        out.push({
          id: `proj|${p.id}|rem|${iso}`,
          dateIso: iso,
          projectTitle: p.name,
          title: "Removal",
          kind: "rem",
        });
      }
    }

    // Deliverables (gated by master toggle + per-project visibility).
    if (visibility.state.showDeliverables) {
      const filteredProjectIds = new Set(projects.map((p) => p.id));
      for (const d of deliverables) {
        if (!filteredProjectIds.has(d.projectId)) continue;
        if (hiddenSet.has(d.projectId)) continue;
        out.push({
          id: `del-${d.id}`,
          dateIso: d.dueIso,
          projectTitle: d.projectName,
          title: d.title,
          kind: "del",
          strikethrough: d.status === "Skipped",
        });
      }
    }

    // Mirror Holidays. Renders with the `.cal-ev.hol` modifier (muted
    // coral per Phase 5.7.9 color sweep) so it's distinguishable from
    // shared Outlook banners + plain Deliverables.
    if (visibility.state.showHolidays) {
      for (const h of mirrorHolidays) {
        out.push({
          id: `hol-${h.dateIso}-${h.label}`,
          dateIso: h.dateIso,
          projectTitle: h.label,
          title: "Holiday",
          kind: "hol",
        });
      }
    }

    // Phase 5.7.9 §9.D personal tasks layer. Gated by the master toggle;
    // routes click to /tasks/:id.
    if (visibility.state.showMyTasks && userId) {
      for (const t of tasks) {
        out.push({
          id: `task-${t.id}`,
          dateIso: t.dueIso,
          projectTitle: t.projectName ?? "No project",
          title: t.title,
          kind: "task",
        });
      }
    }

    return out;
  }, [projects, deliverables, mirrorHolidays, tasks, userId, visibility.state]);

  // Click routing.
  const onEventClick = (ev: CalendarEvent) => {
    if (ev.id.startsWith("hol-")) return; // no-op
    if (ev.id.startsWith("task-")) {
      const taskId = ev.id.replace(/^task-/, "");
      navigate(`/tasks/${taskId}`);
      return;
    }
    if (ev.id.startsWith("del-")) {
      const delId = ev.id.replace(/^del-/, "");
      const d = deliverables.find((x) => x.id === delId);
      if (d) navigate(`/projects/${d.projectId}`);
      return;
    }
    if (ev.id.startsWith("proj|")) {
      const projectId = ev.id.split("|")[1];
      if (projectId) navigate(`/projects/${projectId}`);
    }
  };

  // Phase 5.7.9 §9.E: Prev/Next/Today shift at the active resolution. Day
  // = ±1 day, Week = ±7 days, Month = ±1 month. Today snaps to the current
  // day for Day/Week views and to the first of the current month for Month.
  const activeView: CalendarViewKind = visibility.state.activeView;
  const goPrev = () => {
    if (activeView === "day") setActiveFocus((d) => addDays(d, -1));
    else if (activeView === "week") setActiveFocus((d) => addDays(d, -7));
    else setActiveFocus((d) => addMonths(d, -1));
  };
  const goNext = () => {
    if (activeView === "day") setActiveFocus((d) => addDays(d, 1));
    else if (activeView === "week") setActiveFocus((d) => addDays(d, 7));
    else setActiveFocus((d) => addMonths(d, 1));
  };
  const goToToday = () => {
    if (activeView === "month") {
      setActiveFocus(new Date(today.getFullYear(), today.getMonth(), 1));
    } else {
      setActiveFocus(new Date(today.getFullYear(), today.getMonth(), today.getDate()));
    }
  };

  // Phase 5.7.9 §9.E: focus-date label adapts to the active view. Day shows
  // "May 17, 2026"; Week shows "May 17 - May 23"; Month shows "May 2026".
  const focusLabel = useMemo(() => {
    if (activeView === "day") {
      return `${MONTH_LABELS[activeFocus.getMonth()]} ${activeFocus.getDate()}, ${activeFocus.getFullYear()}`;
    }
    if (activeView === "week") {
      const ws = startOfWeek(activeFocus);
      const we = addDays(ws, 6);
      const sameMonth = ws.getMonth() === we.getMonth();
      const left = `${MONTH_LABELS[ws.getMonth()]} ${ws.getDate()}`;
      const right = sameMonth
        ? `${we.getDate()}`
        : `${MONTH_LABELS[we.getMonth()]} ${we.getDate()}`;
      return `${left} – ${right}, ${we.getFullYear()}`;
    }
    return formatMonthYear(activeFocus);
  }, [activeView, activeFocus]);

  const loading =
    projectsQuery.isLoading ||
    deliverablesQuery.isLoading ||
    tasksQuery.isLoading ||
    visibility.loading;

  return (
    <div className="stack-4">
      <div className="pagehead">
        <div className="stack-2">
          <div>
            <div className="eyebrow">HQ</div>
            <h1 className="h-page" style={{ marginTop: 4 }}>
              Calendar
            </h1>
          </div>
          {/* Row beneath the title. Mirrors the calendar grid's column
              structure (1fr 232px / gap 16) so the legend's right edge
              lands at the calendar table's right edge by structure rather
              than by inset math. LEFT cell: button cluster (month switcher
              + vertical divider + Day/Week/Month) on the left; color
              legend on the right via `.row between`. RIGHT cell: empty
              (visibility-panel column is intentionally unused above). */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 232px",
              gap: 16,
              alignItems: "center",
            }}
          >
            <div
              className="row between"
              style={{ alignItems: "center", flexWrap: "wrap", gap: 16 }}
            >
              <div className="row-c" style={{ gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={goPrev}
                  aria-label={`Previous ${activeView}`}
                >
                  <IconArrowLeft className="ic" />
                </button>
                <span
                  className="h-card"
                  style={{ fontSize: 15, minWidth: 170, textAlign: "center" }}
                >
                  {focusLabel}
                </span>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={goNext}
                  aria-label={`Next ${activeView}`}
                >
                  <IconChevronRight className="ic" />
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={goToToday}
                >
                  Today
                </button>
                <span
                  aria-hidden="true"
                  style={{
                    width: 1,
                    height: 20,
                    background: "hsl(var(--border))",
                    margin: "0 4px",
                  }}
                />
                {(["day", "week", "month"] as const).map((kind) => {
                  const isActive = activeView === kind;
                  return (
                    <button
                      key={kind}
                      type="button"
                      className={`fchip fchip--btn ${isActive ? "fchip--active" : ""}`}
                      onClick={() => visibility.setActiveView(kind)}
                      aria-pressed={isActive}
                    >
                      <span>{kind.charAt(0).toUpperCase() + kind.slice(1)}</span>
                    </button>
                  );
                })}
              </div>
              <div className="callegend" style={{ justifyContent: "flex-end" }}>
                <span>
                  <i style={{ background: "hsl(var(--info))" }} /> Install
                </span>
                <span>
                  <i style={{ background: "hsl(var(--success))" }} /> Live
                </span>
                <span>
                  <i style={{ background: "#B57BF5" }} /> Removal
                </span>
                <span>
                  <i style={{ background: "hsl(var(--warn))" }} /> Deliverable
                </span>
                <span>
                  <i
                    style={{
                      background: "hsl(var(--primary))",
                      opacity: 0.5,
                    }}
                  />{" "}
                  Holiday
                </span>
                <span>
                  <i style={{ background: "hsl(var(--muted-foreground))" }} />{" "}
                  My Tasks
                </span>
              </div>
            </div>
            {/* Right grid cell intentionally empty so the row above tracks
                the calendar grid below pixel-for-pixel. */}
            <div />
          </div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 232px",
          gap: 16,
          alignItems: "start",
        }}
      >
        <div className="stack-3">
          {loading ? (
            <div
              className="flex flex-col items-center gap-4 py-24 text-center"
              style={{ minHeight: 240 }}
            >
              <span className="subtle">Loading Calendar...</span>
            </div>
          ) : activeView === "day" ? (
            <CalendarDayView
              events={events}
              date={activeFocus}
              onEventClick={onEventClick}
            />
          ) : activeView === "week" ? (
            <CalendarWeekView
              events={events}
              weekStart={startOfWeek(activeFocus)}
              onEventClick={onEventClick}
            />
          ) : (
            <CalendarMonthView
              events={events}
              onEventClick={onEventClick}
              activeMonth={activeMonth}
              onActiveMonthChange={setActiveMonth}
              hideInternalNav
            />
          )}
        </div>

        <CalendarVisibilityPanel
          showDeliverables={visibility.state.showDeliverables}
          showHolidays={visibility.state.showHolidays}
          showMyTasks={visibility.state.showMyTasks}
          hiddenProjectIds={visibility.state.hiddenProjectIds}
          projects={visibilityProjects}
          onSetShowDeliverables={visibility.setShowDeliverables}
          onSetShowHolidays={visibility.setShowHolidays}
          onSetShowMyTasks={visibility.setShowMyTasks}
          onToggleProject={visibility.toggleProject}
          canPublishGlobal={isOwner}
          canResetToGlobal={
            visibility.hasPerUserRow && hasGlobalCalendarDefault
          }
          onPublishGlobal={handlePublishGlobalCalendarDefault}
          onResetToGlobal={handleResetCalendarToGlobal}
        />
      </div>
    </div>
  );
}

