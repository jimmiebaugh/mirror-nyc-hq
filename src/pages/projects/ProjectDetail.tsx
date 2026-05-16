import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  IconArrowLeft,
  IconDrive,
  IconSlack,
  IconExt,
} from "@/components/icons/HQIcons";
import {
  projectStatusToken,
  deliverableStatusToken,
  taskStatusToken,
  statusTextDecoration,
} from "@/lib/home/projectStatusToken";
import {
  formatMediumDate,
  formatShortDate,
  daysUntil,
  relativeDay,
} from "@/lib/hq/dates";
import type { ProjectStatus } from "@/lib/projects/queries";

/**
 * Surface 07 Project Detail. Wireframe-fidelity rebuild (Phase 5.2.1
 * Revision); renders the structure at OUTPUTS/phase-5-hq-wireframe-v1-
 * LOCKED.html lines 1318-1482.
 *
 *   crumb -> title row (h-page + right stack pill+Edit) -> meta row
 *     -> folder buttons row -> g3 stat strip -> 2col grid
 *   Left col cards: Overview (kv) / Deliverables (.tbl) / Tasks (.tbl) /
 *   Attachments empty.
 *   Sidebar cards: Team / Status Notes / Client Notes / Project Activity.
 */

type Project = {
  id: string;
  name: string;
  status: ProjectStatus;
  install_dates_start: string | null;
  install_dates_end: string | null;
  live_dates_start: string | null;
  live_dates_end: string | null;
  removal_dates_start: string | null;
  removal_dates_end: string | null;
  production_folder_url: string | null;
  design_decks_folder_url: string | null;
  slack_channel_url: string | null;
  budget_sheet_url: string | null;
  status_notes: string | null;
  client_notes: string | null;
  job_number: string | null;
  category: string | null;
  city: string | null;
  tags: string[] | null;
  budget: number | null;
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

function formatBudget(b: number | null): string {
  if (b == null) return "-";
  return `$${b.toLocaleString("en-US")}`;
}

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
            `id, name, status, install_dates_start, install_dates_end,
             live_dates_start, live_dates_end,
             removal_dates_start, removal_dates_end,
             production_folder_url, design_decks_folder_url, slack_channel_url,
             budget_sheet_url, status_notes, client_notes,
             job_number, category, city, tags, budget,
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
          .select("id, title, status, priority, due_date, assignee:users!tasks_assignee_id_fkey(full_name, email)")
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

  if (loading) {
    return (
      <div className="empty">
        <p>Loading...</p>
      </div>
    );
  }
  if (!project) {
    return (
      <div className="empty">
        <p>Project not found.</p>
      </div>
    );
  }

  const nextDeliverable = deliverables
    .filter((d) => d.due_date && (d.status === "Upcoming" || d.status === "In Progress"))
    .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""))[0];

  const thisWeekDeliverable = (() => {
    const today = new Date();
    const day = today.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const monday = new Date(today);
    monday.setDate(today.getDate() + mondayOffset);
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const mondayIso = monday.toISOString().slice(0, 10);
    const sundayIso = sunday.toISOString().slice(0, 10);
    return deliverables.find(
      (d) =>
        d.due_date &&
        d.due_date >= mondayIso &&
        d.due_date <= sundayIso &&
        (d.status === "Upcoming" || d.status === "In Progress"),
    );
  })();

  // Days-until-Install prefers the new install_dates_start column; falls
  // back to live_dates_start for projects that haven't been backfilled.
  const installCountdownIso =
    project.install_dates_start ?? project.live_dates_start;
  const installDays = installCountdownIso ? daysUntil(installCountdownIso) : null;

  const folderButtons = [
    { label: "Production", url: project.production_folder_url, Icon: IconDrive },
    { label: "Design", url: project.design_decks_folder_url, Icon: IconDrive },
    { label: "Slack", url: project.slack_channel_url, Icon: IconSlack },
    { label: "Server", url: null, Icon: IconDrive },
  ];

  const statusToken = projectStatusToken(project.status);

  return (
    <div className="stack-4">
      <Link to="/projects" className="tlink">
        <IconArrowLeft className="ic" />
        Back to Projects
      </Link>

      <header
        className="stack-3"
        style={{ display: "grid", gridTemplateColumns: "1fr 172px", alignItems: "end", gap: 16 }}
      >
        <div className="stack-3">
          <h1 className="h-page" style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
            {project.job_number ? (
              <span className="text-primary">#{project.job_number}</span>
            ) : null}
            {project.client?.name ? (
              <>
                <span>{project.client.name}</span>
                <span className="subtle">·</span>
              </>
            ) : null}
            <span>{project.name}</span>
          </h1>
          <div className="row-c" style={{ gap: 24 }}>
            <span className="cap">
              {[project.category, project.city].filter(Boolean).join(" · ") || ""}
            </span>
          </div>
          <div className="g3" style={{ gap: 16, maxWidth: 640 }}>
            <div>
              <div className="label-form">Install</div>
              <div className="mono" style={{ marginTop: 4 }}>
                {project.install_dates_start
                  ? `${formatShortDate(project.install_dates_start)}${
                      project.install_dates_end
                        ? ` to ${formatShortDate(project.install_dates_end)}`
                        : ""
                    }`
                  : "-"}
              </div>
            </div>
            <div>
              <div className="label-form">Live</div>
              <div className="mono" style={{ marginTop: 4 }}>
                {project.live_dates_start
                  ? `${formatShortDate(project.live_dates_start)}${
                      project.live_dates_end ? ` to ${formatShortDate(project.live_dates_end)}` : ""
                    }`
                  : "-"}
              </div>
            </div>
            <div>
              <div className="label-form">Removal</div>
              <div className="mono" style={{ marginTop: 4 }}>
                {project.removal_dates_start
                  ? `${formatShortDate(project.removal_dates_start)}${
                      project.removal_dates_end
                        ? ` to ${formatShortDate(project.removal_dates_end)}`
                        : ""
                    }`
                  : "-"}
              </div>
            </div>
          </div>
          <div className="row-c wrap">
            {folderButtons.map((b) => (
              <a
                key={b.label}
                href={b.url ?? "#"}
                target={b.url ? "_blank" : undefined}
                rel={b.url ? "noopener noreferrer" : undefined}
                className={`btn ${b.url ? "btn-secondary" : "btn-secondary"} btn-sm`}
                style={
                  b.url
                    ? undefined
                    : { opacity: 0.45, pointerEvents: "none", cursor: "not-allowed" }
                }
                onClick={(e) => {
                  if (!b.url) e.preventDefault();
                }}
              >
                <b.Icon className="ic" />
                {b.label}
              </a>
            ))}
          </div>
        </div>
        <div className="stack-2" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span
            className={`pill pill-lg p-${statusToken}`}
            style={{ width: "100%", justifyContent: "center" }}
          >
            <span className="dt" />
            {project.status}
          </span>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => navigate(`/projects/${project.id}/edit`)}
          >
            Edit Project
          </button>
        </div>
      </header>

      <div className="g3">
        <div className="stat">
          <div className="lbl">Next Deliverable</div>
          <div className="num">{nextDeliverable?.title ?? "-"}</div>
          <div className="sub">
            {nextDeliverable?.due_date
              ? `${relativeDay(nextDeliverable.due_date)} · ${formatMediumDate(nextDeliverable.due_date)}`
              : "Nothing dated"}
          </div>
        </div>
        <div className="stat">
          <div className="lbl">This Week</div>
          <div className="num">{thisWeekDeliverable?.title ?? "-"}</div>
          <div className="sub">
            {thisWeekDeliverable?.due_date
              ? formatMediumDate(thisWeekDeliverable.due_date)
              : nextDeliverable?.due_date
                ? `Next: ${relativeDay(nextDeliverable.due_date)}`
                : "Nothing dated this week"}
          </div>
        </div>
        <div className="stat stat--accent">
          <div className="lbl">Days Until Install</div>
          <div className="num">{installDays != null ? `${installDays}` : "-"}</div>
          <div className="sub">
            {installCountdownIso ? formatMediumDate(installCountdownIso) : "No install date"}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 332px", gap: 24, alignItems: "start" }}>
        <div className="stack-6">
          <section className="card">
            <div className="card-headbar">
              <span className="h-card">Overview</span>
            </div>
            <div className="card-pad g2" style={{ gap: 12 }}>
              <dl className="kv">
                <dt>Job #</dt>
                <dd>{project.job_number ?? "-"}</dd>
                <dt>Category</dt>
                <dd>{project.category ?? "-"}</dd>
                <dt>City</dt>
                <dd>{project.city ?? "-"}</dd>
                <dt>Client</dt>
                <dd>
                  {project.client?.id ? (
                    <Link
                      to={`/clients/${project.client.id}`}
                      className="tlink"
                      style={{ color: "rgba(190,78,68,.85)" }}
                    >
                      {project.client.name}
                    </Link>
                  ) : (
                    "-"
                  )}
                </dd>
                <dt>Venues</dt>
                <dd>
                  {project.venues.length === 0
                    ? "-"
                    : project.venues.map((pv, i) =>
                        pv.venue ? (
                          <span key={pv.venue.id}>
                            <Link to={`/venues/${pv.venue.id}`} className="tlink">
                              {pv.venue.name}
                            </Link>
                            {i < project.venues.length - 1 ? <span className="muted">, </span> : null}
                          </span>
                        ) : null,
                      )}
                </dd>
              </dl>
              <dl className="kv">
                <dt>Install</dt>
                <dd>
                  {project.install_dates_start
                    ? `${formatShortDate(project.install_dates_start)}${
                        project.install_dates_end
                          ? ` to ${formatShortDate(project.install_dates_end)}`
                          : ""
                      }`
                    : <span className="muted subtle">Not set</span>}
                </dd>
                <dt>Live</dt>
                <dd>
                  {project.live_dates_start
                    ? `${formatShortDate(project.live_dates_start)}${
                        project.live_dates_end ? ` to ${formatShortDate(project.live_dates_end)}` : ""
                      }`
                    : <span className="muted subtle">Not set</span>}
                </dd>
                <dt>Removal</dt>
                <dd>
                  {project.removal_dates_start
                    ? `${formatShortDate(project.removal_dates_start)}${
                        project.removal_dates_end
                          ? ` to ${formatShortDate(project.removal_dates_end)}`
                          : ""
                      }`
                    : <span className="muted subtle">Not set</span>}
                </dd>
                <dt>Budget</dt>
                <dd>{formatBudget(project.budget)}</dd>
                <dt>Tags</dt>
                <dd>
                  {project.tags && project.tags.length > 0 ? (
                    <span className="row-c wrap" style={{ display: "inline-flex", gap: 6 }}>
                      {project.tags.map((t) => (
                        <span key={t} className="tag">{t}</span>
                      ))}
                    </span>
                  ) : (
                    "-"
                  )}
                </dd>
              </dl>
            </div>
          </section>

          <section className="card">
            <div className="card-headbar">
              <span className="h-card">Deliverables</span>
              <button
                type="button"
                className="tlink"
                onClick={() => navigate(`/deliverables/new?project=${project.id}`)}
              >
                + Add deliverable
              </button>
            </div>
            {deliverables.length === 0 ? (
              <div className="card-pad subtle">No deliverables yet.</div>
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Deliverable</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th className="r">Due</th>
                  </tr>
                </thead>
                <tbody>
                  {deliverables.map((d) => {
                    const token = deliverableStatusToken(d.status);
                    return (
                      <tr
                        key={d.id}
                        className={`rb-${token}`}
                        style={{ cursor: "pointer" }}
                        onClick={() => navigate(`/deliverables/${d.id}`)}
                      >
                        <td className={statusTextDecoration("deliverable", d.status)}>
                          {d.title}
                        </td>
                        <td className="muted">{d.type ?? "-"}</td>
                        <td>
                          <span className={`pill p-${token}`}>
                            <span className="dt" />
                            {d.status}
                          </span>
                        </td>
                        <td className="r mono">
                          {d.due_date ? formatShortDate(d.due_date) : "-"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>

          <section className="card">
            <div className="card-headbar">
              <span className="h-card">Tasks</span>
              <button
                type="button"
                className="tlink"
                onClick={() => navigate(`/tasks/new?project=${project.id}`)}
              >
                + Add task
              </button>
            </div>
            {tasks.length === 0 ? (
              <div className="card-pad subtle">No tasks yet.</div>
            ) : (
              <table className="tbl">
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
                  {tasks.map((t) => {
                    const token = taskStatusToken(t.status);
                    return (
                      <tr
                        key={t.id}
                        className={`rb-${token}`}
                        style={{ cursor: "pointer" }}
                        onClick={() => navigate(`/tasks/${t.id}`)}
                      >
                        <td className={statusTextDecoration("task", t.status)}>{t.title}</td>
                        <td className="muted">
                          {t.assignee?.full_name ?? t.assignee?.email ?? "-"}
                        </td>
                        <td>
                          <span className={`pill pill-sm p-${t.priority === "Urgent" ? "destructive" : t.priority === "High" ? "warn" : "muted"}`}>
                            {t.priority}
                          </span>
                        </td>
                        <td>
                          <span className={`pill p-${token}`}>
                            <span className="dt" />
                            {t.status}
                          </span>
                        </td>
                        <td className="r mono">
                          {t.due_date ? formatShortDate(t.due_date) : "-"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>

          <section className="card empty" style={{ borderStyle: "dashed" }}>
            <p>No attachments yet</p>
            <button type="button" className="btn btn-secondary btn-sm" disabled>
              Upload (coming in 5.4)
            </button>
          </section>
        </div>

        <aside className="stack-6">
          <section className="card">
            <div className="card-headbar">
              <span className="h-card">Team</span>
            </div>
            <div className="card-pad stack-3">
              {project.account_managers.length === 0 && project.designers.length === 0 ? (
                <div className="subtle">No team assigned.</div>
              ) : null}
              {project.account_managers.map((j, i) =>
                j.user ? (
                  <div key={`am-${i}`} className="row-c">
                    <span className="av-i">
                      {(j.user.full_name ?? j.user.email ?? "?").slice(0, 2).toUpperCase()}
                    </span>
                    <div>
                      <div>{j.user.full_name ?? j.user.email}</div>
                      <div className="cap">Account</div>
                    </div>
                  </div>
                ) : null,
              )}
              {project.designers.map((j, i) =>
                j.user ? (
                  <div key={`d-${i}`} className="row-c">
                    <span className="av-i">
                      {(j.user.full_name ?? j.user.email ?? "?").slice(0, 2).toUpperCase()}
                    </span>
                    <div>
                      <div>{j.user.full_name ?? j.user.email}</div>
                      <div className="cap">Design</div>
                    </div>
                  </div>
                ) : null,
              )}
            </div>
          </section>

          <section className="card">
            <div className="card-headbar">
              <span className="h-card">Status Notes</span>
              <button
                type="button"
                className="tlink"
                onClick={() => navigate(`/projects/${project.id}/edit`)}
              >
                Edit
              </button>
            </div>
            <div className="card-pad muted" style={{ whiteSpace: "pre-wrap" }}>
              {project.status_notes || "(empty)"}
            </div>
          </section>

          <section className="card">
            <div className="card-headbar">
              <span className="h-card">Client Notes</span>
              <button
                type="button"
                className="tlink"
                onClick={() => navigate(`/projects/${project.id}/edit`)}
              >
                Edit
              </button>
            </div>
            <div className="card-pad muted" style={{ whiteSpace: "pre-wrap" }}>
              {project.client_notes || "(empty)"}
            </div>
          </section>

          <section className="card">
            <div className="card-headbar">
              <span className="h-card">Project Activity</span>
              <a className="tlink" href="/activity">
                View all
                <IconExt className="ic" style={{ width: 11, height: 11 }} />
              </a>
            </div>
            <div className="card-pad subtle">
              Activity feed lands in 5.5. This card will populate from the
              activity_log table once the feed surface ships.
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
