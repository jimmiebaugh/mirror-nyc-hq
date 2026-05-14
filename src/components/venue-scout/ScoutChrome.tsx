// Phase 4.9-port: shared per-scout chrome used by every action page in the
// Venue Scout flow (Brief intake pages, SheetPrompt, SheetUpload,
// SourcingReport, Shortlist, Review, DeckPrep, ErrorState). Loading screens
// are excluded by design (Researching, Compiling, Generating) -- producers
// wait on those, they can't take Settings or step-through actions mid-flight.
//
// Two named exports:
//
//   <ScoutSettingsLink scoutId={id} />
//     Right-slot gear icon. Always visible. Routes to
//     /venue-scout/scouts/:id/settings.
//
//   <ScoutStepThroughNav scoutId={id} scout?={scout} />
//     Nav strip rendered below the page header. Phase 4 Revision: now ALWAYS
//     visible for any scout with a defined current_step (was completed-only).
//     Each chip is clickable once the scout has reached that step, and
//     renders disabled (reduced opacity, no hover) until then. Pages already
//     querying the scout pass the meta as the `scout` prop; pages without an
//     existing query omit it and the component self-queries.
//
// Step-through chips:
//   - 5 phase chips (Brief, Sourcing, Shortlist, Final Review, Deck Prep).
//     The Brief chip routes at /brief (the redirect index dispatches to the
//     in-progress step mid-intake or the report view post-intake).
//   - 1 deck chip (latest entry in generated_decks). Opens in a new tab via
//     the entry's edit_url. Only renders when there's at least one entry
//     with a Drive edit URL.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { stepToRoute } from "@/lib/venue-scout/format";

// Loose shape so callers can pass anything that includes the two columns
// we care about. The vs_scouts Row type pulls in too many unrelated
// columns to be ergonomic here.
type ScoutMeta = {
  current_step: string | null;
  generated_decks: unknown;
};

type DeckMeta = {
  deck_id?: string;
  deck_name?: string;
  version?: number;
  edit_url?: string;
  embed_url?: string;
};

// Ordered step machine. `isStepReached` compares positions: a chip is
// reachable once the scout's current_step is at or past the chip's step.
const STEP_ORDER = [
  "brief",
  "sheet_prompt",
  "sheet_upload",
  "researching",
  "sourcing_report",
  "shortlist",
  "review_selects",
  "compiling",
  "deck_prep",
  "completed",
] as const;

function isStepReached(currentStep: string, chipStep: string): boolean {
  return STEP_ORDER.indexOf(currentStep as (typeof STEP_ORDER)[number]) >=
    STEP_ORDER.indexOf(chipStep as (typeof STEP_ORDER)[number]);
}

// Producer-visible step-through chips. Order matches the natural flow so the
// strip reads left-to-right as the phases the producer walks through. The
// Brief chip routes at /brief (the redirect index) so it lands on the right
// surface based on current_step; the other chips route via stepToRoute().
const NAV_CHIPS: {
  label: string;
  reachedAtStep: string;
  route: (id: string) => string;
}[] = [
  {
    label: "Brief",
    reachedAtStep: "brief",
    route: (id) => `/venue-scout/scouts/${id}/brief`,
  },
  {
    label: "Sourcing",
    reachedAtStep: "sourcing_report",
    route: (id) => stepToRoute(id, "sourcing_report"),
  },
  {
    label: "Shortlist",
    reachedAtStep: "shortlist",
    route: (id) => stepToRoute(id, "shortlist"),
  },
  {
    label: "Final Review",
    reachedAtStep: "review_selects",
    route: (id) => stepToRoute(id, "review_selects"),
  },
  {
    label: "Deck Prep",
    reachedAtStep: "deck_prep",
    route: (id) => stepToRoute(id, "deck_prep"),
  },
];

const CHIP_BASE =
  "inline-flex items-center rounded bg-input px-4 py-2 text-[13px] font-mono font-bold uppercase tracking-wider";

export function ScoutSettingsLink({ scoutId }: { scoutId: string }) {
  return (
    <Link to={`/venue-scout/scouts/${scoutId}/settings`} title="Scout settings">
      <Button variant="outline" size="icon" aria-label="Scout settings">
        <Settings className="h-4 w-4" />
      </Button>
    </Link>
  );
}

export function ScoutStepThroughNav({
  scoutId,
  scout: scoutProp,
}: {
  scoutId: string;
  scout?: ScoutMeta | null;
}) {
  // When the caller passes scoutProp (even null), we trust it and skip the
  // self-query. Only pages that omit the prop (`scoutProp === undefined`)
  // trigger an internal select.
  const [scout, setScout] = useState<ScoutMeta | null>(
    scoutProp === undefined ? null : scoutProp,
  );

  useEffect(() => {
    if (scoutProp !== undefined) {
      setScout(scoutProp);
      return;
    }
    let cancelled = false;
    supabase
      .from("vs_scouts")
      .select("current_step, generated_decks")
      .eq("id", scoutId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setScout((data as ScoutMeta | null) ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [scoutId, scoutProp]);

  // Render for every scout with a defined current_step (Phase 4 Revision:
  // was previously completed-only).
  if (!scout || !scout.current_step) return null;
  const currentStep = scout.current_step;

  const decks = (Array.isArray(scout.generated_decks)
    ? (scout.generated_decks as DeckMeta[])
    : []) as DeckMeta[];
  const latestDeck = decks.length > 0 ? decks[decks.length - 1] : undefined;

  // The "active" chip is the furthest-reached one -- where the scout
  // currently sits. Reached chips are a prefix of NAV_CHIPS (isStepReached
  // is monotonic), so the active index is just the last reached one. The
  // Brief chip (index 0) is always reached, so this is never -1.
  let activeChipIndex = 0;
  NAV_CHIPS.forEach((chip, i) => {
    if (isStepReached(currentStep, chip.reachedAtStep)) activeChipIndex = i;
  });

  return (
    <nav className="mb-6 flex flex-wrap items-center justify-center gap-2 rounded-md border border-border bg-surface-alt p-3">
      {NAV_CHIPS.map((chip, i) => {
        const reached = isStepReached(currentStep, chip.reachedAtStep);
        if (reached) {
          const isActive = i === activeChipIndex;
          return (
            <Link
              key={chip.label}
              to={chip.route(scoutId)}
              className={`${CHIP_BASE} transition-colors hover:bg-primary/10 ${
                isActive
                  ? "text-primary"
                  : "text-foreground hover:text-primary"
              }`}
            >
              {chip.label}
            </Link>
          );
        }
        return (
          <span
            key={chip.label}
            aria-disabled="true"
            className={`${CHIP_BASE} cursor-not-allowed text-muted-foreground/40 opacity-60`}
          >
            {chip.label}
          </span>
        );
      })}
      {latestDeck?.edit_url && (
        <a
          href={latestDeck.edit_url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded bg-primary/15 px-4 py-2 text-[13px] font-mono font-bold uppercase tracking-wider text-primary transition-colors hover:bg-primary/25"
        >
          {typeof latestDeck.version === "number"
            ? `Generated Deck v${latestDeck.version}`
            : "Generated Deck"}
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
    </nav>
  );
}
