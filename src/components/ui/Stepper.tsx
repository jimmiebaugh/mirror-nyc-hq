import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Generic wizard stepper. Renders an N-step horizontal indicator with the
 * current step highlighted, prior steps marked done with a check, and
 * remaining steps muted. `active` is 1-indexed.
 *
 * Lifted from src/components/talent-scout/Stepper.tsx in Phase 5.9.1 when
 * the bulk-import flow needed a 5-step variant. Consumers: TS new-role
 * wizard (3 steps), BulkImportPage (5 steps). The VS brief stepper
 * (src/components/venue-scout/Stepper.tsx) is a separate larger variant
 * and stays put.
 */
export function Stepper({
  steps,
  active,
}: {
  steps: readonly string[];
  active: number;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-center gap-x-3 gap-y-3 py-2">
      {steps.map((label, i) => {
        const num = i + 1;
        const done = num < active;
        const isActive = num === active;
        return (
          <div key={label} className="flex items-center gap-3">
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
                {done ? <Check className="h-3.5 w-3.5" /> : num}
              </span>
              <span>{label}</span>
            </div>
            {i < steps.length - 1 && (
              <div className={cn("hidden h-px w-12 sm:block", num < active ? "bg-primary" : "bg-border")} />
            )}
          </div>
        );
      })}
    </div>
  );
}
