import { cn } from "@/lib/utils";

type Props = {
  status: "running" | "complete" | "failed" | "stalled" | string;
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
export function RoundStatusPill({ status }: Props) {
  if (status === "complete") return null;
  const isRunning = status === "running";
  const isFailed = status === "failed" || status === "stalled";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider",
        isRunning && "border-amber-500/30 bg-amber-500/10 text-amber-400",
        isFailed && "border-red-500/30 bg-red-500/10 text-red-400",
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}
