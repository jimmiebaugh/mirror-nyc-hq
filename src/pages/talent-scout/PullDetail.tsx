import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Loader2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { getScoreColor } from "@/lib/talent-scout/scoreColor";
import { cn } from "@/lib/utils";

type PullRoundRow = Database["public"]["Tables"]["ts_pull_rounds"]["Row"];
type CandidateRow = Database["public"]["Tables"]["ts_candidates"]["Row"];

const STATUS_LABEL: Record<string, string> = {
  running: "Running",
  complete: "Complete",
  failed: "Failed",
  stalled: "Stalled",
};

export default function PullDetail() {
  const { id: roleId, pullRoundId } = useParams<{ id: string; pullRoundId: string }>();
  const [round, setRound] = useState<PullRoundRow | null>(null);
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Initial fetch + realtime subscription.
  useEffect(() => {
    if (!pullRoundId) return;
    let active = true;

    const loadRound = async () => {
      const { data } = await supabase
        .from("ts_pull_rounds")
        .select("*")
        .eq("id", pullRoundId)
        .maybeSingle();
      if (!active) return;
      setRound((data as PullRoundRow | null) ?? null);
      setLoading(false);
    };
    void loadRound();

    const channel = supabase
      .channel(`ts_pull_rounds:${pullRoundId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "ts_pull_rounds", filter: `id=eq.${pullRoundId}` },
        (payload) => {
          if (!active) return;
          setRound(payload.new as PullRoundRow);
        },
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [pullRoundId]);

  // Load candidates once the round is complete.
  useEffect(() => {
    if (!pullRoundId || round?.status !== "complete") return;
    let active = true;
    (async () => {
      const { data } = await supabase
        .from("ts_candidates")
        .select("*")
        .eq("pull_round_id", pullRoundId)
        .order("score", { ascending: false, nullsFirst: false });
      if (!active) return;
      setCandidates((data as CandidateRow[]) ?? []);
    })();
    return () => {
      active = false;
    };
  }, [pullRoundId, round?.status]);

  const progressPct = useMemo(() => {
    if (!round) return 0;
    const found = round.candidates_found ?? 0;
    const done = round.processed_count ?? 0;
    if (found <= 0) return round.status === "complete" ? 100 : 0;
    return Math.min(100, Math.round((done / found) * 100));
  }, [round]);

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!round) {
    return (
      <Card>
        <CardContent className="space-y-3 px-6 py-10 text-center">
          <p className="text-sm">Pull round not found.</p>
          <Button variant="ghost" asChild>
            <Link to={`/talent-scout/roles/${roleId}`}>← Back to role</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const isRunning = round.status === "running";
  const isComplete = round.status === "complete";
  const isFailed = round.status === "failed" || round.status === "stalled";

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <Link
          to={`/talent-scout/roles/${roleId}`}
          className="text-xs uppercase tracking-widest text-primary hover:underline"
        >
          ← Back to role
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">
          Pull round{round.round_number ? ` R${round.round_number}` : ""}
        </h1>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span>Status: <strong className="text-foreground">{STATUS_LABEL[round.status] ?? round.status}</strong></span>
          <span>·</span>
          <span>Started {new Date(round.started_at).toLocaleString()}</span>
          {round.completed_at && (
            <>
              <span>·</span>
              <span>Finished {new Date(round.completed_at).toLocaleString()}</span>
            </>
          )}
        </div>
      </header>

      <Card>
        <CardContent className="space-y-4 p-6">
          {isRunning && (
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <span className="text-sm">
                {round.candidates_found ? (
                  <>
                    Processing <strong>{round.processed_count ?? 0}</strong> of{" "}
                    <strong>{round.candidates_found}</strong> candidates…
                  </>
                ) : (
                  <>Searching Gmail…</>
                )}
              </span>
            </div>
          )}
          {isComplete && (
            <div className="text-sm">
              {round.candidates_found === 0 ? (
                <span className="text-muted-foreground">
                  No new candidates matched the role's search criteria in this window.
                </span>
              ) : (
                <span>
                  Pull complete · <strong>{round.processed_count ?? 0}</strong> of{" "}
                  <strong>{round.candidates_found ?? 0}</strong> candidates scored.
                </span>
              )}
            </div>
          )}
          {isFailed && (
            <div className="text-sm text-red-400">
              Pull {round.status}. Check the function logs for details. Re-run from the role dashboard.
            </div>
          )}
          {(isRunning || isComplete) && (round.candidates_found ?? 0) > 0 && (
            <Progress value={progressPct} className="h-2" />
          )}
        </CardContent>
      </Card>

      {isComplete && candidates.length > 0 && (
        <Card className="overflow-hidden">
          <div className="grid grid-cols-[80px_minmax(0,2fr)_minmax(0,1.5fr)_140px_140px_auto] gap-4 border-b border-border bg-secondary/30 px-5 py-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            <div>Score</div>
            <div>Candidate</div>
            <div>Email</div>
            <div>Status</div>
            <div>Applied</div>
            <div />
          </div>
          {candidates.map((c) => (
            <div
              key={c.id}
              className="grid grid-cols-[80px_minmax(0,2fr)_minmax(0,1.5fr)_140px_140px_auto] gap-4 border-b border-border px-5 py-3 text-sm last:border-b-0 hover:bg-secondary/40"
            >
              <div
                className="text-base font-bold"
                style={{ color: getScoreColor(c.score == null ? null : Number(c.score)) }}
              >
                {c.score == null ? "—" : Number(c.score).toFixed(0)}
              </div>
              <div className="min-w-0 truncate font-medium">{c.name ?? "—"}</div>
              <div className="min-w-0 truncate text-muted-foreground">{c.email ?? "—"}</div>
              <div>
                <StatusPill status={c.status} />
              </div>
              <div className="text-muted-foreground">
                {c.applied_date ? new Date(c.applied_date).toLocaleDateString() : "—"}
              </div>
              <div className="flex items-center justify-end">
                <Link
                  to={`/talent-scout/candidates/${c.id}`}
                  className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground"
                >
                  View <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: CandidateRow["status"] }) {
  const map: Record<string, string> = {
    consider: "bg-secondary text-foreground border-border",
    promote: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
    fast_track: "bg-purple-500/10 text-purple-400 border-purple-500/30",
    reject: "bg-red-500/10 text-red-400 border-red-500/30",
    auto_rejected: "bg-red-500/5 text-red-400/80 border-red-500/20",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
        map[status] ?? "bg-secondary text-muted-foreground border-border",
      )}
    >
      {status.replace("_", " ")}
    </span>
  );
}
