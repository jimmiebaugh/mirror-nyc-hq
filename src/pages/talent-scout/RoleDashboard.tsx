import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { Download, Loader2, Settings as SettingsIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { RoleStatusPill } from "@/components/talent-scout/RoleStatusPill";
import { RoundStatusPill } from "@/components/talent-scout/RoundStatusPill";
import { CandidateTable, type CandidateRow } from "@/components/talent-scout/CandidateTable";
import { matchesSearch } from "@/components/talent-scout/CandidateSearch";
import { toast } from "@/hooks/use-toast";
import type { Database } from "@/integrations/supabase/types";
import { cn } from "@/lib/utils";
import { fmtRelative } from "@/lib/talent-scout/relativeTime";

type RoleRow = Database["public"]["Tables"]["ts_roles"]["Row"];
type PullRoundRow = Database["public"]["Tables"]["ts_pull_rounds"]["Row"];
type Role = RoleRow & {
  hiring_manager: { full_name: string | null; email: string } | null;
};

const POOL_STATUSES = new Set(["consider", "interview", "fast_track"]);
const REJECTED_STATUSES = new Set(["reject", "auto_rejected"]);

const SCHEDULE_LABEL: Record<string, string> = {
  off: "Off",
  daily: "Daily",
  every_3_days: "Every 3 days",
  weekly: "Weekly",
};

// Phase 3.7.3.4: extracted to src/lib/talent-scout/relativeTime.ts so
// CandidateDetail can use the same formatter for "Last evaluated".

export default function RoleDashboard() {
  const { id } = useParams();
  const nav = useNavigate();
  const [role, setRole] = useState<Role | null>(null);
  const [rounds, setRounds] = useState<PullRoundRow[]>([]);
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [pulling, setPulling] = useState(false);
  const [search, setSearch] = useState("");
  const [showAllRounds, setShowAllRounds] = useState(false);
  const [finalTopN, setFinalTopN] = useState("");
  // Latest complete final review id (if any) drives the Generate / View toggle.
  const [latestFinalReviewId, setLatestFinalReviewId] = useState<string | null>(null);

  const runningRound = rounds.find((r) => r.status === "running") ?? null;

  const reload = async () => {
    if (!id) return;
    const [{ data: r }, { data: rr }, { data: cs }, { data: fr }] = await Promise.all([
      supabase
        .from("ts_roles")
        .select("*, hiring_manager:users!ts_roles_hiring_manager_id_fkey(full_name, email)")
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("ts_pull_rounds")
        .select("*")
        .eq("role_id", id)
        .order("round_number", { ascending: false, nullsFirst: false }),
      supabase
        .from("ts_candidates")
        .select("*")
        .eq("role_id", id)
        .order("score", { ascending: false, nullsFirst: false }),
      supabase
        .from("ts_final_reviews")
        .select("id")
        .eq("role_id", id)
        .eq("status", "complete")
        .order("generated_at", { ascending: false })
        .limit(1),
    ]);
    setRole((r as unknown as Role) ?? null);
    setRounds((rr as PullRoundRow[]) ?? []);
    setCandidates((cs as CandidateRow[]) ?? []);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setLatestFinalReviewId(((fr as any[]) ?? [])[0]?.id ?? null);
  };

  useEffect(() => {
    if (!id) return;
    let active = true;
    (async () => {
      await reload();
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const startPull = async () => {
    if (!id) return;
    setPulling(true);
    const { data, error } = await supabase.functions.invoke<{ pull_round_id?: string; error?: string }>(
      "ts-pull-candidates",
      { body: { role_id: id, triggered_by: "manual" } },
    );
    setPulling(false);
    const errMsg = error?.message ?? data?.error ?? null;
    if (errMsg || !data?.pull_round_id) {
      toast({
        title: "Couldn't start pull",
        description: errMsg ?? "No pull_round_id returned",
        variant: "destructive",
      });
      return;
    }
    nav(`/talent-scout/roles/${id}/pulls/${data.pull_round_id}`);
  };

  const [startingFinalReview, setStartingFinalReview] = useState(false);
  const startFinalReview = async () => {
    if (!id) return;
    setStartingFinalReview(true);
    const top_n = finalTopN ? Number(finalTopN) : undefined;
    const { data, error } = await supabase.functions.invoke<{ final_review_id?: string; error?: string }>(
      "ts-final-review",
      { body: { role_id: id, top_n } },
    );
    setStartingFinalReview(false);
    const errMsg = error?.message ?? data?.error ?? null;
    if (errMsg || !data?.final_review_id) {
      toast({
        title: "Couldn't start final review",
        description: errMsg ?? "No final_review_id returned",
        variant: "destructive",
      });
      return;
    }
    nav(`/talent-scout/roles/${id}/final-review/${data.final_review_id}/generating`);
  };

  const stats = useMemo(() => {
    const total = candidates.length;
    const inPool = candidates.filter((c) => POOL_STATUSES.has(c.status)).length;
    const rejected = candidates.filter((c) => REJECTED_STATUSES.has(c.status)).length;
    const fast = candidates.filter((c) => c.status === "fast_track").length;
    return { total, inPool, rejected, fast };
  }, [candidates]);

  const filteredCandidates = useMemo(
    () =>
      candidates.filter((c) =>
        matchesSearch(
          {
            name: c.name,
            email: c.email,
            location: c.location,
            recruiter_overview: c.recruiter_overview,
            top_strengths: c.top_strengths as unknown[] | null,
            key_gaps: c.key_gaps as unknown[] | null,
            quick_overview: c.quick_overview as unknown[] | null,
          },
          search,
        ),
      ),
    [candidates, search],
  );

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!role) {
    return (
      <Card className="bg-surface-alt">
        <CardContent className="space-y-3 p-8 text-center">
          <p className="text-sm">Role not found.</p>
          <Button variant="ghost" onClick={() => nav("/talent-scout")}>← Back to roles</Button>
        </CardContent>
      </Card>
    );
  }

  const managerLabel = role.hiring_manager?.full_name ?? role.hiring_manager?.email ?? "Unassigned";
  const latestRoundNumber = rounds[0]?.round_number ?? null;
  const lastPullAt = rounds.find((r) => r.status === "complete")?.started_at ?? null;
  const scheduleOn = role.auto_pull_schedule && role.auto_pull_schedule !== "off";
  const visibleRounds = showAllRounds ? rounds : rounds.slice(0, 3);

  return (
    <div className="space-y-6">
      <Link to="/talent-scout" className="text-[14px] font-mono uppercase tracking-widest text-primary hover:underline">
        ← Talent Scout
      </Link>

      {/* Top role panel */}
      <Card className="bg-surface-alt">
        <CardContent className="space-y-6 p-6">
          <div className="flex items-start justify-between gap-6">
            <div className="min-w-0 space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="h-page">{role.title}</h1>
                <RoleStatusPill status={role.status} latestRound={latestRoundNumber} size="lg" />
                {rounds[0] && <RoundStatusPill status={rounds[0].status} />}
              </div>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
                <span>
                  <span className="text-muted-foreground/70">Posted</span>{" "}
                  {role.created_at ? new Date(role.created_at).toLocaleDateString() : "—"}
                </span>
                <span>
                  <span className="text-muted-foreground/70">Hiring manager</span> {managerLabel}
                </span>
                <span>
                  <span className="text-muted-foreground/70">Last pull</span> {fmtRelative(lastPullAt)}
                </span>
                <span
                  className={cn(
                    "inline-flex items-center gap-2 rounded-sm border px-2.5 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider",
                    scheduleOn
                      ? "border-green-400/30 bg-green-400/10 text-green-400"
                      : "border-border bg-secondary text-muted-foreground",
                  )}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                  {scheduleOn
                    ? `Scheduled: ${SCHEDULE_LABEL[role.auto_pull_schedule] ?? role.auto_pull_schedule}`
                    : "Schedule off"}
                </span>
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-stretch gap-2">
              <div className="flex items-end gap-2">
                <div className="flex flex-col gap-2">
                  {/* When a complete final review exists, the button becomes
                       'View Final Review' linking to the latest. Re-generation
                       lives on FinalReviewDetail's 'Re-Review' button. */}
                  {latestFinalReviewId ? (
                    <Button asChild variant="outline" className="w-full">
                      <Link to={`/talent-scout/roles/${role.id}/final-review/${latestFinalReviewId}`}>
                        ↗ View Final Review
                      </Link>
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      onClick={startFinalReview}
                      disabled={startingFinalReview || candidates.length < 3}
                      className="w-full"
                      title={candidates.length < 3 ? "Need at least 3 candidates to run final review." : undefined}
                    >
                      {startingFinalReview ? (
                        <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Starting…</>
                      ) : (
                        <>▶ Generate Final Review</>
                      )}
                    </Button>
                  )}
                  {role.status === "open" &&
                    (runningRound ? (
                      <Button asChild>
                        <Link to={`/talent-scout/roles/${role.id}/pulls/${runningRound.id}`}>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          View running pull
                        </Link>
                      </Button>
                    ) : (
                      <Button onClick={startPull} disabled={pulling}>
                        <Download className="mr-2 h-4 w-4" />
                        {pulling ? "Starting…" : "+ Pull New Candidates"}
                      </Button>
                    ))}
                </div>
                <div className="flex flex-col gap-2">
                  {/* Top-N only relevant when GENERATING a new review. Hide
                       it once a review exists; FinalReviewDetail's Re-Review
                       reruns with the same scope. */}
                  {!latestFinalReviewId && (
                    <Input
                      type="number"
                      min={1}
                      placeholder="N"
                      value={finalTopN}
                      onChange={(e) => setFinalTopN(e.target.value)}
                      className="w-14 text-center"
                      title="Optional: top N candidates by score for final review (cap 50)."
                    />
                  )}
                  <Button asChild variant="outline" size="icon" aria-label="Role settings" className="w-14">
                    <Link to={`/talent-scout/roles/${role.id}/settings`}>
                      <SettingsIcon className="h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* 4-stat grid */}
          <div className="grid grid-cols-4 gap-6 border-t border-border pt-6">
            <StatTile label="Total Reviewed" value={stats.total} />
            <StatTile label="In Pool" value={stats.inPool} accent />
            <StatTile label="Fast-Tracked" value={stats.fast} />
            <StatTile label="Rejected" value={stats.rejected} />
          </div>
        </CardContent>
      </Card>

      {/* Pull rounds */}
      {rounds.length > 0 && (
        <Card className="bg-surface-alt">
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-6">
              <div className="shrink-0">
                <div className="text-[13px] font-mono font-bold uppercase tracking-wider text-primary">Pull Rounds</div>
                <div className="mt-1 text-xs text-muted-foreground">Each pull is reviewed as its own batch</div>
              </div>
              <div className="grid min-w-0 flex-1 grid-cols-3 gap-3">
                {visibleRounds.map((rd, i) => {
                  const isLatest = i === 0;
                  const isFailed = rd.status === "failed";
                  const isStalled = rd.status === "stalled";
                  // Phase 3.7.6.7: per-round reviewed count, surfaced as
                  // a small "N / M" caption in the bottom-right of each
                  // card. M = total candidates from this round; N = the
                  // ones a human has marked manually_reviewed=true.
                  const roundCands = candidates.filter((c) => c.pull_round_id === rd.id);
                  const reviewed = roundCands.filter((c) => c.manually_reviewed === true).length;
                  const totalForRound = roundCands.length;
                  return (
                    <Link
                      key={rd.id}
                      to={`/talent-scout/roles/${role.id}/pulls/${rd.id}`}
                      className={cn(
                        "relative min-w-0 rounded-md border bg-card p-3 transition-colors",
                        isLatest
                          ? "border-primary/50 hover:border-primary"
                          : "border-border hover:border-foreground/40",
                      )}
                    >
                      <div className="absolute right-3 top-3 flex flex-col items-end gap-1">
                        {isLatest && (
                          <span className="inline-flex items-center gap-1.5 rounded-sm border border-primary/40 bg-primary/15 px-1.5 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider text-primary">
                            <span className="h-1 w-1 rounded-full bg-current" />
                            Latest
                          </span>
                        )}
                        {isFailed && (
                          <span className="inline-flex items-center rounded-sm border border-red-500/40 bg-red-500/10 px-1.5 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider text-red-500">
                            Failed
                          </span>
                        )}
                        {isStalled && (
                          <span className="inline-flex items-center rounded-sm border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider text-amber-500">
                            Stalled
                          </span>
                        )}
                      </div>
                      <div className="font-display text-3xl font-extrabold tabular-nums leading-none">R{rd.round_number ?? "—"}</div>
                      <div className="mt-3 text-xs text-muted-foreground">
                        {rd.started_at
                          ? new Date(rd.started_at).toLocaleDateString("en-US", {
                              month: "long",
                              day: "numeric",
                              year: "numeric",
                            })
                          : "—"}
                      </div>
                      {totalForRound > 0 && (
                        <div
                          className="absolute right-3 bottom-3 font-mono text-[15px] font-bold tabular-nums leading-none text-muted-foreground"
                          title={`${reviewed} of ${totalForRound} reviewed`}
                        >
                          <span className={reviewed === totalForRound ? "text-foreground" : "text-foreground"}>
                            {reviewed}
                          </span>
                          <span className="text-muted-foreground">/{totalForRound}</span>
                        </div>
                      )}
                    </Link>
                  );
                })}
              </div>
              <div className="flex shrink-0 flex-col items-center gap-3 self-center text-center">
                <div className="text-sm text-muted-foreground">
                  {rounds.length} round{rounds.length === 1 ? "" : "s"} · {candidates.length} candidate{candidates.length === 1 ? "" : "s"}
                </div>
                {rounds.length > 3 && (
                  <button
                    type="button"
                    onClick={() => setShowAllRounds((s) => !s)}
                    className="text-[13px] font-mono font-bold uppercase tracking-wider text-primary underline hover:opacity-80"
                  >
                    {showAllRounds ? "Show fewer" : `Show all (${rounds.length})`}
                  </button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Phase 3.7.8.7: master-pool header moved INSIDE CandidateTable's
          card via title + meta props. Lives in the same card as the
          search bar / bulk actions / rows so the section reads as one
          surface. */}
      <CandidateTable
        candidates={filteredCandidates}
        search={search}
        onSearchChange={setSearch}
        title="Master Pool"
        meta="from all rounds"
        emptyMessage={
          candidates.length === 0
            ? rounds.length === 0
              ? "No candidates pulled yet — click Pull candidates to start."
              : "Master pool is empty."
            : `No candidates match "${search}".`
        }
        onChanged={reload}
      />
    </div>
  );
}

function StatTile({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div>
      <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-1.5 font-display text-3xl font-extrabold tabular-nums leading-none",
          accent && "text-amber-400",
        )}
      >
        {value}
      </div>
    </div>
  );
}
