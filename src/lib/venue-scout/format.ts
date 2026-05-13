// Ported from mirror-nyc-venue-scout-pro/src/lib/format.ts.
// Route prefix swapped from /projects/:id to /venue-scout/scouts/:id and the
// step-label helper added so Scout Index can derive the producer-facing
// "Phase" column from current_step (port plan locks no schema column).

export function relativeTime(iso: string): string {
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min${m === 1 ? "" : "s"} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const days = Math.floor(h / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "last week";
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  return new Date(iso).toLocaleDateString();
}

export type StatusPill = {
  label: string;
  cls: string;
  dot: string;
};

export function statusPill(status: string): StatusPill {
  switch (status) {
    case "in_progress":
      return {
        label: "In Progress",
        cls: "bg-primary/15 text-primary border-primary/30",
        dot: "bg-primary",
      };
    case "complete":
      return {
        label: "Complete",
        cls: "bg-[hsl(var(--success))]/15 text-[hsl(var(--success))] border-[hsl(var(--success))]/30",
        dot: "bg-[hsl(var(--success))]",
      };
    case "draft":
    default:
      return {
        label: "Draft",
        cls: "bg-muted text-muted-foreground border-border",
        dot: "bg-muted-foreground",
      };
  }
}

export type ScoutStep =
  | "sheet_prompt"
  | "sheet_upload"
  | "researching"
  | "sourcing_report"
  | "shortlist"
  | "review_selects"
  | "compiling"
  | "deck_prep"
  | "completed";

export function stepToRoute(scoutId: string, step: string | null | undefined): string {
  switch (step) {
    case "sheet_upload":
      return `/venue-scout/scouts/${scoutId}/sourcing/sheet-upload`;
    case "researching":
      return `/venue-scout/scouts/${scoutId}/sourcing/researching`;
    case "sourcing_report":
      return `/venue-scout/scouts/${scoutId}/sourcing/report`;
    case "shortlist":
      return `/venue-scout/scouts/${scoutId}/sourcing/shortlist`;
    case "review_selects":
      return `/venue-scout/scouts/${scoutId}/sourcing/review`;
    case "compiling":
      return `/venue-scout/scouts/${scoutId}/sourcing/compiling`;
    case "deck_prep":
      return `/venue-scout/scouts/${scoutId}/deck/prep`;
    case "completed":
      return `/venue-scout/scouts/${scoutId}/brief`;
    case "sheet_prompt":
    default:
      return `/venue-scout/scouts/${scoutId}/sourcing/sheet-prompt`;
  }
}

export function isInProgress(step: string | null | undefined): boolean {
  return !!step && step !== "sheet_prompt" && step !== "completed";
}

// Phase 4.10.3-port: 3-tier source priority for the matrix sort.
// Manual venues pin to the top (producer-added are always visible), then
// uploaded sheet rows, then AI-research rows. Within each tier, rank desc.
// Used by SourcingReport + Shortlist; DeckPrep stays on producer-controlled
// dnd-kit order (port plan § 9 4.6-port lock).
//
// `source` column values are 'manual' | 'sheet' | 'research' per the
// vs_candidate_venues constraint (port plan § 4.1-port migration). Unknown
// or null values fall back to lowest priority so they sort to the bottom.
export const SOURCE_PRIORITY: Record<string, number> = {
  manual: 0,
  sheet: 1,
  research: 2,
};

// Producer-facing label for the Phase column on Scout Index. Tweak in one
// place if copy needs to shift.
export function currentStepToLabel(step: string | null | undefined): string {
  switch (step) {
    case "sheet_prompt":
      return "Brief & Setup";
    case "sheet_upload":
      return "Sheet Upload";
    case "researching":
      return "AI Sourcing";
    case "sourcing_report":
      return "Sourcing Report";
    case "shortlist":
      return "Shortlist";
    case "review_selects":
      return "Final Review";
    case "compiling":
      return "Compiling";
    case "deck_prep":
      return "Deck Prep";
    case "completed":
      return "Complete";
    default:
      return "-";
  }
}
