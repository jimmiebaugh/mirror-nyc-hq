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
// Step-through chips (Phase 4 Revision pass 2):
//   - 6 chips (Brief, Sourcing, Shortlist, Final Review, Deck Prep, Overview).
//     The Brief chip routes into the intake stepper at /brief/event ("edit
//     brief" mode -- briefIntakeStore carries unsaved state across mounts).
//     The Overview chip is pinned last and routes to the canonical Brief
//     report at /brief/report; reachable once the scout is at sheet_prompt
//     or past.
//   - The active chip is route-based, not step-based: it reflects where the
//     producer is right now (URL match), not how far the scout has
//     progressed. Pages outside the chip set (Settings, ErrorState) highlight
//     nothing.
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { stepToRoute } from "@/lib/venue-scout/format";

// Loose shape so callers can pass anything that includes the one column we
// care about. The vs_scouts Row type pulls in too many unrelated columns to
// be ergonomic here.
type ScoutMeta = {
  current_step: string | null;
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
// strip reads left-to-right as the phases the producer walks through, with
// Overview pinned last. The Brief chip routes into the intake stepper at
// /brief/event ("edit brief" mode); Overview routes to the canonical Brief
// report at /brief/report; the middle chips route via stepToRoute().
const NAV_CHIPS: {
  label: string;
  reachedAtStep: string;
  route: (id: string) => string;
}[] = [
  {
    label: "Brief",
    reachedAtStep: "brief",
    route: (id) => `/venue-scout/scouts/${id}/brief/event`,
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
  {
    label: "Overview",
    reachedAtStep: "sheet_prompt",
    route: (id) => `/venue-scout/scouts/${id}/brief/report`,
  },
];

// Active-chip resolution is route-based: the chip whose path prefix matches
// the current URL is active, independent of how far the scout has progressed.
// Resolution order matters -- more specific prefixes first so /sourcing/review
// resolves to Final Review, not the broad Sourcing prefix. Prefix (not exact)
// matching keeps a chip active across sub-routes, hash fragments, and query
// strings. Returns null on pages outside the chip set (Settings, ErrorState).
function resolveActiveChip(pathname: string, scoutId: string): string | null {
  const root = `/venue-scout/scouts/${scoutId}`;
  const matches: { label: string; prefix: string }[] = [
    { label: "Overview", prefix: `${root}/brief/report` },
    { label: "Deck Prep", prefix: `${root}/deck/prep` },
    { label: "Final Review", prefix: `${root}/sourcing/review` },
    { label: "Shortlist", prefix: `${root}/sourcing/shortlist` },
    { label: "Sourcing", prefix: `${root}/sourcing` },
    { label: "Brief", prefix: `${root}/brief` },
  ];
  for (const m of matches) {
    if (pathname === m.prefix || pathname.startsWith(`${m.prefix}/`)) {
      return m.label;
    }
  }
  return null;
}

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
  const { pathname } = useLocation();

  useEffect(() => {
    if (scoutProp !== undefined) {
      setScout(scoutProp);
      return;
    }
    let cancelled = false;
    supabase
      .from("vs_scouts")
      .select("current_step")
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

  // Active chip reflects where the producer is viewing right now (URL match),
  // not how far the scout has progressed. Null on pages outside the chip set.
  const activeChipLabel = resolveActiveChip(pathname, scoutId);

  return (
    <nav className="mb-6 flex flex-wrap items-center justify-center gap-2 rounded-md border border-border bg-surface-alt p-3">
      {NAV_CHIPS.map((chip) => {
        const reached = isStepReached(currentStep, chip.reachedAtStep);
        if (reached) {
          const isActive = chip.label === activeChipLabel;
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
    </nav>
  );
}
