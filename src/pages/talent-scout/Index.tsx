import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { DataTable, type Column } from "@/components/data/DataTable";
import { supabase } from "@/integrations/supabase/client";
import { RoleStatusPill } from "@/components/talent-scout/RoleStatusPill";
import { toast } from "@/hooks/use-toast";
import { fmtRelative } from "@/lib/talent-scout/relativeTime";

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

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

const POOL_STATUSES = new Set(["consider", "interview", "fast_track"]);

export default function TalentScoutIndex() {
  const nav = useNavigate();
  const [roles, setRoles] = useState<RoleExt[] | null>(null);
  const [loading, setLoading] = useState(true);
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
      console.warn("ts_roles query error:", error);
      setRoles([]);
      return;
    }
    const list = (rs as unknown as Role[]) ?? [];
    const ids = list.map((r) => r.id);
    const [{ data: cs }, { data: rr }, { data: fr }] = await Promise.all([
      ids.length
        ? supabase.from("ts_candidates").select("role_id, status").in("role_id", ids)
        : Promise.resolve({ data: [] as { role_id: string; status: string }[] }),
      ids.length
        ? supabase
            .from("ts_pull_rounds")
            .select("role_id, round_number, started_at, status")
            .in("role_id", ids)
        : Promise.resolve({ data: [] as { role_id: string; round_number: number | null; started_at: string; status: string }[] }),
      ids.length
        ? supabase
            .from("ts_final_reviews")
            .select("role_id")
            .in("role_id", ids)
            .eq("status", "complete")
        : Promise.resolve({ data: [] as { role_id: string }[] }),
    ]);
    const finalReportByRole: Record<string, boolean> = {};
    for (const r of (fr ?? [])) finalReportByRole[r.role_id] = true;
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
        has_final_report: !!finalReportByRole[r.id],
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

  const rows = roles ?? [];
  const activeCount = rows.filter((r) => r.status !== "closed").length;

  // Phase 5.13.2c smoke: column order locked as
  // Role / Posted / Reviewed / In Pool / Status / Last Pull / Settings.
  const columns: Column<RoleExt>[] = [
    {
      key: "role",
      label: "Role",
      align: "l",
      sort: (a, b) => a.title.localeCompare(b.title),
      render: (r) => (
        <Link
          to={`/talent-scout/roles/${r.id}`}
          className="lead"
          style={{ fontSize: 13.5 }}
          onClick={(e) => e.stopPropagation()}
        >
          {r.title}
        </Link>
      ),
    },
    {
      key: "posted",
      label: "Posted",
      width: 130,
      align: "c",
      sort: (a, b) => a.created_at.localeCompare(b.created_at),
      render: (r) => <span className="muted mono" style={{ fontSize: 12 }}>{fmtDate(r.created_at)}</span>,
    },
    {
      key: "reviewed",
      label: "Reviewed",
      width: 90,
      align: "c",
      sort: (a, b) => a.reviewed - b.reviewed,
      render: (r) => <span className="font-bold tabular-nums">{r.reviewed}</span>,
    },
    {
      key: "in_pool",
      label: "In Pool",
      width: 90,
      align: "c",
      sort: (a, b) => a.in_pool - b.in_pool,
      render: (r) => (
        <span className="font-bold tabular-nums text-amber-400">{r.in_pool}</span>
      ),
    },
    {
      key: "status",
      label: "Status",
      width: 180,
      align: "c",
      render: (r) => (
        <RoleStatusPill
          status={r.status}
          latestRound={r.latest_round_number}
          hasFinalReport={r.has_final_report}
        />
      ),
    },
    {
      key: "last_pull",
      label: "Last Pull",
      width: 130,
      align: "c",
      sort: (a, b) => (a.last_pull_at ?? "").localeCompare(b.last_pull_at ?? ""),
      render: (r) => <span className="muted">{fmtRelative(r.last_pull_at)}</span>,
    },
    {
      key: "actions",
      label: "",
      width: 160,
      align: "c",
      render: (r) => {
        const isClosed = r.status === "closed";
        return (
          <div className="flex items-center justify-center gap-3" onClick={(e) => e.stopPropagation()}>
            {isClosed ? (
              <>
                <button
                  type="button"
                  onClick={() => void reopen(r.id)}
                  className="text-[11px] font-mono font-bold uppercase tracking-wider text-primary hover:underline"
                >
                  Reopen
                </button>
                <button
                  type="button"
                  onClick={() => void openDelete(r)}
                  className="text-[11px] font-mono font-bold uppercase tracking-wider text-destructive hover:underline"
                >
                  Delete
                </button>
              </>
            ) : (
              <Link
                to={`/talent-scout/roles/${r.id}/settings`}
                className="text-[11px] font-mono font-bold uppercase tracking-wider text-primary hover:underline"
              >
                Settings
              </Link>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="stack-6">
      <div className="row between list-head">
        <h1 className="h-page">Talent Scout</h1>
        <Button asChild>
          <Link to="/talent-scout/new/details">
            <Plus className="mr-2 h-4 w-4" />
            New Role
          </Link>
        </Button>
      </div>

      {loading ? (
        <div className="flex flex-col items-center gap-4 py-24 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <div className="text-sm text-muted-foreground">Loading…</div>
        </div>
      ) : (
        <>
          <div className="tbl-list">
            <DataTable<RoleExt>
              rows={rows}
              flat
              columns={columns}
              onRowClick={(r) => nav(`/talent-scout/roles/${r.id}`)}
              twoTier={{
                isTerminal: (r) => r.status === "closed",
                dividerLabel: (n) => `Closed Roles · ${n} hidden`,
              }}
              empty={{
                message: "No open roles yet.",
                ctaLabel: "+ New Role",
                onCta: () => nav("/talent-scout/new/details"),
              }}
            />
          </div>
          <span className="cap">{activeCount} roles</span>
        </>
      )}

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
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deleting…" : "Delete Role"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
