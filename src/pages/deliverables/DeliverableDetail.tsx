import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
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

  if (loading) return <p className="text-sm text-muted-foreground">Loading...</p>;
  if (!row) return <p className="text-sm text-muted-foreground">Deliverable not found.</p>;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link to="/deliverables" className="crumb">← Back to Deliverables</Link>
      <header className="flex items-start justify-between gap-3">
        <h1 className={`h-page ${statusTextDecoration("deliverable", row.status)}`}>{row.title}</h1>
        <Button onClick={() => navigate(`/deliverables/${row.id}/edit`)}>Edit Deliverable</Button>
      </header>

      <div className="hq-card">
        <div className="p-6 space-y-3 text-sm">
          <Row label="Status">
            <span className={`hq-pill hq-pill--${deliverableStatusToken(row.status)}`}>
              <span className="hq-pill-dt" />
              {row.status}
            </span>
          </Row>
          <Row label="Type">{row.type ?? "-"}</Row>
          <Row label="Due">{row.due_date ? formatMediumDate(row.due_date) : "-"}</Row>
          <Row label="Project">
            {row.project ? (
              <Link to={`/projects/${row.project.id}`} className="hq-tlink">{row.project.name}</Link>
            ) : (
              "-"
            )}
          </Row>
          <Row label="Assignees">
            {assignees.length === 0
              ? "Unassigned"
              : assignees.map((a) => a.full_name ?? a.email).join(", ")}
          </Row>
          {row.completed_at ? (
            <Row label="Completed">{formatMediumDate(row.completed_at.slice(0, 10))}</Row>
          ) : null}
        </div>
      </div>

      <div className="hq-card">
        <div className="hq-card-headbar">
          <span className="h-card">Notes</span>
        </div>
        <div className="p-6 text-sm whitespace-pre-wrap text-[hsl(var(--muted-foreground))]">
          {row.notes || "(empty)"}
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="label-form text-[hsl(var(--subtle-foreground))] min-w-[80px]">{label}</span>
      <span>{children}</span>
    </div>
  );
}
