// Phase 4 Revision - Intake: 3-step stepper for the Venue Scout brief flow.
// Visual structure lifted 1:1 from src/components/talent-scout/Stepper.tsx,
// parameterized to take a 3-element `steps` array. Generalizing into a shared
// cross-surface component is out of scope (spec § 2); this stays VS-side until
// a third surface needs a stepper.
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

// Default labels for the brief intake. Override via the `steps` prop if a
// future VS surface reuses this stepper with different labels.
const BRIEF_STEPS = ["Event", "Venue", "Review"] as const;

export function Stepper({
  active,
  steps = BRIEF_STEPS,
}: {
  active: 1 | 2 | 3;
  steps?: readonly [string, string, string];
}) {
  return (
    <div className="mb-8 flex items-center gap-3 py-2">
      {steps.map((label, i) => {
        const num = i + 1;
        const done = num < active;
        const isActive = num === active;
        return (
          <div key={label} className="flex items-center gap-3">
            <div
              className={cn(
                "flex items-center gap-2.5 font-mono text-sm font-bold uppercase tracking-wider",
                // Active label reads coral; reached (done) reads white;
                // unreached (disabled) stays grey.
                isActive
                  ? "text-primary"
                  : done
                    ? "text-foreground"
                    : "text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "inline-flex h-9 w-9 items-center justify-center rounded-full border text-[13px] font-bold",
                  done
                    ? "border-primary bg-primary text-primary-foreground"
                    : isActive
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-input text-muted-foreground",
                )}
              >
                {done ? <Check className="h-4 w-4" /> : num}
              </span>
              <span>{label}</span>
            </div>
            {i < steps.length - 1 && (
              <div className={cn("h-px w-14", num < active ? "bg-primary" : "bg-border")} />
            )}
          </div>
        );
      })}
    </div>
  );
}
