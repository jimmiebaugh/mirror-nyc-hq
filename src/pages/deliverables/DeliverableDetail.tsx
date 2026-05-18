import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { IconArrowLeft } from "@/components/icons/HQIcons";
import { deliverableStatusToken, statusTextDecoration } from "@/lib/home/projectStatusToken";
import { formatMediumDate } from "@/lib/hq/dates";
import {
  DELIVERABLE_STATUS_VALUES,
  updateDeliverableStatus,
  type DeliverableStatus,
} from "@/lib/deliverables/queries";
import { useBackHref } from "@/lib/hq/useBackHref";
import { InlineEditText } from "@/components/hq/InlineEditText";
import { ClickPillCell } from "@/components/hq/ClickPillCell";
import { RecordCombobox } from "@/components/ui/RecordCombobox";
import { InternalNotesEditor } from "@/components/data/InternalNotesEditor";
import { toast } from "@/hooks/use-toast";
import { syncDeliverableAssignees } from "@/lib/deliverables/assigneeSync";

/**
 * Deliverable Detail (Surface 14).
 *
 * Phase 5.6.3.1: detail-page inline-edit pattern. Each field saves
 * itself optimistically; Pencil button (icon-only) on the header still
 * routes to `/deliverables/:id/edit` as a power-edit fallback.
 */

type DbDeliverable = {
  id: string;
  title: string;
  status: DeliverableStatus;
  due_date: string | null;
  assigned_user_ids: string[];
  completed_at: string | null;
  project_id: string | null;
  project: {
    id: string;
    name: string;
    client: { id: string; name: string | null } | null;
  } | null;
};

export default function DeliverableDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [row, setRow] = useState<DbDeliverable | null>(null);
  const [projectOptions, setProjectOptions] = useState<{ id: string; label: string }[]>([]);
  const [userOptions, setUserOptions] = useState<{ id: string; label: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const back = useBackHref({ to: "/deliverables", label: "Deliverables" });

  useEffect(() => {
    if (!id) return;
    let active = true;
    (async () => {
      const [delRes, projectsRes, usersRes] = await Promise.all([
        supabase
          .from("deliverables")
          .select(
            `id, title, status, due_date, assigned_user_ids, completed_at,
             project_id,
             project:projects!deliverables_project_id_fkey(id, name, client:clients(id, name))`,
          )
          .eq("id", id)
          .single(),
        supabase
          .from("projects")
          .select("id, name")
          .is("archived_at", null)
          .order("name", { ascending: true }),
        supabase
          .from("users")
          .select("id, full_name, email")
          .eq("active", true)
          .order("full_name", { ascending: true }),
      ]);
      if (!active) return;
      if (delRes.error || !delRes.data) {
        setLoading(false);
        return;
      }
      setRow(delRes.data as unknown as DbDeliverable);
      setProjectOptions(
        ((projectsRes.data ?? []) as { id: string; name: string | null }[]).map((p) => ({
          id: p.id,
          label: p.name ?? "Untitled",
        })),
      );
      setUserOptions(
        ((usersRes.data ?? []) as { id: string; full_name: string | null; email: string }[]).map(
          (u) => ({ id: u.id, label: u.full_name?.trim() || u.email }),
        ),
      );
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [id]);

  const loadProjectOptions = useCallback(async () => projectOptions, [projectOptions]);
  const loadUserOptions = useCallback(async () => userOptions, [userOptions]);

  // K is restricted to scalar columns; project + project_id have their own
  // dedicated savers because the embedded project shape doesn't round-trip
  // through a deliverables UPDATE.
  type ScalarField = Exclude<keyof DbDeliverable, "project" | "project_id">;
  const saveField = async <K extends ScalarField>(
    field: K,
    nextValue: DbDeliverable[K],
  ): Promise<void> => {
    if (!row) return;
    const prev = row[field];
    setRow({ ...row, [field]: nextValue });
    const { error } = await supabase
      .from("deliverables")
      .update({ [field as string]: nextValue })
      .eq("id", row.id);
    if (error) {
      setRow({ ...row, [field]: prev });
      throw error;
    }
  };

  const saveProjectId = async (nextId: string | null) => {
    if (!row) return;
    const prev = { project_id: row.project_id, project: row.project };
    const nextProject = nextId ? projectOptions.find((p) => p.id === nextId) ?? null : null;
    setRow({
      ...row,
      project_id: nextId,
      // Client is unknown from the lean projectOptions list; leave null
      // until a page refresh re-runs the join. Auto-task title falls back
      // to "(no client)" in that window — acceptable per spec.
      project: nextProject ? { id: nextProject.id, name: nextProject.label, client: null } : null,
    });
    const { error } = await supabase
      .from("deliverables")
      .update({ project_id: nextId })
      .eq("id", row.id);
    if (error) {
      setRow({ ...row, ...prev });
      toast({ title: "Project save failed", description: error.message, variant: "destructive" });
    }
  };

  const saveAssigneeIds = async (nextIds: string[]) => {
    if (!row) return;
    const prev = row.assigned_user_ids;
    setRow({ ...row, assigned_user_ids: nextIds });

    // Phase 5.7.5 follow-up round 1: reordered. UPDATE the deliverables
    // row first so the source-of-truth assignee list reflects the user
    // intent; only fire the auto-task lifecycle once the UPDATE succeeds.
    // Prevents the failure mode where the deliverables UPDATE rejects but
    // we'd already INSERTed / DELETEd the matching task.
    const { error } = await supabase
      .from("deliverables")
      .update({ assigned_user_ids: nextIds })
      .eq("id", row.id);
    if (error) {
      setRow({ ...row, assigned_user_ids: prev });
      toast({ title: "Assignees save failed", description: error.message, variant: "destructive" });
      return;
    }

    const { data: userRes } = await supabase.auth.getUser();
    const createdBy = userRes.user?.id;
    if (!createdBy) return;
    const { errors } = await syncDeliverableAssignees({
      ctx: {
        deliverableId: row.id,
        deliverableTitle: row.title,
        dueDate: row.due_date,
        projectName: row.project?.name ?? null,
        createdBy,
      },
      prevIds: prev,
      nextIds,
    });
    if (errors.length > 0) {
      console.warn("[saveAssigneeIds] task lifecycle errors", errors);
      toast({
        title: "Assignees saved, but some auto-tasks did not sync",
        description: errors[0],
      });
    }
  };

  if (loading) {
    return (
      <div className="empty">
        <p>Loading...</p>
      </div>
    );
  }
  if (!row) {
    return (
      <div className="empty">
        <p>Deliverable not found.</p>
      </div>
    );
  }

  return (
    <div className="stack-4" style={{ maxWidth: 760 }}>
      <Link to={back.to} className="tlink">
        <IconArrowLeft className="ic" />
        Back to {back.label}
      </Link>
      <div className="row between" style={{ alignItems: "flex-start" }}>
        <h1 className={`h-page ${statusTextDecoration("deliverable", row.status)}`}>
          <InlineEditText
            value={row.title}
            required
            placeholder="Deliverable title"
            renderRead={(v) => v ?? "(untitled)"}
            onSave={(next) => saveField("title", next)}
          />
        </h1>
        <button
          type="button"
          className="btn btn-secondary"
          aria-label="Edit Deliverable"
          title="Edit Deliverable"
          onClick={() => navigate(`/deliverables/${row.id}/edit`)}
          style={{ padding: "0 10px" }}
        >
          <Pencil className="ic" style={{ width: 14, height: 14 }} />
        </button>
      </div>

      <section className="card">
        <div className="card-pad">
          <dl className="kv">
            <dt>Status</dt>
            <dd>
              <ClickPillCell
                value={row.status}
                options={DELIVERABLE_STATUS_VALUES}
                tokenMap={deliverableStatusToken}
                onSave={async (next) => {
                  await updateDeliverableStatus(row.id, next as DeliverableStatus);
                  setRow({ ...row, status: next as DeliverableStatus });
                }}
              />
            </dd>
            <dt>Due</dt>
            <dd>
              <InlineEditText
                value={row.due_date}
                placeholder="YYYY-MM-DD"
                inputType="date"
                renderRead={(v) =>
                  v ? formatMediumDate(v) : <span className="muted subtle">-</span>
                }
                onSave={(next) => saveField("due_date", next || null)}
              />
            </dd>
            <dt>Project</dt>
            <dd>
              <RecordCombobox
                source={{ kind: "record", loadOptions: loadProjectOptions }}
                value={row.project_id}
                onChange={(next) => void saveProjectId(next)}
                entityLabel="Project"
                placeholder="No project"
              />
            </dd>
            <dt>Assignees</dt>
            <dd>
              <RecordCombobox
                multi
                source={{ kind: "record", loadOptions: loadUserOptions }}
                multiValue={row.assigned_user_ids}
                onMultiChange={(next) => void saveAssigneeIds(next)}
                entityLabel="user"
                placeholder="Unassigned"
              />
            </dd>
            {row.completed_at ? (
              <>
                <dt>Completed</dt>
                <dd>{formatMediumDate(row.completed_at.slice(0, 10))}</dd>
              </>
            ) : null}
          </dl>
        </div>
      </section>

      <InternalNotesEditor parentType="deliverable" parentId={row.id} />
    </div>
  );
}
