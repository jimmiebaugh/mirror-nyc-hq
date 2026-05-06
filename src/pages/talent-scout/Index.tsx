import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { RoleStatusPill } from "@/components/talent-scout/RoleStatusPill";

type Role = {
  id: string;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
  hiring_manager_id: string | null;
  hiring_manager: { full_name: string | null; email: string } | null;
};

const fmtDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "—";

const GRID = "grid-cols-[minmax(0,2fr)_minmax(0,1fr)_140px_140px_auto]";

function RoleHeader() {
  return (
    <div
      className={`grid ${GRID} gap-4 border-b border-border bg-secondary/30 px-5 py-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground`}
    >
      <div>Role / Hiring Manager</div>
      <div>Created</div>
      <div>Status</div>
      <div>Last Activity</div>
      <div />
    </div>
  );
}

function RoleRow({ r }: { r: Role }) {
  const nav = useNavigate();
  const isClosed = r.status === "closed";
  const managerLabel = r.hiring_manager?.full_name ?? r.hiring_manager?.email ?? "Unassigned";
  return (
    <div
      onClick={() => nav(`/talent-scout/roles/${r.id}`)}
      className={`grid ${GRID} cursor-pointer items-center gap-4 border-b border-border px-5 py-4 last:border-b-0 transition-colors hover:bg-secondary/40`}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-semibold">{r.title}</span>
        <span className="text-xs text-muted-foreground">{managerLabel}</span>
      </div>
      <div className="text-xs text-muted-foreground">{fmtDate(r.created_at)}</div>
      <div>
        <RoleStatusPill status={r.status} />
      </div>
      <div className="text-xs text-muted-foreground">{fmtDate(r.updated_at)}</div>
      <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
        {!isClosed && (
          <Link
            to={`/talent-scout/roles/${r.id}/settings`}
            className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground"
          >
            Settings
          </Link>
        )}
      </div>
    </div>
  );
}

export default function TalentScoutIndex() {
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [closedOpen, setClosedOpen] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error } = await supabase
        .from("ts_roles")
        .select("id, title, status, created_at, updated_at, hiring_manager_id, hiring_manager:users!ts_roles_hiring_manager_id_fkey(full_name, email)")
        .order("updated_at", { ascending: false });

      if (!active) return;

      if (error) {
        // eslint-disable-next-line no-console
        console.warn("ts_roles query error:", error);
        setRoles([]);
      } else {
        setRoles((data as unknown as Role[]) ?? []);
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  const open = (roles ?? []).filter((r) => r.status !== "closed");
  const closed = (roles ?? []).filter((r) => r.status === "closed");

  return (
    <div className="space-y-8">
      <header className="flex items-end justify-between gap-5">
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-widest text-primary">Talent Scout</div>
          <h1 className="text-3xl font-semibold tracking-tight">Open roles</h1>
          <p className="text-sm text-muted-foreground">
            Active hiring searches at Mirror NYC.
          </p>
        </div>
        <Button asChild>
          <Link to="/talent-scout/new/details">
            <Plus className="mr-2 h-4 w-4" />
            New Role
          </Link>
        </Button>
      </header>

      <Card className="overflow-hidden">
        <RoleHeader />
        {loading ? (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">Loading…</div>
        ) : open.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">
            No open roles yet — click <span className="font-semibold text-foreground">+ New Role</span> to get started.
          </div>
        ) : (
          open.map((r) => <RoleRow key={r.id} r={r} />)
        )}
      </Card>

      <div>
        <button
          type="button"
          onClick={() => setClosedOpen((v) => !v)}
          className="flex w-full items-center gap-3 rounded-md border border-border bg-card px-5 py-3 text-left text-xs font-bold uppercase tracking-wider transition-colors hover:bg-secondary/40"
        >
          <ChevronRight
            className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${closedOpen ? "rotate-90" : ""}`}
          />
          <span>Closed Roles</span>
          <span className="ml-auto rounded-full border border-border bg-secondary px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
            {closed.length}
          </span>
        </button>
        {closedOpen && (
          <Card className="mt-3 overflow-hidden">
            <RoleHeader />
            {closed.length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-muted-foreground">No closed roles.</div>
            ) : (
              closed.map((r) => <RoleRow key={r.id} r={r} />)
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
