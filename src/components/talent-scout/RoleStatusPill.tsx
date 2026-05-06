import { cn } from "@/lib/utils";

type Props = {
  status: "open" | "closed" | string | null;
  latestRound?: number | null;
  hasFinalReport?: boolean;
  size?: "default" | "lg";
};

export function RoleStatusPill({ status, latestRound, hasFinalReport, size = "default" }: Props) {
  let label: string;
  let cls: string;

  // Brand colors aligned with source (Phase 3.5b):
  //  - Final Report: success green (#4ade80 = green-400)
  //  - Closed: red-500 family (#ef4444)
  //  - Active round: coral primary (#ef5b5b)
  //  - Open / no round: muted surface
  if (hasFinalReport) {
    label = "Final Report";
    cls = "bg-green-400/10 text-green-400 border-green-400/30";
  } else if (status === "closed") {
    label = "Closed";
    cls = "bg-red-500/10 text-red-500 border-red-500/30";
  } else if (latestRound && latestRound > 0) {
    label = `R${latestRound}`;
    cls = "bg-primary/15 text-primary border-primary/40";
  } else {
    label = "Open";
    cls = "bg-secondary text-muted-foreground border-border";
  }

  const sizeCls = size === "lg" ? "px-3 py-1.5 text-[13px]" : "px-2.5 py-1 text-[11px]";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border font-bold uppercase tracking-wider",
        sizeCls,
        cls,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}
