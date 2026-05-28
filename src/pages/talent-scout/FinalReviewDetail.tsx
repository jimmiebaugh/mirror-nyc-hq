import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ChevronRight, ExternalLink, FileText, Download, RefreshCw, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { unwrapSecurityWrapper } from "@/lib/unwrapUrl";
import { ScoreInline } from "@/components/talent-scout/ScoreInline";
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

/**
 * Final review detail page. Source-fidelity port of mirror-talent-scout's
 * FinalReviewDetail with HQ-specific adaptations:
 *   - final_rankings entry shape: { candidate_id, final_rank, final_tier,
 *     rationale, recruiter_note }
 *   - Recruiter Note rendered as its own column in the rankings table.
 *     Rationale stacked full-width below each candidate row, always
 *     visible (no expand/collapse). Final Overview field removed
 *     entirely (was too noisy in this surface — see decisions doc).
 *   - "Re-Review" calls ts-final-review (HQ name).
 *   - "Generate Packet" calls ts-final-review-packet with include_all: true —
 *     always packets every ranked candidate; no top-N input.
 */

type FinalRanking = {
  candidate_id: string;
  final_rank: number;
  final_tier: "top_recommendation" | "strong_consideration" | "backup" | "not_recommended";
  rationale: string;
  /** Phase 3.6.6: array of bullet strings (≤3). Older reviews may have a
      legacy single-string value — handled by the renderer. */
  recruiter_note?: string[] | string | null;
};

type Review = {
  id: string;
  role_id: string;
  generated_at: string | null;
  candidate_count: number | null;
  final_rankings: FinalRanking[] | null;
  pool_summary: string | null;
  status: string | null;
  duration_seconds: number | null;
  packet_url: string | null;
  packet_top_n: number | null;
  packet_include_fast_track: boolean | null;
  packet_generated_at: string | null;
};

type Cand = {
  id: string;
  name: string | null;
  email: string | null;
  applied_date: string | null;
  total_score: number | null;
  portfolio_path_or_url: string | null;
  resume_path: string | null;
};

const TIER_META: Record<FinalRanking["final_tier"], { label: string; pillToken: string; rbToken: string }> = {
  top_recommendation:   { label: "Top Recommendation",   pillToken: "p-success",     rbToken: "rb-success" },
  strong_consideration: { label: "Strong Consideration", pillToken: "p-warn",        rbToken: "rb-warn" },
  backup:               { label: "Backup",               pillToken: "p-muted",       rbToken: "rb-muted" },
  not_recommended:      { label: "Not Recommended",      pillToken: "p-destructive", rbToken: "rb-destructive" },
};

export default function FinalReviewDetail() {
  const { id: roleId, reviewId: paramReviewId } = useParams();
  const nav = useNavigate();
  const [review, setReview] = useState<Review | null>(null);
  const [history, setHistory] = useState<Review[]>([]);
  const [candMap, setCandMap] = useState<Record<string, Cand>>({});
  const [roleTitle, setRoleTitle] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [showRegen, setShowRegen] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [generatingPacket, setGeneratingPacket] = useState(false);
  const [showPacketRegen, setShowPacketRegen] = useState(false);

  useEffect(() => {
    if (!roleId) return;
    (async () => {
      setLoading(true);
      const [{ data: role }, { data: reviews }] = await Promise.all([
        supabase.from("ts_roles").select("title").eq("id", roleId).maybeSingle(),
        supabase
          .from("ts_final_reviews")
          .select("*")
          .eq("role_id", roleId)
          .eq("status", "complete")
          .order("generated_at", { ascending: false }),
      ]);
      setRoleTitle(role?.title ?? "");
      const list = (reviews ?? []) as unknown as Review[];
      setHistory(list);
      const current = paramReviewId
        ? list.find((r) => r.id === paramReviewId) ?? null
        : list[0] ?? null;
      setReview(current);

      if (current?.final_rankings?.length) {
        const ids = current.final_rankings.map((r) => r.candidate_id);
        const [{ data: cs }, { data: atts }] = await Promise.all([
          supabase
            .from("ts_candidates")
            .select("id,name,email,applied_date,score,portfolio_path_or_url")
            .in("id", ids),
          supabase
            .from("ts_candidate_attachments")
            .select("candidate_id,attachment_type,file_name,file_path")
            .in("candidate_id", ids),
        ]);
        const resumeByCand: Record<string, string> = {};
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (atts ?? []).forEach((a: any) => {
          if (resumeByCand[a.candidate_id]) return; // first wins
          if (a.attachment_type === "resume" || /resume|cv/i.test(a.file_name ?? "")) {
            resumeByCand[a.candidate_id] = a.file_path;
          }
        });
        const m: Record<string, Cand> = {};
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (cs ?? []).forEach((c: any) => {
          m[c.id] = {
            id: c.id,
            name: c.name,
            email: c.email,
            applied_date: c.applied_date,
            total_score: c.score ?? null,
            portfolio_path_or_url: c.portfolio_path_or_url ?? null,
            resume_path: resumeByCand[c.id] ?? null,
          };
        });
        setCandMap(m);
      }
      setLoading(false);
    })();
  }, [roleId, paramReviewId]);

  const ranked = useMemo(() => {
    const list = [...(review?.final_rankings ?? [])];
    list.sort((a, b) => a.final_rank - b.final_rank);
    return list;
  }, [review]);

  const regenerate = async () => {
    if (!roleId) return;
    setRegenerating(true);
    const { data, error } = await supabase.functions.invoke("ts-final-review", { body: { role_id: roleId } });
    setRegenerating(false);
    if (error) {
      toast({ title: "Re-review failed", description: error.message, variant: "destructive" });
      return;
    }
    setShowRegen(false);
    if (data?.final_review_id) {
      nav(`/talent-scout/roles/${roleId}/final-review/${data.final_review_id}/generating`);
    }
  };


  const openResume = async (resumePath: string) => {
    const { data: signed, error } = await supabase.storage
      .from("candidate_attachments")
      .createSignedUrl(resumePath, 3600);
    if (error || !signed?.signedUrl) {
      toast({
        title: "Couldn't open resume",
        description: error?.message ?? "Signed URL failed",
        variant: "destructive",
      });
      return;
    }
    window.open(signed.signedUrl, "_blank");
  };

  const runPacket = async () => {
    if (!review) return;
    setGeneratingPacket(true);
    const { data, error } = await supabase.functions.invoke("ts-final-review-packet", {
      body: { final_review_id: review.id, include_all: true, include_fast_track: true },
    });
    setGeneratingPacket(false);
    setShowPacketRegen(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (error || (data as any)?.error) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      toast({ title: "Packet failed", description: (data as any)?.error ?? error?.message ?? "Unknown error", variant: "destructive" });
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const url = (data as any).url as string;
    setReview((r) => r ? { ...r, packet_url: url, packet_generated_at: new Date().toISOString() } : r);
    toast({ title: "Packet generated", description: "Emailed to the hiring manager and ready for download." });
    if (url?.startsWith("http")) window.open(url, "_blank");
  };

  const downloadPacket = async () => {
    if (!review) return;
    if (review.packet_url) {
      const p = review.packet_url;
      if (p.startsWith("http")) {
        window.open(p, "_blank");
        return;
      }
      const { data: signed, error } = await supabase.storage.from("packets").createSignedUrl(p, 3600);
      if (error || !signed?.signedUrl) {
        setShowPacketRegen(true);
        return;
      }
      window.open(signed.signedUrl, "_blank");
      return;
    }
    await runPacket();
  };

  if (loading) {
    return (
      <div className="text-muted-foreground text-[13px] flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (!review) {
    return (
      <div className="mx-auto max-w-5xl">
        <Link to={`/talent-scout/roles/${roleId}`} className="text-[14px] font-mono uppercase tracking-widest text-primary hover:underline">
          Back to {roleTitle || "role"}
        </Link>
        <div className="mt-6 empty">
          <p>No final review yet for this role.</p>
        </div>
      </div>
    );
  }

  const genDate = review.generated_at ? new Date(review.generated_at) : null;
  const isLatest = history[0]?.id === review.id;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0 space-y-2">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="h-page">Final Review</h1>
            {isLatest && (
              <span className="pill pill-sm p-success">
                <span className="dt" />
                Latest
              </span>
            )}
          </div>
          <div className="detail-meta flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>
              {genDate ? `${genDate.getMonth() + 1}/${genDate.getDate()}/${genDate.getFullYear()}` : "—"}
            </span>
            <span>·</span>
            <span>{review.candidate_count ?? ranked.length} candidates analyzed</span>
          </div>
        </div>
        {/* Phase 3.6.3: Generate Packet up top with Re-Review inline left.
             Packet always includes all ranked candidates (include_all: true).
             No top-N input — the Final Review pool is the packet pool. */}
        <div className="flex w-full flex-col items-start gap-2 sm:w-auto sm:flex-shrink-0 sm:items-end">
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <Button
              variant="outline"
              onClick={() => setShowRegen(true)}
              className="w-full sm:w-auto"
            >
              <RefreshCw className="mr-2 h-3.5 w-3.5" />
              Re-Review
            </Button>
            <Button
              onClick={review.packet_url ? () => setShowPacketRegen(true) : downloadPacket}
              disabled={generatingPacket}
              className="w-full sm:w-auto"
            >
              {generatingPacket ? (
                <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Generating…</>
              ) : review.packet_url ? (
                <><Download className="mr-2 h-3.5 w-3.5" /> Re-generate Packet</>
              ) : (
                <><Download className="mr-2 h-3.5 w-3.5" /> Generate Packet</>
              )}
            </Button>
          </div>
          {review.packet_url && (
            <button
              onClick={downloadPacket}
              className="text-[12px] font-mono font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground"
            >
              ↓ Open last packet
            </button>
          )}
        </div>
      </div>

      {/* Pool Summary */}
      <section className="card">
        <div className="card-headbar">
          <span className="h-card">Pool Summary</span>
        </div>
        <div className="card-pad">
          <div className="fr-body text-foreground/90 whitespace-pre-wrap">
            {review.pool_summary || "—"}
          </div>
        </div>
      </section>

      {/* Final Rankings */}
      <section className="card overflow-hidden">
        <div className="card-headbar">
          <span className="h-card">Final Rankings</span>
        </div>
        <div className="tbl-wrap" style={{ border: "none", borderRadius: 0 }}>
          <table className="tbl fr-table">
            <thead>
              <tr>
                <th style={{ width: 260 }}>Candidate</th>
                <th className="c" style={{ width: 80 }}>Resume</th>
                <th className="c" style={{ width: 80 }}>Portfolio</th>
                <th className="c">Rationale & Considerations</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((r) => {
                const c = candMap[r.candidate_id];
                const ts = TIER_META[r.final_tier] ?? TIER_META.backup;
                const rank = r.final_rank;
                return (
                  <tr
                    key={r.candidate_id}
                    className={ts.rbToken}
                    style={{ cursor: "pointer", verticalAlign: "middle" }}
                    onClick={() => nav(`/talent-scout/candidates/${r.candidate_id}`)}
                  >
                    {/* Column 1: candidate identity stack. */}
                    <td>
                      <div className="flex items-baseline gap-3">
                        <span className="font-display text-[20px] font-extrabold tabular-nums text-primary leading-none">{rank}</span>
                        <span className="text-[16px] font-bold leading-tight">{c?.name ?? "—"}</span>
                      </div>
                      {/* Phase 3.7.1.1: email is a mailto link, muted coral. */}
                      <div className="text-[12px] mt-1 ml-[34px] truncate max-w-[220px]">
                        {c?.email ? (
                          <a
                            href={`mailto:${c.email}`}
                            onClick={(e) => e.stopPropagation()}
                            className="text-primary/80 hover:text-primary hover:underline"
                          >
                            {c.email}
                          </a>
                        ) : (
                          <span className="text-muted-foreground" />
                        )}
                      </div>
                      <div className="text-[12.5px] text-muted-foreground mt-0.5 ml-[34px]">
                        {c?.applied_date ? `Applied ${new Date(c.applied_date).toLocaleDateString()}` : "—"}
                      </div>
                      <div className="mt-5 ml-[34px] space-y-4">
                        <span className={`pill pill-sm ${ts.pillToken}`}>{ts.label}</span>
                        <div className="flex items-center gap-2 label-form">
                          <span>Score:</span>
                          <ScoreInline value={c?.total_score ?? null} size={14} barWidth={60} />
                        </div>
                      </div>
                    </td>

                    {/* Column 2: Resume */}
                    <td className="c">
                      {c?.resume_path ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); openResume(c.resume_path!); }}
                          className="inline-flex h-11 w-11 items-center justify-center rounded-sm border border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                          title="Open resume"
                        >
                          <FileText className="h-5 w-5" />
                        </button>
                      ) : (
                        <span className="text-muted-foreground text-[12px]">—</span>
                      )}
                    </td>

                    {/* Column 3: Portfolio */}
                    <td className="c">
                      {c?.portfolio_path_or_url ? (
                        <a
                          href={unwrapSecurityWrapper(c.portfolio_path_or_url)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex h-11 w-11 items-center justify-center rounded-sm border border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                          title="Open portfolio"
                        >
                          <ExternalLink className="h-5 w-5" />
                        </a>
                      ) : (
                        <span className="text-muted-foreground text-[12px]">—</span>
                      )}
                    </td>

                    {/* Column 4: Rationale + stacked Recruiter Note (sanctioned coral exception) */}
                    <td style={{ verticalAlign: "top" }}>
                      <div className="pl-4 border-l-2 border-border fr-body text-foreground/90">
                        {r.rationale || <span className="text-muted-foreground">No rationale.</span>}
                        {(() => {
                          const notes = Array.isArray(r.recruiter_note)
                            ? r.recruiter_note.filter(Boolean)
                            : typeof r.recruiter_note === "string" && r.recruiter_note.trim()
                              ? [r.recruiter_note]
                              : [];
                          if (notes.length === 0) return null;
                          return (
                            <div className="mt-3">
                              {/* Sanctioned coral: Recruiter Note sub-label stays coral
                                  per Phase 5.13.2c spec. */}
                              <div className="font-mono text-[11px] font-bold uppercase tracking-wider text-primary mb-1.5">Recruiter Note</div>
                              <ul className="space-y-1.5">
                                {notes.map((line, i) => (
                                  <li key={i} className="flex gap-2 fr-body text-foreground/90">
                                    <span className="text-primary flex-shrink-0">—</span>
                                    <span>{line}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          );
                        })()}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* History */}
      {history.length > 1 && (
        <div>
          <button
            onClick={() => setShowHistory((s) => !s)}
            className="w-full flex items-center gap-3 px-5 py-4 rounded-sm border border-border bg-surface hover:bg-secondary/40 text-left font-mono text-[13px] font-bold uppercase tracking-wider"
          >
            <ChevronRight className={`h-3 w-3 text-muted-foreground transition-transform ${showHistory ? "rotate-90" : ""}`} />
            <span>Previous Final Reviews ({history.length - 1})</span>
          </button>
          {showHistory && (
            // Card grid mirrors RoleDashboard's Pull Rounds treatment.
            // Phase 5.13.2c: responsive grid (2 cols mobile, 5 cols md+).
            <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-5">
              {history.slice(1).map((h, i) => {
                const reviewNumber = history.length - 1 - i; // FR1, FR2, ...
                return (
                  <Link
                    key={h.id}
                    to={`/talent-scout/roles/${roleId}/final-review/${h.id}`}
                    className="relative min-w-0 rounded-md border border-border bg-card p-4 transition-colors hover:border-foreground/40"
                  >
                    <div className="font-display text-3xl font-extrabold tabular-nums leading-none">
                      FR{reviewNumber}
                    </div>
                    <div className="mt-4 text-xs text-muted-foreground">
                      {h.generated_at
                        ? new Date(h.generated_at).toLocaleDateString("en-US", {
                            month: "long",
                            day: "numeric",
                            year: "numeric",
                          })
                        : "—"}
                    </div>
                    <div className="mt-3 border-t border-border/60 pt-3 label-form">
                      {h.candidate_count ?? 0} candidates · {h.duration_seconds ?? 0}s
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Re-review confirm */}
      <AlertDialog open={showRegen} onOpenChange={setShowRegen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Re-Generate Final Review?</AlertDialogTitle>
            <AlertDialogDescription>
              Re-running will create a new Final Review and supersede this one. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={regenerating}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={regenerate} disabled={regenerating} className="bg-primary text-primary-foreground hover:bg-primary-hover">
              {regenerating ? "Starting…" : "Re-Generate"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Re-generate packet confirm */}
      <AlertDialog open={showPacketRegen} onOpenChange={setShowPacketRegen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Re-Generate Packet?</AlertDialogTitle>
            <AlertDialogDescription>
              This will replace the existing Final Review packet. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={generatingPacket}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={runPacket} disabled={generatingPacket} className="bg-primary text-primary-foreground hover:bg-primary-hover">
              {generatingPacket ? "Generating…" : "Re-Generate"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
