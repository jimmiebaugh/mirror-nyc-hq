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

export type ScoutStep =
  | "brief"
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
    case "brief":
      // The /brief redirect index dispatches to /brief/event mid-intake or
      // /brief/report once the scout is past intake.
      return `/venue-scout/scouts/${scoutId}/brief`;
    case "sheet_upload":
      // Phase 5.12.14.1 Stage 2C: /sourcing/sheet-upload merged into
      // /sourcing/sheet-prompt with an expanding upload card. The
      // sheet_upload enum value still routes here; the ?upload=1 flag
      // auto-expands the upload section on landing.
      return `/venue-scout/scouts/${scoutId}/sourcing/sheet-prompt?upload=1`;
    case "researching":
      return `/venue-scout/scouts/${scoutId}/sourcing/researching`;
    case "sourcing_report":
      return `/venue-scout/scouts/${scoutId}/sourcing/report`;
    case "shortlist":
      return `/venue-scout/scouts/${scoutId}/sourcing/shortlist`;
    case "review_selects":
      // Phase 5.12.15: legacy enum value; routes forward to the
      // consolidated Review surface. No backfill migration.
      return `/venue-scout/scouts/${scoutId}/review`;
    case "compiling":
      return `/venue-scout/scouts/${scoutId}/sourcing/compiling`;
    case "deck_prep":
      return `/venue-scout/scouts/${scoutId}/review`;
    case "completed":
      return `/venue-scout/scouts/${scoutId}/brief`;
    case "sheet_prompt":
    default:
      return `/venue-scout/scouts/${scoutId}/sourcing/sheet-prompt`;
  }
}

// Phase 4.10.3-port: source priority for the matrix sort. Phase 5.12.1
// extends to 4 tiers: manual venues pin to the top (producer-added are
// always visible), then uploaded sheet rows (producer-curated), then HQ
// pool rows (admin-curated, auto-loaded by vs-research-venues), then AI
// research rows. Within each tier, rank desc. Used by SourcingReport +
// Shortlist; DeckPrep stays on producer-controlled dnd-kit order (port
// plan § 9 4.6-port lock).
//
// `source` column values are 'manual' | 'sheet' | 'hq_pool' | 'research'
// per the vs_candidate_venues CHECK constraint (widened from 3 values to 4
// in the Phase 5.12.1 migration). Unknown or null values fall back to
// lowest priority so they sort to the bottom.
export const SOURCE_PRIORITY: Record<string, number> = {
  manual: 0,
  sheet: 1,
  hq_pool: 2,
  research: 3,
};

// Producer-facing label for the Phase column on Scout Index. Tweak in one
// place if copy needs to shift.
export function currentStepToLabel(step: string | null | undefined): string {
  switch (step) {
    // Phase 4 Revision: one "Brief" label covers both the in-flight intake
    // step (`brief`) and the post-confirmation state (`sheet_prompt`), so the
    // Scout Index Phase column mirrors the Revisit chip.
    case "brief":
      return "Brief";
    case "sheet_prompt":
      return "Brief";
    case "sheet_upload":
      return "Sheet Upload";
    case "researching":
      return "AI Sourcing";
    case "sourcing_report":
      return "Sourcing";
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
