import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  IconDrive,
  IconSlack,
} from "@/components/icons/HQIcons";
import {
  loadActivityByProject,
  type ActivityRow,
  type ActivityViewerRole,
} from "@/lib/activity/queries";
import { useUserRole } from "@/hooks/useUserRole";
import {
  projectStatusToken,
  deliverableStatusToken,
  taskStatusToken,
  statusTextDecoration,
} from "@/lib/home/projectStatusToken";
import {
  formatShortDate,
  relativeDay,
} from "@/lib/hq/dates";
import {
  PROJECT_STATUS_VALUES,
  updateProjectStatus,
  type ProjectStatus,
} from "@/lib/projects/queries";
import { InternalNotesEditor } from "@/components/data/InternalNotesEditor";
import { ClickPillCell } from "@/components/hq/ClickPillCell";
import { toast } from "@/hooks/use-toast";
import { ProjectDetailsCard } from "@/components/projects/ProjectDetailsCard";
import { ProjectTeamSection } from "@/components/projects/ProjectTeamSection";
import { ProjectVendorsCard } from "@/components/projects/ProjectVendorsCard";
import { ProjectActivitySection } from "@/components/projects/ProjectActivitySection";

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

export type Project = {
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

export type VendorLink = {
  id: string;
  name: string;
  category_name: string | null;
};

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

  // Phase 6.3 (P8): atomic multi-column save for the single-or-range
  // DateFields, which must write both halves of a date pair in ONE update
  // (two saveField calls would be non-atomic — a partial row between them).
  // Fire-and-forget like saveClientId/saveVenueIds: toasts + reverts on error
  // rather than throwing (DateField's onChange has no catch wrapper).
  const saveFields = async (patch: Partial<Project>) => {
    if (!project) return;
    const prev = project;
    setProject({ ...project, ...patch });
    const { error } = await supabase
      .from("projects")
      .update(patch)
      .eq("id", project.id);
    if (error) {
      setProject(prev);
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
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
      {/* R7 amendment v3 § 3: per-page back-crumb retired; TopBar carries it. */}

      <header className="stack-3">
        {project.job_number ? (
          <div className="eyebrow" style={{ paddingTop: 8 }}>Job #{project.job_number}</div>
        ) : null}
        <div className="row between" style={{ alignItems: "center" }}>
          <div className="row-c-title" style={{ flex: 1, gap: 16, alignItems: "center" }}>
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
                gridTemplateColumns: "auto 1px auto 1px 1fr",
                gridTemplateRows: "auto auto",
                columnGap: 0,
                rowGap: 14,
                alignItems: "center",
                width: "100%",
              }}
            >
              {/* Col 1: Install + Removal stacked */}
              <div style={{ gridColumn: 1, gridRow: 1, paddingRight: 24 }}>
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
              <div style={{ gridColumn: 1, gridRow: 2, paddingRight: 24 }}>
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
              {/* Col 2: hairline divider between the Install/Removal stack and Live */}
              <div
                style={{
                  gridColumn: 2,
                  gridRow: "1 / span 2",
                  borderLeft: "1px solid hsl(var(--border))",
                  alignSelf: "stretch",
                }}
              />
              {/* Col 3: Live, spanning the height of both stacked rows */}
              <div style={{ gridColumn: 3, gridRow: "1 / span 2", paddingLeft: 24, paddingRight: 24 }}>
                <div className="label-form">Live</div>
                <div className="mono" style={{ marginTop: 4 }}>
                  {project.live_dates_start
                    ? `${formatShortDate(project.live_dates_start)}${
                        project.live_dates_end ? ` to ${formatShortDate(project.live_dates_end)}` : ""
                      }`
                    : "-"}
                </div>
              </div>
              {/* Col 4: stronger divider before Next Deliverable */}
              <div
                style={{
                  gridColumn: 4,
                  gridRow: "1 / span 2",
                  borderLeft: "1px solid hsl(var(--border-strong))",
                  alignSelf: "stretch",
                }}
              />
              {/* Col 5: Next Deliverable, inline to the right of Live */}
              <div style={{ gridColumn: 5, gridRow: "1 / span 2", paddingLeft: 24, minWidth: 0 }}>
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
          <ProjectDetailsCard
            project={project}
            venueIds={venueIds}
            saveField={saveField}
            saveFields={saveFields}
            saveClientId={saveClientId}
            saveVenueIds={saveVenueIds}
            loadClientOptions={loadClientOptions}
            loadVenueOptions={loadVenueOptions}
            setClientOptions={setClientOptions}
            setVenueOptions={setVenueOptions}
          />

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
          <ProjectTeamSection
            project={project}
            userOptions={userOptions}
            memberPickerOpen={memberPickerOpen}
            setMemberPickerOpen={setMemberPickerOpen}
            memberSearch={memberSearch}
            setMemberSearch={setMemberSearch}
            handleAddMember={handleAddMember}
            handleRemoveMember={handleRemoveMember}
          />

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

          <ProjectVendorsCard
            vendors={vendors}
            vendorOptions={vendorOptions}
            vendorPickerOpen={vendorPickerOpen}
            setVendorPickerOpen={setVendorPickerOpen}
            vendorSearch={vendorSearch}
            setVendorSearch={setVendorSearch}
            toggleVendor={toggleVendor}
          />

          <ProjectActivitySection
            activityRows={activityRows}
            activityLoading={activityLoading}
            activityError={activityError}
            viewerRole={viewerRole}
          />
        </aside>
      </div>
    </div>
  );
}
