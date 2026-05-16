import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarMonthView,
  type CalendarEvent,
} from "@/components/data/CalendarMonthView";
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
  loadCalendarOutlook,
  weekToDateIso,
  type CalendarProjectRow,
} from "@/lib/calendar/queries";
import { MIRROR_HOLIDAYS } from "@/lib/calendar/holidays";
import {
  useCalendarVisibility,
  type CalendarSource,
} from "@/lib/calendar/useCalendarVisibility";
import { useUserRole } from "@/hooks/useUserRole";

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

function projectMatchesFilters(
  p: CalendarProjectRow,
  leadFilter: string | null,
  categoryFilter: string | null,
): boolean {
  if (leadFilter && !p.accountManagerIds.includes(leadFilter)) return false;
  if (categoryFilter && p.category !== categoryFilter) return false;
  return true;
}

export default function CalendarPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sourceParam = searchParams.get("source");
  const source: CalendarSource =
    sourceParam === "projects" || sourceParam === "tasks" ? sourceParam : null;

  const { isAdmin } = useUserRole();

  const today = new Date();
  const [activeMonth, setActiveMonth] = useState<Date>(
    new Date(today.getFullYear(), today.getMonth(), 1),
  );

  const [leadFilter, setLeadFilter] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [leadOpen, setLeadOpen] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState(false);

  const visibility = useCalendarVisibility(source);

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
  const activeYear = activeMonth.getFullYear();

  const deliverablesQuery = useQuery({
    queryKey: ["calendar-deliverables", windowStartIso, windowEndIso],
    queryFn: () => loadCalendarDeliverables(windowStartIso, windowEndIso),
  });

  const outlookQuery = useQuery({
    queryKey: ["calendar-outlook", activeYear],
    queryFn: () => loadCalendarOutlook(activeYear),
  });

  const projects = projectsQuery.data ?? [];
  const deliverables = deliverablesQuery.data ?? [];
  const outlookEntries = outlookQuery.data ?? [];

  // Filter chip option sources.
  const leadOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const p of projects) {
      for (let i = 0; i < p.accountManagerIds.length; i++) {
        const id = p.accountManagerIds[i];
        if (!seen.has(id)) {
          seen.set(id, p.accountManagerLabel ?? id.slice(0, 6));
        }
      }
    }
    return Array.from(seen.entries()).map(([id, label]) => ({ id, label }));
  }, [projects]);
  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const p of projects) if (p.category) set.add(p.category);
    return Array.from(set).sort();
  }, [projects]);

  // Filtered project set (applies lead + category chips only).
  const filteredProjects = useMemo(
    () => projects.filter((p) => projectMatchesFilters(p, leadFilter, categoryFilter)),
    [projects, leadFilter, categoryFilter],
  );

  // Visibility panel project list (sorted alphabetically by display).
  const visibilityProjects: VisibilityProject[] = useMemo(() => {
    return filteredProjects
      .map((p) => ({ id: p.id, clientName: p.clientName, name: p.name }))
      .sort((a, b) => {
        const al = a.clientName ? `${a.clientName} · ${a.name}` : a.name;
        const bl = b.clientName ? `${b.clientName} · ${b.name}` : b.name;
        return al.localeCompare(bl);
      });
  }, [filteredProjects]);

  // Build the CalendarEvent[] array for CalendarMonthView.
  const events: CalendarEvent[] = useMemo(() => {
    const out: CalendarEvent[] = [];
    const hiddenSet = new Set(visibility.state.hiddenProjectIds);

    // Project Install / Live / Removal ranges. ID encoding uses `|` as the
    // separator so the projectId (which contains `-`) parses cleanly back
    // out for click routing.
    for (const p of filteredProjects) {
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
      const filteredProjectIds = new Set(filteredProjects.map((p) => p.id));
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

    // Shared Outlook entries (always shared-only; spec § 6a). Renders with
    // the `.cal-ev.olk` modifier (gray, muted-foreground, 2px gray
    // border-left).
    if (visibility.state.showSharedOutlook) {
      for (const e of outlookEntries) {
        if (!e.sharedWithTeam) continue;
        const iso = weekToDateIso(e.year, e.month, e.week);
        const projectTitle = e.clientName ? `${e.clientName} · ${e.name}` : e.name;
        out.push({
          id: `olk-${e.id}`,
          dateIso: iso,
          projectTitle,
          title: "Outlook",
          kind: "olk",
        });
      }
    }

    // Mirror Holidays. Renders with the `.cal-ev.hol` modifier (gray,
    // subtle-foreground, italic) so it's distinguishable from shared
    // Outlook banners + plain Deliverables.
    if (visibility.state.showHolidays) {
      for (const h of MIRROR_HOLIDAYS) {
        out.push({
          id: `hol-${h.dateIso}-${h.label}`,
          dateIso: h.dateIso,
          projectTitle: h.label,
          title: "Holiday",
          kind: "hol",
        });
      }
    }

    return out;
  }, [filteredProjects, deliverables, outlookEntries, visibility.state]);

  // Click routing.
  const onEventClick = (ev: CalendarEvent) => {
    if (ev.id.startsWith("hol-")) return; // no-op
    if (ev.id.startsWith("olk-")) {
      if (!isAdmin) return; // non-admins can see banner, no click target
      const e = outlookEntries.find((x) => `olk-${x.id}` === ev.id);
      if (!e) return;
      navigate(
        `/outlook?year=${e.year}&month=${String(e.month).padStart(2, "0")}#entry=${e.id}`,
      );
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

  const prevMonth = () =>
    setActiveMonth(
      new Date(activeMonth.getFullYear(), activeMonth.getMonth() - 1, 1),
    );
  const nextMonth = () =>
    setActiveMonth(
      new Date(activeMonth.getFullYear(), activeMonth.getMonth() + 1, 1),
    );
  const goToToday = () =>
    setActiveMonth(new Date(today.getFullYear(), today.getMonth(), 1));

  const loading =
    projectsQuery.isLoading ||
    deliverablesQuery.isLoading ||
    outlookQuery.isLoading ||
    visibility.loading;

  return (
    <div className="stack-4">
      <div className="pagehead">
        <div className="row between">
          <div>
            <div className="eyebrow">HQ</div>
            <h1 className="h-page" style={{ marginTop: 4 }}>
              Calendar
            </h1>
          </div>
          {/* Right-inset by 248px = visibility panel width (232) + grid gap
              (16) so the right edge of the Today button lines up with the
              right edge of the Category filter chip below. */}
          <div className="row-c" style={{ marginRight: 248 }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={prevMonth}
              aria-label="Previous month"
            >
              <IconArrowLeft className="ic" />
            </button>
            <span
              className="h-card"
              style={{ fontSize: 15, minWidth: 130, textAlign: "center" }}
            >
              {formatMonthYear(activeMonth)}
            </span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={nextMonth}
              aria-label="Next month"
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
          <div className="row between wrap" style={{ alignItems: "center" }}>
            <div className="callegend">
              <span>
                <i style={{ background: "#06B6D4" }} /> Install
              </span>
              <span>
                <i style={{ background: "hsl(var(--primary))" }} /> Live
              </span>
              <span>
                <i style={{ background: "hsl(var(--warn))" }} /> Removal
              </span>
              <span>
                <i style={{ background: "hsl(var(--success))" }} /> Deliverable
              </span>
              <span>
                <i style={{ background: "hsl(var(--border-strong))" }} /> Outlook
                / Holiday
              </span>
            </div>
            <div className="row-c">
              <FilterChip
                label="Lead"
                value={
                  leadFilter
                    ? leadOptions.find((o) => o.id === leadFilter)?.label ??
                      "Unknown"
                    : "All"
                }
                open={leadOpen}
                onToggle={() => {
                  setLeadOpen((v) => !v);
                  setCategoryOpen(false);
                }}
                onClear={leadFilter ? () => setLeadFilter(null) : undefined}
              >
                {leadOpen ? (
                  <FilterPicker
                    items={[{ id: null, label: "All" }, ...leadOptions.map((o) => ({ id: o.id as string | null, label: o.label }))]}
                    activeId={leadFilter}
                    onPick={(id) => {
                      setLeadFilter(id);
                      setLeadOpen(false);
                    }}
                  />
                ) : null}
              </FilterChip>
              <FilterChip
                label="Category"
                value={categoryFilter ?? "All"}
                open={categoryOpen}
                onToggle={() => {
                  setCategoryOpen((v) => !v);
                  setLeadOpen(false);
                }}
                onClear={
                  categoryFilter ? () => setCategoryFilter(null) : undefined
                }
              >
                {categoryOpen ? (
                  <FilterPicker
                    items={[
                      { id: null, label: "All" },
                      ...categoryOptions.map((c) => ({
                        id: c as string | null,
                        label: c,
                      })),
                    ]}
                    activeId={categoryFilter}
                    onPick={(id) => {
                      setCategoryFilter(id);
                      setCategoryOpen(false);
                    }}
                  />
                ) : null}
              </FilterChip>
            </div>
          </div>

          {loading ? (
            <div
              className="flex flex-col items-center gap-4 py-24 text-center"
              style={{ minHeight: 240 }}
            >
              <span className="subtle">Loading Calendar...</span>
            </div>
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
          showSharedOutlook={visibility.state.showSharedOutlook}
          hiddenProjectIds={visibility.state.hiddenProjectIds}
          projects={visibilityProjects}
          onSetShowDeliverables={visibility.setShowDeliverables}
          onSetShowHolidays={visibility.setShowHolidays}
          onSetShowSharedOutlook={visibility.setShowSharedOutlook}
          onToggleProject={visibility.toggleProject}
        />
      </div>
    </div>
  );
}

function FilterChip({
  label,
  value,
  open,
  onToggle,
  onClear,
  children,
}: {
  label: string;
  value: string;
  open: boolean;
  onToggle: () => void;
  onClear?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      <span
        className="fchip"
        role="button"
        style={{ height: 26 }}
        onClick={onToggle}
      >
        <span className="k">{label}</span>
        <span className="op">is</span>
        <span className="v">{value}</span>
        {onClear ? (
          <span
            className="x"
            role="button"
            aria-label={`Clear ${label}`}
            onClick={(e) => {
              e.stopPropagation();
              onClear();
            }}
          >
            ×
          </span>
        ) : null}
      </span>
      {open ? (
        <div
          className="card"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            zIndex: 30,
            minWidth: 220,
            maxHeight: 320,
            overflowY: "auto",
          }}
        >
          {children}
        </div>
      ) : null}
    </span>
  );
}

function FilterPicker({
  items,
  activeId,
  onPick,
}: {
  items: { id: string | null; label: string }[];
  activeId: string | null;
  onPick: (id: string | null) => void;
}) {
  return (
    <div className="card-pad stack-2" style={{ padding: 8 }}>
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <button
            key={item.id ?? "__all"}
            type="button"
            className="btn btn-tertiary btn-sm"
            style={{
              justifyContent: "flex-start",
              textAlign: "left",
              fontWeight: active ? 700 : 400,
              color: active
                ? "hsl(var(--primary))"
                : "hsl(var(--foreground))",
            }}
            onClick={() => onPick(item.id)}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
