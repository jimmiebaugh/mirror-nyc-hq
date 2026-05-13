// Phase 4.9-port: shared per-scout chrome used by every action page in the
// Venue Scout flow (Brief, SheetPrompt, SheetUpload, SourcingReport,
// Shortlist, Review, DeckPrep, ErrorState). Loading screens are excluded
// by design (Researching, Compiling, Generating) -- producers wait on
// those, they can't take Settings or step-through actions mid-flight.
//
// Two named exports:
//
//   <ScoutSettingsLink scoutId={id} />
//     Right-slot gear icon. Always visible. Routes to
//     /venue-scout/scouts/:id/settings.
//
//   <ScoutStepThroughNav scoutId={id} scout?={scout} />
//     Conditional nav strip rendered below the page header. Renders ONLY
//     when current_step === 'completed'. Pages already querying the scout
//     pass the meta as the `scout` prop; pages without an existing query
//     (SheetPrompt, SheetUpload) omit it and the component self-queries.
//
// Step-through chips:
//   - 5 phase chips (sheet_prompt, sourcing_report, shortlist,
//     review_selects, deck_prep) route via stepToRoute().
//   - 1 deck chip (latest entry in generated_decks). Opens in a new tab
//     via the entry's edit_url. Only renders when there's at least one
//     entry with a Drive edit URL.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { currentStepToLabel, stepToRoute } from "@/lib/venue-scout/format";

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

// Producer-visible step-through chips. Order matches the natural flow
// (Brief -> Sourcing Report -> Shortlist -> Review -> Deck Prep) so the
// strip reads left-to-right as the phases the producer would walk through.
const STEP_KEYS_FOR_NAV = [
  "sheet_prompt",
  "sourcing_report",
  "shortlist",
  "review_selects",
  "deck_prep",
] as const;

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

  if (!scout || scout.current_step !== "completed") return null;

  const decks = (Array.isArray(scout.generated_decks)
    ? (scout.generated_decks as DeckMeta[])
    : []) as DeckMeta[];
  const latestDeck = decks.length > 0 ? decks[decks.length - 1] : undefined;

  return (
    <nav className="mb-6 flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-alt p-3">
      <span className="mr-1 text-[10px] font-mono font-bold uppercase tracking-[0.14em] text-muted-foreground">
        Revisit:
      </span>
      {STEP_KEYS_FOR_NAV.map((stepKey) => (
        <Link
          key={stepKey}
          to={stepToRoute(scoutId, stepKey)}
          className="inline-flex items-center rounded bg-input px-3 py-1.5 text-[11px] font-mono font-bold uppercase tracking-wider text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
        >
          {currentStepToLabel(stepKey)}
        </Link>
      ))}
      {latestDeck?.edit_url && (
        <a
          href={latestDeck.edit_url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded bg-primary/15 px-3 py-1.5 text-[11px] font-mono font-bold uppercase tracking-wider text-primary transition-colors hover:bg-primary/25"
        >
          {typeof latestDeck.version === "number"
            ? `Generated Deck v${latestDeck.version}`
            : "Generated Deck"}
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </nav>
  );
}
