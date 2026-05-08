import { cn } from "@/lib/utils";

type Props = {
  status: "running" | "complete" | "failed" | "stalled" | string;
  /** Phase 3.7.8.9: "large" matches the RX pill on PullDetail
   *  (px-4 py-2 text-[16px] with an h-2 w-2 dot). Default size stays
   *  for the smaller pill on RoleDashboard's top role panel. */
  size?: "default" | "large";
};

const STATUS_LABEL: Record<string, string> = {
  running: "Running",
  complete: "Complete",
  failed: "Failed",
  stalled: "Stalled",
};

/**
 * Shows the status of a pull round. Hidden when status is "complete" — done
 * pulls don't need a pill (they're conveyed by the page contents). Surfaces
 * Running / Failed / Stalled prominently so they're visible at a glance.
 */
export function RoundStatusPill({ status, size = "default" }: Props) {
  if (status === "complete") return null;
  const isRunning = status === "running";
  const isFailed = status === "failed" || status === "stalled";
  const isLarge = size === "large";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm border font-mono font-bold uppercase tracking-wider",
        isLarge ? "gap-2 px-4 py-2 text-[16px]" : "gap-1.5 px-2.5 py-1 text-[13px]",
        isRunning && "border-amber-500/30 bg-amber-500/10 text-amber-500",
        isFailed && "border-red-500/30 bg-red-500/10 text-red-500",
      )}
    >
      <span className={cn("rounded-full bg-current", isLarge ? "h-2 w-2" : "h-1.5 w-1.5")} />
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}
