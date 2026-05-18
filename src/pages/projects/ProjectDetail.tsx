import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Check, Pencil, Plus, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  IconArrowLeft,
  IconDrive,
  IconSlack,
  IconExt,
  IconActivity,
  IconClients,
  IconComment,
  IconDeliverables,
  IconLock,
  IconOrgs,
  IconOutlook,
  IconPeople,
  IconProjects,
  IconTasks,
  IconVenues,
  IconWiki,
} from "@/components/icons/HQIcons";
import {
  loadActivityByProject,
  type ActivityRow,
  type ActivityViewerRole,
} from "@/lib/activity/queries";
import {
  activityRowTimestamp,
  formatActivitySentence,
  iconKeyForEntity,
} from "@/lib/activity/formatSentence";
import { useUserRole } from "@/hooks/useUserRole";
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
import {
  PROJECT_STATUS_VALUES,
  updateProjectStatus,
  type ProjectStatus,
} from "@/lib/projects/queries";
import { useBackHref } from "@/lib/hq/useBackHref";
import { InlineEditText } from "@/components/hq/InlineEditText";
import { InternalNotesEditor } from "@/components/data/InternalNotesEditor";
import { InlineTagInput } from "@/components/hq/InlineTagInput";
import { ClickPillCell } from "@/components/hq/ClickPillCell";
import { RecordCombobox } from "@/components/ui/RecordCombobox";
import {
  createClientInline,
  createVenueInline,
  CLIENT_MINI_CREATE_FIELDS,
  VENUE_MINI_CREATE_FIELDS,
} from "@/lib/hq/inlineCreate";
import { toast } from "@/hooks/use-toast";

/**
 * Surface 07 Project Detail.
 *
 * Phase 5.6.3.1: detail-page inline-edit pattern. Most fields save
 * themselves optimistically. Pencil button (icon-only) at top-right
 * stays as the power-edit / bulk fallback (the Team picker, the Vendors
 * picker, the four URL fields, etc. still route through ProjectEdit;
 * inline single-field edit covers the kv content). h1 is the project
 * name only; job # / client now live as proper inline rows in the
 * Overview kv (was previously crammed into the title composite).
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
  tags: string[];
  budget: number | null;
  client_id: string | null;
  client: { id: string; name: string | null } | null;
  venues: { venue: { id: string; name: string | null } | null }[];
  account_managers: { user: { id: string; full_name: string | null; email: string | null } | null }[];
  designers: { user: { id: string; full_name: string | null; email: string | null } | null }[];
  members: { user: { id: string; full_name: string | null; email: string | null } | null }[];
};

type Deliverable = {
  id: string;
  title: string;
  type: string | null;
  status: "Upcoming" | "Complete" | "Skipped";
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

type VendorLink = {
  id: string;
  name: string;
  category_name: string | null;
};

function formatBudget(b: number | null): string {
  if (b == null) return "-";
  return `$${b.toLocaleString("en-US")}`;
}

// Phase 5.7.3 § 3.F: row-dot icon for the Project Activity card. Same mapping
// the global ActivityFeed uses (kept inline so this card doesn't pull in the
// full feed component).
function ActivityRowIcon({ entityType }: { entityType: string }) {
  const key = iconKeyForEntity(entityType);
  const style = { width: 14, height: 14 } as const;
  switch (key) {
    case "project":       return <IconProjects style={style} />;
    case "task":          return <IconTasks style={style} />;
    case "deliverable":   return <IconDeliverables style={style} />;
    case "venue":         return <IconVenues style={style} />;
    case "vendor":        return <IconOrgs style={style} />;
    case "client":        return <IconClients style={style} />;
    case "person":        return <IconPeople style={style} />;
    case "wiki_page":     return <IconWiki style={style} />;
    case "credential":    return <IconLock style={style} />;
    case "outlook_entry": return <IconOutlook style={style} />;
    case "notes_log":     return <IconComment style={style} />;
    default:              return <IconActivity style={style} />;
  }
}

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [vendors, setVendors] = useState<VendorLink[]>([]);
  const [vendorOptions, setVendorOptions] = useState<{ id: string; label: string }[]>([]);
  const [vendorPickerOpen, setVendorPickerOpen] = useState(false);
  const [vendorSearch, setVendorSearch] = useState("");
  const [clientOptions, setClientOptions] = useState<{ id: string; label: string }[]>([]);
  const [venueOptions, setVenueOptions] = useState<{ id: string; label: string }[]>([]);
  const [venueIds, setVenueIds] = useState<string[]>([]);
  const [userOptions, setUserOptions] = useState<{ id: string; label: string }[]>([]);
  const [memberPickerOpen, setMemberPickerOpen] = useState(false);
  const [memberSearch, setMemberSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [activityRows, setActivityRows] = useState<ActivityRow[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityError, setActivityError] = useState<Error | null>(null);
  const back = useBackHref({ to: "/projects", label: "Projects" });
  const { isAdmin, isFreelance, loading: roleLoading } = useUserRole();
  const viewerRole: ActivityViewerRole = isAdmin
    ? "admin"
    : isFreelance
      ? "freelance"
      : "standard";

  useEffect(() => {
    if (!id) return;
    let active = true;
    (async () => {
      const [proj, dels, tks, vds, clientsRes, venuesAllRes, vendorsAllRes, usersAllRes] = await Promise.all([
        supabase
          .from("projects")
          .select(
            `id, name, status, install_dates_start, install_dates_end,
             live_dates_start, live_dates_end,
             removal_dates_start, removal_dates_end,
             production_folder_url, design_decks_folder_url, slack_channel_url,
             budget_sheet_url, status_notes, client_notes,
             job_number, category, city, tags, budget, client_id,
             client:clients!projects_client_id_fkey(id, name),
             venues:project_venues(venue:venues!project_venues_venue_id_fkey(id, name)),
             account_managers:project_account_managers(user:users(id, full_name, email)),
             designers:project_designers(user:users(id, full_name, email)),
             members:project_members(user:users!project_members_user_id_fkey(id, full_name, email))`,
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
        supabase
          .from("project_vendors")
          .select(
            "created_at, vendor:vendors!project_vendors_vendor_id_fkey(id, name, category:vendor_categories!vendors_category_id_fkey(name))",
          )
          .eq("project_id", id)
          .order("created_at", { ascending: false }),
        supabase.from("clients").select("id, name").order("name", { ascending: true }),
        supabase.from("venues").select("id, name").order("name", { ascending: true }),
        supabase.from("vendors").select("id, name").order("name", { ascending: true }),
        supabase
          .from("users")
          .select("id, full_name, email")
          .eq("active", true)
          .order("full_name", { ascending: true }),
      ]);
      if (!active) return;
      if (proj.error) {
        console.warn("project load failed", proj.error);
        setLoading(false);
        return;
      }
      const projRow = proj.data as unknown as Omit<Project, "tags" | "venues" | "members"> & {
        tags: string[] | null;
        venues: { venue: { id: string; name: string | null } | null }[] | null;
        members: { user: { id: string; full_name: string | null; email: string | null } | null }[] | null;
      };
      const venueJoin = projRow.venues ?? [];
      setProject({
        ...projRow,
        tags: projRow.tags ?? [],
        venues: venueJoin,
        members: projRow.members ?? [],
      });
      setVenueIds(
        venueJoin
          .map((pv) => pv.venue?.id)
          .filter((v): v is string => !!v),
      );
      setDeliverables((dels.data ?? []) as unknown as Deliverable[]);
      setTasks((tks.data ?? []) as unknown as TaskRow[]);
      const vendorRows: VendorLink[] = [];
      for (const r of vds.data ?? []) {
        const row = r as unknown as {
          vendor: {
            id: string;
            name: string | null;
            category: { name: string | null } | null;
          } | null;
        };
        if (row.vendor) {
          vendorRows.push({
            id: row.vendor.id,
            name: row.vendor.name ?? "Untitled",
            category_name: row.vendor.category?.name ?? null,
          });
        }
      }
      setVendors(vendorRows);
      setClientOptions(
        ((clientsRes.data ?? []) as { id: string; name: string | null }[]).map((c) => ({
          id: c.id,
          label: c.name ?? "Untitled",
        })),
      );
      setVenueOptions(
        ((venuesAllRes.data ?? []) as { id: string; name: string | null }[]).map((v) => ({
          id: v.id,
          label: v.name ?? "Untitled",
        })),
      );
      setVendorOptions(
        ((vendorsAllRes.data ?? []) as { id: string; name: string | null }[]).map((v) => ({
          id: v.id,
          label: v.name ?? "Untitled",
        })),
      );
      setUserOptions(
        ((usersAllRes.data ?? []) as { id: string; full_name: string | null; email: string | null }[]).map((u) => ({
          id: u.id,
          label: u.full_name ?? u.email ?? "Unnamed",
        })),
      );
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [id]);

  const saveField = async <K extends keyof Project>(
    field: K,
    nextValue: Project[K],
  ): Promise<void> => {
    if (!project) return;
    const prev = project[field];
    setProject({ ...project, [field]: nextValue });
    const { error } = await supabase
      .from("projects")
      .update({ [field as string]: nextValue })
      .eq("id", project.id);
    if (error) {
      setProject({ ...project, [field]: prev });
      throw error;
    }
  };

  const saveClientId = async (nextId: string | null) => {
    if (!project) return;
    const prev = { client_id: project.client_id, client: project.client };
    const nextClient = nextId ? clientOptions.find((c) => c.id === nextId) ?? null : null;
    setProject({
      ...project,
      client_id: nextId,
      client: nextClient ? { id: nextClient.id, name: nextClient.label } : null,
    });
    const { error } = await supabase
      .from("projects")
      .update({ client_id: nextId })
      .eq("id", project.id);
    if (error) {
      setProject({ ...project, ...prev });
      toast({ title: "Client save failed", description: error.message, variant: "destructive" });
    }
  };

  // project_venues diff-on-save (mirrors PersonDetail's saveVenueIds for
  // the venue_contact_people join, but against project_venues).
  const saveVenueIds = async (nextIds: string[]) => {
    if (!project) return;
    const prevIds = venueIds;
    setVenueIds(nextIds);
    const toAdd = nextIds.filter((v) => !prevIds.includes(v));
    const toRemove = prevIds.filter((v) => !nextIds.includes(v));
    try {
      for (const venueId of toAdd) {
        const { error } = await supabase
          .from("project_venues")
          .insert({ project_id: project.id, venue_id: venueId });
        if (error) throw error;
      }
      for (const venueId of toRemove) {
        const { error } = await supabase
          .from("project_venues")
          .delete()
          .eq("project_id", project.id)
          .eq("venue_id", venueId);
        if (error) throw error;
      }
      // Refresh the visible venue label list.
      setProject({
        ...project,
        venues: nextIds
          .map((vid) => venueOptions.find((o) => o.id === vid))
          .filter((o): o is { id: string; label: string } => !!o)
          .map((o) => ({ venue: { id: o.id, name: o.label } })),
      });
    } catch (err) {
      setVenueIds(prevIds);
      const message = err instanceof Error ? err.message : "Save failed";
      toast({ title: "Venues save failed", description: message, variant: "destructive" });
    }
  };

  const loadClientOptions = useCallback(async () => clientOptions, [clientOptions]);
  const loadVenueOptions = useCallback(async () => venueOptions, [venueOptions]);

  // Phase 5.7.3 followup-12: inline Vendors picker on the detail page.
  // Toggles a project_vendors join row directly; optimistic local update +
  // rollback toast on failure (matches saveVenueIds shape).
  const toggleVendor = async (vendorId: string) => {
    if (!project) return;
    const previous = vendors;
    const isSelected = vendors.some((v) => v.id === vendorId);
    if (isSelected) {
      setVendors(vendors.filter((v) => v.id !== vendorId));
      const { error } = await supabase
        .from("project_vendors")
        .delete()
        .eq("project_id", project.id)
        .eq("vendor_id", vendorId);
      if (error) {
        setVendors(previous);
        toast({
          title: "Could not remove vendor",
          description: error.message,
          variant: "destructive",
        });
      }
    } else {
      const opt = vendorOptions.find((v) => v.id === vendorId);
      if (!opt) return;
      const optimistic = [
        ...vendors,
        { id: opt.id, name: opt.label, category_name: null },
      ];
      setVendors(optimistic);
      const { error } = await supabase
        .from("project_vendors")
        .insert({ project_id: project.id, vendor_id: vendorId });
      if (error) {
        setVendors(previous);
        toast({
          title: "Could not add vendor",
          description: error.message,
          variant: "destructive",
        });
      } else {
        // Refresh just the category for the newly added vendor.
        const { data } = await supabase
          .from("vendors")
          .select(
            "id, name, category:vendor_categories!vendors_category_id_fkey(name)",
          )
          .eq("id", vendorId)
          .single();
        const row = data as unknown as {
          id: string;
          name: string | null;
          category: { name: string | null } | null;
        } | null;
        if (row) {
          setVendors((prev) =>
            prev.map((v) =>
              v.id === vendorId
                ? {
                    id: row.id,
                    name: row.name ?? "Untitled",
                    category_name: row.category?.name ?? null,
                  }
                : v,
            ),
          );
        }
      }
    }
  };

  // Phase 5.7.7: project_members general bucket. Add + remove fire the
  // join row optimistically; the AM + D buckets stay edit-page only.
  const handleAddMember = async (userId: string) => {
    if (!project) return;
    const opt = userOptions.find((u) => u.id === userId);
    if (!opt) return;
    const prev = project.members;
    const optimistic = [
      ...project.members,
      { user: { id: opt.id, full_name: opt.label, email: null } },
    ];
    setProject({ ...project, members: optimistic });
    setMemberPickerOpen(false);
    setMemberSearch("");
    const { data: userRes } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("project_members")
      .insert({
        project_id: project.id,
        user_id: userId,
        created_by: userRes.user?.id ?? null,
      });
    if (error) {
      setProject({ ...project, members: prev });
      toast({
        title: "Could not add to team",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!project) return;
    const prev = project.members;
    setProject({
      ...project,
      members: project.members.filter((j) => j.user?.id !== userId),
    });
    const { error } = await supabase
      .from("project_members")
      .delete()
      .eq("project_id", project.id)
      .eq("user_id", userId);
    if (error) {
      setProject({ ...project, members: prev });
      toast({
        title: "Could not remove from team",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  // Phase 5.7.3 § 3.F: hydrate the Project Activity card. Wait on the
  // user-role hook so the `viewerRole` filter matches the global feed
  // (avoids a flash of admin-tier rows for a standard viewer).
  useEffect(() => {
    if (!id || roleLoading) return;
    let active = true;
    setActivityLoading(true);
    setActivityError(null);
    loadActivityByProject({ projectId: id, limit: 5, viewerRole })
      .then((rows) => {
        if (!active) return;
        setActivityRows(rows);
        setActivityLoading(false);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setActivityError(err instanceof Error ? err : new Error("Activity load failed"));
        setActivityLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id, viewerRole, roleLoading]);

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
    .filter((d) => d.due_date && d.status === "Upcoming")
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
        d.status === "Upcoming",
    );
  })();

  const installCountdownIso =
    project.install_dates_start ?? project.live_dates_start;
  const installDays = installCountdownIso ? daysUntil(installCountdownIso) : null;

  const folderButtons = [
    { label: "Production", url: project.production_folder_url, Icon: IconDrive },
    { label: "Design", url: project.design_decks_folder_url, Icon: IconDrive },
    { label: "Slack", url: project.slack_channel_url, Icon: IconSlack },
    { label: "Server", url: null, Icon: IconDrive },
  ];

  return (
    <div className="stack-4">
      <Link to={back.to} className="tlink">
        <IconArrowLeft className="ic" />
        Back to {back.label}
      </Link>

      <header className="stack-3">
        <div className="row between" style={{ alignItems: "center" }}>
          <div className="row-c" style={{ gap: 16, alignItems: "center" }}>
            <h1 className="h-page">{project.name || "(untitled)"}</h1>
            <ClickPillCell
              value={project.status}
              options={PROJECT_STATUS_VALUES}
              tokenMap={projectStatusToken}
              size="lg"
              onSave={async (next) => {
                await updateProjectStatus(project.id, next as ProjectStatus);
                setProject({ ...project, status: next as ProjectStatus });
              }}
            />
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            aria-label="Edit Project"
            title="Edit Project"
            onClick={() => navigate(`/projects/${project.id}/edit`)}
            style={{ padding: "0 10px" }}
          >
            <Pencil className="ic" style={{ width: 14, height: 14 }} />
          </button>
        </div>
        <div className="row-c" style={{ gap: 24 }}>
          <span
            className="cap"
            style={{ fontSize: 16, letterSpacing: ".06em" }}
          >
            {[
              project.job_number ? `#${project.job_number}` : null,
              project.category,
              project.city,
            ]
              .filter(Boolean)
              .join(" · ") || ""}
          </span>
        </div>
        <div
          className="row between"
          style={{ alignItems: "flex-end", gap: 24, flexWrap: "wrap" }}
        >
          <div className="row-c" style={{ gap: 0, flexWrap: "wrap" }}>
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
            <div
              style={{
                marginLeft: 24,
                paddingLeft: 24,
                borderLeft: "1px solid hsl(var(--border))",
              }}
            >
              <div className="label-form">Live</div>
              <div className="mono" style={{ marginTop: 4 }}>
                {project.live_dates_start
                  ? `${formatShortDate(project.live_dates_start)}${
                      project.live_dates_end ? ` to ${formatShortDate(project.live_dates_end)}` : ""
                    }`
                  : "-"}
              </div>
            </div>
            <div
              style={{
                marginLeft: 24,
                paddingLeft: 24,
                borderLeft: "1px solid hsl(var(--border))",
              }}
            >
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
                    ? { height: 36, fontSize: 13 }
                    : {
                        height: 36,
                        fontSize: 13,
                        opacity: 0.45,
                        pointerEvents: "none",
                        cursor: "not-allowed",
                      }
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
      </header>

      {/* Top 3-stat row mirrors the Overview/Team 70/30 grid below so
          the stat tiles' left + right edges line up with the cards
          underneath: Next Deliverable left = Overview left, This Week
          right = Overview right, Days Until Install spans the Team
          column. Cards land near-equal width at typical viewport
          (~33% / 33% / 30%); exact equality + alignment would need a
          ~9% gap which doesn't read clean. */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 70%) minmax(0, 30%)", gap: 24, alignItems: "start" }}>
        <div className="g2" style={{ gap: 24 }}>
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
        </div>
        <div className="stat stat--accent">
          <div className="lbl">Days Until Install</div>
          <div className="num">{installDays != null ? `${installDays}` : "-"}</div>
          <div className="sub">
            {installCountdownIso ? formatMediumDate(installCountdownIso) : "No install date"}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 70%) minmax(0, 30%)", gap: 24, alignItems: "start" }}>
        <div className="stack-6" style={{ minWidth: 0 }}>
          <section className="card">
            <div className="card-headbar">
              <span className="h-card">Overview</span>
            </div>
            <div className="card-pad g2" style={{ gap: 24 }}>
              {/* Left column: Job # → Client → Title → City → Budget (per
                  Phase 5.6.3.1 reorder request). */}
              <dl className="kv">
                <dt>Job #</dt>
                <dd>
                  <InlineEditText
                    value={project.job_number}
                    placeholder="Job number"
                    renderRead={(v) =>
                      v ? <span className="mono">#{v}</span> : <span className="muted subtle">-</span>
                    }
                    onSave={(next) => saveField("job_number", next || null)}
                  />
                </dd>
                <dt>Client</dt>
                <dd>
                  <RecordCombobox
                    source={{ kind: "record", loadOptions: loadClientOptions }}
                    value={project.client_id}
                    onChange={(next) => void saveClientId(next)}
                    entityLabel="Client"
                    placeholder="No client"
                    quickCreate
                    getRecordHref={(id) => `/clients/${id}`}
                    miniCreateFields={CLIENT_MINI_CREATE_FIELDS}
                    onMiniCreate={async (data) => {
                      const created = await createClientInline(data);
                      if (created) {
                        setClientOptions((prev) =>
                          [...prev, created].sort((a, b) =>
                            a.label.localeCompare(b.label),
                          ),
                        );
                      }
                      return created;
                    }}
                  />
                </dd>
                <dt>Title</dt>
                <dd>
                  <InlineEditText
                    value={project.name}
                    required
                    placeholder="Project name"
                    renderRead={(v) => v ?? "(untitled)"}
                    onSave={(next) => saveField("name", next)}
                  />
                </dd>
                <dt>City</dt>
                <dd>
                  <RecordCombobox
                    source={{ kind: "lookup", table: "cities" }}
                    value={project.city || null}
                    onChange={(next) => void saveField("city", next || null)}
                    entityLabel="city"
                    placeholder="Select"
                  />
                </dd>
                <dt>Budget</dt>
                <dd>
                  <InlineEditText
                    value={project.budget != null ? String(project.budget) : null}
                    placeholder="$185,000"
                    renderRead={(v) =>
                      v ? formatBudget(Number(v)) : <span className="muted subtle">-</span>
                    }
                    onSave={(next) => {
                      const parsed = next ? Number(next.replace(/[$,\s]/g, "")) : null;
                      return saveField(
                        "budget",
                        parsed != null && Number.isFinite(parsed) ? parsed : null,
                      );
                    }}
                  />
                </dd>
                <dt>Category</dt>
                <dd>
                  <InlineEditText
                    value={project.category}
                    placeholder="Category"
                    renderRead={(v) => (v ? v : <span className="muted subtle">-</span>)}
                    onSave={(next) => saveField("category", next || null)}
                  />
                </dd>
              </dl>
              {/* Right column: Venue → Live (start/end pair, tight) → Install
                  (start/end pair, tight) → Removal (start/end pair, tight) →
                  Tags. Phase 5.7.3 followup-3: the three date pairs sit
                  inside a single bordered container with internal dividers
                  so the date trio reads as a grouped section. */}
              <div className="stack-4">
                <dl className="kv">
                  <dt>Venue</dt>
                  <dd>
                    <RecordCombobox
                      multi
                      source={{ kind: "record", loadOptions: loadVenueOptions }}
                      multiValue={venueIds}
                      onMultiChange={(next) => void saveVenueIds(next)}
                      entityLabel="Venue"
                      placeholder="Add venue..."
                      quickCreate
                      getRecordHref={(id) => `/venues/${id}`}
                      displayAs="stack"
                      miniCreateFields={VENUE_MINI_CREATE_FIELDS}
                      onMiniCreate={async (data) => {
                        const created = await createVenueInline(data);
                        if (created) {
                          setVenueOptions((prev) =>
                            [...prev, created].sort((a, b) =>
                              a.label.localeCompare(b.label),
                            ),
                          );
                        }
                        return created;
                      }}
                    />
                  </dd>
                </dl>
                <div
                  style={{
                    borderTop: "1px solid hsl(var(--border))",
                    borderBottom: "1px solid hsl(var(--border))",
                  }}
                >
                <dl
                  className="kv kv--pair"
                  style={{ paddingTop: 14, paddingBottom: 14 }}
                >
                  <dt>Live start</dt>
                  <dd>
                    <InlineEditText
                      value={project.live_dates_start}
                      placeholder="YYYY-MM-DD"
                      inputType="date"
                      renderRead={(v) =>
                        v ? formatShortDate(v) : <span className="muted subtle">Not set</span>
                      }
                      onSave={(next) => saveField("live_dates_start", next || null)}
                    />
                  </dd>
                  <dt>Live end</dt>
                  <dd>
                    <InlineEditText
                      value={project.live_dates_end}
                      placeholder="YYYY-MM-DD"
                      inputType="date"
                      renderRead={(v) =>
                        v ? formatShortDate(v) : <span className="muted subtle">-</span>
                      }
                      onSave={(next) => saveField("live_dates_end", next || null)}
                    />
                  </dd>
                </dl>
                <dl
                  className="kv kv--pair"
                  style={{
                    paddingTop: 14,
                    paddingBottom: 14,
                    borderTop: "1px solid hsl(var(--border))",
                  }}
                >
                  <dt>Install start</dt>
                  <dd>
                    <InlineEditText
                      value={project.install_dates_start}
                      placeholder="YYYY-MM-DD"
                      inputType="date"
                      renderRead={(v) =>
                        v ? formatShortDate(v) : <span className="muted subtle">Not set</span>
                      }
                      onSave={(next) => saveField("install_dates_start", next || null)}
                    />
                  </dd>
                  <dt>Install end</dt>
                  <dd>
                    <InlineEditText
                      value={project.install_dates_end}
                      placeholder="YYYY-MM-DD"
                      inputType="date"
                      renderRead={(v) =>
                        v ? formatShortDate(v) : <span className="muted subtle">-</span>
                      }
                      onSave={(next) => saveField("install_dates_end", next || null)}
                    />
                  </dd>
                </dl>
                <dl
                  className="kv kv--pair"
                  style={{
                    paddingTop: 14,
                    paddingBottom: 14,
                    borderTop: "1px solid hsl(var(--border))",
                  }}
                >
                  <dt>Removal start</dt>
                  <dd>
                    <InlineEditText
                      value={project.removal_dates_start}
                      placeholder="YYYY-MM-DD"
                      inputType="date"
                      renderRead={(v) =>
                        v ? formatShortDate(v) : <span className="muted subtle">Not set</span>
                      }
                      onSave={(next) => saveField("removal_dates_start", next || null)}
                    />
                  </dd>
                  <dt>Removal end</dt>
                  <dd>
                    <InlineEditText
                      value={project.removal_dates_end}
                      placeholder="YYYY-MM-DD"
                      inputType="date"
                      renderRead={(v) =>
                        v ? formatShortDate(v) : <span className="muted subtle">-</span>
                      }
                      onSave={(next) => saveField("removal_dates_end", next || null)}
                    />
                  </dd>
                </dl>
                </div>
                <dl className="kv">
                  <dt>Tags</dt>
                  <dd>
                    <InlineTagInput
                      values={project.tags}
                      onChange={(next) => void saveField("tags", next)}
                    />
                  </dd>
                </dl>
              </div>
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
        </div>

        <aside className="stack-6" style={{ minWidth: 0 }}>
          <section className="card">
            <div className="card-headbar">
              <span className="h-card">Team</span>
              <Popover
                open={memberPickerOpen}
                onOpenChange={(o) => {
                  setMemberPickerOpen(o);
                  if (!o) setMemberSearch("");
                }}
              >
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="combo-picker-btn"
                    aria-label="Add team member"
                    title="Add team member"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-[280px] p-0" align="end">
                  <Command shouldFilter>
                    <CommandInput
                      value={memberSearch}
                      onValueChange={setMemberSearch}
                      placeholder="Search users..."
                    />
                    <CommandList>
                      <CommandEmpty>No users.</CommandEmpty>
                      {userOptions.map((opt) => {
                        const isAlreadyOnProject =
                          project.account_managers.some((j) => j.user?.id === opt.id) ||
                          project.designers.some((j) => j.user?.id === opt.id) ||
                          project.members.some((j) => j.user?.id === opt.id);
                        return (
                          <CommandItem
                            key={opt.id}
                            value={opt.label}
                            disabled={isAlreadyOnProject}
                            onSelect={() => {
                              if (isAlreadyOnProject) return;
                              void handleAddMember(opt.id);
                            }}
                            className="cursor-pointer"
                          >
                            <span className="flex-1 truncate">{opt.label}</span>
                            {isAlreadyOnProject ? (
                              <span className="cap" style={{ opacity: 0.6 }}>
                                on project
                              </span>
                            ) : null}
                          </CommandItem>
                        );
                      })}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            <div className="card-pad stack-3">
              {project.account_managers.length === 0 &&
              project.designers.length === 0 &&
              project.members.length === 0 ? (
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
              {project.members.map((j, i) =>
                j.user ? (
                  <div
                    key={`m-${i}`}
                    className="row-c team-member-row"
                    style={{ justifyContent: "space-between" }}
                  >
                    <div className="row-c">
                      <span className="av-i">
                        {(j.user.full_name ?? j.user.email ?? "?").slice(0, 2).toUpperCase()}
                      </span>
                      <div>
                        <div>{j.user.full_name ?? j.user.email}</div>
                        <div className="cap">Team</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="combo-picker-btn team-member-remove"
                      aria-label={`Remove ${j.user.full_name ?? j.user.email ?? "member"} from team`}
                      title="Remove from team"
                      onClick={() => {
                        if (j.user) void handleRemoveMember(j.user.id);
                      }}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : null,
              )}
            </div>
          </section>

          {/* Status Notes (Phase 5.7.3 followup-13): append-only via
              shared InternalNotesEditor; users can be @-mentioned. Existing
              projects.status_notes content was backfilled into notes_log by
              migration 20260523100000. */}
          <InternalNotesEditor
            parentType="project"
            parentId={project.id}
            title="Status Notes"
            maxVisibleNotes={2}
          />

          <section className="card">
            <div className="card-headbar">
              <span className="h-card">Vendors</span>
              <Popover open={vendorPickerOpen} onOpenChange={(o) => { setVendorPickerOpen(o); if (!o) setVendorSearch(""); }}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="combo-picker-btn"
                    aria-label="Add or remove vendors"
                    title="Manage vendors"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-[280px] p-0" align="end">
                  <Command shouldFilter>
                    <CommandInput
                      value={vendorSearch}
                      onValueChange={setVendorSearch}
                      placeholder="Search vendors..."
                    />
                    <CommandList>
                      <CommandEmpty>No vendors.</CommandEmpty>
                      {vendorOptions.map((opt) => {
                        const selected = vendors.some((v) => v.id === opt.id);
                        return (
                          <CommandItem
                            key={opt.id}
                            value={opt.label}
                            onSelect={() => {
                              void toggleVendor(opt.id);
                            }}
                            className="cursor-pointer"
                          >
                            <span className="flex-1 truncate">{opt.label}</span>
                            {selected ? (
                              <Check className="ml-2 h-4 w-4 text-primary" />
                            ) : null}
                          </CommandItem>
                        );
                      })}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            <div className="card-pad stack-2">
              {vendors.length === 0 ? (
                <div className="subtle" style={{ fontSize: 13 }}>
                  No vendors linked yet.
                </div>
              ) : (
                vendors.map((v) => (
                  <div key={v.id} className="row-c" style={{ justifyContent: "space-between" }}>
                    <Link
                      to={`/vendors/${v.id}`}
                      className="tlink"
                      style={{ fontSize: 13 }}
                    >
                      {v.name}
                    </Link>
                    {v.category_name ? (
                      <span className="cap muted">{v.category_name}</span>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="card">
            <div className="card-headbar">
              <span className="h-card">Project Activity</span>
              <Link to="/activity" className="tlink">
                View all
                <IconExt className="ic" style={{ width: 11, height: 11 }} />
              </Link>
            </div>
            <div className="card-pad">
              {activityLoading ? (
                <p className="subtle" style={{ fontSize: 13 }}>Loading...</p>
              ) : activityError ? (
                <p className="subtle" style={{ fontSize: 13 }}>
                  Could not load activity.
                </p>
              ) : activityRows.length === 0 ? (
                <p className="subtle" style={{ fontSize: 13 }}>
                  No project activity yet.
                </p>
              ) : (
                activityRows.map((row) => {
                  const f = formatActivitySentence(row);
                  // Phase 5.7.2 carry-forward: /users (Team list) is admin-only.
                  // Demote the mention-fallback link for non-admin viewers so we
                  // don't render a dead-end. Revert in 5.7.11 once /users/:id ships.
                  const recordHrefEffective =
                    f.recordHref === "/users" && viewerRole !== "admin"
                      ? null
                      : f.recordHref;
                  return (
                    <div key={row.id} className="activity-row">
                      <span className="actdot">
                        <ActivityRowIcon entityType={row.entity_type} />
                      </span>
                      <div>
                        <div className="txt">
                          <span className="who">{f.actor.name}</span>
                          {f.leadingText}
                          {f.recordName ? (
                            f.recordIsBoldOnly ? (
                              <span className="dlv">{f.recordName}</span>
                            ) : recordHrefEffective ? (
                              <Link to={recordHrefEffective}>
                                <b>{f.recordName}</b>
                              </Link>
                            ) : (
                              <b>{f.recordName}</b>
                            )
                          ) : null}
                          {f.trailingText}
                        </div>
                        <div className="ts">{activityRowTimestamp(row.created_at)}</div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
