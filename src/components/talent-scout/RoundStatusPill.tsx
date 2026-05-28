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
  // Phase 5.13.2c smoke: bring this pill onto the canonical .pill token
  // system so it sits the same height as the RX / Latest pills in the
  // PullDetail header (previously rendered larger via custom 16px font +
  // px-4 py-2 padding). `size="large"` → `.pill` base (10.5px),
  // `size="default"` → `.pill-sm` (9.5px).
  return (
    <span
      className={cn(
        "pill",
        isLarge ? null : "pill-sm",
        isRunning && "p-warn",
        isFailed && "p-destructive",
      )}
    >
      <span className="dt" />
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}
