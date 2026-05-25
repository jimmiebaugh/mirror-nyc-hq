import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { currentWeekWindow, formatRangeLabel, formatWeekcardDate } from "@/lib/home/week";
import { IconChevronLeft, IconChevronRight } from "@/components/icons/HQIcons";

/**
 * Phase 5.1 `My Week` strip (spec § 7c).
 *
 * Renders the signed-in user's project dates that fall inside the current
 * calendar week (Mon-Sun, local timezone). 5.7.14 narrows the visible
 * window to today-forward and paginates 3 cards at a time when more
 * entries exist.
 */

type WeekEntry = {
  key: string;
  dateIso: string;
  projectName: string;
  clientName: string | null;
  milestone: "Live" | "Removal" | "Deliverable";
  displayLabel: string;
};

type Token = "success" | "warn" | "info" | "muted";

const PAGE_SIZE = 3;

const TOKEN_FOR: Record<WeekEntry["milestone"], Token> = {
  Live: "success",
  Removal: "warn",
  Deliverable: "info",
};

function tokenColor(token: Token): string {
  switch (token) {
    case "success": return "hsl(var(--success))";
    case "warn": return "hsl(var(--warn))";
    case "info": return "hsl(var(--info))";
    case "muted": return "hsl(var(--border-strong))";
  }
}

function todayIsoLocal(): string {
  // YYYY-MM-DD in the browser's local timezone.
  return new Date().toLocaleDateString("en-CA");
}

async function loadEntries(
  userId: string,
  todayIso: string,
  sundayIso: string,
): Promise<WeekEntry[]> {
  // Find every project where the user is an account manager OR a designer.
  const [amRes, dRes] = await Promise.all([
    supabase
      .from("project_account_managers")
      .select("project_id")
      .eq("user_id", userId),
    supabase
      .from("project_designers")
      .select("project_id")
      .eq("user_id", userId),
  ]);
  const ids = new Set<string>();
  for (const r of amRes.data ?? []) ids.add(r.project_id);
  for (const r of dRes.data ?? []) ids.add(r.project_id);
  if (ids.size === 0) return [];

  const projectIds = Array.from(ids);
  const [projectsRes, deliverablesRes] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, live_dates_start, live_dates_end, client:clients(name)")
      .in("id", projectIds)
      .is("archived_at", null),
    supabase
      .from("deliverables")
      .select("id, project_id, title, due_date, status, project:projects(name, client:clients(name))")
      .in("project_id", projectIds)
      .not("due_date", "is", null)
      .gte("due_date", todayIso)
      .lte("due_date", sundayIso)
      .in("status", ["Upcoming"]),
  ]);

  const out: WeekEntry[] = [];
  for (const p of projectsRes.data ?? []) {
    const clientName = (p.client as { name?: string } | null)?.name ?? null;
    if (p.live_dates_start && p.live_dates_start >= todayIso && p.live_dates_start <= sundayIso) {
      out.push({
        key: `${p.id}-start`,
        dateIso: p.live_dates_start,
        projectName: p.name,
        clientName,
        milestone: "Live",
        displayLabel: "Live",
      });
    }
    if (p.live_dates_end && p.live_dates_end >= todayIso && p.live_dates_end <= sundayIso) {
      out.push({
        key: `${p.id}-end`,
        dateIso: p.live_dates_end,
        projectName: p.name,
        clientName,
        milestone: "Removal",
        displayLabel: "Removal",
      });
    }
  }
  type DeliverableRow = {
    id: string;
    title: string;
    due_date: string;
    project: { name: string; client: { name: string | null } | null } | null;
  };
  for (const d of (deliverablesRes.data ?? []) as unknown as DeliverableRow[]) {
    out.push({
      key: `d-${d.id}`,
      dateIso: d.due_date,
      projectName: d.project?.name ?? d.title,
      clientName: d.project?.client?.name ?? null,
      milestone: "Deliverable",
      displayLabel: d.title,
    });
  }
  out.sort((a, b) => a.dateIso.localeCompare(b.dateIso));
  return out;
}

export function MyWeekStrip({ userId }: { userId: string | undefined }) {
  const [entries, setEntries] = useState<WeekEntry[]>([]);
  const [page, setPage] = useState(0);
  const { sundayIso, monday, sunday } = currentWeekWindow();
  const rangeLabel = formatRangeLabel(monday, sunday);
  const todayIso = todayIsoLocal();

  useEffect(() => {
    if (!userId) return;
    let active = true;
    loadEntries(userId, todayIso, sundayIso).then((rows) => {
      if (active) setEntries(rows);
    });
    return () => {
      active = false;
    };
  }, [userId, todayIso, sundayIso]);

  useEffect(() => {
    setPage(0);
  }, [entries.length]);

  const visible = entries.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const placeholders = Math.max(0, PAGE_SIZE - visible.length);
  const hasPrev = page > 0;
  const hasNext = (page + 1) * PAGE_SIZE < entries.length;

  return (
    <section>
      <div className="block-lbl">
        <span
          className="label-section"
          style={{ fontSize: 16 }}
        >
          <span style={{ color: "hsl(var(--primary))" }}>My Week</span> · {rangeLabel}
        </span>
      </div>
      <div className="row-c" style={{ gap: 6 }}>
        {hasPrev ? (
          <button
            type="button"
            aria-label="Previous week page"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="hq-weekstrip-nav"
          >
            <IconChevronLeft className="ic" />
          </button>
        ) : null}
        <div className="hq-weekstrip" style={{ flex: 1, minWidth: 0 }}>
          {visible.map((e) => {
            const token = TOKEN_FOR[e.milestone];
            const color = tokenColor(token);
            return (
              <div key={e.key} className="hq-weekcard">
                <div className="hq-weekcard-typ" style={{ color }}>
                  {formatWeekcardDate(e.dateIso)}
                </div>
                <div className="hq-weekcard-nm">
                  {e.clientName ? `${e.clientName} · ${e.projectName}` : e.projectName}
                </div>
                <div className="hq-weekcard-mt">{e.displayLabel}</div>
              </div>
            );
          })}
          {Array.from({ length: placeholders }).map((_, i) => (
            <div
              key={`ph-${i}`}
              className="hq-weekcard hq-weekcard--empty"
            >
              <span className="text-[11px] font-mono text-[hsl(var(--subtle-foreground))]">
                {entries.length === 0 && i === 0
                  ? "No install / live / removal dates this week"
                  : "Nothing else dated this week"}
              </span>
            </div>
          ))}
        </div>
        {hasNext ? (
          <button
            type="button"
            aria-label="Next week page"
            onClick={() => setPage((p) => p + 1)}
            className="hq-weekstrip-nav"
          >
            <IconChevronRight className="ic" />
          </button>
        ) : null}
      </div>
    </section>
  );
}
