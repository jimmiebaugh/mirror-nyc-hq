import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

const STEPS = [
  { num: 1, label: "Role Details" },
  { num: 2, label: "Search Setup" },
  { num: 3, label: "Scorecard" },
] as const;

export function Stepper({ active }: { active: 1 | 2 | 3 }) {
  return (
    <div className="mb-8 flex items-center gap-3 py-2">
      {STEPS.map((s, i) => {
        const done = s.num < active;
        const isActive = s.num === active;
        return (
          <div key={s.num} className="flex items-center gap-3">
            <div
              className={cn(
                "flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-wider",
                done || isActive ? "text-foreground" : "text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "inline-flex h-7 w-7 items-center justify-center rounded-full border text-[11px] font-bold",
                  done
                    ? "border-primary bg-primary text-primary-foreground"
                    : isActive
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-secondary text-muted-foreground",
                )}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : s.num}
              </span>
              <span>{s.label}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={cn("h-px w-12", s.num < active ? "bg-primary" : "bg-border")} />
            )}
          </div>
        );
      })}
    </div>
  );
}
