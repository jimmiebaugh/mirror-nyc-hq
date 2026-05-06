import { cn } from "@/lib/utils";

type Props = {
  status: "open" | "closed" | string | null;
  latestRound?: number | null;
  hasFinalReport?: boolean;
};

export function RoleStatusPill({ status, latestRound, hasFinalReport }: Props) {
  let label: string;
  let cls: string;

  if (hasFinalReport) {
    label = "Final Report";
    cls = "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
  } else if (status === "closed") {
    label = "Closed";
    cls = "bg-red-500/10 text-red-400 border-red-500/30";
  } else if (latestRound && latestRound > 0) {
    label = `R${latestRound}`;
    cls = "bg-primary/15 text-primary border-primary/40";
  } else {
    label = "Open";
    cls = "bg-secondary text-muted-foreground border-border";
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider",
        cls,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}
