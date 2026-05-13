import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ChevronRight, ExternalLink, FileText, Download, RefreshCw, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { unwrapSecurityWrapper } from "@/lib/unwrapUrl";
import { ScoreInline } from "@/components/talent-scout/ScoreInline";
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
  resume_path: string | null; // Storage path for the resume attachment, if present.
};

const tierStyle: Record<FinalRanking["final_tier"], { color: string; bg: string; border: string; label: string }> = {
  top_recommendation:   { color: "#4ade80", bg: "rgba(74,222,128,0.12)",  border: "rgba(74,222,128,0.4)",  label: "Top Recommendation" },
  strong_consideration: { color: "#f59e0b", bg: "rgba(245,158,11,0.12)",  border: "rgba(245,158,11,0.3)",  label: "Strong Consideration" },
  backup:               { color: "hsl(var(--muted-foreground))", bg: "hsl(var(--surface-alt))", border: "hsl(var(--border))", label: "Backup" },
  not_recommended:      { color: "#ef4444", bg: "rgba(239,68,68,0.12)",   border: "rgba(239,68,68,0.3)",   label: "Not Recommended" },
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
        // Fetch candidates AND their resume attachments in parallel. Resume
        // path is the first attachment row matching attachment_type='resume'
        // (or the file_name regex fallback for older candidates that pre-date
        // the typed enum).
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
      // Already exists — confirm regen, otherwise re-sign and open.
      const p = review.packet_url;
      if (p.startsWith("http")) {
        window.open(p, "_blank");
        return;
      }
      // Sign and open existing packet.
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
      <div>
        <Link to={`/talent-scout/roles/${roleId}`} className="text-[14px] font-mono uppercase tracking-widest text-primary hover:underline">
          ← Back to {roleTitle || "role"}
        </Link>
        <div className="mt-6 rounded-sm border border-border bg-surface p-8 text-center text-muted-foreground text-[13px]">
          No final review yet for this role.
        </div>
      </div>
    );
  }

  const genDate = review.generated_at ? new Date(review.generated_at) : null;
  const isLatest = history[0]?.id === review.id;

  return (
    <div>
      <Link to={`/talent-scout/roles/${roleId}`} className="text-[14px] font-mono uppercase tracking-widest text-primary hover:underline">
        ← Back to {roleTitle}
      </Link>

      <div className="mt-4 flex items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="h-page">Final Review</h1>
            {isLatest && (
              <span className="inline-flex items-center gap-1.5 rounded-sm border border-green-400/30 bg-green-400/10 px-2.5 py-1 text-[13px] font-mono font-bold uppercase tracking-wider text-green-400">
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                Latest
              </span>
            )}
          </div>
          <div className="mt-4 text-[13.5px] text-muted-foreground">
            {genDate ? `${genDate.getMonth() + 1}/${genDate.getDate()}/${genDate.getFullYear()}` : "—"}
            <span className="mx-2 text-subtle-foreground">·</span>
            {review.candidate_count ?? ranked.length} candidates analyzed
          </div>
        </div>
        {/* Phase 3.6.3: Generate Packet up top with Re-Review inline left.
             Packet always includes all ranked candidates (include_all: true).
             No top-N input — the Final Review pool is the packet pool. */}
        <div className="flex flex-col items-end gap-2 flex-shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowRegen(true)}
              className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-sm border border-border-strong bg-transparent text-foreground text-[13px] font-medium hover:bg-white/5 hover:border-foreground transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Re-Review
            </button>
            <button
              onClick={review.packet_url ? () => setShowPacketRegen(true) : downloadPacket}
              disabled={generatingPacket}
              className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-sm bg-primary text-primary-foreground text-[13px] font-medium hover:bg-primary-hover transition-colors disabled:opacity-50"
            >
              {generatingPacket ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Generating…</>
              ) : review.packet_url ? (
                <><Download className="h-3.5 w-3.5" /> Re-generate Packet</>
              ) : (
                <><Download className="h-3.5 w-3.5" /> Generate Packet</>
              )}
            </button>
          </div>
          {review.packet_url && (
            <button onClick={downloadPacket} className="text-[12px] font-mono font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground">
              ↓ Open last packet
            </button>
          )}
        </div>
      </div>

      {/* Pool Summary */}
      <div className="mt-6 rounded-sm border border-border bg-surface p-6" style={{ borderLeft: "3px solid hsl(var(--primary))" }}>
        <div className="text-[16px] font-mono font-bold uppercase tracking-wider text-primary mb-3">Pool Summary</div>
        <div className="text-[13.5px] text-foreground/90 leading-relaxed whitespace-pre-wrap">{review.pool_summary || "—"}</div>
      </div>

      {/* Final Rankings */}
      <div className="mt-6 rounded-sm border border-border bg-surface overflow-hidden">
        <div className="px-6 py-5 border-b border-border">
          <div className="text-[16px] font-mono font-bold uppercase tracking-wider text-primary">Final Rankings</div>
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left text-[10.5px] font-mono font-bold uppercase tracking-wider text-muted-foreground py-3 px-5 w-[260px]">Candidate</th>
              <th className="text-center text-[10.5px] font-mono font-bold uppercase tracking-wider text-muted-foreground py-3 px-3 w-[80px]">Resume</th>
              <th className="text-center text-[10.5px] font-mono font-bold uppercase tracking-wider text-muted-foreground py-3 px-3 w-[80px]">Portfolio</th>
              <th className="text-left text-[10.5px] font-mono font-bold uppercase tracking-wider text-muted-foreground py-3 px-5">Rationale & Considerations</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((r) => {
              const c = candMap[r.candidate_id];
              const ts = tierStyle[r.final_tier] ?? tierStyle.backup;
              const rank = r.final_rank;
              return (
                <tr
                  key={r.candidate_id}
                  className="border-b border-border align-middle cursor-pointer hover:bg-white/[0.02]"
                  onClick={() => nav(`/talent-scout/candidates/${r.candidate_id}`)}
                >
                  {/* Column 1: candidate identity stack. Final Tier pill +
                       score sit lower in the cell with breathing room above
                       (mt-6 — matches the gap between the top of the pill
                       and the bottom of the applied-date line). */}
                  <td className="py-5 px-5 align-middle">
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
                    <div className="mt-6 ml-[34px] space-y-2">
                      <span
                        className="inline-flex items-center px-2.5 py-1 rounded-sm border font-mono text-[12px] font-bold uppercase tracking-wider w-fit"
                        style={{ color: ts.color, background: ts.bg, borderColor: ts.border }}
                      >
                        {ts.label}
                      </span>
                      <div className="flex items-center gap-2 font-mono text-[12px] uppercase tracking-wider text-muted-foreground">
                        <span>Score:</span>
                        <ScoreInline value={c?.total_score ?? null} size={14} barWidth={60} />
                      </div>
                    </div>
                  </td>

                  {/* Column 2: Resume — bigger icon (Phase 3.6.6 — rows
                       are tall, h-9 looked too small). */}
                  <td className="py-5 px-3 align-middle text-center">
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

                  {/* Column 3: Portfolio — bigger icon */}
                  <td className="py-5 px-3 align-middle text-center">
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

                  {/* Column 4: Rationale + stacked Recruiter Note */}
                  <td className="py-5 px-5 align-top">
                    <div
                      className="pl-4 border-l-2 text-[13px] text-foreground/90 leading-relaxed"
                      style={{ borderColor: ts.color }}
                    >
                      {r.rationale || <span className="text-muted-foreground">No rationale.</span>}
                      {(() => {
                        // Coerce string OR array shapes (legacy reviews
                        // had a single string; Phase 3.6.6+ returns an array).
                        const notes = Array.isArray(r.recruiter_note)
                          ? r.recruiter_note.filter(Boolean)
                          : typeof r.recruiter_note === "string" && r.recruiter_note.trim()
                            ? [r.recruiter_note]
                            : [];
                        if (notes.length === 0) return null;
                        return (
                          <div className="mt-3">
                            <div className="font-mono text-[11px] font-bold uppercase tracking-wider text-primary mb-1.5">Recruiter Note</div>
                            <ul className="space-y-1.5">
                              {notes.map((line, i) => (
                                <li key={i} className="flex gap-2 text-[13px] text-foreground/90 leading-relaxed">
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

      {/* History */}
      {history.length > 1 && (
        <div className="mt-6">
          <button
            onClick={() => setShowHistory((s) => !s)}
            className="w-full flex items-center gap-3 px-5 py-4 rounded-sm border border-border bg-surface hover:bg-secondary/40 text-left font-mono text-[13px] font-bold uppercase tracking-wider"
          >
            <ChevronRight className={`h-3 w-3 text-muted-foreground transition-transform ${showHistory ? "rotate-90" : ""}`} />
            <span>Previous Final Reviews ({history.length - 1})</span>
          </button>
          {showHistory && (
            // Card grid mirrors RoleDashboard's Pull Rounds treatment.
            // Phase 3.6.6: up to 5 cards per row (was 3) since cards are
            // compact and Final Reviews accumulate over time.
            <div className="mt-3 grid grid-cols-5 gap-3">
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
                    <div className="mt-3 border-t border-border/60 pt-3 text-[10px] font-mono font-bold uppercase tracking-wider text-muted-foreground">
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
