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
  relativeDay,
} from "@/lib/hq/dates";
import {
  PROJECT_STATUS_VALUES,
  updateProjectStatus,
  type ProjectStatus,
} from "@/lib/projects/queries";
import { useBackHref } from "@/lib/hq/useBackHref";
import { InlineEditText } from "@/components/hq/InlineEditText";
import { DField } from "@/components/hq/DField";
import { InternalNotesEditor } from "@/components/data/InternalNotesEditor";
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
             budget_sheet_url,
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

  // Phase 5.7.14 § 6.F.1: live-refresh the Project Activity card on
  // activity_log INSERTs. Server-side filter is coarse (any new row); we
  // re-run the loader so the project/task/deliverable rollup stays
  // accurate without per-row merge logic.
  useEffect(() => {
    if (!id || roleLoading) return;
    const channel = supabase
      .channel(`project-activity:${id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "activity_log" },
        () => {
          loadActivityByProject({ projectId: id, limit: 5, viewerRole })
            .then((rows) => setActivityRows(rows))
            .catch(() => {
              /* swallow: stale rows still render */
            });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
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

  // Phase 5.11.2: order for the 2x2 folder-links grid (Production | Design,
  // Budget | Slack). Renders left-to-right, top-to-bottom.
  const folderButtons = [
    { label: "Production", url: project.production_folder_url, Icon: IconDrive },
    { label: "Design", url: project.design_decks_folder_url, Icon: IconDrive },
    { label: "Budget", url: project.budget_sheet_url, Icon: IconDrive },
    { label: "Slack", url: project.slack_channel_url, Icon: IconSlack },
  ];

  return (
    <div className="stack-4">
      <Link to={back.to} className="crumb">
        <IconArrowLeft className="ic ic-sm" />
        Back to {back.label}
      </Link>

      <header className="stack-3">
        {project.job_number ? (
          <div className="eyebrow" style={{ paddingTop: 8 }}>Job #{project.job_number}</div>
        ) : null}
        <div className="row between" style={{ alignItems: "center" }}>
          <div className="row-c" style={{ flex: 1, gap: 16, alignItems: "center", minWidth: 0, flexWrap: "wrap" }}>
            <h1 className="h-page" style={{ minWidth: 0 }}>{project.name || "(untitled)"}</h1>
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
        <div
          className="row-c detail-meta"
          style={{ gap: 12, marginTop: 8, flexWrap: "wrap" }}
        >
          {[project.client?.name, project.category, project.city].filter(Boolean).length > 0 ? (
            <span>
              {[project.client?.name, project.category, project.city]
                .filter(Boolean)
                .join(" · ")}
            </span>
          ) : null}
        </div>
      </header>

      {/* Phase 5.11.3: dates + Next Deliverable on the left (Schedule
          card); folder links on the right (Links card). Both surfaces are
          .card with a card-headbar so the row stretches them to a shared
          height (via align-items:stretch on the row + h-100 on the cards). */}
      <div className="detail-2col--wide" style={{ alignItems: "stretch" }}>
        <section className="card" style={{ display: "flex", flexDirection: "column" }}>
          <div className="card-pad" style={{ flex: 1, display: "flex", alignItems: "center" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "auto auto auto 1px 1fr",
                gap: 0,
                alignItems: "center",
                width: "100%",
              }}
            >
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
                  paddingRight: 24,
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
              <div style={{ borderLeft: "1px solid hsl(var(--border-strong))", alignSelf: "stretch" }} />
              <div style={{ paddingLeft: 24, minWidth: 0 }}>
                <div className="row between" style={{ alignItems: "center" }}>
                  <span className="label-form">Next Deliverable</span>
                  {nextDeliverable?.due_date ? (
                    <span
                      className="label-form"
                      style={{ color: "hsl(var(--foreground))" }}
                    >
                      {relativeDay(nextDeliverable.due_date)}
                    </span>
                  ) : null}
                </div>
                <div
                  className="row between"
                  style={{ alignItems: "baseline", marginTop: 4, gap: 12 }}
                >
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontWeight: 700,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {nextDeliverable?.title ?? "-"}
                  </span>
                  <span
                    className="mono"
                    style={{
                      color: "hsl(var(--primary-hover))",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {nextDeliverable?.due_date
                      ? formatShortDate(nextDeliverable.due_date)
                      : "Nothing dated"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>
        {/* Links card: 2x2 coral hyperlink grid. Production | Design (row 1),
            Budget | Slack (row 2). Disabled links render muted. */}
        <section className="card" style={{ display: "flex", flexDirection: "column" }}>
          <div className="card-headbar">
            <span className="h-card">Links</span>
          </div>
          <div className="card-pad" style={{ flex: 1, display: "flex", alignItems: "center" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "12px 24px",
                alignItems: "center",
                width: "100%",
              }}
            >
              {folderButtons.map((b) =>
                b.url ? (
                  <a
                    key={b.label}
                    href={b.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="tlink"
                    style={{ fontSize: 13 }}
                  >
                    <b.Icon className="ic ic-sm" /> {b.label}
                  </a>
                ) : (
                  <span
                    key={b.label}
                    className="muted subtle"
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 13,
                      fontWeight: 700,
                      letterSpacing: ".04em",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                    }}
                    title={`${b.label} not linked yet`}
                  >
                    <b.Icon className="ic ic-sm" /> {b.label}
                  </span>
                ),
              )}
            </div>
          </div>
        </section>
      </div>

      <div className="detail-2col--wide">
        <div className="stack-6" style={{ minWidth: 0 }}>
          <section className="card">
            <div className="card-headbar">
              <span className="h-card">Details</span>
            </div>
            <div className="card-pad stack-4">
              {/* Phase 5.11.3: Job# | Category | Budget (3-col), Title |
                  Client, City | Venue, then the Live / Install / Removal
                  date trio. Tags moved to its own full-width row at the
                  bottom under a divider. */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr",
                  gap: 16,
                }}
              >
                <DField label="Job #">
                  <InlineEditText
                    value={project.job_number}
                    placeholder="Job number"
                    renderRead={(v) =>
                      v ? <span className="mono">#{v}</span> : <span className="muted subtle">-</span>
                    }
                    onSave={(next) => saveField("job_number", next || null)}
                  />
                </DField>
                <DField label="Category">
                  <RecordCombobox
                    source={{ kind: "lookup", table: "project_categories" }}
                    value={project.category || null}
                    onChange={(next) => void saveField("category", next || null)}
                    entityLabel="Category"
                    placeholder="Select"
                  />
                </DField>
                <DField label="Budget">
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
                </DField>
              </div>
              <div style={{ borderTop: "1px solid hsl(var(--border))" }} />
              <div className="g2">
                <DField label="Title">
                  <InlineEditText
                    value={project.name}
                    required
                    placeholder="Project name"
                    renderRead={(v) => v ?? "(untitled)"}
                    onSave={(next) => saveField("name", next)}
                  />
                </DField>
                <DField label="Client">
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
                </DField>
              </div>
              <div style={{ borderTop: "1px solid hsl(var(--border))" }} />
              <div className="g2">
                <DField label="City">
                  <RecordCombobox
                    source={{ kind: "lookup", table: "cities" }}
                    value={project.city || null}
                    onChange={(next) => void saveField("city", next || null)}
                    entityLabel="city"
                    placeholder="Select"
                  />
                </DField>
                <DField label="Venue">
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
                </DField>
              </div>
              <div style={{ borderTop: "1px solid hsl(var(--border))" }} />
              {/* Combined dates row: Live | Install | Removal with vertical
                  dividers. Tight 4px label-to-input gap so the date pairs
                  read as compact columns. */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 0 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div className="field" style={{ gap: 4 }}>
                    <div className="label-form">Live start</div>
                    <InlineEditText
                      value={project.live_dates_start}
                      placeholder="YYYY-MM-DD"
                      inputType="date"
                      renderRead={(v) =>
                        v ? formatShortDate(v) : <span className="muted subtle">Not set</span>
                      }
                      onSave={(next) => saveField("live_dates_start", next || null)}
                    />
                  </div>
                  <div className="field" style={{ gap: 4 }}>
                    <div className="label-form">Live end</div>
                    <InlineEditText
                      value={project.live_dates_end}
                      placeholder="YYYY-MM-DD"
                      inputType="date"
                      renderRead={(v) =>
                        v ? formatShortDate(v) : <span className="muted subtle">-</span>
                      }
                      onSave={(next) => saveField("live_dates_end", next || null)}
                    />
                  </div>
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                    borderLeft: "1px solid hsl(var(--border))",
                    paddingLeft: 16,
                    marginLeft: 16,
                  }}
                >
                  <div className="field" style={{ gap: 4 }}>
                    <div className="label-form">Install start</div>
                    <InlineEditText
                      value={project.install_dates_start}
                      placeholder="YYYY-MM-DD"
                      inputType="date"
                      renderRead={(v) =>
                        v ? formatShortDate(v) : <span className="muted subtle">Not set</span>
                      }
                      onSave={(next) => saveField("install_dates_start", next || null)}
                    />
                  </div>
                  <div className="field" style={{ gap: 4 }}>
                    <div className="label-form">Install end</div>
                    <InlineEditText
                      value={project.install_dates_end}
                      placeholder="YYYY-MM-DD"
                      inputType="date"
                      renderRead={(v) =>
                        v ? formatShortDate(v) : <span className="muted subtle">-</span>
                      }
                      onSave={(next) => saveField("install_dates_end", next || null)}
                    />
                  </div>
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                    borderLeft: "1px solid hsl(var(--border))",
                    paddingLeft: 16,
                    marginLeft: 16,
                  }}
                >
                  <div className="field" style={{ gap: 4 }}>
                    <div className="label-form">Removal start</div>
                    <InlineEditText
                      value={project.removal_dates_start}
                      placeholder="YYYY-MM-DD"
                      inputType="date"
                      renderRead={(v) =>
                        v ? formatShortDate(v) : <span className="muted subtle">Not set</span>
                      }
                      onSave={(next) => saveField("removal_dates_start", next || null)}
                    />
                  </div>
                  <div className="field" style={{ gap: 4 }}>
                    <div className="label-form">Removal end</div>
                    <InlineEditText
                      value={project.removal_dates_end}
                      placeholder="YYYY-MM-DD"
                      inputType="date"
                      renderRead={(v) =>
                        v ? formatShortDate(v) : <span className="muted subtle">-</span>
                      }
                      onSave={(next) => saveField("removal_dates_end", next || null)}
                    />
                  </div>
                </div>
              </div>
              <div style={{ borderTop: "1px solid hsl(var(--border))" }} />
              <div className="field-chips">
                <DField label="Tags">
                  <RecordCombobox
                    multi
                    source={{ kind: "lookup", table: "project_tags" }}
                    multiValue={project.tags}
                    onMultiChange={(next) => void saveField("tags", next)}
                    entityLabel="Tag"
                    placeholder="Add tag..."
                  />
                </DField>
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
