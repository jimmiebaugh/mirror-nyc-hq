// Phase 4 Revision - Intake: 3-step stepper for the Venue Scout brief flow.
// Visual structure lifted 1:1 from src/components/talent-scout/Stepper.tsx,
// parameterized to take a 3-element `steps` array. Generalizing into a shared
// cross-surface component is out of scope (spec § 2); this stays VS-side until
// a third surface needs a stepper.
//
// Phase 5.12.14.1 Stage 2C revision round: visually shrunk + treated as an
// informational sub-indicator (NOT a clickable control). The intake step
// can't be navigated by tapping the stepper, so the chrome reads "status"
// rather than "control": smaller circles, smaller labels, no hover state
// (was never interactive anyway), and the calling page wraps this in a
// rounded-rectangle pill with a coral connector dropping from the Brief
// step in ScoutPhaseBreadcrumb to nest it visually.
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

// Default labels for the brief intake. Override via the `steps` prop if a
// future VS surface reuses this stepper with different labels.
const BRIEF_STEPS = ["Event", "Venue", "Overview"] as const;

// `active` accepts 1-3 (the active step) plus 4 to render the "completed"
// state where every step displays with a check (the BriefReport posture).
export function Stepper({
  active,
  steps = BRIEF_STEPS,
}: {
  active: 1 | 2 | 3 | 4;
  steps?: readonly [string, string, string];
}) {
  return (
    <div className="flex items-center gap-2">
      {steps.map((label, i) => {
        const num = i + 1;
        const done = num < active;
        const isActive = num === active;
        return (
          <div key={label} className="flex items-center gap-2">
            <div
              className={cn(
                "flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-wider",
                isActive
                  ? "text-primary"
                  : done
                    ? "text-foreground"
                    : "text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "inline-flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-bold",
                  done
                    ? "border-primary bg-primary text-primary-foreground"
                    : isActive
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-input text-muted-foreground",
                )}
              >
                {done ? <Check className="h-2.5 w-2.5" /> : num}
              </span>
              <span>{label}</span>
            </div>
            {i < steps.length - 1 && (
              <div className={cn("h-px w-6", num < active ? "bg-primary" : "bg-border")} />
            )}
          </div>
        );
      })}
    </div>
  );
}
