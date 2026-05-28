import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

/**
 * Loading screen for ts-final-review. Subscribes to the ts_final_reviews row
 * via Realtime and a 3s polling fallback. When status flips to 'complete',
 * navigates to the FinalReviewDetail page. Mirrors source's page structure
 * (3-step list, primary loader spinner, error surface).
 */

type Step = { status: "pending" | "active" | "done"; count?: number; label?: string };
type Review = {
  id: string;
  status: string | null;
  step_progress: Record<string, Step> | null;
  candidate_count: number | null;
  error_message: string | null;
};

const STEP_DEFS = [
  { key: "aggregate", defaultLabel: "Aggregating Master Pool" },
  { key: "build", defaultLabel: "Building comparative analysis" },
  { key: "rank", defaultLabel: "Analyzing and Ranking (this can take 5+ minutes for large pools)" },
];

export default function FinalReviewLoading() {
  const { id: roleId, reviewId } = useParams();
  const nav = useNavigate();
  const [review, setReview] = useState<Review | null>(null);

  useEffect(() => {
    if (!reviewId) return;
    let mounted = true;
    const load = async () => {
      const { data } = await supabase
        .from("ts_final_reviews")
        .select("id,status,step_progress,candidate_count,error_message")
        .eq("id", reviewId)
        .maybeSingle();
      if (mounted && data) setReview(data as unknown as Review);
    };
    load();
    const channel = supabase
      .channel(`ts_final_review_${reviewId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "ts_final_reviews", filter: `id=eq.${reviewId}` },
        (p) => {
          if (mounted) setReview(p.new as unknown as Review);
        },
      )
      .subscribe();
    const poll = setInterval(load, 3000);
    return () => {
      mounted = false;
      clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, [reviewId]);

  useEffect(() => {
    if (review?.status === "complete" && roleId && reviewId) {
      const t = setTimeout(() => nav(`/talent-scout/roles/${roleId}/final-review/${reviewId}`), 600);
      return () => clearTimeout(t);
    }
  }, [review?.status, roleId, reviewId, nav]);

  const progress = review?.step_progress ?? {};
  const completed = STEP_DEFS.filter((s) => progress[s.key]?.status === "done").length;
  const pct = (completed / STEP_DEFS.length) * 100;
  const n = review?.candidate_count ?? 0;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex flex-col items-center text-center pt-8 pb-4">
        <Loader2 className="h-10 w-10 text-primary animate-spin mb-6" />
        <h1 className="h-page">Analyzing Master Pool</h1>
        <div className="text-[13px] text-muted-foreground mt-4 max-w-[480px]">
          Comparing {n > 0 ? `all ${n}` : "all"} candidates and producing a holistic final ranking. This usually takes 30-90 seconds.
        </div>
        <div className="w-full max-w-[520px] mt-8 h-[3px] bg-surface-alt rounded-full overflow-hidden">
          <div className="h-full bg-primary transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <section className="card mt-8 divide-y divide-border">
        {STEP_DEFS.map((def, i) => {
          const s = progress[def.key];
          const status = s?.status ?? "pending";
          return (
            <div key={def.key} className="flex items-center gap-4 px-6 py-4">
              <div
                className={cn(
                  "fr-step-circle",
                  status === "done" && "fr-step-circle--done",
                  status === "active" && "fr-step-circle--active",
                  status === "pending" && "fr-step-circle--pending",
                )}
              >
                {status === "done" ? (
                  <Check className="h-4 w-4" />
                ) : status === "active" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  i + 1
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div
                  className={`text-[13px] font-semibold ${
                    status === "pending" ? "text-subtle-foreground" : "text-foreground"
                  }`}
                >
                  {s?.label ?? def.defaultLabel}
                </div>
              </div>
            </div>
          );
        })}
      </section>

      {review?.status === "failed" && (
        <section className="card fr-error-card mt-6">
          <div className="card-pad">
            <div className="font-mono text-[13px] font-bold uppercase tracking-wider text-destructive">
              Final Review Failed
            </div>
            <div className="text-[13px] text-muted-foreground mt-2">
              {review.error_message ?? "Unknown error"}
            </div>
            <div className="mt-4">
              <Button variant="outline" asChild>
                <Link to={`/talent-scout/roles/${roleId}`}>← Back to role</Link>
              </Button>
            </div>
          </div>
        </section>
      )}

      <div className="text-center mt-8">
        <Link
          to={`/talent-scout/roles/${roleId}`}
          className="font-mono text-[12px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground"
        >
          ← Run in background
        </Link>
      </div>
    </div>
  );
}
