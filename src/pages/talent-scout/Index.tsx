import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { RoleStatusPill } from "@/components/talent-scout/RoleStatusPill";
import { toast } from "@/hooks/use-toast";

type Role = {
  id: string;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
  hiring_manager_id: string | null;
  hiring_manager: { full_name: string | null; email: string } | null;
};

type RoleExt = Role & {
  reviewed: number;
  in_pool: number;
  last_pull_at: string | null;
  latest_round_number: number | null;
  has_final_report: boolean;
};

const fmtRelative = (iso: string | null) => {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return "Just now";
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return "Yesterday";
  if (d < 30) return `${d}d ago`;
  const m = Math.floor(d / 30);
  return `${m}mo ago`;
};

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

const POOL_STATUSES = new Set(["consider", "interview", "fast_track"]);

const GRID = "grid-cols-[minmax(0,2fr)_140px_140px_140px_90px_90px_180px]";

function RoleHeader() {
  return (
    <div
      className={`grid ${GRID} gap-4 border-b border-border bg-secondary/30 px-5 py-3 text-[13px] font-mono font-bold uppercase tracking-wider text-muted-foreground`}
    >
      <div>Role / Hiring Manager</div>
      <div>Role Posted</div>
      <div>Last Pull</div>
      <div>Status</div>
      <div className="text-right">Reviewed</div>
      <div className="text-right">In Pool</div>
      <div />
    </div>
  );
}

function RoleRow({
  r,
  onReopen,
  onDelete,
}: {
  r: RoleExt;
  onReopen?: (id: string) => void;
  onDelete?: (r: RoleExt) => void;
}) {
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
      <div className="text-xs text-muted-foreground">{fmtRelative(r.last_pull_at)}</div>
      <div>
        <RoleStatusPill
          status={r.status}
          latestRound={r.latest_round_number}
          hasFinalReport={r.has_final_report}
        />
      </div>
      <div className="text-right text-base font-bold tabular-nums">{r.reviewed}</div>
      <div className="text-right text-base font-bold tabular-nums text-amber-400">
        {r.in_pool}
      </div>
      <div className="flex items-center justify-end gap-3" onClick={(e) => e.stopPropagation()}>
        {isClosed ? (
          <>
            <button
              type="button"
              onClick={() => onReopen?.(r.id)}
              className="text-[13px] font-mono font-bold uppercase tracking-wider text-primary hover:underline"
            >
              Reopen
            </button>
            <button
              type="button"
              onClick={() => onDelete?.(r)}
              className="text-[13px] font-mono font-bold uppercase tracking-wider text-red-400 hover:text-red-300 hover:underline"
            >
              Delete
            </button>
          </>
        ) : (
          <Link
            to={`/talent-scout/roles/${r.id}/settings`}
            className="text-[13px] font-mono font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground"
          >
            Settings
          </Link>
        )}
      </div>
    </div>
  );
}

export default function TalentScoutIndex() {
  const [roles, setRoles] = useState<RoleExt[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [closedOpen, setClosedOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<RoleExt | null>(null);
  const [deleteCounts, setDeleteCounts] = useState<{ rounds: number; candidates: number; attachments: number } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const reload = async () => {
    const { data: rs, error } = await supabase
      .from("ts_roles")
      .select(
        "id, title, status, created_at, updated_at, hiring_manager_id, hiring_manager:users!ts_roles_hiring_manager_id_fkey(full_name, email)",
      )
      .order("updated_at", { ascending: false });

    if (error) {
      // eslint-disable-next-line no-console
      console.warn("ts_roles query error:", error);
      setRoles([]);
      return;
    }
    const list = (rs as unknown as Role[]) ?? [];
    const ids = list.map((r) => r.id);
    const [{ data: cs }, { data: rr }] = await Promise.all([
      ids.length
        ? supabase.from("ts_candidates").select("role_id, status").in("role_id", ids)
        : Promise.resolve({ data: [] as { role_id: string; status: string }[] }),
      ids.length
        ? supabase
            .from("ts_pull_rounds")
            .select("role_id, round_number, started_at, status")
            .in("role_id", ids)
        : Promise.resolve({ data: [] as { role_id: string; round_number: number | null; started_at: string; status: string }[] }),
    ]);
    const reviewedByRole: Record<string, number> = {};
    const inPoolByRole: Record<string, number> = {};
    for (const c of (cs ?? [])) {
      reviewedByRole[c.role_id] = (reviewedByRole[c.role_id] ?? 0) + 1;
      if (POOL_STATUSES.has(c.status)) inPoolByRole[c.role_id] = (inPoolByRole[c.role_id] ?? 0) + 1;
    }
    const lastPullByRole: Record<string, string | null> = {};
    const latestRoundByRole: Record<string, number | null> = {};
    for (const r of (rr ?? [])) {
      const cur = lastPullByRole[r.role_id];
      if (r.status === "complete" && (!cur || new Date(r.started_at).getTime() > new Date(cur).getTime())) {
        lastPullByRole[r.role_id] = r.started_at;
      }
      const curRn = latestRoundByRole[r.role_id] ?? 0;
      if ((r.round_number ?? 0) > (curRn ?? 0)) latestRoundByRole[r.role_id] = r.round_number;
    }
    setRoles(
      list.map((r) => ({
        ...r,
        reviewed: reviewedByRole[r.id] ?? 0,
        in_pool: inPoolByRole[r.id] ?? 0,
        last_pull_at: lastPullByRole[r.id] ?? null,
        latest_round_number: latestRoundByRole[r.id] ?? null,
        // Final reviews come in Phase 3.6; placeholder for the pill.
        has_final_report: false,
      })),
    );
  };

  useEffect(() => {
    let active = true;
    (async () => {
      await reload();
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reopen = async (id: string) => {
    const { error } = await supabase.from("ts_roles").update({ status: "open" }).eq("id", id);
    if (error) {
      toast({ title: "Reopen failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Role reopened" });
    void reload();
  };

  const openDelete = async (r: RoleExt) => {
    setPendingDelete(r);
    setDeleteCounts(null);
    const [
      { count: rounds },
      { data: cands },
    ] = await Promise.all([
      supabase.from("ts_pull_rounds").select("id", { count: "exact", head: true }).eq("role_id", r.id),
      supabase.from("ts_candidates").select("id").eq("role_id", r.id),
    ]);
    const candidateIds = (cands ?? []).map((c) => c.id);
    let attachments = 0;
    if (candidateIds.length) {
      const { count } = await supabase
        .from("ts_candidate_attachments")
        .select("id", { count: "exact", head: true })
        .in("candidate_id", candidateIds);
      attachments = count ?? 0;
    }
    setDeleteCounts({
      rounds: rounds ?? 0,
      candidates: candidateIds.length,
      attachments,
    });
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    // FK CASCADE on ts_pull_rounds, ts_candidates, ts_evaluations,
    // ts_candidate_attachments handles the cleanup. Storage files are NOT
    // cascaded — Phase 3.7's storage cleanup cron handles them.
    const { error } = await supabase.from("ts_roles").delete().eq("id", pendingDelete.id);
    setDeleting(false);
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: `Deleted "${pendingDelete.title}"` });
    setPendingDelete(null);
    void reload();
  };

  const open = (roles ?? []).filter((r) => r.status !== "closed");
  const closed = (roles ?? []).filter((r) => r.status === "closed");

  return (
    <div className="space-y-8">
      <header className="flex items-end justify-between gap-5">
        <div className="space-y-2">
          <div className="text-xs font-mono uppercase tracking-widest text-primary">Talent Scout</div>
          <h1 className="h-page">Open roles</h1>
          <p className="text-sm text-muted-foreground">Active hiring searches at Mirror NYC.</p>
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
          className="flex w-full items-center gap-3 rounded-md border border-border bg-card px-5 py-3 text-left text-[13px] font-mono font-bold uppercase tracking-wider transition-colors hover:bg-secondary/40"
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
              closed.map((r) => <RoleRow key={r.id} r={r} onReopen={reopen} onDelete={openDelete} />)
            )}
          </Card>
        )}
      </div>

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this role permanently?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <div>This will delete:</div>
                <ul className="list-disc space-y-1 pl-5">
                  <li>{deleteCounts?.rounds ?? "…"} pull rounds</li>
                  <li>{deleteCounts?.candidates ?? "…"} candidates and their evaluations</li>
                  <li>{deleteCounts?.attachments ?? "…"} attachments in Storage (resumes, cover letters, portfolios)</li>
                  <li>All role settings and scorecard customizations</li>
                  <li>All hiring manager notes</li>
                </ul>
                <div className="pt-2 font-semibold text-foreground">This cannot be undone.</div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={deleting}
              className="bg-red-500 text-white hover:bg-red-600"
            >
              {deleting ? "Deleting…" : "Delete Role"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
