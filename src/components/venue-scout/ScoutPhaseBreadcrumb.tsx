// Phase 5.12.14: scout-level breadcrumb-stepper. Smaller, numbered-circle
// horizontal breadcrumb that reads as part of the standard HQ page header
// rather than a heavy secondary nav strip.
//
// Visual: `(1) BRIEF › (2) SOURCING › (3) SHORTLIST › (4) REVIEW › (5) OVERVIEW`.
// 20px circles, mono uppercase labels, chevron separators. No card / border /
// background container — the breadcrumb sits inline below the page crumb,
// above the eyebrow.
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { stepToRoute } from "@/lib/venue-scout/format";

type ScoutMeta = {
  current_step: string | null;
};

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

type Phase = {
  num: number;
  label: string;
  reachedAtStep: string;
  route: (id: string) => string;
};

const PHASES: Phase[] = [
  {
    num: 1,
    label: "Brief",
    reachedAtStep: "brief",
    route: (id) => `/venue-scout/scouts/${id}/brief/event`,
  },
  {
    num: 2,
    label: "Sourcing",
    reachedAtStep: "sourcing_report",
    route: (id) => stepToRoute(id, "sourcing_report"),
  },
  {
    num: 3,
    label: "Shortlist",
    reachedAtStep: "shortlist",
    route: (id) => stepToRoute(id, "shortlist"),
  },
  {
    num: 4,
    label: "Review",
    reachedAtStep: "deck_prep",
    route: (id) => stepToRoute(id, "deck_prep"),
  },
  {
    num: 5,
    label: "Overview",
    reachedAtStep: "completed",
    route: (id) => `/venue-scout/scouts/${id}/brief/report`,
  },
];

function resolveActiveLabel(pathname: string, scoutId: string): string | null {
  const root = `/venue-scout/scouts/${scoutId}`;
  const matches: { label: string; prefix: string }[] = [
    { label: "Overview", prefix: `${root}/brief/report` },
    { label: "Review", prefix: `${root}/review` },
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

export function ScoutPhaseBreadcrumb({
  scoutId,
  scout: scoutProp,
}: {
  scoutId: string;
  scout?: ScoutMeta | null;
}) {
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

  if (!scout || !scout.current_step) return null;
  const currentStep = scout.current_step;
  const activeLabel = resolveActiveLabel(pathname, scoutId);

  return (
    // R7 amendment v3 § 4: single-row enforcement. flex-wrap → flex-nowrap,
    // responsive gap-x scale (gap-x-1.5 → md:gap-x-2 → lg:gap-x-3), and
    // hidden below md so the stepper doesn't crowd narrow viewports
    // (5 phases + 4 chevrons + labels at standard sizing clears ~660px;
    // below md the page chrome doesn't have horizontal room to fit it
    // single-row, and the TopBar already carries the back-crumb so
    // navigation isn't lost when the stepper hides).
    //
    // `flex-1` so the nav fills its parent flex row (every consumer page
    // puts it in a `flex justify-between` row with the settings link on
    // the right). Without `flex-1` the nav is intrinsic-width, and the
    // `justify-center` inside is a no-op.
    <nav className="mb-4 hidden md:flex flex-1 flex-nowrap items-center justify-center gap-x-1.5 md:gap-x-2 lg:gap-x-3 py-2 whitespace-nowrap">
      {PHASES.map((phase, i) => {
        const reached = isStepReached(currentStep, phase.reachedAtStep);
        const isActive = phase.label === activeLabel;
        const node = (
          <PhaseStep
            num={phase.num}
            label={phase.label}
            state={
              isActive ? "active" : reached ? "reached" : "unreached"
            }
          />
        );
        const groupKey = `phase-${phase.num}`;
        const wrapper =
          reached && !isActive ? (
            <Link
              key={groupKey}
              to={phase.route(scoutId)}
              className="inline-flex items-center gap-2.5 rounded px-1 py-0.5 transition-colors hover:bg-primary/10"
            >
              {node}
            </Link>
          ) : (
            <span key={groupKey} className="inline-flex items-center gap-2.5 px-1 py-0.5">
              {node}
            </span>
          );
        return (
          <span key={`group-${phase.num}`} className="inline-flex items-center gap-2">
            {wrapper}
            {i < PHASES.length - 1 ? (
              <Separator
                hot={
                  isStepReached(currentStep, phase.reachedAtStep) &&
                  isStepReached(currentStep, PHASES[i + 1].reachedAtStep)
                }
              />
            ) : null}
          </span>
        );
      })}
    </nav>
  );
}

function PhaseStep({
  num,
  label,
  state,
}: {
  num: number;
  label: string;
  state: "active" | "reached" | "unreached";
}) {
  const circleClass =
    state === "active"
      ? "border-foreground bg-foreground text-background"
      : state === "reached"
        ? "border-primary bg-primary text-primary-foreground"
        : "border-border bg-input text-muted-foreground";
  const labelClass =
    state === "active"
      ? "text-primary"
      : state === "reached"
        ? "text-foreground"
        : "text-muted-foreground";
  // R7 amendment v3 § 4: responsive scale for the phase circles + labels
  // so the 5-phase row stays single-row from md (~768) up. h-5/w-5 →
  // h-5/w-5 → h-6/w-6 across breakpoints. Label text scales similarly.
  return (
    <>
      <span
        className={`inline-flex h-5 w-5 md:h-5 md:w-5 lg:h-6 lg:w-6 items-center justify-center rounded-full border text-[10px] md:text-[10px] lg:text-[11px] font-bold ${circleClass}`}
      >
        {state === "reached" ? <Check className="h-3 w-3 lg:h-3.5 lg:w-3.5" /> : num}
      </span>
      <span
        className={`text-[11px] md:text-[12px] lg:text-[13px] font-mono font-bold uppercase tracking-[0.06em] md:tracking-[0.07em] lg:tracking-[0.08em] whitespace-nowrap ${labelClass}`}
      >
        {label}
      </span>
    </>
  );
}

function Separator({ hot }: { hot: boolean }) {
  return (
    <span
      aria-hidden
      className={`mx-1 text-[14px] ${hot ? "text-primary" : "text-border"}`}
    >
      ›
    </span>
  );
}
