import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { hqPillClass, projectStatusToken, deliverableStatusToken, taskStatusToken, statusTextDecoration } from "@/lib/home/projectStatusToken";
import { formatMediumDate, formatShortDate, daysUntil, relativeDay } from "@/lib/hq/dates";
import type { ProjectStatus } from "@/lib/projects/queries";

type Project = {
  id: string;
  name: string;
  status: ProjectStatus;
  live_dates_start: string | null;
  live_dates_end: string | null;
  production_folder_url: string | null;
  design_decks_folder_url: string | null;
  slack_channel_url: string | null;
  budget_sheet_url: string | null;
  notes: string | null;
  client: { id: string; name: string | null } | null;
  venues: { venue: { id: string; name: string | null } | null }[];
  account_managers: { user: { id: string; full_name: string | null; email: string | null } | null }[];
  designers: { user: { id: string; full_name: string | null; email: string | null } | null }[];
};

type Deliverable = {
  id: string;
  title: string;
  type: string | null;
  status: "Upcoming" | "In Progress" | "Complete" | "Skipped";
  due_date: string | null;
};

type TaskRow = {
  id: string;
  title: string;
  status: "To Do" | "Doing" | "Blocked" | "Done";
  priority: "Urgent" | "High" | "Normal" | "Low";
  due_date: string | null;
  assignee: { full_name: string | null; email: string | null } | null;
};

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    let active = true;
    (async () => {
      const [proj, dels, tks] = await Promise.all([
        supabase
          .from("projects")
          .select(
            `id, name, status, live_dates_start, live_dates_end,
             production_folder_url, design_decks_folder_url, slack_channel_url,
             budget_sheet_url, notes,
             client:clients(id, name),
             venues:project_venues(venue:venues(id, name)),
             account_managers:project_account_managers(user:users(id, full_name, email)),
             designers:project_designers(user:users(id, full_name, email))`,
          )
          .eq("id", id)
          .single(),
        supabase
          .from("deliverables")
          .select("id, title, type, status, due_date")
          .eq("project_id", id)
          .order("due_date", { ascending: true, nullsFirst: false }),
        supabase
          .from("tasks")
          .select("id, title, status, priority, due_date, assignee:users(full_name, email)")
          .eq("project_id", id)
          .order("due_date", { ascending: true, nullsFirst: false }),
      ]);
      if (!active) return;
      if (proj.error) {
        console.warn("project load failed", proj.error);
        setLoading(false);
        return;
      }
      setProject(proj.data as unknown as Project);
      setDeliverables((dels.data ?? []) as unknown as Deliverable[]);
      setTasks((tks.data ?? []) as unknown as TaskRow[]);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [id]);

  if (loading) return <p className="text-sm text-muted-foreground">Loading...</p>;
  if (!project) {
    return (
      <div className="mx-auto max-w-3xl">
        <p className="text-sm text-muted-foreground">Project not found.</p>
      </div>
    );
  }

  const nextDeliverable = deliverables
    .filter((d) => d.due_date && (d.status === "Upcoming" || d.status === "In Progress"))
    .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""))[0];

  const installDays = project.live_dates_start ? daysUntil(project.live_dates_start) : null;

  const folderButtons = [
    { label: "Production", url: project.production_folder_url },
    { label: "Design", url: project.design_decks_folder_url },
    { label: "Slack", url: project.slack_channel_url },
    { label: "Server", url: null }, // afp:// path lands in 5.2.2 if needed
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <Link to="/projects" className="crumb">← Back to Projects</Link>
      <header className="grid items-end gap-4" style={{ gridTemplateColumns: "1fr 172px" }}>
        <div>
          <h1 className="h-page flex items-baseline gap-3 flex-wrap">
            <span>{project.client?.name ?? ""}</span>
            <span className="text-[hsl(var(--subtle-foreground))]">·</span>
            <span>{project.name}</span>
          </h1>
          <div className="mt-3 grid grid-cols-3 gap-6 text-[11px] font-mono uppercase tracking-widest text-[hsl(var(--subtle-foreground))]">
            <div>
              <div className="text-primary">Install</div>
              <div className="mt-1 text-[12px] normal-case tracking-normal text-foreground">
                {project.live_dates_start ? formatShortDate(project.live_dates_start) : "-"}
              </div>
            </div>
            <div>
              <div className="text-primary">Live</div>
              <div className="mt-1 text-[12px] normal-case tracking-normal text-foreground">
                {project.live_dates_start
                  ? `${formatShortDate(project.live_dates_start)}${project.live_dates_end ? ` to ${formatShortDate(project.live_dates_end)}` : ""}`
                  : "-"}
              </div>
            </div>
            <div>
              <div className="text-primary">Removal</div>
              <div className="mt-1 text-[12px] normal-case tracking-normal text-foreground">
                {project.live_dates_end ? formatShortDate(project.live_dates_end) : "-"}
              </div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {folderButtons.map((b) => (
              <a
                key={b.label}
                href={b.url ?? "#"}
                target={b.url ? "_blank" : undefined}
                rel={b.url ? "noopener noreferrer" : undefined}
                aria-disabled={!b.url}
                className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm ${
                  b.url
                    ? "border-[hsl(var(--border-strong))] hover:border-primary"
                    : "border-[hsl(var(--border))] text-[hsl(var(--subtle-foreground))] pointer-events-none"
                }`}
                onClick={(e) => {
                  if (!b.url) e.preventDefault();
                }}
              >
                {b.label}
              </a>
            ))}
          </div>
        </div>
        <div className="flex flex-col items-stretch gap-3 w-[172px]">
          <span className={`hq-pill-lg ${hqPillClass(project.status).replace("hq-pill ", "")}`}>
            <span className="hq-pill-dt" />
            {project.status}
          </span>
          <Button onClick={() => navigate(`/projects/${project.id}/edit`)}>
            Edit Project
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-3 gap-4">
        <div className="hq-stat">
          <div className="hq-stat-lbl">Next Deliverable</div>
          <div className="hq-stat-num">{nextDeliverable?.title ?? "-"}</div>
          <div className="hq-stat-sub">
            {nextDeliverable?.due_date ? `${relativeDay(nextDeliverable.due_date)} · ${formatMediumDate(nextDeliverable.due_date)}` : "Nothing dated"}
          </div>
        </div>
        <div className="hq-stat">
          <div className="hq-stat-lbl">Days Until Install</div>
          <div className="hq-stat-num text-primary">{installDays != null ? `${installDays}` : "-"}</div>
          <div className="hq-stat-sub">
            {project.live_dates_start ? formatMediumDate(project.live_dates_start) : "No install date"}
          </div>
        </div>
        <div className="hq-stat">
          <div className="hq-stat-lbl">Open Tasks</div>
          <div className="hq-stat-num">{tasks.filter((t) => t.status !== "Done").length}</div>
          <div className="hq-stat-sub">{tasks.length} total</div>
        </div>
      </div>

      <div className="grid gap-6" style={{ gridTemplateColumns: "1fr 332px" }}>
        <div className="space-y-6">
          <div className="hq-card">
            <div className="hq-card-headbar">
              <span className="h-card">Overview</span>
            </div>
            <div className="grid grid-cols-2 gap-x-8 gap-y-3 p-6 text-sm">
              <div>
                <div className="label-form text-[hsl(var(--subtle-foreground))]">Client</div>
                <div className="mt-1">
                  {project.client?.id ? (
                    <Link to={`/organizations/${project.client.id}`} style={{ color: "rgba(190,78,68,0.85)" }}>
                      {project.client.name}
                    </Link>
                  ) : (
                    "-"
                  )}
                </div>
              </div>
              <div>
                <div className="label-form text-[hsl(var(--subtle-foreground))]">Venues</div>
                <div className="mt-1 flex flex-wrap gap-2">
                  {project.venues.length === 0
                    ? "-"
                    : project.venues.map((pv) =>
                        pv.venue ? (
                          <Link key={pv.venue.id} to={`/venues/${pv.venue.id}`} className="hq-tlink">
                            {pv.venue.name}
                          </Link>
                        ) : null,
                      )}
                </div>
              </div>
            </div>
          </div>

          <div className="hq-card">
            <div className="hq-card-headbar">
              <span className="h-card">Deliverables</span>
              <button
                type="button"
                className="hq-tlink"
                onClick={() => navigate(`/deliverables/new?project=${project.id}`)}
              >
                + Add deliverable
              </button>
            </div>
            {deliverables.length === 0 ? (
              <div className="p-6 text-sm text-[hsl(var(--subtle-foreground))]">No deliverables yet.</div>
            ) : (
              <table className="hq-tbl">
                <thead>
                  <tr>
                    <th>Deliverable</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th className="r">Due</th>
                  </tr>
                </thead>
                <tbody>
                  {deliverables.map((d) => (
                    <tr
                      key={d.id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/deliverables/${d.id}`)}
                    >
                      <td className={statusTextDecoration("deliverable", d.status)}>{d.title}</td>
                      <td className="text-[hsl(var(--muted-foreground))]">{d.type ?? "-"}</td>
                      <td>
                        <span className={`hq-pill hq-pill--${deliverableStatusToken(d.status)}`}>
                          <span className="hq-pill-dt" />
                          {d.status}
                        </span>
                      </td>
                      <td className="r">{d.due_date ? formatShortDate(d.due_date) : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="hq-card">
            <div className="hq-card-headbar">
              <span className="h-card">Tasks</span>
              <button
                type="button"
                className="hq-tlink"
                onClick={() => navigate(`/tasks/new?project=${project.id}`)}
              >
                + Add task
              </button>
            </div>
            {tasks.length === 0 ? (
              <div className="p-6 text-sm text-[hsl(var(--subtle-foreground))]">No tasks yet.</div>
            ) : (
              <table className="hq-tbl">
                <thead>
                  <tr>
                    <th>Task</th>
                    <th>Assignee</th>
                    <th>Priority</th>
                    <th>Status</th>
                    <th className="r">Due</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((t) => (
                    <tr
                      key={t.id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/tasks/${t.id}`)}
                    >
                      <td className={statusTextDecoration("task", t.status)}>{t.title}</td>
                      <td className="text-[hsl(var(--muted-foreground))]">
                        {t.assignee?.full_name ?? t.assignee?.email ?? "-"}
                      </td>
                      <td>{t.priority}</td>
                      <td>
                        <span className={`hq-pill hq-pill--${taskStatusToken(t.status)}`}>
                          <span className="hq-pill-dt" />
                          {t.status}
                        </span>
                      </td>
                      <td className="r">{t.due_date ? formatShortDate(t.due_date) : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <Card className="border-dashed border-border bg-transparent p-8 text-center">
            <p className="text-sm text-muted-foreground">No attachments yet</p>
            <Button variant="outline" disabled className="mt-3">Upload (coming soon)</Button>
          </Card>
        </div>

        <aside className="space-y-6">
          <div className="hq-card">
            <div className="hq-card-headbar">
              <span className="h-card">Team</span>
            </div>
            <div className="space-y-2 p-6 text-sm">
              {project.account_managers.length === 0 && project.designers.length === 0 ? (
                <div className="text-[hsl(var(--subtle-foreground))]">No team assigned.</div>
              ) : null}
              {project.account_managers.map((j, i) =>
                j.user ? (
                  <div key={`am-${i}`}>
                    <span>{j.user.full_name ?? j.user.email}</span>
                    <span className="ml-2 text-[10px] uppercase tracking-widest text-[hsl(var(--subtle-foreground))]">
                      Account
                    </span>
                  </div>
                ) : null,
              )}
              {project.designers.map((j, i) =>
                j.user ? (
                  <div key={`d-${i}`}>
                    <span>{j.user.full_name ?? j.user.email}</span>
                    <span className="ml-2 text-[10px] uppercase tracking-widest text-[hsl(var(--subtle-foreground))]">
                      Design
                    </span>
                  </div>
                ) : null,
              )}
            </div>
          </div>
          <div className="hq-card">
            <div className="hq-card-headbar">
              <span className="h-card">Status Notes</span>
            </div>
            <div className="p-6 text-sm text-[hsl(var(--muted-foreground))] whitespace-pre-wrap">
              {project.notes || "(empty)"}
            </div>
          </div>
          <div className="hq-card">
            <div className="hq-card-headbar">
              <span className="h-card">Client Notes</span>
            </div>
            <div className="p-6 text-sm text-[hsl(var(--subtle-foreground))]">
              Client Notes lands when Phase 5.2.2 adds the projects.client_notes column.
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
