import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { currentWeekWindow, formatRangeLabel, formatWeekcardDate } from "@/lib/home/week";

/**
 * Phase 5.1 `My Week` strip (spec § 7c).
 *
 * Renders the signed-in user's project dates that fall inside the current
 * calendar week (Mon-Sun, local timezone). Up to 3 cards plus a fourth
 * placeholder when fewer than 3 events exist.
 *
 * Data scope after 5.2.1: project-side Install / Live / Removal dates
 * (driven by `projects.live_dates_start` and `projects.live_dates_end`)
 * union'd with deliverable due dates for the same projects, taken from
 * the new `deliverables` table.
 */

type WeekEntry = {
  key: string;
  dateIso: string;
  projectName: string;
  clientName: string | null;
  milestone: "Live" | "Removal" | "Deliverable";
};

type Token = "success" | "warn" | "info" | "muted";

const TOKEN_FOR: Record<WeekEntry["milestone"], Token> = {
  Live: "success",
  Removal: "warn",
  Deliverable: "info",
};

function tokenColor(token: Token): string {
  switch (token) {
    case "success": return "hsl(var(--success))";
    case "warn": return "hsl(var(--warn))";
    case "info": return "#06B6D4";
    case "muted": return "hsl(var(--border-strong))";
  }
}

async function loadEntries(userId: string, mondayIso: string, sundayIso: string): Promise<WeekEntry[]> {
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
      .gte("due_date", mondayIso)
      .lte("due_date", sundayIso)
      .in("status", ["Upcoming", "In Progress"]),
  ]);

  const out: WeekEntry[] = [];
  for (const p of projectsRes.data ?? []) {
    const clientName = (p.client as { name?: string } | null)?.name ?? null;
    if (p.live_dates_start && p.live_dates_start >= mondayIso && p.live_dates_start <= sundayIso) {
      out.push({
        key: `${p.id}-start`,
        dateIso: p.live_dates_start,
        projectName: p.name,
        clientName,
        milestone: "Live",
      });
    }
    if (p.live_dates_end && p.live_dates_end >= mondayIso && p.live_dates_end <= sundayIso) {
      out.push({
        key: `${p.id}-end`,
        dateIso: p.live_dates_end,
        projectName: p.name,
        clientName,
        milestone: "Removal",
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
    });
  }
  out.sort((a, b) => a.dateIso.localeCompare(b.dateIso));
  return out;
}

export function MyWeekStrip({ userId }: { userId: string | undefined }) {
  const [entries, setEntries] = useState<WeekEntry[]>([]);
  const { mondayIso, sundayIso, monday, sunday } = currentWeekWindow();
  const rangeLabel = formatRangeLabel(monday, sunday);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    loadEntries(userId, mondayIso, sundayIso).then((rows) => {
      if (active) setEntries(rows);
    });
    return () => {
      active = false;
    };
  }, [userId, mondayIso, sundayIso]);

  const visible = entries.slice(0, 3);
  const placeholders = Math.max(0, 3 - visible.length);

  return (
    <section>
      <div className="hq-block-lbl">
        <span className="hq-block-lbl-text">
          <span className="text-primary">My Week</span> · {rangeLabel}
        </span>
      </div>
      <div className="hq-weekstrip">
        {visible.map((e) => {
          const token = TOKEN_FOR[e.milestone];
          const color = tokenColor(token);
          return (
            <div
              key={e.key}
              className="hq-weekcard"
              style={{ borderLeftColor: color }}
            >
              <div className="hq-weekcard-typ" style={{ color }}>
                {formatWeekcardDate(e.dateIso)}
              </div>
              <div className="hq-weekcard-nm">
                {e.clientName ? `${e.clientName} · ${e.projectName}` : e.projectName}
              </div>
              <div className="hq-weekcard-mt">{e.milestone}</div>
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
    </section>
  );
}