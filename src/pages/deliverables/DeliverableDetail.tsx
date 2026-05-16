import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { IconArrowLeft } from "@/components/icons/HQIcons";
import { deliverableStatusToken, statusTextDecoration } from "@/lib/home/projectStatusToken";
import { formatMediumDate } from "@/lib/hq/dates";
import type { DeliverableStatus } from "@/lib/deliverables/queries";

type DbDeliverable = {
  id: string;
  title: string;
  type: string | null;
  status: DeliverableStatus;
  due_date: string | null;
  notes: string | null;
  assigned_user_ids: string[];
  completed_at: string | null;
  project: { id: string; name: string } | null;
};

export default function DeliverableDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [row, setRow] = useState<DbDeliverable | null>(null);
  const [assignees, setAssignees] = useState<{ id: string; full_name: string | null; email: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    let active = true;
    (async () => {
      const { data, error } = await supabase
        .from("deliverables")
        .select(
          `id, title, type, status, due_date, notes, assigned_user_ids, completed_at,
           project:projects(id, name)`,
        )
        .eq("id", id)
        .single();
      if (!active) return;
      if (error || !data) {
        setLoading(false);
        return;
      }
      setRow(data as unknown as DbDeliverable);
      if ((data.assigned_user_ids ?? []).length > 0) {
        const { data: us } = await supabase
          .from("users")
          .select("id, full_name, email")
          .in("id", data.assigned_user_ids);
        if (active) setAssignees((us ?? []) as { id: string; full_name: string | null; email: string }[]);
      }
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
  if (!row) {
    return (
      <div className="empty">
        <p>Deliverable not found.</p>
      </div>
    );
  }

  const token = deliverableStatusToken(row.status);

  return (
    <div className="stack-4" style={{ maxWidth: 760 }}>
      <Link to="/deliverables" className="tlink">
        <IconArrowLeft className="ic" />
        Back to Deliverables
      </Link>
      <div className="row between" style={{ alignItems: "flex-start" }}>
        <h1 className={`h-page ${statusTextDecoration("deliverable", row.status)}`}>
          {row.title}
        </h1>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => navigate(`/deliverables/${row.id}/edit`)}
        >
          Edit Deliverable
        </button>
      </div>

      <section className="card">
        <div className="card-pad">
          <dl className="kv">
            <dt>Status</dt>
            <dd>
              <span className={`pill p-${token}`}>
                <span className="dt" />
                {row.status}
              </span>
            </dd>
            <dt>Type</dt>
            <dd>{row.type ?? "-"}</dd>
            <dt>Due</dt>
            <dd>{row.due_date ? formatMediumDate(row.due_date) : "-"}</dd>
            <dt>Project</dt>
            <dd>
              {row.project ? (
                <Link to={`/projects/${row.project.id}`} className="tlink">
                  {row.project.name}
                </Link>
              ) : (
                "-"
              )}
            </dd>
            <dt>Assignees</dt>
            <dd>
              {assignees.length === 0
                ? "Unassigned"
                : assignees.map((a) => a.full_name ?? a.email).join(", ")}
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

      <section className="card">
        <div className="card-headbar">
          <span className="h-card">Notes</span>
        </div>
        <div className="card-pad muted" style={{ whiteSpace: "pre-wrap" }}>
          {row.notes || "(empty)"}
        </div>
      </section>
    </div>
  );
}
