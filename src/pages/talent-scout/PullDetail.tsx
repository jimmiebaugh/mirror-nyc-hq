import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Loader2, MoreVertical, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { CandidateTable, type CandidateRow } from "@/components/talent-scout/CandidateTable";
import { matchesSearch } from "@/lib/talent-scout/candidateSearch";
import { PullStepsList } from "@/components/talent-scout/PullStepsList";
import { RoundStatusPill } from "@/components/talent-scout/RoundStatusPill";
import { cn } from "@/lib/utils";
import type { Database } from "@/integrations/supabase/types";

type PullRoundRow = Database["public"]["Tables"]["ts_pull_rounds"]["Row"];

const POOL_STATUSES = new Set(["consider", "interview", "fast_track"]);
const REJECTED_STATUSES = new Set(["reject", "auto_rejected"]);

// Phase 3.6.12: packet generation is hidden in the UI while the path is
// being stabilized. Flip this back to `true` once the round-scoped packet
// flow is verified end-to-end. Logic (generatePacket, openExistingPacket,
// state, imports) stays in place so re-enabling is one line.
const PACKET_FEATURE_ENABLED = false;

export default function PullDetail() {
  const { id: roleId, pullRoundId } = useParams<{ id: string; pullRoundId: string }>();
  const nav = useNavigate();
  const { user } = useAuth();
  const [round, setRound] = useState<PullRoundRow | null>(null);
  const [roleTitle, setRoleTitle] = useState<string>("");
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [allRoundIds, setAllRoundIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [showReeval, setShowReeval] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [reevalState, setReevalState] = useState<{
    running: boolean;
    total: number;
    processed: number;
    failed: number;
  }>({ running: false, total: 0, processed: 0, failed: 0 });
  const reevalCancelRef = useRef(false);
  const [packetTopN, setPacketTopN] = useState("15");
  const [generatingPacket, setGeneratingPacket] = useState(false);

  const generatePacket = async (force = false) => {
    if (!pullRoundId) return;
    if (!force && round?.packet_url) {
      // Existing packet — open it instead of regenerating.
      void openExistingPacket();
      return;
    }
    setGeneratingPacket(true);
    const top_n = packetTopN ? Number(packetTopN) : 15;
    const { data, error } = await supabase.functions.invoke<{ url?: string; path?: string; error?: string }>(
      "ts-packet-generate",
      { body: { pull_round_id: pullRoundId, top_n } },
    );
    setGeneratingPacket(false);
    const errMsg = error?.message ?? data?.error ?? null;
    if (errMsg || !data?.url) {
      toast({
        title: "Packet generation failed",
        description: errMsg ?? "No URL returned",
        variant: "destructive",
      });
      return;
    }
    toast({
      title: "Packet ready",
      description: "Emailed to the hiring manager and opened in a new tab.",
    });
    window.open(data.url, "_blank");
    // Refresh round so packet_url shows up locally.
    const { data: rr } = await supabase.from("ts_pull_rounds").select("*").eq("id", pullRoundId).maybeSingle();
    if (rr) setRound(rr as PullRoundRow);
  };

  const openExistingPacket = async () => {
    if (!round?.packet_url) return;
    const p = round.packet_url;
    if (p.startsWith("http")) {
      window.open(p, "_blank");
      return;
    }
    const { data: signed, error } = await supabase.storage.from("packets").createSignedUrl(p, 3600);
    if (error || !signed?.signedUrl) {
      toast({
        title: "Could not open packet",
        description: error?.message ?? "Signed URL failed",
        variant: "destructive",
      });
      return;
    }
    window.open(signed.signedUrl, "_blank");
  };

  // Initial fetch + realtime subscription on the round.
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

  // Sibling rounds (for "Latest" badge) + role title.
  useEffect(() => {
    if (!roleId) return;
    let active = true;
    (async () => {
      const [{ data: r }, { data: rounds }] = await Promise.all([
        supabase.from("ts_roles").select("title").eq("id", roleId).maybeSingle(),
        supabase
          .from("ts_pull_rounds")
          .select("id")
          .eq("role_id", roleId)
          .order("started_at", { ascending: false }),
      ]);
      if (!active) return;
      setRoleTitle((r?.title as string | undefined) ?? "");
      setAllRoundIds((rounds ?? []).map((x) => x.id));
    })();
    return () => {
      active = false;
    };
  }, [roleId]);

  const reloadCandidates = async () => {
    if (!pullRoundId) return;
    const { data } = await supabase
      .from("ts_candidates")
      .select("*")
      .eq("pull_round_id", pullRoundId)
      .order("score", { ascending: false, nullsFirst: false });
    setCandidates((data as CandidateRow[]) ?? []);
  };

  useEffect(() => {
    if (!pullRoundId || round?.status !== "complete") return;
    void reloadCandidates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pullRoundId, round?.status]);

  const stats = useMemo(() => {
    const total = candidates.length;
    const inPool = candidates.filter((c) => POOL_STATUSES.has(c.status)).length;
    const rejected = candidates.filter((c) => REJECTED_STATUSES.has(c.status)).length;
    const fast = candidates.filter((c) => c.status === "fast_track").length;
    return { total, inPool, rejected, fast };
  }, [candidates]);

  const poolForReeval = useMemo(
    () => candidates.filter((c) => !REJECTED_STATUSES.has(c.status)),
    [candidates],
  );

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
  const isLatest = allRoundIds[0] === round.id;

  // Round-scoped re-eval: parallel ts-evaluate-candidate calls with overwrite_history=true.
  const startReevalPool = async () => {
    setShowReeval(false);
    if (poolForReeval.length === 0) return;
    reevalCancelRef.current = false;
    setReevalState({ running: true, total: poolForReeval.length, processed: 0, failed: 0 });
    const ids = poolForReeval.map((c) => c.id);
    // Limit concurrency to avoid overwhelming the runtime; 6-wide is plenty.
    const CONCURRENCY = 6;
    let cursor = 0;
    let processed = 0;
    let failed = 0;
    const worker = async () => {
      while (true) {
        if (reevalCancelRef.current) return;
        const i = cursor++;
        if (i >= ids.length) return;
        const cid = ids[i];
        const { data, error } = await supabase.functions.invoke<{ ok?: boolean; error?: string }>(
          "ts-evaluate-candidate",
          {
            body: {
              candidate_id: cid,
              triggered_by_user_id: user?.id ?? null,
              overwrite_history: true,
            },
          },
        );
        if (error || data?.error) failed++;
        processed++;
        setReevalState((s) => ({ ...s, processed, failed }));
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    setReevalState((s) => ({ ...s, running: false }));
    await reloadCandidates();
    if (failed === 0) {
      toast({
        title: "Pool re-evaluated",
        description: `${processed} candidate${processed === 1 ? "" : "s"} processed.`,
      });
    } else {
      toast({
        title: "Pool re-eval finished with errors",
        description: `${processed - failed} succeeded · ${failed} failed.`,
        variant: failed === processed ? "destructive" : "default",
      });
    }
  };

  const deleteRound = async () => {
    setShowDelete(false);
    const { error } = await supabase.from("ts_pull_rounds").delete().eq("id", round.id);
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Round deleted" });
    nav(`/talent-scout/roles/${roleId}`);
  };

  return (
    <div className="space-y-6">
      <Link
        to={`/talent-scout/roles/${roleId}`}
        className="text-[14px] font-mono uppercase tracking-widest text-primary hover:underline"
      >
        ← Back to role
      </Link>

      {/* Failure / pending banners */}
      {isFailed && (
        <div className="rounded-md border border-red-500/40 bg-red-500/5 p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-semibold">This pull failed</div>
              <div className="mt-1 break-all text-xs text-muted-foreground">
                Status {round.status}. Check the function logs for details.
              </div>
            </div>
          </div>
        </div>
      )}
      {round.pending_candidates && Array.isArray(round.pending_candidates) && (round.pending_candidates as unknown[]).length > 0 && !isRunning && (
        <div className="rounded-md border border-primary/40 bg-primary/5 p-4">
          <div className="text-sm font-semibold">This round has pending candidates</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {(round.pending_candidates as unknown[]).length} candidate(s) still queued ·{" "}
            {round.processed_count ?? 0} of {round.candidates_found ?? 0} processed. Status auto-recovers via
            the pull-watchdog cron (Phase 3.7).
          </div>
        </div>
      )}

      {/* Top round panel */}
      <Card>
        <CardContent className="space-y-6 p-6">
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
            <div className="min-w-0 space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                {/* Phase 3.7.8.4: RX pill + round status moved to the
                     RIGHT of the role title. Order: title → RX → round
                     status (latest/running/failed) → "Latest" badge.
                     Earlier (3.6.6) the RX pill sat LEFT of the title;
                     the visual weight ended up competing with the role
                     name and made the page feel R-pill-led rather than
                     role-led. */}
                <h1 className="h-page">{roleTitle || "Role"}</h1>
                {round.round_number != null && (
                  <span className="inline-flex items-center gap-2 rounded-sm border border-primary/40 bg-primary/15 px-4 py-2 text-[16px] font-mono font-bold uppercase tracking-wider text-primary">
                    <span className="h-2 w-2 rounded-full bg-current" />
                    R{round.round_number}
                  </span>
                )}
                <RoundStatusPill status={round.status} size="large" />
                {isLatest && (
                  <span className="inline-flex items-center gap-2 rounded-sm border border-green-400/40 bg-green-400/10 px-4 py-2 text-[16px] font-mono font-bold uppercase tracking-wider text-green-400">
                    <span className="h-2 w-2 rounded-full bg-current" />
                    Latest
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
                <span className="text-foreground">
                  {round.started_at
                    ? new Date(round.started_at).toLocaleDateString("en-US", {
                        month: "long",
                        day: "numeric",
                        year: "numeric",
                      })
                    : "—"}
                </span>
                <span>
                  <span className="text-muted-foreground/70">Trigger</span> {round.triggered_by ?? "—"}
                </span>
                {(round.pulled_from || round.pulled_to) && (
                  <span>
                    <span className="text-muted-foreground/70">Range</span>{" "}
                    {round.pulled_from ? new Date(round.pulled_from).toLocaleDateString() : "—"} →{" "}
                    {round.pulled_to ? new Date(round.pulled_to).toLocaleDateString() : "—"}
                  </span>
                )}
              </div>
            </div>

            <div className="flex w-full shrink-0 flex-wrap items-center gap-2 sm:w-auto sm:items-end">
              {/* Generate Packet + Top-N input hidden while packet path is
                   broken (Phase 3.6.12). Toggle PACKET_FEATURE_ENABLED to
                   restore. */}
              {PACKET_FEATURE_ENABLED && (
                <>
                  <Button
                    variant="outline"
                    onClick={generatePacket}
                    disabled={generatingPacket || isRunning}
                    title={isRunning ? "Wait for pull to finish before generating a packet." : undefined}
                  >
                    {generatingPacket ? (
                      <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating…</>
                    ) : round.packet_url ? (
                      <>↓ Re-generate Packet</>
                    ) : (
                      <>↓ Generate Packet</>
                    )}
                  </Button>
                  <Input
                    type="number"
                    min={1}
                    max={50}
                    value={packetTopN}
                    onChange={(e) => setPacketTopN(e.target.value)}
                    className="w-14 text-center"
                    title="Top-N candidates by score for the packet (default 15)."
                  />
                </>
              )}

              {(isComplete || isFailed) && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon" aria-label="Round actions">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    {isComplete && (
                      <DropdownMenuItem
                        onSelect={() => setShowReeval(true)}
                        disabled={reevalState.running || poolForReeval.length === 0}
                      >
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Re-Evaluate Pool Candidates
                      </DropdownMenuItem>
                    )}
                    {PACKET_FEATURE_ENABLED && isComplete && round.packet_url && (
                      <DropdownMenuItem onSelect={openExistingPacket}>
                        ↓ Open Last Packet
                      </DropdownMenuItem>
                    )}
                    {PACKET_FEATURE_ENABLED && isComplete && (
                      <DropdownMenuItem onSelect={() => generatePacket(true)} disabled={generatingPacket}>
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Re-generate Packet
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      onSelect={() => setShowDelete(true)}
                      className="text-red-500 focus:text-red-500"
                    >
                      Delete Round
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>

          {/* Phase 3.7.8.6: stepped checklist replaces the single-line
               spinner + progress bar. Live-updates via the realtime
               subscription on ts_pull_rounds. */}
          {isRunning && (
            <div className="border-t border-border pt-6">
              <PullStepsList round={round} />
            </div>
          )}

          {/* Stat tiles */}
          {isComplete && (
            <div className="grid grid-cols-4 gap-6 border-t border-border pt-6">
              <StatTile label="In Round" value={stats.total} />
              <StatTile label="In Pool" value={stats.inPool} accent />
              <StatTile label="Fast-Tracked" value={stats.fast} />
              <StatTile label="Rejected" value={stats.rejected} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Candidate search + table */}
      {isComplete && (
        <div>
          <CandidateTable
            candidates={filteredCandidates}
            search={search}
            onSearchChange={setSearch}
            emptyMessage={search ? `No candidates match "${search}".` : "No candidates in this round."}
            onChanged={reloadCandidates}
          />
        </div>
      )}

      {/* Re-eval pool dialog */}
      <AlertDialog open={showReeval} onOpenChange={setShowReeval}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Re-Evaluate Pool Candidates?</AlertDialogTitle>
            <AlertDialogDescription>
              Re-runs Claude evaluation against the current scorecard and prompt for{" "}
              {poolForReeval.length} pool candidate{poolForReeval.length === 1 ? "" : "s"} in this round
              (rejected and auto-rejected candidates are excluded). Existing scores, recruiter overviews,
              top strengths, key gaps, and quick overviews will be overwritten. Prior evaluations are
              not retained because this assumes the prompt or scorecard changed. Internal notes will be
              preserved and folded into the new evaluation.
              <br />
              <br />
              This may take several minutes and consumes Anthropic credits. Only run if multiple notes
              were added or settings changed significantly.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={startReevalPool}>
              Re-Evaluate Pool Candidates
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete round dialog */}
      <AlertDialog open={showDelete} onOpenChange={setShowDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this pull round?</AlertDialogTitle>
            <AlertDialogDescription>
              Permanently deletes this round, its {candidates.length} candidate
              {candidates.length === 1 ? "" : "s"}, all evaluations, and all attachments persisted to Storage.
              This cannot be undone.
              <br />
              <br />
              If you've manually changed any candidate's status (Interview, Fast-Track, etc.), those
              changes are lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={deleteRound} className="bg-red-500 text-white hover:bg-red-600">
              Delete Round
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Floating progress widget for in-progress re-eval */}
      {reevalState.running && (
        <div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-lg bg-primary px-4 py-3 text-primary-foreground shadow-2xl">
          <Loader2 className="h-5 w-5 animate-spin" />
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-bold">Re-evaluating pool candidates</span>
            <span className="text-xs opacity-90">
              {Math.min(reevalState.processed, reevalState.total)} of {reevalState.total}
              {reevalState.failed > 0 ? ` · ${reevalState.failed} failed` : ""}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              reevalCancelRef.current = true;
              setReevalState((s) => ({ ...s, running: false }));
            }}
            className="ml-2 text-[13px] font-mono font-bold uppercase tracking-wider underline opacity-90 hover:opacity-100"
          >
            Cancel
          </button>
        </div>
      )}
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
