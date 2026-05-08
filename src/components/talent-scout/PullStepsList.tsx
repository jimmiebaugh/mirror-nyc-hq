// Phase 3.7.8.6: stepped checklist for the Pull Round Detail running
// state. Adapted from mirror-talent-scout's PullLoading.tsx step-progress
// rendering, but driven by HQ's existing pull_rounds signals
// (candidates_found + processed_count + status) instead of a per-step
// JSONB column. The HQ port intentionally dropped the source's
// step_progress writes to keep ts-pull-candidates simple; this component
// reconstructs a coarser-grained 4-step view from the data we already
// track. Live-updates via the realtime subscription PullDetail already
// has on ts_pull_rounds.

import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Database } from "@/integrations/supabase/types";

type PullRoundRow = Database["public"]["Tables"]["ts_pull_rounds"]["Row"];

type StepStatus = "pending" | "active" | "done";

interface PullStep {
  key: string;
  label: string;
  status: StepStatus;
  count?: number;
}

function deriveSteps(round: PullRoundRow): PullStep[] {
  const found = round.candidates_found ?? 0;
  const processed = round.processed_count ?? 0;
  const isComplete = round.status === "complete";
  const isFailed = round.status === "failed" || round.status === "stalled";

  // Search + dedupe both fire pre-loop in HQ's edge function (gmail
  // search runs, dedupe drops already-ingested rows, candidates_found
  // is set with the post-dedupe count). Both flip to done in the same
  // db update. Source-style separate visual rows preserved so the
  // running screen feels substantial; both steps just share a trigger.
  const searchAndDedupeDone = found > 0 || isComplete;
  const processingDone = isComplete || (found > 0 && processed >= found);
  const savingDone = isComplete;

  return [
    {
      key: "search",
      label: searchAndDedupeDone
        ? `Searched Gmail (${found} ${found === 1 ? "match" : "matches"})`
        : "Searching Gmail…",
      status: searchAndDedupeDone ? "done" : isFailed ? "pending" : "active",
      count: searchAndDedupeDone && found > 0 ? found : undefined,
    },
    {
      key: "dedupe",
      label: searchAndDedupeDone
        ? `Found ${found} new candidate${found === 1 ? "" : "s"}`
        : "Finding new candidates…",
      status: searchAndDedupeDone ? "done" : "pending",
      count: searchAndDedupeDone && found > 0 ? found : undefined,
    },
    {
      key: "process",
      label: processingDone
        ? `Processed ${found} candidate${found === 1 ? "" : "s"}`
        : found > 0
        ? `Processing ${processed} of ${found} candidate${found === 1 ? "" : "s"}`
        : "Processing candidates…",
      status: processingDone
        ? "done"
        : searchAndDedupeDone
        ? "active"
        : "pending",
      count: processed > 0 ? processed : undefined,
    },
    {
      key: "save",
      label: savingDone ? "Saved results" : "Saving results…",
      status: savingDone ? "done" : processingDone ? "active" : "pending",
    },
  ];
}

export function PullStepsList({ round }: { round: PullRoundRow }) {
  const steps = deriveSteps(round);
  const completed = steps.filter((s) => s.status === "done").length;
  const pct = (completed / steps.length) * 100;

  return (
    <div className="space-y-6">
      {/* Slim progress bar above the checklist — gives the screen a
          single global "how far along" reading at a glance. Mirrors
          the source's PullLoading.tsx top progress bar. */}
      <div className="h-[3px] w-full overflow-hidden rounded-full bg-surface-alt">
        <div
          className="h-full bg-primary transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="divide-y divide-border rounded-md border border-border bg-card">
        {steps.map((s, i) => (
          <PullStepRow key={s.key} step={s} index={i} />
        ))}
      </div>
    </div>
  );
}

function PullStepRow({ step, index }: { step: PullStep; index: number }) {
  const isDone = step.status === "done";
  const isActive = step.status === "active";

  return (
    <div className="flex items-center gap-4 px-6 py-4">
      <div
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[12px] font-bold",
          isDone && "border-green-400/30 bg-green-400/15 text-green-400",
          isActive && "border-primary/40 bg-primary/15 text-primary",
          !isDone && !isActive && "border-border bg-surface-alt text-muted-foreground",
        )}
      >
        {isDone ? (
          <Check className="h-4 w-4" />
        ) : isActive ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          index + 1
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "text-[13px] font-semibold",
            isDone || isActive ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {step.label}
        </div>
      </div>
      {typeof step.count === "number" && step.count > 0 && (
        <div className="text-[14px] font-bold tabular-nums text-muted-foreground">
          {step.count}
        </div>
      )}
    </div>
  );
}
